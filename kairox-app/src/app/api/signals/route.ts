import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { auth } from '@/lib/auth';
import { redis } from '@/lib/redis';
import { signalQueue } from '@/workers/queues';
import type { NormalizedCandle } from '@/services/market-data/binance';

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const assetParam = searchParams.get('asset');
    const status = searchParams.get('status');
    const side = searchParams.get('side');

    let query: FirebaseFirestore.Query = db.collection('signals');
    
    if (assetParam && assetParam !== 'ALL') query = query.where('symbol', '==', assetParam);
    if (status && status !== 'ALL') query = query.where('status', '==', status);
    if (side && side !== 'ALL') query = query.where('side', '==', side);

    const snapshot = await query.orderBy('createdAt', 'desc').limit(50).get();

    const signals = await Promise.all(snapshot.docs.map(async (doc) => {
      const data = doc.data();
      const signalId = doc.id;

      // Fetch asset
      const assetSnapshot = await db.collection('assets').where('symbol', '==', data.symbol).limit(1).get();
      const asset = assetSnapshot.empty ? { symbol: data.symbol } : { id: assetSnapshot.docs[0].id, ...assetSnapshot.docs[0].data() };

      // Fetch risk assessment
      const riskSnapshot = await db.collection('riskAssessments').where('signalId', '==', signalId).limit(1).get();
      const riskAssessment = riskSnapshot.empty ? null : { id: riskSnapshot.docs[0].id, ...riskSnapshot.docs[0].data() };

      // Fetch votes
      const votesSnapshot = await db.collection('signalVotes').where('signalId', '==', signalId).get();
      const votes = votesSnapshot.docs.map(v => ({ id: v.id, ...v.data() }));

      return {
        id: signalId,
        ...data,
        asset,
        riskAssessment,
        votes,
      };
    }));

    return NextResponse.json(signals);
  } catch (error) {
    console.error('[API] Failed to fetch signals:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const symbol = (body?.symbol || 'BTCUSDT').toUpperCase();
    const timeframe = body?.timeframe || '1h';
    const key = `market:${symbol}:${timeframe}:latest`;

    const candleJson = await redis.get(key);
    if (!candleJson) {
      return NextResponse.json(
        { error: `No latest candle found for ${symbol} ${timeframe}. Wait for market stream to cache data.` },
        { status: 400 }
      );
    }

    const candle = JSON.parse(candleJson) as NormalizedCandle;
    await signalQueue.add('generate-signal', { candle });

    return NextResponse.json(
      { message: 'Signal generation queued', symbol, timeframe },
      { status: 202 }
    );
  } catch (error) {
    console.error('[API] Failed to queue manual signal generation:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
