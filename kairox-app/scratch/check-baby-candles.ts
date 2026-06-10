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

  // Let's find market snapshots for BABYUSDT
  console.log('Fetching market snapshots for BABYUSDT...');
  const snapshots = await db.collection('marketSnapshots')
    .find({ symbol: 'BABYUSDT' })
    .sort({ createdAt: 1 })
    .toArray();

  console.log(`Found ${snapshots.length} snapshots.`);
  for (const snap of snapshots) {
    console.log(`Snapshot created at: ${snap.createdAt.toISOString()}`);
    if (snap.candles) {
      for (const candle of snap.candles) {
        console.log(`  Candle Time: ${new Date(candle.timestamp).toISOString()} | Open: ${candle.open} | High: ${candle.high} | Low: ${candle.low} | Close: ${candle.close} | Closed: ${candle.isClosed}`);
      }
    }
  }

  // Also search paperOrders for BABYUSDT to see if there were multiple records or ticks
  console.log('\nFetching paperOrders for BABYUSDT...');
  const orders = await db.collection('paperOrders')
    .find({ symbol: 'BABYUSDT' })
    .toArray();
  console.log(JSON.stringify(orders, null, 2));

  await client.close();
}

main().catch(console.error);
