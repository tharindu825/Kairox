import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { NormalizedCandle } from '../market-data/binance';
import { alertQueue } from '@/workers/queues';
import { Decimal } from 'decimal.js';

// ─── Constants ───────────────────────────────────────────────────────────────
/** Binance taker fee rate (0.06% per side — standard VIP 0 spot/futures) */
const TAKER_FEE_RATE = 0.0006;

/** Partial TP exit split ratios — must sum to 1.0 */
const TP1_RATIO = 0.50; // 50% of position closed at TP1
const TP2_RATIO = 0.30; // 30% closed at TP2
// TP3 closes the remaining 20% (whatever is left)

/** Trailing stop distance as fraction of price, activated after TP2 is hit */
const TRAILING_STOP_PCT = 0.015; // 1.5%

/** Pending order expiry window */
const PENDING_EXPIRY_MS = 8 * 60 * 60 * 1000; // 8 hours

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcFee(price: number, qty: number): number {
  return price * qty * TAKER_FEE_RATE;
}

function calcGrossPnl(side: string, entry: number, exit: number, qty: number): number {
  return side === 'LONG' ? (exit - entry) * qty : (entry - exit) * qty;
}

function fmt(n: number, dp = 4): string {
  return n.toFixed(dp);
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class PaperTradingService {
  /**
   * Called on every live candle tick. Evaluates all OPEN/PENDING orders for
   * the given symbol, applying real-exchange logic:
   *
   *  - Pending → OPEN when entry price is touched by candle high/low
   *  - SL fills at candle.low (LONG) or candle.high (SHORT) — worst-case fill
   *  - TP1 fills 50%, moves SL to breakeven
   *  - TP2 fills 30%, activates trailing stop on remaining 20%
   *  - TP3 fills remaining 20%, closes the trade
   *  - Trailing stop uses high-water mark and TRAILING_STOP_PCT distance
   *  - Every exit leg deducts TAKER_FEE_RATE on both sides
   */
  async processLiveTick(candle: NormalizedCandle) {
    const db = await getDb();

    const activeOrders = await db.collection('paperOrders')
      .find({ symbol: candle.symbol, status: { $in: ['OPEN', 'PENDING'] } })
      .toArray();

    if (activeOrders.length === 0) return;

    for (const order of activeOrders) {
      const orderId = order._id.toString();
      try {
        if (order.status === 'PENDING') {
          await this._processPending(order, orderId, candle, db);
        } else {
          await this._processOpen(order, orderId, candle, db);
        }
      } catch (err) {
        console.error(`[Paper Trade] Error on order ${orderId}:`, err);
      }
    }
  }

  // ── PENDING order: check entry trigger or expiry ──────────────────────────

  private async _processPending(order: any, orderId: string, candle: NormalizedCandle, db: any) {
    const now = new Date();
    const age = now.getTime() - new Date(order.openedAt || now).getTime();

    if (age > PENDING_EXPIRY_MS) {
      await db.collection('paperOrders').updateOne(
        { _id: new ObjectId(orderId) },
        { $set: { status: 'EXPIRED', closedAt: now, exitReason: 'TIMEOUT' } }
      );
      if (order.signalId) {
        await db.collection('signals').updateOne(
          { _id: new ObjectId(order.signalId) },
          { $set: { status: 'EXPIRED', updatedAt: now } }
        );
      }
      console.log(`[Paper Trade] ${orderId} expired (8h, entry never reached).`);
      await alertQueue.add('send-telegram', {
        signalId: order.signalId,
        message: `⏰ SIGNAL EXPIRED: ${candle.symbol}\n\nSide: ${order.side}\nEntry price $${fmt(order.entryPrice)} was not reached within 8 hours.`,
      });
      return;
    }

    const entry = new Decimal(order.entryPrice);
    const entryTriggered = entry.greaterThanOrEqualTo(candle.low) && entry.lessThanOrEqualTo(candle.high);

    if (entryTriggered) {
      const qty = Number(order.remainingQty ?? order.quantity);
      const entryFee = calcFee(entry.toNumber(), qty);
      await db.collection('paperOrders').updateOne(
        { _id: new ObjectId(orderId) },
        {
          $set: {
            status: 'OPEN',
            openedAt: now,
            entryFee,
            feesTotal: entryFee,
            highWaterMark: entry.toNumber(),
          },
        }
      );
      console.log(`[Paper Trade] ${orderId} activated at $${entry} (entry fee $${fmt(entryFee)})`);
      await alertQueue.add('send-telegram', {
        signalId: order.signalId,
        message: `🚀 TRADE OPENED: ${candle.symbol}\n\nSide: ${order.side}\nEntry: $${fmt(entry.toNumber())}\nSize: ${qty} units\nSL: $${fmt(order.stopLoss)}\nFee: $${fmt(entryFee)}`,
      });
    }
  }

  // ── OPEN order: SL, partial TPs, trailing stop ────────────────────────────

  private async _processOpen(order: any, orderId: string, candle: NormalizedCandle, db: any) {
    const side = order.side as 'LONG' | 'SHORT';

    // Worst-case fill prices
    const candleLow  = candle.low;
    const candleHigh = candle.high;
    // TP hits use candle extremes (favourable direction)
    const tpFill   = side === 'LONG' ? candleHigh : candleLow;
    // SL hits use candle extremes (unfavourable direction)
    const slExtreme = side === 'LONG' ? candleLow  : candleHigh;

    const entryPrice    = Number(order.entryPrice);
    let   currentSL     = Number(order.stopLoss);
    const targets: Array<{ label: string; price: number }> = order.targets || [];
    let   remainingQty  = Number(order.remainingQty ?? order.quantity);
    const fullQty       = Number(order.quantity);
    const tp1Hit        = order.tp1Hit === true;
    const tp2Hit        = order.tp2Hit === true;
    const tp3Hit        = order.tp3Hit === true;
    let   feesTotal     = Number(order.feesTotal ?? 0);
    let   realizedPnl   = Number(order.realizedPnl ?? 0);
    let   hwm           = Number(order.highWaterMark ?? entryPrice);
    let   trailing      = order.trailingStopActive === true;

    // ── Update trailing stop ─────────────────────────────────────────────────
    if (trailing) {
      if (side === 'LONG' && candleHigh > hwm) hwm = candleHigh;
      if (side === 'SHORT' && candleLow < hwm)  hwm = candleLow;

      const trailSL = side === 'LONG'
        ? hwm * (1 - TRAILING_STOP_PCT)
        : hwm * (1 + TRAILING_STOP_PCT);

      // Only tighten the SL, never loosen it
      if (side === 'LONG'  && trailSL > currentSL) currentSL = trailSL;
      if (side === 'SHORT' && trailSL < currentSL) currentSL = trailSL;
    }

    // ── SL check (realistic worst-case fill at SL level) ────────────────────
    const slHit = side === 'LONG'
      ? slExtreme <= currentSL
      : slExtreme >= currentSL;

    if (slHit) {
      const slFillPrice = currentSL; // fill exactly at SL
      const grossPnl    = calcGrossPnl(side, entryPrice, slFillPrice, remainingQty);
      const exitFee     = calcFee(slFillPrice, remainingQty);
      const netPnl      = grossPnl - exitFee;
      const totalPnl    = realizedPnl + netPnl;
      const totalFees   = feesTotal + exitFee;
      const reason      = trailing ? 'TRAILING_STOP' : order.breakEvenMoved ? 'BREAKEVEN_STOP' : 'SL_HIT';

      await db.collection('paperOrders').updateOne(
        { _id: new ObjectId(orderId) },
        {
          $set: {
            status: 'STOPPED',
            exitPrice: slFillPrice,
            pnl: round2(totalPnl),
            feesTotal: round4(totalFees),
            remainingQty: 0,
            closedAt: new Date(),
            exitReason: reason,
            highWaterMark: hwm,
          },
          $push: {
            partialExits: {
              $each: [{
                reason,
                qty: remainingQty,
                price: slFillPrice,
                grossPnl: round2(grossPnl),
                fees: round4(exitFee),
                netPnl: round2(netPnl),
                timestamp: new Date(),
              }],
            },
          },
        }
      );

      const emoji = totalPnl >= 0 ? '🟢' : '🔴';
      console.log(`[Paper Trade] ${orderId} stopped (${reason}) @ $${fmt(slFillPrice)} | Net P&L $${round2(totalPnl)}`);
      await alertQueue.add('send-telegram', {
        signalId: order.signalId,
        message: `${emoji} TRADE STOPPED: ${candle.symbol}\n\nSide: ${side} | Reason: ${reason}\nEntry: $${fmt(entryPrice)}\nExit: $${fmt(slFillPrice)}\nNet P&L: $${round2(totalPnl)}\nFees paid: $${round4(totalFees)}`,
      });
      return;
    }

    // ── TP checks (partial exits) ─────────────────────────────────────────────
    const setUpdates: Record<string, any>  = { highWaterMark: hwm };
    const pushExits: any[]                 = [];
    const messages: string[]               = [];

    // ── TP1 — 50% close, move SL to breakeven ────────────────────────────────
    if (!tp1Hit && targets[0]) {
      const tp1 = targets[0].price;
      const triggered = side === 'LONG' ? tpFill >= tp1 : tpFill <= tp1;

      if (triggered) {
        const closeQty  = round8(fullQty * TP1_RATIO);
        const grossPnl  = calcGrossPnl(side, entryPrice, tp1, closeQty);
        const fee       = calcFee(tp1, closeQty);
        const netPnl    = grossPnl - fee;

        realizedPnl     += netPnl;
        feesTotal       += fee;
        remainingQty     = round8(remainingQty - closeQty);

        setUpdates.tp1Hit         = true;
        setUpdates.breakEvenMoved = true;
        setUpdates.stopLoss       = entryPrice;   // ← breakeven
        setUpdates.remainingQty   = remainingQty;
        setUpdates.realizedPnl    = round2(realizedPnl);
        setUpdates.feesTotal      = round4(feesTotal);

        pushExits.push({
          reason: 'TP1_PARTIAL',
          qty: closeQty,
          price: tp1,
          grossPnl: round2(grossPnl),
          fees: round4(fee),
          netPnl: round2(netPnl),
          timestamp: new Date(),
        });

        messages.push(
          `✅ TP1 HIT (50%): ${candle.symbol}\n\nSide: ${side}\nTP1: $${fmt(tp1)}\nClosed: ${closeQty} units\nPartial P&L: $${round2(netPnl)}\n⚡ SL moved to breakeven ($${fmt(entryPrice)})`
        );
        console.log(`[Paper Trade] ${orderId} TP1 @ $${tp1}. SL → breakeven $${entryPrice}. Remaining: ${remainingQty}`);
      }
    }

    // ── TP2 — 30% close, activate trailing stop ───────────────────────────────
    if (!tp2Hit && (setUpdates.tp1Hit || tp1Hit) && targets[1]) {
      const tp2 = targets[1].price;
      const triggered = side === 'LONG' ? tpFill >= tp2 : tpFill <= tp2;

      if (triggered) {
        const closeQty  = round8(Math.min(fullQty * TP2_RATIO, remainingQty));
        const grossPnl  = calcGrossPnl(side, entryPrice, tp2, closeQty);
        const fee       = calcFee(tp2, closeQty);
        const netPnl    = grossPnl - fee;

        realizedPnl    += netPnl;
        feesTotal      += fee;
        remainingQty    = round8(remainingQty - closeQty);
        hwm             = tp2;
        trailing        = true;

        setUpdates.tp2Hit              = true;
        setUpdates.trailingStopActive  = true;
        setUpdates.highWaterMark       = hwm;
        setUpdates.remainingQty        = remainingQty;
        setUpdates.realizedPnl         = round2(realizedPnl);
        setUpdates.feesTotal           = round4(feesTotal);

        pushExits.push({
          reason: 'TP2_PARTIAL',
          qty: closeQty,
          price: tp2,
          grossPnl: round2(grossPnl),
          fees: round4(fee),
          netPnl: round2(netPnl),
          timestamp: new Date(),
        });

        messages.push(
          `✅ TP2 HIT (30%): ${candle.symbol}\n\nSide: ${side}\nTP2: $${fmt(tp2)}\nClosed: ${closeQty} units\nPartial P&L: $${round2(netPnl)}\n🔁 Trailing stop activated (1.5%)`
        );
        console.log(`[Paper Trade] ${orderId} TP2 @ $${tp2}. Trailing stop ON. Remaining: ${remainingQty}`);
      }
    }

    // ── TP3 — close everything remaining ─────────────────────────────────────
    if (!tp3Hit && (setUpdates.tp2Hit || tp2Hit) && targets[2]) {
      const tp3 = targets[2].price;
      const triggered = side === 'LONG' ? tpFill >= tp3 : tpFill <= tp3;

      if (triggered) {
        const closeQty  = remainingQty;
        const grossPnl  = calcGrossPnl(side, entryPrice, tp3, closeQty);
        const fee       = calcFee(tp3, closeQty);
        const netPnl    = grossPnl - fee;
        const totalPnl  = realizedPnl + netPnl;
        const totalFees = feesTotal + fee;

        pushExits.push({
          reason: 'TP3_FULL',
          qty: closeQty,
          price: tp3,
          grossPnl: round2(grossPnl),
          fees: round4(fee),
          netPnl: round2(netPnl),
          timestamp: new Date(),
        });

        await db.collection('paperOrders').updateOne(
          { _id: new ObjectId(orderId) },
          {
            $set: {
              ...setUpdates,
              status: 'CLOSED',
              exitPrice: tp3,
              pnl: round2(totalPnl),
              feesTotal: round4(totalFees),
              remainingQty: 0,
              tp3Hit: true,
              closedAt: new Date(),
              exitReason: 'TP3_FULL',
            },
            $push: { partialExits: { $each: pushExits } },
          }
        );

        for (const msg of messages) {
          await alertQueue.add('send-telegram', { signalId: order.signalId, message: msg });
        }
        await alertQueue.add('send-telegram', {
          signalId: order.signalId,
          message: `🎯 ALL TARGETS HIT: ${candle.symbol}\n\nSide: ${side}\nTP3: $${fmt(tp3)}\nTotal Net P&L: $${round2(totalPnl)}\nTotal Fees: $${round4(totalFees)}\n\nBreakdown:\n• TP1 (50%) ✅\n• TP2 (30%) ✅\n• TP3 (20%) ✅`,
        });
        console.log(`[Paper Trade] ${orderId} ALL TPs HIT. Total P&L $${round2(totalPnl)}`);
        return;
      }
    }

    // Apply intermediate updates (partial TPs hit but trade still open)
    if (Object.keys(setUpdates).length > 0 || pushExits.length > 0) {
      const updateOp: any = { $set: setUpdates };
      if (pushExits.length > 0) {
        updateOp.$push = { partialExits: { $each: pushExits } };
      }
      await db.collection('paperOrders').updateOne({ _id: new ObjectId(orderId) }, updateOp);
      for (const msg of messages) {
        await alertQueue.add('send-telegram', { signalId: order.signalId, message: msg });
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Creates a PENDING paper order from an approved signal.
   * Stores a snapshot of targets, full qty, and all tracking fields at creation time.
   */
  async executeApprovedSignal(signalId: string, quantity: number) {
    const db  = await getDb();
    const sig = await db.collection('signals').findOne({ _id: new ObjectId(signalId) });

    if (!sig || sig.status !== 'APPROVED') return;

    const entryFee = calcFee(Number(sig.entry), quantity);

    const orderData = {
      signalId,
      symbol:             sig.symbol,
      side:               sig.side,
      entryPrice:         sig.entry,
      stopLoss:           sig.stopLoss,
      quantity,
      remainingQty:       quantity,
      /** Immutable snapshot of targets so they cannot drift if the signal is later edited */
      targets:            Array.isArray(sig.targets) ? sig.targets : [],
      // Tracking fields
      tp1Hit:             false,
      tp2Hit:             false,
      tp3Hit:             false,
      breakEvenMoved:     false,
      trailingStopActive: false,
      highWaterMark:      Number(sig.entry),
      entryFee,
      feesTotal:          entryFee,
      realizedPnl:        0,
      partialExits:       [],
      status:             'PENDING',
      openedAt:           new Date(),
    };

    const result = await db.collection('paperOrders').insertOne(orderData);
    console.log(`[Paper Trade] Order ${result.insertedId} created for signal ${signalId} — PENDING at $${sig.entry} (entry fee $${round4(entryFee)})`);
    return { id: result.insertedId.toString(), ...orderData };
  }

  /**
   * Manually closes the remaining open position at the current market price.
   * Deducts taker fee on exit and appends to partialExits log.
   */
  async closeOrder(orderId: string, exitReason = 'MANUAL_CLOSE') {
    const db    = await getDb();
    const order = await db.collection('paperOrders').findOne({ _id: new ObjectId(orderId) });

    if (!order || order.status !== 'OPEN') {
      throw new Error('Order not found or not OPEN');
    }

    const { marketDataService } = await import('../market-data');
    const priceRaw = await marketDataService.getLatestPrice(order.symbol);
    if (!priceRaw) throw new Error(`No live price for ${order.symbol}`);

    const exitPrice    = Number(priceRaw);
    const entryPrice   = Number(order.entryPrice);
    const remainingQty = Number(order.remainingQty ?? order.quantity);
    const prevFees     = Number(order.feesTotal ?? 0);
    const prevPnl      = Number(order.realizedPnl ?? 0);

    const grossPnl  = calcGrossPnl(order.side, entryPrice, exitPrice, remainingQty);
    const exitFee   = calcFee(exitPrice, remainingQty);
    const netPnl    = grossPnl - exitFee;
    const totalPnl  = prevPnl + netPnl;
    const totalFees = prevFees + exitFee;

    await db.collection('paperOrders').updateOne(
      { _id: new ObjectId(orderId) },
      {
        $set: {
          status:       'CLOSED',
          exitPrice,
          pnl:          round2(totalPnl),
          feesTotal:    round4(totalFees),
          remainingQty: 0,
          closedAt:     new Date(),
          exitReason,
        },
        $push: {
          partialExits: {
            $each: [{
              reason: exitReason,
              qty:      remainingQty,
              price:    exitPrice,
              grossPnl: round2(grossPnl),
              fees:     round4(exitFee),
              netPnl:   round2(netPnl),
              timestamp: new Date(),
            }],
          },
        },
      } as any
    );

    await alertQueue.add('send-telegram', {
      signalId: order.signalId,
      message: `⏹️ TRADE CLOSED MANUALLY: ${order.symbol}\n\nSide: ${order.side}\nExit: $${fmt(exitPrice)}\nNet P&L: $${round2(totalPnl)}\nFees: $${round4(totalFees)}`,
    });

    console.log(`[Paper Trade] ${orderId} manually closed @ $${exitPrice} | Net P&L $${round2(totalPnl)}`);
    return { id: orderId, pnl: totalPnl, exitPrice };
  }

  /**
   * Batch-expires all PENDING orders older than 8 hours.
   * Called lazily on GET /api/paper-trades.
   */
  async cleanupExpiredOrders() {
    const db        = await getDb();
    const threshold = new Date(Date.now() - PENDING_EXPIRY_MS);

    const expired = await db.collection('paperOrders')
      .find({ status: 'PENDING', openedAt: { $lt: threshold } })
      .toArray();

    for (const order of expired) {
      await db.collection('paperOrders').updateOne(
        { _id: order._id },
        { $set: { status: 'EXPIRED', closedAt: new Date(), exitReason: 'TIMEOUT' } }
      );
      if (order.signalId) {
        await db.collection('signals').updateOne(
          { _id: new ObjectId(order.signalId) },
          { $set: { status: 'EXPIRED', updatedAt: new Date() } }
        );
      }
      console.log(`[Paper Trade Cleanup] ${order._id} expired (8h, no entry).`);
      try {
        await alertQueue.add('send-telegram', {
          signalId: order.signalId,
          message:  `⏰ SIGNAL EXPIRED: ${order.symbol}\n\nSide: ${order.side}\nEntry $${fmt(order.entryPrice)} never reached within 8 hours.`,
        });
      } catch { /* non-critical */ }
    }
  }
}

export const paperTradingService = new PaperTradingService();

// ─── Rounding helpers ─────────────────────────────────────────────────────────
function round2(n: number) { return Math.round(n * 100) / 100; }
function round4(n: number) { return Math.round(n * 10000) / 10000; }
function round8(n: number) { return Math.round(n * 1e8) / 1e8; }
