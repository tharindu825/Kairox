import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!, {
    auth: { username: process.env.MONGODB_USER, password: process.env.MONGODB_PASS }
  });

  await client.connect();
  const db = client.db('kairox');

  // Changes were applied at ~10:26 UTC on 2026-07-19
  const changeTime = new Date('2026-07-19T10:26:00Z');

  const orders = await db.collection('paperOrders')
    .find({})
    .sort({ openedAt: -1 })
    .limit(2)
    .toArray();

  console.log('\n=== Last 2 Paper Orders ===\n');
  for (const o of orders) {
    const openedAt = new Date(o.openedAt);
    const afterChange = openedAt >= changeTime;
    console.log('Symbol    :', o.symbol);
    console.log('Side      :', o.side);
    console.log('Status    :', o.status);
    console.log('Entry     :', o.entryPrice);
    console.log('Size      :', o.quantity);
    console.log('OpenedAt  :', openedAt.toISOString());
    console.log('After fix :', afterChange ? '✅ YES — generated after our changes' : '❌ NO — pre-dates our changes');

    if (o.signalId) {
      const sig = await db.collection('signals').findOne({ _id: new ObjectId(o.signalId) });
      if (sig) {
        console.log('Signal    :', sig.symbol, sig.side, '| WinProb:', (sig.winProbability * 100).toFixed(0) + '%', '| Status:', sig.status);
        const ra = await db.collection('riskAssessments').findOne({ signalId: o.signalId });
        if (ra) console.log('R:R       :', ra.rewardToRisk?.toFixed(2), '| Verdict:', ra.verdict, '| Reasons:', ra.reasons?.join(' | '));
        const votes = await db.collection('signalVotes').find({ signalId: o.signalId }).toArray();
        for (const v of votes) {
          console.log(`Vote [${v.role}]: ${v.side} (${(v.winProbability * 100).toFixed(0)}%)`);
        }
      }
    }
    console.log('---');
  }

  await client.close();
}

main().catch(console.error);
