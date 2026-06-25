import { getDb } from '@/lib/mongodb';
import { IndicatorService } from '@/services/indicators';
import { SmartMoneyService } from '@/services/indicators/smc-service';
import { yahooFinanceService } from '@/services/market-data/yahoo-finance';
import { twelveDataService } from '@/services/market-data/twelve-data';
import type { NormalizedCandle } from '@/services/market-data/binance';
import { FOREX_DEFAULT_SYMBOLS } from '@/types';

/**
 * Fetches forex candles using Yahoo Finance first (free, no API key),
 * then falls back to Twelve Data if Yahoo returns insufficient data.
 */
async function getForexKlines(
  symbol:    string,
  timeframe: string,
  limit:     number = 250,
): Promise<NormalizedCandle[]> {
  const yfCandles = await yahooFinanceService.getKlines(symbol, timeframe, limit);
  if (yfCandles.length >= 50) {
    return yfCandles;
  }

  // Fallback to Twelve Data
  console.warn(`[Forex] Yahoo Finance returned insufficient data for ${symbol} — trying Twelve Data...`);
  return twelveDataService.getKlines(symbol, timeframe, limit);
}

export type SideFilter = 'ALL' | 'LONG' | 'SHORT';

export interface ForexSelectionOptions {
  timeframe?:        string;
  sideFilter?:       SideFilter;
  candidateSymbols?: string[];
}

export interface ForexSelectionResult {
  symbol: string;
  candle: NormalizedCandle;
  score:  number;
  inferredSide: 'LONG' | 'SHORT';
}

// ── Symbol resolution ─────────────────────────────────────────────────────────

async function resolveCandidateSymbols(explicitSymbols?: string[]): Promise<string[]> {
  if (explicitSymbols && explicitSymbols.length > 0) {
    return explicitSymbols.map(s => s.toUpperCase());
  }

  // Check MongoDB for user-saved forex assets
  try {
    const db     = await getDb();
    const assets = await db.collection('assets').find({ category: 'FOREX' }).toArray();
    const saved  = assets.map(a => String(a.symbol || '').toUpperCase()).filter(Boolean);
    if (saved.length > 0) return saved;
  } catch {
    // Non-fatal — fall through to defaults
  }

  // Strip "/" from default symbols to get internal keys (e.g. "XAU/USD" → "XAUUSD")
  return FOREX_DEFAULT_SYMBOLS.map(s => s.replace('/', '').toUpperCase());
}

// ── Scoring ───────────────────────────────────────────────────────────────────

interface ForexScore {
  symbol:       string;
  candle:       NormalizedCandle;
  score:        number;
  inferredSide: 'LONG' | 'SHORT';
}

async function scoreForexCandidate(
  symbol:    string,
  timeframe: string,
): Promise<ForexScore | null> {
  const candles = await getForexKlines(symbol, timeframe, 250);
  if (!candles || candles.length < 50) return null;

  // Run indicator service
  const svc = new IndicatorService();
  svc.initialize(symbol, timeframe, candles);

  const latest   = candles[candles.length - 1];
  const features = svc.getEnhancedFeatureBundle(candles);

  const { rsi, macd, adx, atr, stochRsi, volatilityRegime } = features;

  // Skip dead / zero-data candles
  if (atr === 0 || latest.close === 0) return null;

  // Determine likely direction
  const bullSignals = [
    rsi < 50,
    macd.histogram > 0,
    features.trend === 'BULL' || features.trend === 'STRONG_BULL',
    stochRsi.k < 80,
  ].filter(Boolean).length;

  const bearSignals = [
    rsi > 50,
    macd.histogram < 0,
    features.trend === 'BEAR' || features.trend === 'STRONG_BEAR',
    stochRsi.k > 20,
  ].filter(Boolean).length;

  const inferredSide: 'LONG' | 'SHORT' = bullSignals >= bearSignals ? 'LONG' : 'SHORT';

  // Score components
  const momentumScore = Math.abs(rsi - 50) / 50;           // 0-1
  const trendScore    = adx > 25 ? adx / 100 : 0;          // Trending markets preferred
  const atrScore      = volatilityRegime === 'HIGH' ? 1
                      : volatilityRegime === 'NORMAL' ? 0.7
                      : volatilityRegime === 'LOW' ? 0.3 : 0.2;
  const macdScore     = Math.min(Math.abs(macd.histogram) * 10, 1); // Normalised

  const smcBonus = features.smc
    ? (features.smc.lastBOS ? 0.15 : 0) + (features.smc.nearestOB ? 0.15 : 0)
    : 0;

  const score = momentumScore * 0.3 + trendScore * 0.3 + atrScore * 0.2 + macdScore * 0.1 + smcBonus * 0.1;

  return { symbol, candle: latest, score, inferredSide };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function selectBestForexCandidate(
  options:  ForexSelectionOptions = {},
  topN:     number = 3,
): Promise<ForexSelectionResult[]> {
  const { timeframe = '4h', sideFilter = 'ALL', candidateSymbols } = options;

  const symbols = await resolveCandidateSymbols(candidateSymbols);

  // When no API key is set, throttle to 6 pairs to respect Twelve Data's
  // free unauthenticated rate limit (~8 req/min). With a key, scan all.
  const hasApiKey = !!(process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API_KEY !== 'your_twelvedata_api_key_here');
  const scanLimit = hasApiKey ? symbols.length : 6;
  const scanList  = symbols.slice(0, scanLimit);

  // Delay between each API request to avoid 429s:
  //   - No key:  ~8 s gap  (free tier ~8 req/min)
  //   - With key: ~1 s gap (generous plan)
  const requestDelayMs = hasApiKey ? 1000 : 8000;

  console.log(`[Forex Auto-Selector] Scanning ${scanList.length} pairs on ${timeframe} (delay=${requestDelayMs}ms/req, apiKey=${hasApiKey})...`);

  const results: ForexScore[] = [];

  for (let i = 0; i < scanList.length; i++) {
    const symbol = scanList[i];
    if (i > 0) {
      // Throttle between requests
      await new Promise(r => setTimeout(r, requestDelayMs));
    }
    try {
      const result = await scoreForexCandidate(symbol, timeframe);
      if (!result) continue;

      if (sideFilter !== 'ALL' && result.inferredSide !== sideFilter) continue;

      results.push(result);
      console.log(`[Forex Auto-Selector] ${symbol}: score=${result.score.toFixed(4)} side=${result.inferredSide}`);
    } catch (err) {
      console.warn(`[Forex Auto-Selector] Error scoring ${symbol}:`, (err as Error).message);
    }
  }

  // Sort descending by score, take top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}

/**
 * Fetches recent candles for a specific forex symbol.
 * Used by the manual generation API.
 */
export async function fetchForexCandles(
  symbol:    string,
  timeframe: string,
  limit:     number = 250,
): Promise<NormalizedCandle[] | null> {
  const candles = await getForexKlines(symbol, timeframe, limit);
  return candles && candles.length > 0 ? candles : null;
}
