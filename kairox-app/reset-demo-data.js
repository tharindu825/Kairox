/**
 * reset-demo-data.js
 * Wipes all demo/paper-trading data from the Kairox MongoDB database.
 * Run with: node reset-demo-data.js
 */

const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs');

// Load .env manually
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  const key = trimmed.slice(0, idx).trim();
  let value = trimmed.slice(idx + 1).trim();
  // Strip surrounding quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

const MONGODB_URI  = env.MONGODB_URI;
const MONGODB_USER = env.MONGODB_USER;
const MONGODB_PASS = env.MONGODB_PASS;

if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI not found in .env');
  process.exit(1);
}

// Inject credentials into the URI
const fullUri = MONGODB_URI.replace(
  'mongodb+srv://',
  `mongodb+srv://${encodeURIComponent(MONGODB_USER)}:${encodeURIComponent(MONGODB_PASS)}@`
);

// ── Collections to WIPE ──────────────────────────────────────────
const TRADING_COLLECTIONS = [
  'paperOrders',
  'signals',
  'riskAssessments',
  'signalVotes',
  'backtestRuns',
  'systemLogs',
  'auditLogs',
];

// ── Collections to KEEP ──────────────────────────────────────────
const PRESERVED_COLLECTIONS = ['users', 'assets', 'strategyPolicy', 'modelConfig'];

async function reset() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║    Kairox — Fresh Start / Demo Data Reset    ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  console.log('✅  Preserved (will NOT be touched): ' + PRESERVED_COLLECTIONS.join(', '));
  console.log();

  const client = new MongoClient(fullUri);
  await client.connect();
  console.log('🔗  Connected to MongoDB Atlas\n');

  const db = client.db();
  let total = 0;

  for (const collName of TRADING_COLLECTIONS) {
    const col = db.collection(collName);
    const count = await col.countDocuments();
    if (count === 0) {
      console.log('   ⬜  ' + collName.padEnd(20) + ' — already empty');
    } else {
      const result = await col.deleteMany({});
      total += result.deletedCount;
      console.log('   🗑️   ' + collName.padEnd(20) + ' — deleted ' + result.deletedCount + ' document(s)');
    }
  }

  await client.close();

  console.log('\n──────────────────────────────────────────────');
  console.log('✅  Reset complete.  Total documents removed: ' + total);
  console.log('──────────────────────────────────────────────');
  console.log('\n🚀  Kairox is ready for a fresh start!\n');
}

reset().catch(err => {
  console.error('\n❌  Fatal error:', err);
  process.exit(1);
});
