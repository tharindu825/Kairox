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

  const recentSignals = await db.collection('signals')
    .find({})
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();

  console.log('\n=== LATEST SIGNALS IN DB ===');
  for (const s of recentSignals) {
    console.log(`ID: ${s._id}`);
    console.log(`Symbol: ${s.symbol}`);
    console.log(`Market Type: ${s.marketType}`);
    console.log(`Status: ${s.status}`);
    console.log(`Side: ${s.side}`);
    console.log(`Created At: ${s.createdAt}`);
    console.log('---');
  }

  await client.close();
}
run().catch(console.error);
