import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
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
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    const db = await getDb();
    
    const query: any = {};
    if (assetParam && assetParam !== 'ALL') query.symbol = assetParam;
    if (status && status !== 'ALL') query.status = status;
    if (side && side !== 'ALL') query.side = side;

    const baseSignals = await db.collection('signals')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    const signals = await Promise.all(baseSignals.map(async (data) => {
      const signalId = data._id.toString();

      // Fetch asset
      const asset = await db.collection('assets').findOne({ symbol: data.symbol });
      
      // Fetch risk assessment
      const riskAssessment = await db.collection('riskAssessments').findOne({ signalId });

      // Fetch votes
      const votes = await db.collection('signalVotes').find({ signalId }).toArray();

      return {
        ...data,
        id: signalId,
        asset: asset ? { ...asset, id: asset._id.toString() } : { symbol: data.symbol },
        riskAssessment: riskAssessment ? { ...riskAssessment, id: riskAssessment._id.toString() } : null,
        votes: votes.map(v => ({ ...v, id: v._id.toString() })),
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
      const candidates = await selectBestSignalCandidate({
        timeframe,
        sideFilter,
        assetQuery,
      }, 3); // Choose top 3 as requested

      if (candidates.length === 0) {
        return NextResponse.json(
          { error: 'No pairs passed the current filters and indicator requirements.' },
          { status: 400 }
        );
      }

      // Add each candidate to the queue
      const queuedSymbols: string[] = [];
      for (const candidate of candidates) {
        const { symbol: s, candle: c } = candidate;
        await redis.set(`market:${s}:${timeframe}:latest`, JSON.stringify(c));
        await signalQueue.add('generate-signal', { candle: c });
        queuedSymbols.push(s);
      }

      return NextResponse.json(
        { 
          message: `${queuedSymbols.length} signals generation queued`, 
          symbols: queuedSymbols, 
          timeframe, 
          autoSelected: true 
        },
        { status: 202 }
      );
    } else {
      const candles = await fetchRecentCandles(symbol, timeframe, 250);
      if (!candles || candles.length === 0) {
        return NextResponse.json(
          { error: `No candle data available for ${symbol} ${timeframe}.` },
          { status: 400 }
        );
      }
      candle = candles[candles.length - 1];
      await redis.set(`market:${symbol}:${timeframe}:latest`, JSON.stringify(candle));
      await signalQueue.add('generate-signal', { candle });

      return NextResponse.json(
        { message: 'Signal generation queued', symbol, timeframe, autoSelected: false },
        { status: 202 }
      );
    }
  } catch (error) {
    console.error('[API] Failed to queue manual signal generation:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
