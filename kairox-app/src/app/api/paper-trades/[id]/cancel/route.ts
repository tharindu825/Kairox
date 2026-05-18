import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const db = await getDb();
    const orderId = params.id;

    if (!ObjectId.isValid(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const order = await db.collection('paperOrders').findOne({ _id: new ObjectId(orderId) });

    if (!order || order.status !== 'PENDING') {
      return NextResponse.json({ error: 'Order not found or not in PENDING status' }, { status: 404 });
    }

    // Cancel order
    await db.collection('paperOrders').updateOne(
      { _id: new ObjectId(orderId) },
      {
        $set: {
          status: 'CANCELLED',
          exitReason: 'MANUAL_CANCEL',
          closedAt: new Date()
        }
      }
    );

    // Cancel associated signal
    if (order.signalId) {
      await db.collection('signals').updateOne(
        { _id: new ObjectId(order.signalId) },
        { $set: { status: 'CANCELLED', updatedAt: new Date() } }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API] Error canceling paper trade:', error);
    return NextResponse.json({ error: error.message || 'Failed to cancel trade' }, { status: 500 });
  }
}
