import { resolveCandidateSymbols, evaluateSymbol } from './src/services/signals/auto-selector';
import { getDb } from './src/lib/mongodb';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  console.log('Testing Auto-Selector Filters...');
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT', 'DOTUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'MATICUSDT'];
  
  const results = await Promise.all(symbols.map(async (sym) => {
    try {
      const res = await evaluateSymbol(sym, '1h', 'ALL');
      return { sym, passed: !!res, reason: res ? 'PASSED' : 'REJECTED BY evaluateSymbol' };
    } catch (e: any) {
      return { sym, passed: false, reason: 'ERROR: ' + e.message };
    }
  }));

  console.table(results);

  console.log('Checking cooldowns...');
  const db = await getDb();
  const cooldownCutoff = new Date(Date.now() - 8 * 60 * 60 * 1000);
  const recent = await db.collection('signals').find({ createdAt: { $gte: cooldownCutoff } }).toArray();
  console.log(`Signals in last 8 hours: ${recent.length}`);
  if (recent.length > 0) {
    console.log(`Recent symbols: ${recent.map(r => r.symbol).join(', ')}`);
  }
  process.exit(0);
}

run();
