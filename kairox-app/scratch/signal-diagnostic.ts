/**
 * Signal Diagnostic Script
 * Run: npx tsx scratch/signal-diagnostic.ts
 *
 * Reports on all signals and their skip reasons in the last 24 hours.
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI!;
const MONGODB_USER = process.env.MONGODB_USER!;
const MONGODB_PASS = process.env.MONGODB_PASS!;

async function main() {
  const uri = MONGODB_URI.replace('<username>', MONGODB_USER).replace('<password>', MONGODB_PASS)
    .replace('tharindudilshan0825', MONGODB_USER)
    .replace('Ddunac@41', MONGODB_PASS);

  const client = new MongoClient(MONGODB_URI, {
    auth: { username: MONGODB_USER, password: MONGODB_PASS },
  });

  try {
    await client.connect();
    const db = client.db('kairox');

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1. All signals in last 24h
    const allSignals = await db.collection('signals')
      .find({ createdAt: { $gte: since24h } })
      .sort({ createdAt: -1 })
      .toArray();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 SIGNAL REPORT — Last 24 Hours`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total signals generated: ${allSignals.length}`);

    const approved = allSignals.filter(s => s.status === 'APPROVED');
    const blocked  = allSignals.filter(s => s.status === 'BLOCKED');

    console.log(`  ✅ APPROVED : ${approved.length}`);
    console.log(`  ❌ BLOCKED  : ${blocked.length}`);

    if (allSignals.length > 0) {
      console.log(`\n--- Recent Signals (latest first) ---`);
      for (const sig of allSignals.slice(0, 20)) {
        const t = new Date(sig.createdAt).toISOString();
        console.log(`  [${t}] ${sig.symbol} ${sig.side} → ${sig.status} | WinProb=${(sig.winProbability*100).toFixed(0)}%`);
      }
    }

    // 2. Risk assessments for blocked signals
    if (blocked.length > 0) {
      console.log(`\n--- Block Reasons ---`);
      for (const sig of blocked.slice(0, 10)) {
        const ra = await db.collection('riskAssessments').findOne({ signalId: sig._id.toString() });
        if (ra) {
          console.log(`  ${sig.symbol} (${sig.side}): ${ra.reasons?.join(' | ')}`);
        }
      }
    }

    // 3. Open paper orders
    const openOrders = await db.collection('paperOrders').find({ status: 'OPEN' }).toArray();
    console.log(`\n--- Open Paper Trades: ${openOrders.length} ---`);
    for (const o of openOrders) {
      console.log(`  ${o.symbol} ${o.side} | Entry: ${o.entryPrice} | OpenedAt: ${new Date(o.openedAt).toISOString()}`);
    }

    // 4. Recent closed orders with PnL
    const recentClosed = await db.collection('paperOrders')
      .find({ status: { $in: ['CLOSED', 'STOPPED'] }, closedAt: { $gte: since24h } })
      .sort({ closedAt: -1 })
      .toArray();

    console.log(`\n--- Closed/Stopped Trades (last 24h): ${recentClosed.length} ---`);
    for (const o of recentClosed) {
      const pnl = Number(o.pnl || 0).toFixed(2);
      console.log(`  ${o.symbol} ${o.side} → ${o.status} | PnL: $${pnl} | ClosedAt: ${new Date(o.closedAt).toISOString()}`);
    }

    // 5. Loss-blocked symbols (4h block)
    const lossBlockCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const recentLosses = await db.collection('paperOrders')
      .find({ closedAt: { $gte: lossBlockCutoff }, status: 'STOPPED', pnl: { $lt: 0 } })
      .toArray();
    if (recentLosses.length > 0) {
      console.log(`\n--- 🔴 Loss-Blocked Symbols (4h cooldown) ---`);
      for (const o of recentLosses) {
        console.log(`  ${o.symbol} — stopped at ${new Date(o.closedAt).toISOString()} | PnL: $${Number(o.pnl).toFixed(2)}`);
      }
    }

    // 6. Cooldown-blocked symbols (signal in last 4h)
    const cooldownCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const recentSignals = await db.collection('signals')
      .find({ createdAt: { $gte: cooldownCutoff } })
      .project({ symbol: 1, createdAt: 1, status: 1 })
      .toArray();
    if (recentSignals.length > 0) {
      console.log(`\n--- 🟡 Cooldown-Blocked Symbols (signal created <4h ago) ---`);
      for (const s of recentSignals) {
        const ageMin = Math.floor((Date.now() - new Date(s.createdAt).getTime()) / 60000);
        console.log(`  ${s.symbol} — ${s.status} signal ${ageMin}m ago`);
      }
    }

    // 7. App logs (last 50 entries)
    const logs = await db.collection('logs')
      .find({ timestamp: { $gte: since24h } })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();

    if (logs.length > 0) {
      console.log(`\n--- 📋 Recent Logs (last 50) ---`);
      for (const log of logs) {
        const t = new Date(log.timestamp).toISOString().slice(11, 19);
        console.log(`  [${t}] [${log.level}] ${log.source}: ${log.message}`);
      }
    }

    console.log(`\n${'='.repeat(60)}\n`);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
