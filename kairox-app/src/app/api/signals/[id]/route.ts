import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
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
    const signal = await db.signal.findUnique({
      where: { id },
      include: { asset: true },
    });

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
    const updated = await db.signal.update({
      where: { id },
      data: { status },
      include: {
        asset: true,
        riskAssessment: true,
        votes: true,
      },
    });

    // Audit log
    await db.auditLog.create({
      data: {
        userId: (session.user as any)?.id || null,
        action: status === 'APPROVED' ? 'SIGNAL_APPROVED' : 'SIGNAL_BLOCKED',
        entity: 'Signal',
        entityId: id,
        details: {
          symbol: signal.asset?.symbol,
          side: signal.side,
          previousStatus: signal.status,
          newStatus: status,
        },
      },
    });

    return NextResponse.json(updated);
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
