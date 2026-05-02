import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { redis } from '@/lib/redis';
import { ObjectId } from 'mongodb';

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
    const sym = symbol.toUpperCase();
    const db = await getDb();

    // Get asset from DB
    const asset = await db.collection('assets').findOne({ symbol: sym });

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }
    const formattedAsset = { id: asset._id.toString(), ...asset };

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
    const signalsDocs = await db.collection('signals')
      .find({ symbol: sym })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
      
    const signals = await Promise.all(signalsDocs.map(async (data) => {
      const signalId = data._id.toString();
      
      const riskAssessment = await db.collection('riskAssessments').findOne({ signalId });
      const votes = await db.collection('signalVotes').find({ signalId }).toArray();
      
      return {
        ...data,
        id: signalId,
        riskAssessment: riskAssessment ? { id: riskAssessment._id.toString(), ...riskAssessment } : null,
        votes: votes.map(v => ({ id: v._id.toString(), ...v }))
      };
    }));

    // Get open paper trades for this asset
    const openTradesDocs = await db.collection('paperOrders')
      .find({ symbol: sym, status: 'OPEN' })
      .toArray();
      
    const openTrades = await Promise.all(openTradesDocs.map(async (data) => {
      const tradeId = data._id.toString();
      // fetch signal
      let signal = null;
      if (data.signalId) {
        const sig = await db.collection('signals').findOne({ _id: new ObjectId(data.signalId) });
        if (sig) signal = { id: sig._id.toString(), ...sig };
      }
      return { ...data, id: tradeId, signal };
    }));

    return NextResponse.json({
      asset: formattedAsset,
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
