/**
 * reset-demo-data.ts
 * ─────────────────────────────────────────────────────────────────
 * Wipes ALL demo / paper-trading data from the Kairox MongoDB
 * database and gives the app a clean fresh start.
 *
 * Collections DELETED (trading data):
 *   • paperOrders     — paper-trade orders (open, closed, cancelled…)
 *   • signals         — AI-generated trade signals
 *   • riskAssessments — per-signal risk analysis records
 *   • signalVotes     — AI model votes per signal
 *   • backtestRuns    — historical back-test results
 *   • systemLogs      — worker / system event logs
 *   • auditLogs       — API audit trail entries
 *
 * Collections PRESERVED (configuration / identity):
 *   • users           — user accounts & credentials
 *   • assets          — tracked asset list (crypto & forex)
 *   • strategyPolicy  — active trading strategy parameters
 *   • modelConfig     — AI model configuration
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register reset-demo-data.ts
 * ─────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import { getDb } from './src/lib/mongodb';

// ── Collections that hold transient trading data ──────────────────
const TRADING_COLLECTIONS = [
  'paperOrders',
  'signals',
  'riskAssessments',
  'signalVotes',
  'backtestRuns',
  'systemLogs',
  'auditLogs',
] as const;

// ── Collections that must NOT be touched ─────────────────────────
const PRESERVED_COLLECTIONS = [
  'users',
  'assets',
  'strategyPolicy',
  'modelConfig',
];

async function resetDemoData() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║    Kairox — Fresh Start / Demo Data Reset    ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  console.log('⚠️  Collections preserved (will NOT be touched):');
  PRESERVED_COLLECTIONS.forEach(c => console.log(`   ✓  ${c}`));
  console.log();

  const db = await getDb();
  const results: { collection: string; deleted: number }[] = [];

  for (const collName of TRADING_COLLECTIONS) {
    try {
      const coll = db.collection(collName);
      const countBefore = await coll.countDocuments();

      if (countBefore === 0) {
        console.log(`   ⬜  ${collName.padEnd(20)} — already empty`);
        results.push({ collection: collName, deleted: 0 });
        continue;
      }

      const res = await coll.deleteMany({});
      console.log(
        `   🗑️  ${collName.padEnd(20)} — deleted ${res.deletedCount} document(s)`
      );
      results.push({ collection: collName, deleted: res.deletedCount });
    } catch (err) {
      console.error(`   ❌  ${collName} — ERROR:`, err);
    }
  }

  // ── Summary ───────────────────────────────────────────────────
  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
  console.log('\n──────────────────────────────────────────────');
  console.log(`✅  Reset complete.  Total documents removed: ${totalDeleted}`);
  console.log('──────────────────────────────────────────────\n');

  console.log('🚀  Kairox is ready for a fresh start!\n');
  process.exit(0);
}

resetDemoData().catch(err => {
  console.error('\n❌  Fatal error during reset:', err);
  process.exit(1);
});
