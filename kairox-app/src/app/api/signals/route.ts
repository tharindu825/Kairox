import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const asset = searchParams.get('asset');
    const status = searchParams.get('status');
    const side = searchParams.get('side');

    const where: any = {};
    if (asset && asset !== 'ALL') where.asset = { symbol: asset };
    if (status && status !== 'ALL') where.status = status;
    if (side && side !== 'ALL') where.side = side;

    const signals = await db.signal.findMany({
      where,
      include: {
        asset: true,
        riskAssessment: true,
        votes: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json(signals);
  } catch (error) {
    console.error('[API] Failed to fetch signals:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
