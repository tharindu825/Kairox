import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { auth } from '@/lib/auth';
import { Decimal } from 'decimal.js';

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let query: FirebaseFirestore.Query = db.collection('paperOrders');
    if (status && status !== 'ALL') {
      query = query.where('status', '==', status);
    }

    const snapshot = await query.orderBy('openedAt', 'desc').limit(50).get();

    const formatted = await Promise.all(snapshot.docs.map(async (doc) => {
      const order = doc.data() as any;
      
      let riskVerdict = null;
      if (order.signalId) {
         const riskSnapshot = await db.collection('riskAssessments').where('signalId', '==', order.signalId).limit(1).get();
         if (!riskSnapshot.empty) {
           riskVerdict = riskSnapshot.docs[0].data().verdict;
         }
      }

      return {
        id: doc.id,
        signalId: order.signalId,
        symbol: order.symbol,
        side: order.side,
        entryPrice: new Decimal(order.entryPrice).toNumber(),
        exitPrice: order.exitPrice ? new Decimal(order.exitPrice).toNumber() : null,
        stopLoss: new Decimal(order.stopLoss).toNumber(),
        quantity: new Decimal(order.quantity).toNumber(),
        status: order.status,
        pnl: order.pnl ? new Decimal(order.pnl).toNumber() : null,
        openedAt: order.openedAt ? (order.openedAt.toDate ? order.openedAt.toDate() : new Date(order.openedAt)) : null,
        closedAt: order.closedAt ? (order.closedAt.toDate ? order.closedAt.toDate() : new Date(order.closedAt)) : null,
        riskVerdict,
      };
    }));

    // Calculate aggregate stats
    const closed = formatted.filter(o => o.status === 'CLOSED' || o.status === 'STOPPED');
    const wins = closed.filter(o => (o.pnl || 0) > 0);
    const totalPnL = closed.reduce((sum, o) => sum + (o.pnl || 0), 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

    return NextResponse.json({
      orders: formatted,
      stats: {
        totalTrades: closed.length,
        openTrades: formatted.filter(o => o.status === 'OPEN').length,
        winRate: Math.round(winRate * 10) / 10,
        totalPnL: Math.round(totalPnL * 100) / 100,
        wins: wins.length,
        losses: closed.length - wins.length,
      },
    });
  } catch (error) {
    console.error('[API] Failed to fetch paper trades:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
