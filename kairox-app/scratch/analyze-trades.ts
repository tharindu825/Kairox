import 'dotenv/config';
import { MongoClient } from 'mongodb';

async function main() {
  const uri = process.env.MONGODB_URI!;
  const options: Record<string, unknown> = {};
  if (process.env.MONGODB_USER && process.env.MONGODB_PASS) {
    options.auth = {
      username: process.env.MONGODB_USER,
      password: process.env.MONGODB_PASS,
    };
  }

  const client = new MongoClient(uri, options);
  await client.connect();
  const db = client.db('kairox');

  // Last 7 days
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  console.log(`\n📅 Analyzing trades from ${oneWeekAgo.toISOString()} to now\n`);

  // Fetch all completed trades (CLOSED, STOPPED, EXPIRED) in the last week
  const allOrders = await db.collection('paperOrders')
    .find({ openedAt: { $gte: oneWeekAgo } })
    .sort({ openedAt: -1 })
    .toArray();

  console.log(`📊 Total paper orders in last 7 days: ${allOrders.length}\n`);

  // Status breakdown
  const statusCounts: Record<string, number> = {};
  for (const o of allOrders) {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
  }
  console.log('── Status Breakdown ──');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log();

  // Completed trades (trades that actually had an outcome)
  const completedTrades = allOrders.filter(o => ['CLOSED', 'STOPPED'].includes(o.status));
  console.log(`── Completed Trades (CLOSED + STOPPED): ${completedTrades.length} ──\n`);

  if (completedTrades.length === 0) {
    console.log('No completed trades found in the last 7 days.');
    
    // Also check signals
    const signals = await db.collection('signals')
      .find({ createdAt: { $gte: oneWeekAgo } })
      .sort({ createdAt: -1 })
      .toArray();
    console.log(`\n📡 Total signals generated: ${signals.length}`);
    const sigStatus: Record<string, number> = {};
    for (const s of signals) {
      sigStatus[s.status] = (sigStatus[s.status] || 0) + 1;
    }
    for (const [st, ct] of Object.entries(sigStatus)) {
      console.log(`  ${st}: ${ct}`);
    }

    await client.close();
    return;
  }

  // Win/Loss analysis
  const wins = completedTrades.filter(t => (t.pnl ?? 0) > 0);
  const losses = completedTrades.filter(t => (t.pnl ?? 0) < 0);
  const breakeven = completedTrades.filter(t => (t.pnl ?? 0) === 0);

  const winRate = (wins.length / completedTrades.length * 100).toFixed(1);
  const totalPnl = completedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const totalFees = completedTrades.reduce((sum, t) => sum + (t.feesTotal ?? 0), 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length : 0;
  const profitFactor = Math.abs(avgLoss) > 0 ? (wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0))) : Infinity;

  console.log('══════════════════════════════════════');
  console.log('       WIN RATE ANALYSIS');
  console.log('══════════════════════════════════════');
  console.log(`  Wins:       ${wins.length}`);
  console.log(`  Losses:     ${losses.length}`);
  console.log(`  Breakeven:  ${breakeven.length}`);
  console.log(`  Win Rate:   ${winRate}%`);
  console.log(`  Total P&L:  $${totalPnl.toFixed(2)}`);
  console.log(`  Total Fees: $${totalFees.toFixed(4)}`);
  console.log(`  Avg Win:    $${avgWin.toFixed(2)}`);
  console.log(`  Avg Loss:   $${avgLoss.toFixed(2)}`);
  console.log(`  Profit Factor: ${profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}`);
  console.log('══════════════════════════════════════\n');

  // Per-symbol breakdown
  const symbolStats: Record<string, { wins: number; losses: number; pnl: number; count: number }> = {};
  for (const t of completedTrades) {
    if (!symbolStats[t.symbol]) symbolStats[t.symbol] = { wins: 0, losses: 0, pnl: 0, count: 0 };
    symbolStats[t.symbol].count++;
    symbolStats[t.symbol].pnl += t.pnl ?? 0;
    if ((t.pnl ?? 0) > 0) symbolStats[t.symbol].wins++;
    else symbolStats[t.symbol].losses++;
  }

  console.log('── Per-Symbol Breakdown ──');
  console.log(`${'Symbol'.padEnd(14)} ${'Trades'.padStart(7)} ${'Wins'.padStart(5)} ${'Losses'.padStart(7)} ${'WinRate'.padStart(8)} ${'P&L'.padStart(10)}`);
  console.log('-'.repeat(55));
  for (const [sym, s] of Object.entries(symbolStats).sort((a, b) => b[1].pnl - a[1].pnl)) {
    const wr = (s.wins / s.count * 100).toFixed(0);
    console.log(`${sym.padEnd(14)} ${String(s.count).padStart(7)} ${String(s.wins).padStart(5)} ${String(s.losses).padStart(7)} ${(wr + '%').padStart(8)} ${('$' + s.pnl.toFixed(2)).padStart(10)}`);
  }

  // Per-side breakdown
  console.log('\n── Per-Side Breakdown ──');
  const longTrades = completedTrades.filter(t => t.side === 'LONG');
  const shortTrades = completedTrades.filter(t => t.side === 'SHORT');
  const longWins = longTrades.filter(t => (t.pnl ?? 0) > 0).length;
  const shortWins = shortTrades.filter(t => (t.pnl ?? 0) > 0).length;
  console.log(`  LONG:  ${longTrades.length} trades | ${longWins} wins | WR: ${longTrades.length > 0 ? (longWins / longTrades.length * 100).toFixed(1) : 'N/A'}% | P&L: $${longTrades.reduce((s, t) => s + (t.pnl ?? 0), 0).toFixed(2)}`);
  console.log(`  SHORT: ${shortTrades.length} trades | ${shortWins} wins | WR: ${shortTrades.length > 0 ? (shortWins / shortTrades.length * 100).toFixed(1) : 'N/A'}% | P&L: $${shortTrades.reduce((s, t) => s + (t.pnl ?? 0), 0).toFixed(2)}`);

  // Exit reason breakdown
  console.log('\n── Exit Reason Breakdown ──');
  const exitReasons: Record<string, { count: number; pnl: number }> = {};
  for (const t of completedTrades) {
    const reason = t.exitReason || 'UNKNOWN';
    if (!exitReasons[reason]) exitReasons[reason] = { count: 0, pnl: 0 };
    exitReasons[reason].count++;
    exitReasons[reason].pnl += t.pnl ?? 0;
  }
  for (const [reason, data] of Object.entries(exitReasons)) {
    console.log(`  ${reason}: ${data.count} trades | P&L: $${data.pnl.toFixed(2)}`);
  }

  // TP hit rate analysis
  console.log('\n── Target Hit Rate (for completed trades) ──');
  const tp1Count = completedTrades.filter(t => t.tp1Hit).length;
  const tp2Count = completedTrades.filter(t => t.tp2Hit).length;
  const tp3Count = completedTrades.filter(t => t.tp3Hit).length;
  console.log(`  TP1 hit: ${tp1Count}/${completedTrades.length} (${(tp1Count / completedTrades.length * 100).toFixed(1)}%)`);
  console.log(`  TP2 hit: ${tp2Count}/${completedTrades.length} (${(tp2Count / completedTrades.length * 100).toFixed(1)}%)`);
  console.log(`  TP3 hit: ${tp3Count}/${completedTrades.length} (${(tp3Count / completedTrades.length * 100).toFixed(1)}%)`);

  // Individual trade details
  console.log('\n── Individual Trade Details ──');
  for (const t of completedTrades) {
    const icon = (t.pnl ?? 0) > 0 ? '🟢' : (t.pnl ?? 0) < 0 ? '🔴' : '⚪';
    const opened = t.openedAt ? new Date(t.openedAt).toISOString().slice(0, 16) : 'N/A';
    const closed = t.closedAt ? new Date(t.closedAt).toISOString().slice(0, 16) : 'N/A';
    const durationMs = t.closedAt && t.openedAt ? new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime() : 0;
    const durationHrs = (durationMs / 3600000).toFixed(1);
    console.log(`${icon} ${t.symbol.padEnd(12)} ${t.side.padEnd(6)} | Entry: $${Number(t.entryPrice).toFixed(4)} | Exit: $${Number(t.exitPrice || 0).toFixed(4)} | P&L: $${(t.pnl ?? 0).toFixed(2)} | ${t.exitReason || 'N/A'} | ${opened} → ${closed} (${durationHrs}h)`);
    if (t.tp1Hit) console.log(`   ├─ TP1 ✅`);
    if (t.tp2Hit) console.log(`   ├─ TP2 ✅`);
    if (t.tp3Hit) console.log(`   └─ TP3 ✅`);
  }

  // Also print signal statistics
  console.log('\n\n══════════════════════════════════════');
  console.log('       SIGNAL PIPELINE ANALYSIS');
  console.log('══════════════════════════════════════');
  const signals = await db.collection('signals')
    .find({ createdAt: { $gte: oneWeekAgo } })
    .sort({ createdAt: -1 })
    .toArray();
  
  console.log(`  Total signals generated: ${signals.length}`);
  const sigStatus: Record<string, number> = {};
  for (const s of signals) {
    sigStatus[s.status] = (sigStatus[s.status] || 0) + 1;
  }
  for (const [st, ct] of Object.entries(sigStatus)) {
    console.log(`    ${st}: ${ct}`);
  }

  // Confidence distribution
  const confBuckets = { 'low(<50%)': 0, 'med(50-70%)': 0, 'high(70%+)': 0 };
  for (const s of signals) {
    const conf = s.confidence ?? 0;
    if (conf < 0.5) confBuckets['low(<50%)']++;
    else if (conf < 0.7) confBuckets['med(50-70%)']++;
    else confBuckets['high(70%+)']++;
  }
  console.log('\n  Confidence Distribution:');
  for (const [bucket, count] of Object.entries(confBuckets)) {
    console.log(`    ${bucket}: ${count}`);
  }

  // Average R:R of the signals
  const signalRRs = signals
    .filter(s => s.entry && s.stopLoss && s.targets?.length > 0)
    .map(s => {
      const stopDist = Math.abs(s.entry - s.stopLoss);
      const tpDist = Math.abs(s.targets[0].price - s.entry);
      return stopDist > 0 ? tpDist / stopDist : 0;
    })
    .filter(rr => rr > 0);
  
  if (signalRRs.length > 0) {
    const avgRR = signalRRs.reduce((a, b) => a + b, 0) / signalRRs.length;
    console.log(`\n  Average Signal R:R (to TP1): ${avgRR.toFixed(2)}`);
  }

  await client.close();
}

main().catch(console.error);
