import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

async function cleanDeadTrades() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('No URI');
  const options: any = {};
  if (process.env.MONGODB_USER && process.env.MONGODB_PASS) {
    options.auth = { username: process.env.MONGODB_USER, password: process.env.MONGODB_PASS };
  }
  const client = new MongoClient(uri, options);
  await client.connect();
  const db = client.db('kairox');

  const deadSymbols = ['ATAUSDT', 'CVPUSDT', 'COMBOUSDT', 'BNXUSDT'];

  const result = await db.collection('paperOrders').updateMany(
    { symbol: { $in: deadSymbols }, status: 'OPEN' },
    { $set: { status: 'CANCELLED', exitReason: 'DELISTED_COIN', closedAt: new Date() } }
  );

  console.log(`Cleaned up ${result.modifiedCount} dead trades.`);

  await client.close();
  process.exit(0);
}
cleanDeadTrades().catch(console.error);
