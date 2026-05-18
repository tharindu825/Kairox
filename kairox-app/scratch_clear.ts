import 'dotenv/config';
import { getDb } from './src/lib/mongodb';
import { ObjectId } from 'mongodb';

async function clearPending() {
  try {
    const db = await getDb();
    
    // Get all pending orders
    const pendingOrders = await db.collection('paperOrders').find({ status: 'PENDING' }).toArray();
    console.log(`Found ${pendingOrders.length} pending orders to cancel.`);
    
    for (const order of pendingOrders) {
      await db.collection('paperOrders').updateOne(
        { _id: order._id },
        { $set: { status: 'CANCELLED', exitReason: 'MANUAL_CANCEL', closedAt: new Date() } }
      );
      
      if (order.signalId) {
        await db.collection('signals').updateOne(
          { _id: new ObjectId(order.signalId) },
          { $set: { status: 'CANCELLED', updatedAt: new Date() } }
        );
      }
    }
    
    console.log(`Successfully cancelled ${pendingOrders.length} pending orders.`);
    process.exit(0);
  } catch (error) {
    console.error('Error clearing pending orders:', error);
    process.exit(1);
  }
}

clearPending();
