import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { Decimal } from 'decimal.js';
import { marketDataService } from '@/services/market-data';

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const db = await getDb();
    const query: any = {};
    if (status && status !== 'ALL') {
      query.status = status;
    }

    const docs = await db.collection('paperOrders')
      .find(query)
      .sort({ openedAt: -1 })
      .limit(50)
      .toArray();

    const formatted = await Promise.all(docs.map(async (data) => {
      const order = data;
      const orderId = order._id.toString();
      
      let riskVerdict = null;
      if (order.signalId) {
         const riskAssessment = await db.collection('riskAssessments').findOne({ signalId: order.signalId });
         if (riskAssessment) {
           riskVerdict = riskAssessment.verdict;
         }
      }

      // Calculate unrealized PnL for open orders
      let currentPnl = order.pnl ? new Decimal(order.pnl).toNumber() : null;
      let currentPrice = null;

      if (order.status === 'OPEN') {
        const latestPrice = await marketDataService.getLatestPrice(order.symbol);
        if (latestPrice) {
          currentPrice = latestPrice;
          const entry = new Decimal(order.entryPrice);
          const current = new Decimal(latestPrice);
          const qty = new Decimal(order.quantity);
          
          if (order.side === 'LONG') {
            currentPnl = current.minus(entry).times(qty).toNumber();
          } else {
            currentPnl = entry.minus(current).times(qty).toNumber();
          }
        }
      }

      return {
        id: orderId,
        signalId: order.signalId,
        symbol: order.symbol,
        side: order.side,
        entryPrice: new Decimal(order.entryPrice).toNumber(),
        exitPrice: order.exitPrice ? new Decimal(order.exitPrice).toNumber() : currentPrice,
        stopLoss: new Decimal(order.stopLoss).toNumber(),
        quantity: new Decimal(order.quantity).toNumber(),
        status: order.status,
        pnl: currentPnl ? Math.round(currentPnl * 100) / 100 : 0,
        openedAt: order.openedAt ? new Date(order.openedAt) : null,
        closedAt: order.closedAt ? new Date(order.closedAt) : null,
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
