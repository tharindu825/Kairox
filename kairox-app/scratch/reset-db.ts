import 'dotenv/config';
import { getDb } from '../src/lib/mongodb';

async function resetDatabase() {
  try {
    const db = await getDb();
    
    console.log('Resetting trading data...');
    
    // Delete documents in these collections
    const collectionsToClear = ['signals', 'paperOrders', 'riskAssessments', 'signalVotes'];
    
    for (const collName of collectionsToClear) {
      const res = await db.collection(collName).deleteMany({});
      console.log(`Cleared ${res.deletedCount} documents from ${collName}`);
    }
    
    console.log('Database reset complete. Ready for fresh start!');
    process.exit(0);
  } catch (error) {
    console.error('Error during database reset:', error);
    process.exit(1);
  }
}

resetDatabase();
