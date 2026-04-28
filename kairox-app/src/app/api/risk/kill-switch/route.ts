import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { marketDataService } from '@/services/market-data';
import { Decimal } from 'decimal.js';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Fetch all open orders
    const openOrders = await db.paperOrder.findMany({
      where: { status: 'OPEN' },
      include: { signal: { include: { asset: true } } },
    });

    let closedCount = 0;

    // 2. Close each open order at the latest market price
    for (const order of openOrders) {
      const currentPriceNum = await marketDataService.getLatestPrice(order.signal.asset.symbol);
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

      await db.paperOrder.update({
        where: { id: order.id },
        data: {
          status: 'STOPPED', // Mark as STOPPED for the kill switch
          exitPrice: currentPrice.toNumber(),
          pnl: pnl.toNumber(),
          closedAt: new Date(),
        },
      });

      closedCount++;
    }

    // 3. Block all pending signals to prevent new entries
    const blockedSignals = await db.signal.updateMany({
      where: { status: 'PENDING' },
      data: { status: 'BLOCKED' },
    });

    // 4. Audit Log
    await db.auditLog.create({
      data: {
        userId: (session.user as any)?.id || null,
        action: 'EMERGENCY_KILL_SWITCH',
        entity: 'System',
        entityId: 'ALL',
        details: {
          closedOrdersCount: closedCount,
          blockedSignalsCount: blockedSignals.count,
        },
      },
    });

    return NextResponse.json({
      message: 'Emergency kill switch executed successfully',
      closedOrders: closedCount,
      blockedSignals: blockedSignals.count,
    });
  } catch (error) {
    console.error('[API] Kill switch failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
