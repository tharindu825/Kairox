import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('No URI');
  const options: any = {};
  if (process.env.MONGODB_USER && process.env.MONGODB_PASS) {
    options.auth = { username: process.env.MONGODB_USER, password: process.env.MONGODB_PASS };
  }
  const client = new MongoClient(uri, options);
  await client.connect();
  const db = client.db('kairox');

  // ALL paper orders ever
  const allOrders = await db.collection('paperOrders')
    .find({})
    .sort({ createdAt: -1 })
    .limit(30)
    .toArray();

  console.log(`\n=== ALL PAPER ORDERS (most recent 30): ${allOrders.length} ===\n`);
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  let open = 0;
  let expired = 0;
  for (const o of allOrders) {
    const pnl = o.pnl !== undefined && o.pnl !== null ? Number(o.pnl) : null;
    console.log(`  ${o.symbol} | ${o.side} | status=${o.status} | pnl=${pnl !== null ? pnl.toFixed(4) : 'N/A'} | entry=${o.entryPrice} | exit=${o.exitPrice || '-'} | created=${o.createdAt || o.openedAt || '-'} | closed=${o.closedAt || '-'}`);
    if (o.status === 'OPEN') open++;
    else if (o.status === 'EXPIRED') expired++;
    else if (pnl !== null) {
      totalPnl += pnl;
      if (pnl > 0) wins++;
      else losses++;
    }
  }
  console.log(`\n  Summary: ${wins} wins, ${losses} losses, ${open} open, ${expired} expired | Total PnL: ${totalPnl.toFixed(4)}`);

  // Count all signals ever
  const totalSignals = await db.collection('signals').countDocuments({});
  const approvedSignals = await db.collection('signals').countDocuments({ status: 'APPROVED' });
  const blockedSignals = await db.collection('signals').countDocuments({ status: 'BLOCKED' });
  console.log(`\n=== ALL-TIME SIGNAL COUNTS ===`);
  console.log(`  Total: ${totalSignals} | Approved: ${approvedSignals} | Blocked: ${blockedSignals}`);

  await client.close();
}
run().catch(console.error);
