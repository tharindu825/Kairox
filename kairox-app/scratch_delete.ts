import 'dotenv/config';
import { getDb } from './src/lib/mongodb';

async function deleteCancelled() {
  try {
    const db = await getDb();
    const res = await db.collection('paperOrders').deleteMany({ status: 'CANCELLED' });
    console.log(`Deleted ${res.deletedCount} cancelled orders`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

deleteCancelled();
