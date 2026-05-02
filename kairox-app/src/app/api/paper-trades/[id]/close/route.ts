import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
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
    const result = await paperTradingService.closeOrder(id, 'MANUAL_CLOSE');

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Failed to close paper trade:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
