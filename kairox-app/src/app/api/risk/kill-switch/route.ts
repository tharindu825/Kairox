import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
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
    const openOrdersSnapshot = await db.collection('paperOrders').where('status', '==', 'OPEN').get();
    
    let closedCount = 0;
    const batch = db.batch();

    // 2. Close each open order at the latest market price
    for (const doc of openOrdersSnapshot.docs) {
      const order = doc.data() as any;
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

      batch.update(doc.ref, {
        status: 'STOPPED', // Mark as STOPPED for the kill switch
        exitPrice: currentPrice.toNumber(),
        pnl: pnl.toNumber(),
        closedAt: new Date(),
      });

      closedCount++;
    }

    // 3. Block all pending signals to prevent new entries
    const pendingSignalsSnapshot = await db.collection('signals').where('status', '==', 'PENDING').get();
    for (const doc of pendingSignalsSnapshot.docs) {
      batch.update(doc.ref, { status: 'BLOCKED', updatedAt: new Date() });
    }

    // 4. Audit Log
    const auditLogRef = db.collection('auditLogs').doc();
    batch.set(auditLogRef, {
      userId: (session.user as any)?.id || null,
      action: 'EMERGENCY_KILL_SWITCH',
      entity: 'System',
      entityId: 'ALL',
      details: {
        closedOrdersCount: closedCount,
        blockedSignalsCount: pendingSignalsSnapshot.size,
      },
      createdAt: new Date(),
    });

    await batch.commit();

    return NextResponse.json({
      message: 'Emergency kill switch executed successfully',
      closedOrders: closedCount,
      blockedSignals: pendingSignalsSnapshot.size,
    });
  } catch (error) {
    console.error('[API] Kill switch failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
