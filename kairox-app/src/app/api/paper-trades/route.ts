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

    // Lazily expire pending orders on every read
    try {
      const { paperTradingService } = await import('@/services/paper-trading');
      await paperTradingService.cleanupExpiredOrders();
    } catch (cleanupErr) {
      console.error('[API] Paper trade cleanup failed:', cleanupErr);
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const db = await getDb();
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Build query: only active (OPEN, PENDING) OR completed in last 24 hours
    const query: any = {
      $or: [
        { status: { $in: ['OPEN', 'PENDING'] } },
        {
          status: { $in: ['CLOSED', 'STOPPED', 'EXPIRED', 'CANCELLED'] },
          $or: [
            { closedAt: { $gte: oneDayAgo } },
            { closedAt: { $exists: false }, openedAt: { $gte: oneDayAgo } }
          ]
        }
      ]
    };

    if (status && status !== 'ALL') {
      if (['OPEN', 'PENDING'].includes(status)) {
        query.status = status;
        delete query.$or;
      } else {
        query.status = status;
        query.$or = [
          { closedAt: { $gte: oneDayAgo } },
          { closedAt: { $exists: false }, openedAt: { $gte: oneDayAgo } }
        ];
      }
    }

    const docs = await db.collection('paperOrders')
      .find(query)
      .sort({ openedAt: -1 })
      .limit(50)
      .toArray();

    const formatted = await Promise.all(docs.map(async (order) => {
      const orderId = order._id.toString();

      // Fetch risk verdict for display
      let riskVerdict: string | null = null;
      if (order.signalId) {
        const ra = await db.collection('riskAssessments').findOne({ signalId: order.signalId });
        if (ra) riskVerdict = ra.verdict;
      }

      // Unrealised P&L for still-open orders
      let unrealisedPnl: number | null = null;
      let currentPrice: number | null = null;

      if (order.status === 'OPEN') {
        const latest = await marketDataService.getLatestPrice(order.symbol);
        if (latest) {
          currentPrice = Number(latest);
          const entryDec   = new Decimal(order.entryPrice);
          const currentDec = new Decimal(latest);
          const remainQty  = new Decimal(order.remainingQty ?? order.quantity);

          const grossUnrealised = order.side === 'LONG'
            ? currentDec.minus(entryDec).times(remainQty)
            : entryDec.minus(currentDec).times(remainQty);

          // Add already-realised partial exits
          unrealisedPnl = grossUnrealised.toNumber() + Number(order.realizedPnl ?? 0);
        }
      }

      // Total displayed P&L:
      //   closed orders → use stored pnl (net, fee-included)
      //   open orders   → unrealised + realised partials
      const displayPnl = order.status === 'OPEN'
        ? (unrealisedPnl !== null ? Math.round(unrealisedPnl * 100) / 100 : null)
        : (order.pnl !== null && order.pnl !== undefined ? Math.round(Number(order.pnl) * 100) / 100 : 0);

      return {
        id:           orderId,
        signalId:     order.signalId ?? null,
        symbol:       order.symbol,
        side:         order.side,
        entryPrice:   Number(order.entryPrice),
        exitPrice:    order.exitPrice != null ? Number(order.exitPrice) : (currentPrice ?? null),
        stopLoss:     Number(order.stopLoss),
        quantity:     Number(order.quantity),
        remainingQty: Number(order.remainingQty ?? order.quantity),
        targets:      Array.isArray(order.targets) ? order.targets : [],
        status:       order.status,
        exitReason:   order.exitReason ?? null,
        // P&L (fee-adjusted for closed, gross+realised for open)
        pnl:          displayPnl,
        realizedPnl:  order.realizedPnl != null ? Math.round(Number(order.realizedPnl) * 100) / 100 : 0,
        feesTotal:    order.feesTotal   != null ? Math.round(Number(order.feesTotal)   * 10000) / 10000 : 0,
        // TP progress
        tp1Hit:       order.tp1Hit   ?? false,
        tp2Hit:       order.tp2Hit   ?? false,
        tp3Hit:       order.tp3Hit   ?? false,
        breakEvenMoved:     order.breakEvenMoved     ?? false,
        trailingStopActive: order.trailingStopActive ?? false,
        highWaterMark:      order.highWaterMark       ?? null,
        // Partial exits log
        partialExits: Array.isArray(order.partialExits) ? order.partialExits : [],
        openedAt:    order.openedAt  ? new Date(order.openedAt)  : null,
        closedAt:    order.closedAt  ? new Date(order.closedAt)  : null,
        riskVerdict,
        source:      order.source ?? null,
      };
    }));

    // Fetch projected trades to calculate accurate all-time statistics across all-time trading history
    const allTradesStats = await db.collection('paperOrders')
      .find({}, { projection: { status: 1, pnl: 1, feesTotal: 1 } })
      .toArray();

    const closedAll   = allTradesStats.filter(o => o.status === 'CLOSED' || o.status === 'STOPPED');
    const winsAll     = closedAll.filter(o => Number(o.pnl ?? 0) > 0);
    const totalPnL    = closedAll.reduce((s, o) => s + Number(o.pnl ?? 0), 0);
    const winRate     = closedAll.length > 0 ? (winsAll.length / closedAll.length) * 100 : 0;
    const totalFeesPaid = allTradesStats.reduce((s, o) => s + Number(o.feesTotal ?? 0), 0);

    return NextResponse.json({
      orders: formatted,
      stats: {
        totalTrades: closedAll.length,
        openTrades:  allTradesStats.filter(o => o.status === 'OPEN').length,
        winRate:     Math.round(winRate * 10) / 10,
        totalPnL:    Math.round(totalPnL * 100) / 100,
        wins:        winsAll.length,
        losses:      closedAll.length - winsAll.length,
        totalFeesPaid: Math.round(totalFeesPaid * 100) / 100,
      },
    });
  } catch (error) {
    console.error('[API] Failed to fetch paper trades:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
