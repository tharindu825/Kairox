import { getDb } from '@/lib/mongodb';
import { IndicatorService } from '@/services/indicators';
import type { NormalizedCandle } from '@/services/market-data/binance';

export type SideFilter = 'ALL' | 'LONG' | 'SHORT';

export interface SignalSelectionOptions {
  timeframe?: string;
  sideFilter?: SideFilter;
  assetQuery?: string;
  candidateSymbols?: string[];
}

export interface SignalSelectionResult {
  symbol: string;
  candle: NormalizedCandle;
  score: number;
  inferredSide: 'LONG' | 'SHORT';
}

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map((symbol) => String(symbol).toUpperCase()).filter(Boolean)));
}

async function resolveCandidateSymbols(explicitSymbols?: string[]): Promise<string[]> {
  if (explicitSymbols && explicitSymbols.length > 0) {
    return normalizeSymbols(explicitSymbols);
  }

  const db = await getDb();
  const assets = await db.collection('assets').find({}).toArray();
  const assetSymbols = normalizeSymbols(
    assets.map((asset) => String(asset.symbol || ''))
  );

  return assetSymbols.length > 0 ? assetSymbols : DEFAULT_SYMBOLS;
}

export async function fetchRecentCandles(
  symbol: string,
  timeframe: string,
  limit = 220
): Promise<NormalizedCandle[] | null> {
  const binanceUrl = process.env.BINANCE_REST_URL || 'https://api.binance.com';
  const response = await fetch(
    `${binanceUrl}/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`,
    { cache: 'no-store' }
  );

  if (!response.ok) return null;
  const klines = await response.json();
  if (!Array.isArray(klines) || klines.length === 0) return null;

  return klines.map((k: any) => ({
    symbol,
    timeframe,
    timestamp: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    isClosed: true,
  }));
}

function scoreCandidate(candle: NormalizedCandle, trendStrength: number, macdStrength: number): number {
  // Momentum: percentage change of the candle body (primary driver of score)
  const momentum = Math.abs((candle.close - candle.open) / Math.max(candle.open, 1));
  // Volume: normalize to a 0-1 range using log scale, capped so majors don't dominate
  const logVolume = Math.min(Math.log10(Math.max(candle.volume, 1)) / 10, 1);
  // Normalize MACD relative to price so BTC ($60k MACD) doesn't dominate altcoins ($0.01 MACD)
  const normalizedMacd = candle.close > 0 ? macdStrength / candle.close : 0;
  // Score: momentum (65%), normalized MACD alignment (25%), volume bonus (10%)
  return (momentum * 100 * trendStrength) * 0.65 + (normalizedMacd * 1000) * 0.25 + logVolume * 0.10;
}

function passesIndicatorFilters(
  inferredSide: 'LONG' | 'SHORT',
  features: {
    rsi: number;
    macd: { histogram: number };
    ema20: number;
    ema50: number;
    atr: number;
    trend: string;
  },
  close: number
): boolean {
  if (!Number.isFinite(features.atr) || features.atr <= 0) return false;

  // MACD must be clearly aligned (not just barely crossing zero)
  const macdAligned = inferredSide === 'LONG'
    ? features.macd.histogram > 0
    : features.macd.histogram < 0;

  // Tighter RSI ranges to avoid overbought/oversold entries
  const rsiAligned = inferredSide === 'LONG'
    ? features.rsi >= 42 && features.rsi <= 68
    : features.rsi >= 32 && features.rsi <= 58;

  // Price must be above/below BOTH EMA20 and EMA50 for strong trend confirmation
  const emaAligned = inferredSide === 'LONG'
    ? close >= features.ema20 && close >= features.ema50
    : close <= features.ema20 && close <= features.ema50;

  // Require meaningful candle body relative to ATR (at least 30%)
  // This filters out doji/indecision candles
  const trend = features.trend;
  const isStrongTrend = trend.startsWith('STRONG');

  return macdAligned && rsiAligned && emaAligned && isStrongTrend;
}

async function evaluateSymbol(
  symbol: string,
  timeframe: string,
  sideFilter: SideFilter
): Promise<SignalSelectionResult | null> {
  const candles = await fetchRecentCandles(symbol, timeframe, 220);
  if (!candles || candles.length < 60) return null;

  const indicator = new IndicatorService();
  for (const candle of candles) {
    indicator.update(candle);
  }

  const latest = candles[candles.length - 1];
  const features = indicator.getFeatureBundle(latest);
  const inferredSide: 'LONG' | 'SHORT' = features.trend.includes('BULL') ? 'LONG' : 'SHORT';

  if (sideFilter !== 'ALL' && sideFilter !== inferredSide) return null;
  if (!passesIndicatorFilters(inferredSide, features, latest.close)) return null;

  const trendStrength = features.trend.startsWith('STRONG') ? 2 : 1;
  const score = scoreCandidate(latest, trendStrength, Math.abs(features.macd.histogram || 0));

  return {
    symbol,
    candle: latest,
    score,
    inferredSide,
  };
}

export async function selectBestSignalCandidate(
  options: SignalSelectionOptions = {},
  limit = 1
): Promise<SignalSelectionResult[]> {
  const timeframe = options.timeframe || '1h';
  const sideFilter: SideFilter = options.sideFilter || 'ALL';
  const assetQuery = (options.assetQuery || '').toUpperCase().trim();
  const symbols = await resolveCandidateSymbols(options.candidateSymbols);
  const filteredSymbols = assetQuery ? symbols.filter((symbol) => symbol.includes(assetQuery)) : symbols;

  if (filteredSymbols.length === 0) return [];

  // Process in the order they were provided (or alphabetically) to ensure fairness
  const sortedSymbols = assetQuery ? filteredSymbols : [...filteredSymbols].sort();

  // Limit to first 200 for performance as requested
  const processingSymbols = sortedSymbols.slice(0, 200);

  // Process in batches of 10 to avoid overwhelming Binance API with concurrent requests
  const BATCH_SIZE = 10;
  const candidates: SignalSelectionResult[] = [];

  for (let i = 0; i < processingSymbols.length; i += BATCH_SIZE) {
    const batch = processingSymbols.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (symbol) => {
        try {
          return await evaluateSymbol(symbol, timeframe, sideFilter);
        } catch {
          // Skip symbols that fail (timeout, invalid pair, etc.)
          return null;
        }
      })
    );
    for (const r of results) {
      if (r) candidates.push(r);
    }
    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < processingSymbols.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  
  if (candidates.length === 0) return [];

  // Diversity: penalize symbols that already have recent signals (last 2 cycles)
  const db = await getDb();
  const intervalMs = Number(process.env.AUTO_SIGNAL_INTERVAL_SECONDS || 300) * 1000;
  const recentCutoff = new Date(Date.now() - intervalMs * 2);
  const recentSignals = await db.collection('signals')
    .find({ createdAt: { $gte: recentCutoff } })
    .project({ symbol: 1 })
    .toArray();
  const recentSymbols = new Set(recentSignals.map((s) => s.symbol));

  // Apply diversity penalty: reduce score of recently-signaled assets by 70%
  const diversified = candidates.map((c) => ({
    ...c,
    score: recentSymbols.has(c.symbol) ? c.score * 0.3 : c.score,
  }));

  // Return the top N candidates sorted by score
  return diversified.sort((a, b) => b.score - a.score).slice(0, limit);
}

