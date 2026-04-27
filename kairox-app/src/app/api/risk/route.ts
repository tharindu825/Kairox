import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // In a real app, calculate actual portfolio state from PaperOrders or real exchange
    // We are mocking portfolio metrics for the dashboard view currently
    const metrics = {
      capitalAtRisk: 4.2,
      maxCapitalRisk: 10,
      dailyDrawdown: -1.8,
      maxDrawdown: -5,
      openTrades: 3,
      maxOpenTrades: 5,
      correlatedPairs: 1,
      maxCorrelated: 3,
      consecutiveStops: 0,
      cooldownActive: false,
    };

    const blockedSignals = await db.signal.findMany({
      where: { status: 'BLOCKED' },
      include: { asset: true, riskAssessment: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return NextResponse.json({ metrics, blockedSignals });
  } catch (error) {
    console.error('[API] Failed to fetch risk metrics:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
