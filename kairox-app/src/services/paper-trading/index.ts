import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { NormalizedCandle } from '../market-data/binance';
import { alertQueue } from '@/workers/queues';
import { Decimal } from 'decimal.js';

export class PaperTradingService {
  /**
   * Evaluates all OPEN paper orders against the latest real-time tick to see if
   * a stop-loss or take-profit target has been hit.
   */
  async processLiveTick(candle: NormalizedCandle) {
    const db = await getDb();
    
    const activeOrders = await db.collection('paperOrders')
      .find({ 
        symbol: candle.symbol,
        status: { $in: ['OPEN', 'PENDING'] }
      })
      .toArray();
      
    if (activeOrders.length === 0) return;
    
    const ordersWithSignals = await Promise.all(activeOrders.map(async (order) => {
       let signal = null;
       if (order.signalId) {
          signal = await db.collection('signals').findOne({ _id: new ObjectId(order.signalId) });
       }
       return { id: order._id.toString(), ...order, signal } as any;
    }));

    for (const order of ordersWithSignals) {
      if (order.status === 'PENDING') {
         const now = new Date();
         const orderTime = new Date(order.openedAt || now);
         const expirationMs = 8 * 60 * 60 * 1000; // 8 hours
         
         if (now.getTime() - orderTime.getTime() > expirationMs) {
            await db.collection('paperOrders').updateOne(
              { _id: new ObjectId(order.id) },
              { $set: { status: 'EXPIRED', closedAt: now, exitReason: 'TIMEOUT' } }
            );
            
            if (order.signalId) {
               await db.collection('signals').updateOne(
                 { _id: new ObjectId(order.signalId) },
                 { $set: { status: 'EXPIRED', updatedAt: now } }
               );
            }
            
            console.log(`[Paper Trade] Order ${order.id} expired without reaching entry price.`);
            
            await alertQueue.add('send-telegram', {
              signalId: order.signalId,
              message: `⏰ SIGNAL EXPIRED: ${candle.symbol}\n\nSide: ${order.side}\n\nThis Signal is expired (Entry price not reached within 8 hours).`
            });
            
            continue;
         }

         const entryPrice = new Decimal(order.entryPrice);
         const lowPrice = new Decimal(candle.low);
         const highPrice = new Decimal(candle.high);

         if (entryPrice.greaterThanOrEqualTo(lowPrice) && entryPrice.lessThanOrEqualTo(highPrice)) {
            await db.collection('paperOrders').updateOne(
              { _id: new ObjectId(order.id) },
              { $set: { status: 'OPEN', openedAt: new Date() } }
            );
            console.log(`[Paper Trade] Order ${order.id} activated at entry price ${entryPrice.toString()}`);
            
            await alertQueue.add('send-telegram', {
              signalId: order.signalId,
              message: `🚀 PAPER TRADE OPENED: ${candle.symbol}\n\nSide: ${order.side}\nEntry Price: ${entryPrice.toString()}\nSize: ${order.quantity}`
            });
         }
         continue;
      }

      const currentPrice = new Decimal(candle.close);
      const stopLoss = new Decimal(order.stopLoss);
      let exitReason: 'STOP_LOSS' | 'TAKE_PROFIT' | null = null;
      let exitPrice: Decimal | null = null;

      // 1. Check Stop Loss
      if (order.side === 'LONG' && currentPrice.lessThanOrEqualTo(stopLoss)) {
        exitReason = 'STOP_LOSS';
        exitPrice = currentPrice;
      } else if (order.side === 'SHORT' && currentPrice.greaterThanOrEqualTo(stopLoss)) {
        exitReason = 'STOP_LOSS';
        exitPrice = currentPrice;
      }

      // 2. Check Targets
      if (!exitReason && order.signal?.targets?.length > 0) {
        const targets = order.signal.targets as any[];
        // For simplicity, we just exit on TP1 right now
        const tp1 = new Decimal(targets[0].price);

        if (order.side === 'LONG' && currentPrice.greaterThanOrEqualTo(tp1)) {
          exitReason = 'TAKE_PROFIT';
          exitPrice = currentPrice;
        } else if (order.side === 'SHORT' && currentPrice.lessThanOrEqualTo(tp1)) {
          exitReason = 'TAKE_PROFIT';
          exitPrice = currentPrice;
        }
      } else if (!exitReason && !order.signal) {
        console.warn(`[Paper Trade] Missing signal data for order ${order.id}. Skipping target check.`);
      }

      // 3. Execute Exit
      if (exitReason && exitPrice) {
        console.log(`[Paper Trade] Order ${order.id} hit ${exitReason} at ${exitPrice.toString()}`);
        
        // Calculate P&L
        const entryPrice = new Decimal(order.entryPrice);
        const quantity = new Decimal(order.quantity);
        
        let pnl = new Decimal(0);
        if (order.side === 'LONG') {
          pnl = exitPrice.minus(entryPrice).times(quantity);
        } else {
          pnl = entryPrice.minus(exitPrice).times(quantity);
        }

        // Close Order
        await db.collection('paperOrders').updateOne(
          { _id: new ObjectId(order.id) },
          {
            $set: {
              status: exitReason === 'STOP_LOSS' ? 'STOPPED' : 'CLOSED',
              exitPrice: exitPrice.toNumber(),
              pnl: pnl.toNumber(),
              closedAt: new Date()
            }
          }
        );

        // Dispatch Alert
        await alertQueue.add('send-telegram', {
          signalId: order.signalId,
          message: `📉 TRADE CLOSED: ${candle.symbol}\n\nSide: ${order.side}\nReason: ${exitReason}\nEntry: ${entryPrice}\nExit: ${exitPrice}\nPnL: $${pnl.toFixed(2)}`
        });
      }
    }
  }

  /**
   * Converts an approved signal into a PENDING paper order at the exact entry price.
   */
  async executeApprovedSignal(signalId: string, quantity: number) {
    const db = await getDb();
    const signal = await db.collection('signals').findOne({ _id: new ObjectId(signalId) });
    
    if (!signal) return;
    if (signal.status !== 'APPROVED') return;

    const orderData = {
      signalId: signalId,
      symbol: signal.symbol,
      side: signal.side,
      entryPrice: signal.entry,
      stopLoss: signal.stopLoss,
      quantity: quantity,
      status: 'PENDING',
      openedAt: new Date(),
    };
    
    const result = await db.collection('paperOrders').insertOne(orderData);

    console.log(`[Paper Trade] Executed paper order ${result.insertedId} for ${signalId} as PENDING at entry price $${signal.entry}`);
    return { id: result.insertedId.toString(), ...orderData };
  }

  /**
   * Manually closes an open paper order at the current market price.
   */
  async closeOrder(orderId: string, exitReason: string = 'MANUAL_CLOSE') {
    const db = await getDb();
    const order = await db.collection('paperOrders').findOne({ _id: new ObjectId(orderId) });

    if (!order || order.status !== 'OPEN') {
      throw new Error('Order not found or already closed');
    }

    // Get current price
    const { marketDataService } = await import('../market-data');
    const currentPriceRaw = await marketDataService.getLatestPrice(order.symbol);
    
    if (!currentPriceRaw) {
      throw new Error(`Could not fetch current price for ${order.symbol}`);
    }

    const currentPrice = new Decimal(currentPriceRaw);
    const entryPrice = new Decimal(order.entryPrice);
    const quantity = new Decimal(order.quantity);

    let pnl = new Decimal(0);
    if (order.side === 'LONG') {
      pnl = currentPrice.minus(entryPrice).times(quantity);
    } else {
      pnl = entryPrice.minus(currentPrice).times(quantity);
    }

    await db.collection('paperOrders').updateOne(
      { _id: new ObjectId(orderId) },
      {
        $set: {
          status: 'CLOSED',
          exitPrice: currentPrice.toNumber(),
          pnl: pnl.toNumber(),
          closedAt: new Date(),
          exitReason: exitReason
        }
      }
    );

    // Dispatch Alert
    await alertQueue.add('send-telegram', {
      signalId: order.signalId,
      message: `⏹️ TRADE CLOSED MANUALLY: ${order.symbol}\n\nSide: ${order.side}\nExit Price: ${currentPrice}\nPnL: $${pnl.toFixed(2)}`
    });

    return { id: orderId, pnl: pnl.toNumber(), exitPrice: currentPrice.toNumber() };
  }

  /**
   * Periodically cancels/expires all PENDING paper orders that have been pending for more than 8 hours.
   */
  async cleanupExpiredOrders() {
    const db = await getDb();
    const now = new Date();
    const expirationMs = 8 * 60 * 60 * 1000; // 8 hours
    const threshold = new Date(now.getTime() - expirationMs);

    const expiredOrders = await db.collection('paperOrders')
      .find({
        status: 'PENDING',
        openedAt: { $lt: threshold }
      })
      .toArray();

    if (expiredOrders.length === 0) return;

    for (const order of expiredOrders) {
      await db.collection('paperOrders').updateOne(
        { _id: order._id },
        {
          $set: {
            status: 'EXPIRED',
            closedAt: now,
            exitReason: 'TIMEOUT'
          }
        }
      );

      if (order.signalId) {
        await db.collection('signals').updateOne(
          { _id: new ObjectId(order.signalId) },
          { $set: { status: 'EXPIRED', updatedAt: now } }
        );
      }

      console.log(`[Paper Trade Cleanup] Order ${order._id.toString()} expired without reaching entry price (8h limit).`);

      try {
        await alertQueue.add('send-telegram', {
          signalId: order.signalId,
          message: `⏰ SIGNAL EXPIRED: ${order.symbol}\n\nSide: ${order.side}\n\nThis Signal is expired (Entry price not reached within 8 hours).`
        });
      } catch (err) {
        console.error('[Paper Trade Cleanup] Failed to send telegram alert:', err);
      }
    }
  }
}

export const paperTradingService = new PaperTradingService();
