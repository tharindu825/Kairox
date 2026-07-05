import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { auth } from '@/lib/auth';
import { binanceDemoService } from '@/services/execution/binance-demo';

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.BINANCE_TESTNET_API_KEY) {
      return NextResponse.json({ error: 'Binance API keys not configured' }, { status: 400 });
    }

    const positions = await binanceDemoService.fetchPositions();
    const balance = await binanceDemoService.fetchBalance();
    
    // Format the response nicely
    return NextResponse.json({ 
      positions: positions.map((p: any) => ({
        symbol: p.symbol,
        side: p.side,
        contracts: p.contracts,
        entryPrice: p.entryPrice,
        markPrice: p.markPrice,
        unrealizedPnl: p.unrealizedPnl,
        percentage: p.percentage,
        leverage: p.leverage,
        collateral: p.collateral
      })),
      balance: balance.USDT ? balance.USDT.total : 0
    });
  } catch (error: any) {
    console.error('[API] Failed to fetch Binance positions:', error.message);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
