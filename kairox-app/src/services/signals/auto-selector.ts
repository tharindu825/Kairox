import { db } from '@/lib/firebase-admin';
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

  const assetsSnapshot = await db.collection('assets').get();
  const assetSymbols = normalizeSymbols(
    assetsSnapshot.docs.map((doc) => String((doc.data() as { symbol?: string })?.symbol || ''))
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
  const momentum = Math.abs((candle.close - candle.open) / Math.max(candle.open, 1));
  const logVolume = Math.log10(Math.max(candle.volume, 1));
  return momentum * 100 * trendStrength + macdStrength * 10 + logVolume;
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
  if (features.trend === 'NEUTRAL') return false;
  if (!Number.isFinite(features.atr) || features.atr <= 0) return false;

  const macdAligned = inferredSide === 'LONG' ? features.macd.histogram >= 0 : features.macd.histogram <= 0;
  const rsiAligned =
    inferredSide === 'LONG'
      ? features.rsi >= 45 && features.rsi <= 72
      : features.rsi >= 28 && features.rsi <= 55;
  const emaAligned = inferredSide === 'LONG' ? close >= features.ema20 && close >= features.ema50 : close <= features.ema20 && close <= features.ema50;

  return macdAligned && rsiAligned && emaAligned;
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

export async function selectBestSignalCandidate(options: SignalSelectionOptions = {}): Promise<SignalSelectionResult | null> {
  const timeframe = options.timeframe || '1h';
  const sideFilter: SideFilter = options.sideFilter || 'ALL';
  const assetQuery = (options.assetQuery || '').toUpperCase().trim();
  const symbols = await resolveCandidateSymbols(options.candidateSymbols);
  const filteredSymbols = assetQuery ? symbols.filter((symbol) => symbol.includes(assetQuery)) : symbols;

  if (filteredSymbols.length === 0) return null;

  const evaluated = await Promise.all(filteredSymbols.map((symbol) => evaluateSymbol(symbol, timeframe, sideFilter)));
  const candidates = evaluated.filter((candidate): candidate is SignalSelectionResult => candidate !== null);
  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => b.score - a.score)[0];
}

