import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { marketDataService } from '@/services/market-data';

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const assets = await db.asset.findMany({
      include: {
        _count: {
          select: { signals: true }
        }
      }
    });

    // Hydrate with real-time price from Redis
    const populated = await Promise.all(assets.map(async (asset) => {
      const price = await marketDataService.getLatestPrice(asset.symbol);
      return {
        ...asset,
        currentPrice: price || 0,
        change24h: 0, // Placeholder: implement 24h change calculation in market data service
        volume: '0', // Placeholder
        signalsCount: asset._count.signals,
      };
    }));

    return NextResponse.json(populated);
  } catch (error) {
    console.error('[API] Failed to fetch assets:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
