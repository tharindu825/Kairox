import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { ObjectId } from 'mongodb';

const updateSchema = z.object({
  status: z.enum(['APPROVED', 'BLOCKED']),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { status } = updateSchema.parse(body);

    const db = await getDb();
    
    // Verify signal exists and is in PENDING state
    const signal = await db.collection('signals').findOne({ _id: new ObjectId(id) });

    if (!signal) {
      return NextResponse.json({ error: 'Signal not found' }, { status: 404 });
    }

    if (signal.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Signal is already ${signal.status}` },
        { status: 400 }
      );
    }

    // Update signal status
    await db.collection('signals').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } }
    );

    // Audit log
    await db.collection('auditLogs').insertOne({
      userId: (session.user as any)?.id || null,
      action: status === 'APPROVED' ? 'SIGNAL_APPROVED' : 'SIGNAL_BLOCKED',
      entity: 'Signal',
      entityId: id,
      details: {
        symbol: signal.symbol,
        side: signal.side,
        previousStatus: signal.status,
        newStatus: status,
      },
      createdAt: new Date(),
    });

    return NextResponse.json({ id, ...signal, status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }
    console.error('[API] Failed to update signal:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const db = await getDb();

    const signal = await db.collection('signals').findOne({ _id: new ObjectId(id) });

    if (!signal) {
      return NextResponse.json({ error: 'Signal not found' }, { status: 404 });
    }

    // Delete the signal
    await db.collection('signals').deleteOne({ _id: new ObjectId(id) });

    // Also delete associated risk assessment and votes
    await db.collection('riskAssessments').deleteMany({ signalId: id });
    await db.collection('signalVotes').deleteMany({ signalId: id });

    // Audit log
    await db.collection('auditLogs').insertOne({
      userId: (session.user as any)?.id || null,
      action: 'SIGNAL_DELETED',
      entity: 'Signal',
      entityId: id,
      details: {
        symbol: signal.symbol,
        side: signal.side,
      },
      createdAt: new Date(),
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[API] Failed to delete signal:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
