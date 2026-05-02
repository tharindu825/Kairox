import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { Decimal } from 'decimal.js';
import { ObjectId } from 'mongodb';

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDb();

    // ─── Real Portfolio Metrics from DB ─────────────────────────────────
    const openOrdersDocs = await db.collection('paperOrders').find({ status: 'OPEN' }).toArray();
    
    const openOrders = await Promise.all(openOrdersDocs.map(async (data) => {
      const orderId = data._id.toString();
      let signal = null;
      if (data.signalId && typeof data.signalId === 'string' && data.signalId.length === 24) {
        const sig = await db.collection('signals').findOne({ _id: new ObjectId(data.signalId) });
        if (sig) {
          const riskAssessment = await db.collection('riskAssessments').findOne({ signalId: data.signalId });
          signal = { id: sig._id.toString(), ...sig, asset: { symbol: sig.symbol }, riskAssessment };
        }
      }
      return { id: orderId, ...data, signal };
    }));

    const openTrades = openOrders.length;

    // Calculate total capital at risk from open positions
    const totalRiskPercent = openOrders.reduce((sum, order) => {
      return sum + (order.signal?.riskAssessment?.riskPercent || 0);
    }, 0);

    // Calculate daily P&L from orders closed today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const closedTodayDocs = await db.collection('paperOrders')
      .find({
        status: { $in: ['CLOSED', 'STOPPED'] },
        closedAt: { $gte: todayStart }
      })
      .toArray();

    const dailyPnL = closedTodayDocs.reduce((sum, order) => {
      return sum + (order.pnl ? new Decimal(order.pnl).toNumber() : 0);
    }, 0);

    // Assume a starting paper balance of $10,000
    const paperBalance = Number(process.env.PAPER_BALANCE || 10000);
    const dailyDrawdown = paperBalance > 0 ? (dailyPnL / paperBalance) * 100 : 0;

    // Count correlated open pairs
    const openSymbols = [...new Set(openOrders.map(o => o.signal?.asset?.symbol).filter(Boolean))];
    const cryptoCorrelationGroups = [['BTCUSDT', 'ETHUSDT']];
    let correlatedPairs = 0;
    for (const group of cryptoCorrelationGroups) {
      const count = openSymbols.filter(s => group.includes(s as string)).length;
      if (count > 1) correlatedPairs += count;
    }

    // Count consecutive stop-outs
    const recentOrdersDocs = await db.collection('paperOrders')
      .find({ status: { $in: ['CLOSED', 'STOPPED'] } })
      .sort({ closedAt: -1 })
      .limit(10)
      .toArray();

    let consecutiveStops = 0;
    for (const order of recentOrdersDocs) {
      if (order.status === 'STOPPED') consecutiveStops++;
      else break;
    }

    // Load strategy policy from DB
    const policy = await db.collection('strategyPolicy').findOne({ isActive: true });
    
    const maxOpenTrades = policy?.maxOpenTrades || 5;
    const maxCapitalRisk = (policy?.maxRiskPercent || 2) * maxOpenTrades;
    const maxCorrelated = policy?.maxCorrelated || 3;
    const dailyDrawdownLimit = policy?.dailyDrawdownLimit || 5;
    const cooldownMinutes = policy?.cooldownMinutes || 60;

    // Check cooldown
    const lastStopOut = recentOrdersDocs.find(o => o.status === 'STOPPED');
    let cooldownActive = false;
    if (lastStopOut && consecutiveStops >= 2 && lastStopOut.closedAt) {
      const closedAtMs = new Date(lastStopOut.closedAt).getTime();
      const minutesSince = (Date.now() - closedAtMs) / 60000;
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
    const blockedSignalsDocs = await db.collection('signals')
      .find({ status: 'BLOCKED' })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();
      
    const blockedSignals = await Promise.all(blockedSignalsDocs.map(async (data) => {
       const signalId = data._id.toString();
       const riskAssessment = await db.collection('riskAssessments').findOne({ signalId });
       return { id: signalId, ...data, asset: { symbol: data.symbol }, riskAssessment };
    }));

    // ─── Open Positions for Paper Trades Table ──────────────────────────
    const openPositions = openOrders.map(order => ({
      id: order.id,
      symbol: order.signal?.asset?.symbol,
      side: order.side,
      entryPrice: new Decimal(order.entryPrice).toNumber(),
      stopLoss: new Decimal(order.stopLoss).toNumber(),
      quantity: new Decimal(order.quantity).toNumber(),
      openedAt: order.openedAt ? new Date(order.openedAt) : null,
      signalId: order.signalId,
    }));

    return NextResponse.json({ metrics, blockedSignals, openPositions });
  } catch (error) {
    console.error('[API] Failed to fetch risk metrics:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
