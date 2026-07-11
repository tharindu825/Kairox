import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { FOREX_DEFAULT_SYMBOLS } from '@/types';
import { toTwelveSymbol } from '@/services/market-data/twelve-data';

const FOREX_DISPLAY_SYMBOLS = FOREX_DEFAULT_SYMBOLS; // e.g. ['XAU/USD', ...]

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Return available forex pairs for the dropdown
    return NextResponse.json({
      symbols: FOREX_DISPLAY_SYMBOLS,
      timeframes: ['1h', '4h', '1d'],
    });
  } catch (error) {
    console.error('[API] Failed to fetch forex pairs:', error);
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

    // Symbol can arrive as internal key ("XAUUSD") or slash format ("XAU/USD")
    const rawSymbol     = body?.symbol ? String(body.symbol).toUpperCase() : null;
    const timeframe     = body?.timeframe || '4h';
    const autoSelect    = body?.autoSelect === true || !rawSymbol;

    const { redis }            = await import('@/lib/redis');
    const { forexSignalQueue } = await import('@/workers/queues');

    if (autoSelect) {
      // Auto-select best forex candidates
      const { selectBestForexCandidate } = await import('@/services/signals/forex-auto-selector');
      const candidates = await selectBestForexCandidate({ timeframe, sideFilter: 'ALL' }, 3);

      if (candidates.length === 0) {
        return NextResponse.json(
          { error: 'No forex pairs passed the current filters. Try again later.' },
          { status: 400 }
        );
      }

      const queuedSymbols: string[] = [];
      for (const { symbol, candle } of candidates) {
        const displaySymbol = toTwelveSymbol(symbol);
        await redis?.set(`market:${symbol}:${timeframe}:latest`, JSON.stringify(candle));
        await forexSignalQueue.add('generate-forex-signal', { candle, displaySymbol });
        queuedSymbols.push(displaySymbol);
      }

      return NextResponse.json(
        { message: `${queuedSymbols.length} forex signals queued`, symbols: queuedSymbols, timeframe, autoSelected: true },
        { status: 202 }
      );

    } else {
      // Manual symbol request — strip "/" so we have internal key
      const symbol        = rawSymbol!.replace('/', '');
      const displaySymbol = toTwelveSymbol(symbol);

      const { fetchForexCandles } = await import('@/services/signals/forex-auto-selector');
      const candles = await fetchForexCandles(symbol, timeframe, 250);

      if (!candles || candles.length === 0) {
        return NextResponse.json(
          { error: `No candle data available for ${displaySymbol} ${timeframe}. Check your Twelve Data API key.` },
          { status: 400 }
        );
      }

      const candle = candles[candles.length - 1];
      await redis?.set(`market:${symbol}:${timeframe}:latest`, JSON.stringify(candle));
      await forexSignalQueue.add('generate-forex-signal', { candle, displaySymbol });

      return NextResponse.json(
        { message: 'Forex signal generation queued', symbol: displaySymbol, timeframe, autoSelected: false },
        { status: 202 }
      );
    }
  } catch (error) {
    console.error('[API] Failed to queue forex signal generation:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
