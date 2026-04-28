import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { redis } from '@/lib/redis';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { symbol } = await params;

    // Get asset from DB
    const asset = await db.asset.findUnique({
      where: { symbol: symbol.toUpperCase() },
    });

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // Fetch historical candles from Binance REST API
    const interval = '1h';
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=200`;
    const binanceRes = await fetch(url);
    const klines: any[][] = binanceRes.ok ? await binanceRes.json() : [];

    const candles = klines.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    // Get latest price from Redis
    const priceStr = await redis.hget('market:ticker', symbol.toUpperCase());
    const currentPrice = priceStr ? parseFloat(priceStr) : (candles.length > 0 ? candles[candles.length - 1].close : 0);

    // Get recent signals for this asset
    const signals = await db.signal.findMany({
      where: { assetId: asset.id },
      include: {
        riskAssessment: true,
        votes: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Get open paper trades for this asset
    const openTrades = await db.paperOrder.findMany({
      where: {
        status: 'OPEN',
        signal: { assetId: asset.id },
      },
      include: { signal: true },
    });

    return NextResponse.json({
      asset,
      currentPrice,
      candles,
      signals,
      openTrades,
    });
  } catch (error) {
    console.error('[API] Failed to fetch asset detail:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
