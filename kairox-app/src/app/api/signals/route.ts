import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { auth } from '@/lib/auth';
import { fetchRecentCandles, selectBestSignalCandidate, type SideFilter } from '@/services/signals/auto-selector';

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

    const baseSnapshot = await db.collection('signals').orderBy('createdAt', 'desc').limit(300).get();
    const filteredDocs = baseSnapshot.docs.filter((doc) => {
      const data = doc.data();
      if (assetParam && assetParam !== 'ALL' && data.symbol !== assetParam) return false;
      if (status && status !== 'ALL' && data.status !== status) return false;
      if (side && side !== 'ALL' && data.side !== side) return false;
      return true;
    }).slice(0, 50);

    const signals = await Promise.all(filteredDocs.map(async (doc) => {
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
    const requestedSymbol = body?.symbol ? String(body.symbol).toUpperCase() : null;
    const timeframe = body?.timeframe || '1h';
    const sideFilter = body?.sideFilter ? String(body.sideFilter).toUpperCase() as SideFilter : 'ALL';
    const assetQuery = body?.assetQuery ? String(body.assetQuery).toUpperCase() : '';
    const { redis } = await import('@/lib/redis');
    const { signalQueue } = await import('@/workers/queues');
    const autoSelect = body?.autoSelect === true || !requestedSymbol;

    let symbol = requestedSymbol || 'BTCUSDT';
    let candle: any = null;

    if (autoSelect) {
      const best = await selectBestSignalCandidate({
        timeframe,
        sideFilter,
        assetQuery,
      });

      if (!best) {
        return NextResponse.json(
          { error: 'No pair passed the current filters and indicator requirements.' },
          { status: 400 }
        );
      }

      symbol = best.symbol;
      candle = best.candle;
      await redis.set(`market:${symbol}:${timeframe}:latest`, JSON.stringify(candle));
    } else {
      const candles = await fetchRecentCandles(symbol, timeframe, 220);
      if (!candles || candles.length === 0) {
        return NextResponse.json(
          { error: `No candle data available for ${symbol} ${timeframe}.` },
          { status: 400 }
        );
      }
      candle = candles[candles.length - 1];
      await redis.set(`market:${symbol}:${timeframe}:latest`, JSON.stringify(candle));
    }

    await signalQueue.add('generate-signal', { candle });

    return NextResponse.json(
      { message: 'Signal generation queued', symbol, timeframe, autoSelected: autoSelect },
      { status: 202 }
    );
  } catch (error) {
    console.error('[API] Failed to queue manual signal generation:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
