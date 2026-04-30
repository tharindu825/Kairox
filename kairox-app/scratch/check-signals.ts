import 'dotenv/config';
import { db } from '../src/lib/firebase-admin';

async function checkStatus() {
  console.log('--- Checking System Logs (Last 10) ---');
  const logsSnapshot = await db.collection('systemLogs').orderBy('timestamp', 'desc').limit(10).get();
  logsSnapshot.forEach(doc => {
    const d = doc.data();
    console.log(`[${d.timestamp.toDate().toLocaleTimeString()}] [${d.source}] ${d.level}: ${d.message}`);
  });

  console.log('\n--- Checking Signals (Last 5) ---');
  const signalsSnapshot = await db.collection('signals').orderBy('createdAt', 'desc').limit(5).get();
  if (signalsSnapshot.empty) {
    console.log('No signals found in database.');
  }
  signalsSnapshot.forEach(doc => {
    const d = doc.data();
    console.log(`[${d.createdAt.toDate().toLocaleTimeString()}] ${d.symbol} - ${d.side} - Status: ${d.status}`);
  });

  const assetsCount = (await db.collection('assets').count().get()).data().count;
  console.log(`\nTotal assets in database: ${assetsCount}`);
}

checkStatus().catch(console.error);
