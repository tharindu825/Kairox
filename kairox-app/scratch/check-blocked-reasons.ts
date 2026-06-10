import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

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

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  console.log(`Analyzing blocked signals since ${threeDaysAgo.toISOString()}...`);

  // 1. Fetch signals in the last 3 days
  const signals = await db.collection('signals').find({
    createdAt: { $gte: threeDaysAgo }
  }).toArray();

  console.log(`Found ${signals.length} signals in the last 3 days.`);

  // 2. Fetch risk assessments for these signals
  const signalIds = signals.map(s => s._id.toString());
  const assessments = await db.collection('riskAssessments').find({
    signalId: { $in: signalIds }
  }).toArray();

  const assessmentMap = new Map(assessments.map(a => [a.signalId, a]));

  const reasonsMap: Record<string, number> = {};
  let totalBlocked = 0;
  let approvedCount = 0;
  let blockedCount = 0;

  for (const sig of signals) {
    const ra = assessmentMap.get(sig._id.toString());
    if (sig.status === 'APPROVED') {
      approvedCount++;
    } else if (sig.status === 'BLOCKED') {
      blockedCount++;
    }
    
    if (ra && (ra.verdict === 'BLOCKED' || ra.verdict === 'WATCH_ONLY' || sig.status === 'BLOCKED')) {
      totalBlocked++;
      if (ra.reasons && Array.isArray(ra.reasons)) {
        for (const r of ra.reasons) {
          let key = r;
          if (r.includes('R:R ratio')) {
            key = 'R:R ratio below minimum';
          } else if (r.includes('Confidence')) {
            key = 'Low/Moderate confidence';
          } else if (r.includes('Counter-trend')) {
            key = 'Counter-trend alignment';
          } else if (r.includes('Model Agreement') || r.includes('model disagreement')) {
            key = 'Model Disagreement';
          } else if (r.includes('Max open trades')) {
            key = 'Max open trades reached';
          } else if (r.includes('Daily drawdown limit')) {
            key = 'Daily drawdown limit hit';
          } else if (r.includes('Cooldown active')) {
            key = 'Cooldown active after stop-outs';
          }
          reasonsMap[key] = (reasonsMap[key] || 0) + 1;
        }
      }
    }
  }

  console.log(`Approved: ${approvedCount}`);
  console.log(`Blocked: ${blockedCount}`);
  console.log(`Total Blocked/Watch Only Signals tracked by risk engine in Last 3 Days: ${totalBlocked}\n`);
  console.log('── Reasons for Blocking ──');
  for (const [reason, count] of Object.entries(reasonsMap).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count} (${((count / totalBlocked) * 100).toFixed(1)}%)`);
  }

  // Also query specific details of the BABYUSDT trade
  console.log('\n── BABYUSDT trade details ──');
  const babyOrder = await db.collection('paperOrders').findOne({ symbol: 'BABYUSDT' });
  if (babyOrder) {
    console.log(JSON.stringify(babyOrder, null, 2));
    const babySignal = await db.collection('signals').findOne({ _id: new ObjectId(babyOrder.signalId) });
    if (babySignal) {
      console.log('\n── BABYUSDT original signal ──');
      console.log(JSON.stringify(babySignal, null, 2));
    }
  } else {
    console.log('No BABYUSDT order found in paperOrders.');
  }

  await client.close();
}

main().catch(console.error);
