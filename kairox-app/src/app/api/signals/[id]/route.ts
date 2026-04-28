import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { auth } from '@/lib/auth';
import { z } from 'zod';

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

    // Verify signal exists and is in PENDING state
    const signalRef = db.collection('signals').doc(id);
    const signalDoc = await signalRef.get();

    if (!signalDoc.exists) {
      return NextResponse.json({ error: 'Signal not found' }, { status: 404 });
    }

    const signalData = signalDoc.data() as any;

    if (signalData.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Signal is already ${signalData.status}` },
        { status: 400 }
      );
    }

    // Update signal status
    await signalRef.update({ status, updatedAt: new Date() });

    // Audit log
    await db.collection('auditLogs').add({
      userId: (session.user as any)?.id || null,
      action: status === 'APPROVED' ? 'SIGNAL_APPROVED' : 'SIGNAL_BLOCKED',
      entity: 'Signal',
      entityId: id,
      details: {
        symbol: signalData.symbol,
        side: signalData.side,
        previousStatus: signalData.status,
        newStatus: status,
      },
      createdAt: new Date(),
    });

    return NextResponse.json({ id, ...signalData, status });
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
