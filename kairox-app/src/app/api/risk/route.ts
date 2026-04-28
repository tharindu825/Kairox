import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { Decimal } from 'decimal.js';

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ─── Real Portfolio Metrics from DB ─────────────────────────────────
    const openOrders = await db.paperOrder.findMany({
      where: { status: 'OPEN' },
      include: { signal: { include: { asset: true, riskAssessment: true } } },
    });

    const openTrades = openOrders.length;

    // Calculate total capital at risk from open positions
    const totalRiskPercent = openOrders.reduce((sum, order) => {
      return sum + (order.signal.riskAssessment?.riskPercent || 0);
    }, 0);

    // Calculate daily P&L from orders closed today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const closedToday = await db.paperOrder.findMany({
      where: {
        closedAt: { gte: todayStart },
        status: { in: ['CLOSED', 'STOPPED'] },
      },
    });

    const dailyPnL = closedToday.reduce((sum, order) => {
      return sum + (order.pnl ? new Decimal(order.pnl).toNumber() : 0);
    }, 0);

    // Assume a starting paper balance of $10,000
    const paperBalance = 10000;
    const dailyDrawdown = paperBalance > 0 ? (dailyPnL / paperBalance) * 100 : 0;

    // Count correlated open pairs
    const openSymbols = [...new Set(openOrders.map(o => o.signal.asset.symbol))];
    const cryptoCorrelationGroups = [['BTCUSDT', 'ETHUSDT']];
    let correlatedPairs = 0;
    for (const group of cryptoCorrelationGroups) {
      const count = openSymbols.filter(s => group.includes(s)).length;
      if (count > 1) correlatedPairs += count;
    }

    // Count consecutive stop-outs
    const recentOrders = await db.paperOrder.findMany({
      where: { status: { in: ['CLOSED', 'STOPPED'] } },
      orderBy: { closedAt: 'desc' },
      take: 10,
    });

    let consecutiveStops = 0;
    for (const order of recentOrders) {
      if (order.status === 'STOPPED') consecutiveStops++;
      else break;
    }

    // Load strategy policy from DB
    const policy = await db.strategyPolicy.findFirst({ where: { isActive: true } });
    const maxOpenTrades = policy?.maxOpenTrades || 5;
    const maxCapitalRisk = (policy?.maxRiskPercent || 2) * maxOpenTrades;
    const maxCorrelated = policy?.maxCorrelated || 3;
    const dailyDrawdownLimit = policy?.dailyDrawdownLimit || 5;
    const cooldownMinutes = policy?.cooldownMinutes || 60;

    // Check cooldown
    const lastStopOut = recentOrders.find(o => o.status === 'STOPPED');
    let cooldownActive = false;
    if (lastStopOut && consecutiveStops >= 2 && lastStopOut.closedAt) {
      const minutesSince = (Date.now() - lastStopOut.closedAt.getTime()) / 60000;
      cooldownActive = minutesSince < cooldownMinutes;
    }

    const metrics = {
      capitalAtRisk: Math.round(totalRiskPercent * 10) / 10,
      maxCapitalRisk,
      dailyDrawdown: Math.round(dailyDrawdown * 10) / 10,
      maxDrawdown: -dailyDrawdownLimit,
      openTrades,
      maxOpenTrades,
      correlatedPairs,
      maxCorrelated,
      consecutiveStops,
      cooldownActive,
      paperBalance,
      dailyPnL: Math.round(dailyPnL * 100) / 100,
    };

    // ─── Blocked Signals ────────────────────────────────────────────────
    const blockedSignals = await db.signal.findMany({
      where: { status: 'BLOCKED' },
      include: { asset: true, riskAssessment: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    // ─── Open Positions for Paper Trades Table ──────────────────────────
    const openPositions = openOrders.map(order => ({
      id: order.id,
      symbol: order.signal.asset.symbol,
      side: order.side,
      entryPrice: new Decimal(order.entryPrice).toNumber(),
      stopLoss: new Decimal(order.stopLoss).toNumber(),
      quantity: new Decimal(order.quantity).toNumber(),
      openedAt: order.openedAt,
      signalId: order.signalId,
    }));

    return NextResponse.json({ metrics, blockedSignals, openPositions });
  } catch (error) {
    console.error('[API] Failed to fetch risk metrics:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
