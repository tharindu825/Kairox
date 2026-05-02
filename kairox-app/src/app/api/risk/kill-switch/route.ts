import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { marketDataService } from '@/services/market-data';
import { Decimal } from 'decimal.js';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDb();

    // 1. Fetch all open orders
    const openOrdersDocs = await db.collection('paperOrders').find({ status: 'OPEN' }).toArray();
    
    let closedCount = 0;

    // 2. Close each open order at the latest market price
    for (const data of openOrdersDocs) {
      const order = data;
      if (!order.symbol) continue;

      const currentPriceNum = await marketDataService.getLatestPrice(order.symbol);
      if (!currentPriceNum) continue;

      const currentPrice = new Decimal(currentPriceNum);
      const entryPrice = new Decimal(order.entryPrice);
      const quantity = new Decimal(order.quantity);

      let pnl = new Decimal(0);
      if (order.side === 'LONG') {
        pnl = currentPrice.minus(entryPrice).times(quantity);
      } else {
        pnl = entryPrice.minus(currentPrice).times(quantity);
      }

      await db.collection('paperOrders').updateOne(
        { _id: data._id },
        {
          $set: {
            status: 'STOPPED', // Mark as STOPPED for the kill switch
            exitPrice: currentPrice.toNumber(),
            pnl: pnl.toNumber(),
            closedAt: new Date(),
          }
        }
      );

      closedCount++;
    }

    // 3. Block all pending signals to prevent new entries
    const pendingSignalsResult = await db.collection('signals').updateMany(
      { status: 'PENDING' },
      { $set: { status: 'BLOCKED', updatedAt: new Date() } }
    );

    // 4. Audit Log
    await db.collection('auditLogs').insertOne({
      userId: (session.user as any)?.id || null,
      action: 'EMERGENCY_KILL_SWITCH',
      entity: 'System',
      entityId: 'ALL',
      details: {
        closedOrdersCount: closedCount,
        blockedSignalsCount: pendingSignalsResult.modifiedCount,
      },
      createdAt: new Date(),
    });

    return NextResponse.json({
      message: 'Emergency kill switch executed successfully',
      closedOrders: closedCount,
      blockedSignals: pendingSignalsResult.modifiedCount,
    });
  } catch (error) {
    console.error('[API] Kill switch failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
