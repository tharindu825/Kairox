import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
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
    const sym = symbol.toUpperCase();

    // Get asset from DB
    const assetSnapshot = await db.collection('assets').where('symbol', '==', sym).limit(1).get();

    if (assetSnapshot.empty) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }
    const asset = { id: assetSnapshot.docs[0].id, ...assetSnapshot.docs[0].data() };

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
    const signalsSnapshot = await db.collection('signals')
      .where('symbol', '==', sym)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
      
    const signals = await Promise.all(signalsSnapshot.docs.map(async (doc) => {
      const signalData = doc.data();
      const signalId = doc.id;
      
      const riskSnapshot = await db.collection('riskAssessments').where('signalId', '==', signalId).limit(1).get();
      const votesSnapshot = await db.collection('signalVotes').where('signalId', '==', signalId).get();
      
      return {
        id: signalId,
        ...signalData,
        riskAssessment: riskSnapshot.empty ? null : { id: riskSnapshot.docs[0].id, ...riskSnapshot.docs[0].data() },
        votes: votesSnapshot.docs.map(v => ({ id: v.id, ...v.data() }))
      };
    }));

    // Get open paper trades for this asset
    const openTradesSnapshot = await db.collection('paperOrders')
      .where('symbol', '==', sym)
      .where('status', '==', 'OPEN')
      .get();
      
    const openTrades = await Promise.all(openTradesSnapshot.docs.map(async (doc) => {
      const tradeData = doc.data();
      // fetch signal
      let signal = null;
      if (tradeData.signalId) {
        const sigDoc = await db.collection('signals').doc(tradeData.signalId).get();
        if (sigDoc.exists) signal = { id: sigDoc.id, ...sigDoc.data() };
      }
      return { id: doc.id, ...tradeData, signal };
    }));

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
