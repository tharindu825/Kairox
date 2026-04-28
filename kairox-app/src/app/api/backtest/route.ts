import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { auth } from '@/lib/auth';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { z } from 'zod';
import { Decimal } from 'decimal.js';

const backtestSchema = z.object({
  asset: z.string().min(1),
  timeframe: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit: 5 backtest runs per minute (expensive operation)
    const rl = checkRateLimit(`backtest:${session.user?.email || 'anon'}`, { maxRequests: 5, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many backtest requests. Please wait.' }, { status: 429, headers: rateLimitHeaders(rl) });
    }

    const body = await request.json();
    const { asset, timeframe, startDate, endDate } = backtestSchema.parse(body);

    // Fetch historical candles from Binance REST API
    const interval = timeframe.toLowerCase();
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();

    const url = `https://api.binance.com/api/v3/klines?symbol=${asset}&interval=${interval}&startTime=${start}&endTime=${end}&limit=500`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const klines: any[][] = await response.json();

    if (klines.length < 30) {
      return NextResponse.json({
        error: 'Insufficient data for backtesting. Need at least 30 candles.',
      }, { status: 400 });
    }

    // Run a simple rule-based backtest (EMA crossover + RSI filter)
    const trades: any[] = [];
    let wins = 0;
    let losses = 0;
    let totalPnL = 0;
    let maxDrawdown = 0;
    let peak = 0;
    let equity = 10000;

    // Calculate EMAs
    const closes = klines.map(k => parseFloat(k[4]));

    const ema = (data: number[], period: number): number[] => {
      const result: number[] = [];
      const multiplier = 2 / (period + 1);
      result[0] = data[0];
      for (let i = 1; i < data.length; i++) {
        result[i] = (data[i] - result[i - 1]) * multiplier + result[i - 1];
      }
      return result;
    };

    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);

    // Simple RSI
    const calcRSI = (data: number[], period: number): number[] => {
      const rsi: number[] = Array(data.length).fill(50);
      for (let i = period; i < data.length; i++) {
        let gains = 0, lossesSum = 0;
        for (let j = i - period + 1; j <= i; j++) {
          const change = data[j] - data[j - 1];
          if (change > 0) gains += change;
          else lossesSum += Math.abs(change);
        }
        const avgGain = gains / period;
        const avgLoss = lossesSum / period;
        rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
      }
      return rsi;
    };

    const rsiValues = calcRSI(closes, 14);

    // Simulate trades
    let inTrade = false;
    let tradeEntry = 0;
    let tradeSide: 'LONG' | 'SHORT' = 'LONG';
    let tradeEntryIndex = 0;

    for (let i = 50; i < klines.length - 1; i++) {
      const close = closes[i];
      const rsi = rsiValues[i];

      if (!inTrade) {
        // Long entry: EMA20 crosses above EMA50, RSI < 70
        if (ema20[i] > ema50[i] && ema20[i - 1] <= ema50[i - 1] && rsi < 70) {
          inTrade = true;
          tradeSide = 'LONG';
          tradeEntry = close;
          tradeEntryIndex = i;
        }
        // Short entry: EMA20 crosses below EMA50, RSI > 30
        else if (ema20[i] < ema50[i] && ema20[i - 1] >= ema50[i - 1] && rsi > 30) {
          inTrade = true;
          tradeSide = 'SHORT';
          tradeEntry = close;
          tradeEntryIndex = i;
        }
      } else {
        // Exit after 5 candles or on EMA cross reversal
        const holdingPeriod = i - tradeEntryIndex;
        const exitSignal = holdingPeriod >= 5 ||
          (tradeSide === 'LONG' && ema20[i] < ema50[i]) ||
          (tradeSide === 'SHORT' && ema20[i] > ema50[i]);

        if (exitSignal) {
          const exitPrice = close;
          const pnl = tradeSide === 'LONG'
            ? ((exitPrice - tradeEntry) / tradeEntry) * 100
            : ((tradeEntry - exitPrice) / tradeEntry) * 100;

          equity += equity * (pnl / 100);
          totalPnL += pnl;
          if (pnl > 0) wins++;
          else losses++;

          if (equity > peak) peak = equity;
          const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
          if (drawdown > maxDrawdown) maxDrawdown = drawdown;

          trades.push({
            side: tradeSide,
            entry: tradeEntry,
            exit: exitPrice,
            pnl: Math.round(pnl * 100) / 100,
            holdingPeriod,
            entryTime: new Date(klines[tradeEntryIndex][0]).toISOString(),
            exitTime: new Date(klines[i][0]).toISOString(),
          });

          inTrade = false;
        }
      }
    }

    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const expectancy = totalTrades > 0 ? totalPnL / totalTrades : 0;

    // Save backtest run to DB
    const assetSnapshot = await db.collection('assets').where('symbol', '==', asset).limit(1).get();
    const assetId = assetSnapshot.empty ? asset : assetSnapshot.docs[0].id;

    const runRef = db.collection('backtestRuns').doc();
    const runData = {
      assetId,
      timeframe,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      modelConfig: { strategy: 'EMA_CROSSOVER_RSI', ema: [20, 50], rsi: 14 },
      results: {
        winRate: Math.round(winRate * 10) / 10,
        expectancy: Math.round(expectancy * 100) / 100,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
        totalTrades,
        wins,
        losses,
        totalPnL: Math.round(totalPnL * 100) / 100,
        finalEquity: Math.round(equity * 100) / 100,
      },
      trades,
      createdAt: new Date(),
    };
    
    await runRef.set(runData);

    const run = { id: runRef.id, ...runData };

    return NextResponse.json({
      id: run.id,
      results: run.results,
      trades: run.trades,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message }, { status: 400 });
    }
    console.error('[API] Backtest error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const snapshot = await db.collection('backtestRuns')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const runs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    return NextResponse.json(runs);
  } catch (error) {
    console.error('[API] Failed to fetch backtests:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
