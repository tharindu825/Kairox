import 'dotenv/config';
import { getDb } from '../src/lib/mongodb';

async function checkSignals() {
  const db = await getDb();
  const signals = await db.collection('signals').find({}).sort({ createdAt: -1 }).limit(5).toArray();
  
  console.log('--- LATEST 5 SIGNALS ---');
  signals.forEach(s => {
    console.log(`ID: ${s._id} | Asset: ${s.symbol} | Side: ${s.side} | Status: ${s.status}`);
    console.log(`Entry: ${s.entry} | SL: ${s.stopLoss}`);
    console.log(`Targets: ${JSON.stringify(s.targets)}`);
    console.log('------------------------');
  });
  
  process.exit(0);
}

checkSignals();
