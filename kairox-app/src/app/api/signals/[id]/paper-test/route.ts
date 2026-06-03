import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { ObjectId } from 'mongodb';
import { paperTradingService } from '@/services/paper-trading';

export async function POST(
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

    // Look up the signal
    const signal = await db.collection('signals').findOne({ _id: new ObjectId(id) });
    if (!signal) {
      return NextResponse.json({ error: 'Signal not found' }, { status: 404 });
    }

    if (signal.status !== 'BLOCKED') {
      return NextResponse.json(
        { error: `Only BLOCKED signals can be shadow-tested. This signal is ${signal.status}.` },
        { status: 400 }
      );
    }

    if (signal.side === 'HOLD') {
      return NextResponse.json(
        { error: 'Cannot paper-test a HOLD signal — no position to track.' },
        { status: 400 }
      );
    }

    // Compute position size using the same % risk model as approved trades
    const PAPER_BALANCE = Number(process.env.PAPER_BALANCE || 10000);
    const MAX_RISK_PCT = 2.0; // matches default risk policy
    const riskAmount = PAPER_BALANCE * (MAX_RISK_PCT / 100);
    const stopDistance = Math.abs(Number(signal.entry) - Number(signal.stopLoss));
    const positionSize = stopDistance > 0 ? riskAmount / stopDistance : 0;

    if (positionSize <= 0) {
      return NextResponse.json(
        { error: 'Cannot compute a valid position size (stop distance is zero).' },
        { status: 400 }
      );
    }

    // Execute shadow trade
    const order = await paperTradingService.executeShadowTrade(id, positionSize);

    return NextResponse.json({
      message: 'Shadow trade created — tracking blocked signal in paper trading.',
      order,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';

    // Duplicate shadow trade is a 409 Conflict
    if (message.includes('already exists')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    console.error('[API] Failed to create shadow trade:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
