import { NextResponse } from 'next/server';
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

    const orders = await binanceDemoService.fetchOpenOrders();
    
    return NextResponse.json({ 
      orders: orders.map((o: any) => ({
        id: o.id,
        symbol: o.symbol,
        type: o.type,
        side: o.side,
        price: o.price,
        stopPrice: o.stopPrice,
        amount: o.amount,
        status: o.status
      }))
    });
  } catch (error: any) {
    console.error('[API] Failed to fetch Binance orders:', error.message);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
