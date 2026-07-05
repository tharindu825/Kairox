import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { binanceDemoService } from '@/services/execution/binance-demo';
import { z } from 'zod';

const closeSchema = z.object({
  symbol: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.BINANCE_TESTNET_API_KEY) {
      return NextResponse.json({ error: 'Binance API keys not configured' }, { status: 400 });
    }

    const body = await request.json();
    const { symbol } = closeSchema.parse(body);

    await binanceDemoService.closePosition(symbol);
    
    return NextResponse.json({ message: `Successfully closed position for ${symbol}` });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input data' }, { status: 400 });
    }
    console.error('[API] Failed to close Binance position:', error.message);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
