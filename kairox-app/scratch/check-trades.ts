import { getDb } from '../src/lib/mongodb';

async function check() {
  try {
    const db = await getDb();
    const orders = await db.collection('paperOrders').find({ status: 'OPEN' }).toArray();
    console.log('Open Orders:', JSON.stringify(orders, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

check();
