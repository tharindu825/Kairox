import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { auth } from '@/lib/auth';
import { Decimal } from 'decimal.js';

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ─── Real Portfolio Metrics from DB ─────────────────────────────────
    const openOrdersSnapshot = await db.collection('paperOrders').where('status', '==', 'OPEN').get();
    
    const openOrders = await Promise.all(openOrdersSnapshot.docs.map(async (doc) => {
      const order = doc.data() as any;
      let signal = null;
      if (order.signalId) {
        const sigDoc = await db.collection('signals').doc(order.signalId).get();
        if (sigDoc.exists) {
          const sigData = sigDoc.data() as any;
          const riskSnap = await db.collection('riskAssessments').where('signalId', '==', order.signalId).limit(1).get();
          const riskAssessment = riskSnap.empty ? null : riskSnap.docs[0].data();
          signal = { id: sigDoc.id, ...sigData, asset: { symbol: sigData.symbol }, riskAssessment };
        }
      }
      return { id: doc.id, ...order, signal };
    }));

    const openTrades = openOrders.length;

    // Calculate total capital at risk from open positions
    const totalRiskPercent = openOrders.reduce((sum, order) => {
      return sum + (order.signal?.riskAssessment?.riskPercent || 0);
    }, 0);

    // Calculate daily P&L from orders closed today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const closedTodaySnapshot = await db.collection('paperOrders')
      .where('status', 'in', ['CLOSED', 'STOPPED'])
      .where('closedAt', '>=', todayStart)
      .get();

    const closedToday = closedTodaySnapshot.docs.map(d => d.data());

    const dailyPnL = closedToday.reduce((sum, order) => {
      return sum + (order.pnl ? new Decimal(order.pnl).toNumber() : 0);
    }, 0);

    // Assume a starting paper balance of $10,000
    const paperBalance = 10000;
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
    const recentOrdersSnapshot = await db.collection('paperOrders')
      .where('status', 'in', ['CLOSED', 'STOPPED'])
      .orderBy('closedAt', 'desc')
      .limit(10)
      .get();
      
    const recentOrders = recentOrdersSnapshot.docs.map(d => d.data());

    let consecutiveStops = 0;
    for (const order of recentOrders) {
      if (order.status === 'STOPPED') consecutiveStops++;
      else break;
    }

    // Load strategy policy from DB
    const policySnapshot = await db.collection('strategyPolicy').where('isActive', '==', true).limit(1).get();
    const policy = policySnapshot.empty ? null : policySnapshot.docs[0].data();
    
    const maxOpenTrades = policy?.maxOpenTrades || 5;
    const maxCapitalRisk = (policy?.maxRiskPercent || 2) * maxOpenTrades;
    const maxCorrelated = policy?.maxCorrelated || 3;
    const dailyDrawdownLimit = policy?.dailyDrawdownLimit || 5;
    const cooldownMinutes = policy?.cooldownMinutes || 60;

    // Check cooldown
    const lastStopOut = recentOrders.find(o => o.status === 'STOPPED');
    let cooldownActive = false;
    if (lastStopOut && consecutiveStops >= 2 && lastStopOut.closedAt) {
      const closedAtMs = lastStopOut.closedAt.toDate ? lastStopOut.closedAt.toDate().getTime() : new Date(lastStopOut.closedAt).getTime();
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
    const blockedSignalsSnapshot = await db.collection('signals')
      .where('status', '==', 'BLOCKED')
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();
      
    const blockedSignals = await Promise.all(blockedSignalsSnapshot.docs.map(async (doc) => {
       const data = doc.data();
       const riskSnap = await db.collection('riskAssessments').where('signalId', '==', doc.id).limit(1).get();
       const riskAssessment = riskSnap.empty ? null : riskSnap.docs[0].data();
       return { id: doc.id, ...data, asset: { symbol: data.symbol }, riskAssessment };
    }));

    // ─── Open Positions for Paper Trades Table ──────────────────────────
    const openPositions = openOrders.map(order => ({
      id: order.id,
      symbol: order.signal?.asset?.symbol,
      side: order.side,
      entryPrice: new Decimal(order.entryPrice).toNumber(),
      stopLoss: new Decimal(order.stopLoss).toNumber(),
      quantity: new Decimal(order.quantity).toNumber(),
      openedAt: order.openedAt ? (order.openedAt.toDate ? order.openedAt.toDate() : order.openedAt) : null,
      signalId: order.signalId,
    }));

    return NextResponse.json({ metrics, blockedSignals, openPositions });
  } catch (error) {
    console.error('[API] Failed to fetch risk metrics:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
