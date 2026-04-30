import { db } from '@/lib/firebase-admin';
import { NormalizedCandle } from '../market-data/binance';
import { alertQueue } from '@/workers/queues';
import { Decimal } from 'decimal.js';

export class PaperTradingService {
  /**
   * Evaluates all OPEN paper orders against the latest real-time tick to see if
   * a stop-loss or take-profit target has been hit.
   */
  async processLiveTick(candle: NormalizedCandle) {
    // Only process every few seconds or when a significant move happens
    // In production, you'd cache open orders in Redis to avoid querying Postgres on every tick.
    const openOrdersSnapshot = await db.collection('paperOrders')
      .where('symbol', '==', candle.symbol)
      .get();
      
    if (openOrdersSnapshot.empty) return;
    
    const openOrders = await Promise.all(openOrdersSnapshot.docs
      .filter(doc => doc.data().status === 'OPEN')
      .map(async (doc) => {
       const order = doc.data();
       let signal = null;
       if (order.signalId) {
          const sigDoc = await db.collection('signals').doc(order.signalId).get();
          if (sigDoc.exists) signal = sigDoc.data();
       }
       return { id: doc.id, ...order, signal } as any;
    }));

    for (const order of openOrders) {
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
        await db.collection('paperOrders').doc(order.id).update({
          status: exitReason === 'STOP_LOSS' ? 'STOPPED' : 'CLOSED',
          exitPrice: exitPrice.toNumber(),
          pnl: pnl.toNumber(),
          closedAt: new Date()
        });

        // Dispatch Alert
        await alertQueue.add('send-telegram', {
          signalId: order.signalId,
          message: `📉 TRADE CLOSED: ${candle.symbol}\n\nSide: ${order.side}\nReason: ${exitReason}\nEntry: ${entryPrice}\nExit: ${exitPrice}\nPnL: $${pnl.toFixed(2)}`
        });
      }
    }
  }

  /**
   * Converts an approved signal into an active paper order.
   */
  async executeApprovedSignal(signalId: string, quantity: number) {
    const signalRef = db.collection('signals').doc(signalId);
    const signalDoc = await signalRef.get();
    
    if (!signalDoc.exists) return;
    const signal = signalDoc.data() as any;
    
    if (signal.status !== 'APPROVED') return;

    const orderRef = db.collection('paperOrders').doc();
    const orderData = {
      signalId: signalId,
      symbol: signal.symbol,
      side: signal.side,
      entryPrice: signal.entry,
      stopLoss: signal.stopLoss,
      quantity: quantity,
      status: 'OPEN',
      openedAt: new Date(),
    };
    
    await orderRef.set(orderData);

    console.log(`[Paper Trade] Executed paper order ${orderRef.id} for ${signalId}`);
    return { id: orderRef.id, ...orderData };
  }
}

export const paperTradingService = new PaperTradingService();
