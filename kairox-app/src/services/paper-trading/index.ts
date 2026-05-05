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
    
    const openOrders = await db.collection('paperOrders')
      .find({ 
        symbol: candle.symbol,
        status: 'OPEN'
      })
      .toArray();
      
    if (openOrders.length === 0) return;
    
    const ordersWithSignals = await Promise.all(openOrders.map(async (order) => {
       let signal = null;
       if (order.signalId) {
          signal = await db.collection('signals').findOne({ _id: new ObjectId(order.signalId) });
       }
       return { id: order._id.toString(), ...order, signal } as any;
    }));

    for (const order of ordersWithSignals) {
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
   * Converts an approved signal into an active paper order at the CURRENT market price.
   */
  async executeApprovedSignal(signalId: string, quantity: number) {
    const db = await getDb();
    const signal = await db.collection('signals').findOne({ _id: new ObjectId(signalId) });
    
    if (!signal) return;
    if (signal.status !== 'APPROVED') return;

    // Fetch the actual current market price to prevent instant phantom P&L
    const { marketDataService } = await import('../market-data');
    const currentPriceRaw = await marketDataService.getLatestPrice(signal.symbol);
    
    const actualEntryPrice = currentPriceRaw || signal.entry;

    if (!currentPriceRaw) {
      console.warn(`[Paper Trade] Could not fetch real-time price for ${signal.symbol}, falling back to AI entry price: ${signal.entry}`);
    }

    const orderData = {
      signalId: signalId,
      symbol: signal.symbol,
      side: signal.side,
      entryPrice: actualEntryPrice,
      stopLoss: signal.stopLoss,
      quantity: quantity,
      status: 'OPEN',
      openedAt: new Date(),
    };
    
    const result = await db.collection('paperOrders').insertOne(orderData);

    console.log(`[Paper Trade] Executed paper order ${result.insertedId} for ${signalId} at market price $${actualEntryPrice}`);
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
}

export const paperTradingService = new PaperTradingService();
