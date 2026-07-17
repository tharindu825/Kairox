/**
 * Regime Service
 *
 * Provides macro trend context before candidates are selected:
 *   - Crypto: BTC trend on 4H and 1D (if BTC is crashing, block altcoin LONGs)
 *   - Forex:  DXY trend on 4H and 1D (USD strength context for pairs)
 *
 * Uses a 15-minute in-memory cache to avoid redundant API calls within a scan cycle.
 * Always fails open (returns NEUTRAL) so a data outage never freezes signal generation.
 */

import { IndicatorService } from '@/services/indicators';
import { yahooFinanceService } from '@/services/market-data/yahoo-finance';
import type { NormalizedCandle } from '@/services/market-data/binance';

// ── Types ──────────────────────────────────────────────────────────────────────

export type CryptoRegime = 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';
export type ForexRegime  = 'STRONG_USD' | 'WEAK_USD' | 'NEUTRAL';

export interface MacroRegime {
  crypto: CryptoRegime;
  forex:  ForexRegime;
}

// ── Internal cache ─────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value:     T;
  expiresAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

let cryptoCache: CacheEntry<CryptoRegime> | null = null;
let forexCache:  CacheEntry<ForexRegime>  | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Fetches BTC candles from Binance REST (no auth needed for public endpoint).
 */
async function fetchBtcCandles(timeframe: string, limit = 200): Promise<NormalizedCandle[]> {
  const binanceUrl = process.env.BINANCE_REST_URL || 'https://api.binance.com';
  const response = await fetch(
    `${binanceUrl}/api/v3/klines?symbol=BTCUSDT&interval=${timeframe}&limit=${limit}`,
    { cache: 'no-store' }
  );
  if (!response.ok) throw new Error(`Binance klines HTTP ${response.status}`);
  const klines: any[] = await response.json();
  return klines.map((k) => ({
    symbol:    'BTCUSDT',
    timeframe,
    timestamp: Number(k[0]),
    open:      Number(k[1]),
    high:      Number(k[2]),
    low:       Number(k[3]),
    close:     Number(k[4]),
    volume:    Number(k[5]),
    isClosed:  true,
  }));
}

/**
 * Derives a trend label from a candle array using EMA alignment.
 * Reuses the existing IndicatorService — no new logic needed.
 */
function deriveTrend(candles: NormalizedCandle[]): string {
  if (candles.length < 60) return 'NEUTRAL';
  const svc = new IndicatorService();
  svc.initialize(candles[0].symbol, candles[0].timeframe, candles);
  const features = svc.getEnhancedFeatureBundle(candles);
  return features.trend;
}

// ── Crypto Regime ──────────────────────────────────────────────────────────────

/**
 * Fetches the BTC regime (STRONG_BULL → STRONG_BEAR) based on the 4H and 1D trend.
 *
 * Rules:
 *   - Both 4H and 1D STRONG_BEAR → STRONG_BEAR
 *   - Both STRONG_BULL            → STRONG_BULL
 *   - 1D alone BEAR/STRONG_BEAR   → BEAR
 *   - 1D alone BULL/STRONG_BULL   → BULL
 *   - Otherwise                  → NEUTRAL
 */
async function resolveCryptoRegime(): Promise<CryptoRegime> {
  try {
    const [candles4h, candles1d] = await Promise.all([
      fetchBtcCandles('4h', 200),
      fetchBtcCandles('1d', 200),
    ]);

    const trend4h = deriveTrend(candles4h);
    const trend1d = deriveTrend(candles1d);

    console.log(`[Regime] BTC 4H=${trend4h} | 1D=${trend1d}`);

    if (trend4h === 'STRONG_BEAR' && trend1d === 'STRONG_BEAR') return 'STRONG_BEAR';
    if (trend4h === 'STRONG_BULL' && trend1d === 'STRONG_BULL') return 'STRONG_BULL';
    if (trend1d === 'STRONG_BEAR' || trend1d === 'BEAR')        return 'BEAR';
    if (trend1d === 'STRONG_BULL' || trend1d === 'BULL')        return 'BULL';
    return 'NEUTRAL';
  } catch (err) {
    console.warn('[Regime] Failed to resolve BTC regime — defaulting to NEUTRAL:', (err as Error).message);
    return 'NEUTRAL';
  }
}

// ── Forex Regime (DXY) ─────────────────────────────────────────────────────────

/**
 * Derives USD strength via the DXY proxy (Yahoo Finance ticker DX-Y.NYB).
 * Falls back to the UUP ETF as a secondary proxy.
 *
 * Rules:
 *   - DXY 4H AND 1D trending up (BULL/STRONG_BULL)   → STRONG_USD
 *   - DXY 4H AND 1D trending down (BEAR/STRONG_BEAR)  → WEAK_USD
 *   - Otherwise                                        → NEUTRAL
 */
async function resolveForexRegime(): Promise<ForexRegime> {
  // DXY proxies — try DX-Y.NYB first, then UUP ETF, then UUP as fallback symbol
  const dxyProxies = ['DX-Y.NYB', 'UUP'];

  for (const ticker of dxyProxies) {
    try {
      // Yahoo Finance service normalizes the ticker via its internal map if needed;
      // for DXY we call it directly via the raw ticker since it's not in the pair map.
      const [candles4h, candles1d] = await Promise.all([
        yahooFinanceService.getKlines(ticker, '4h', 200),
        yahooFinanceService.getKlines(ticker, '1d', 200),
      ]);

      if (candles4h.length < 50 || candles1d.length < 50) continue; // Try next proxy

      // Reuse candles but label the symbol for IndicatorService key isolation
      const normalize = (c: NormalizedCandle, tf: string) => ({ ...c, symbol: 'DXY', timeframe: tf });
      const norm4h = candles4h.map(c => normalize(c, '4h'));
      const norm1d = candles1d.map(c => normalize(c, '1d'));

      const trend4h = deriveTrend(norm4h);
      const trend1d = deriveTrend(norm1d);

      console.log(`[Regime] DXY (${ticker}) 4H=${trend4h} | 1D=${trend1d}`);

      const bullish4h = trend4h === 'BULL' || trend4h === 'STRONG_BULL';
      const bearish4h = trend4h === 'BEAR' || trend4h === 'STRONG_BEAR';
      const bullish1d = trend1d === 'BULL' || trend1d === 'STRONG_BULL';
      const bearish1d = trend1d === 'BEAR' || trend1d === 'STRONG_BEAR';

      if (bullish4h && bullish1d) return 'STRONG_USD';
      if (bearish4h && bearish1d) return 'WEAK_USD';
      return 'NEUTRAL';

    } catch (err) {
      console.warn(`[Regime] DXY proxy "${ticker}" failed:`, (err as Error).message);
      // Continue to next proxy
    }
  }

  // All proxies failed — fail open
  console.warn('[Regime] All DXY proxies failed — defaulting to NEUTRAL.');
  return 'NEUTRAL';
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns the current BTC regime, served from cache when available.
 *
 * The regime is used to gate altcoin long signals:
 *   - STRONG_BEAR or BEAR → block all LONG altcoin candidates
 *   - All other regimes   → allow (crypto-specific rules apply)
 */
export async function getCryptoRegime(): Promise<CryptoRegime> {
  if (cryptoCache && Date.now() < cryptoCache.expiresAt) {
    return cryptoCache.value;
  }
  const value = await resolveCryptoRegime();
  cryptoCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/**
 * Returns the current DXY (USD) regime, served from cache when available.
 *
 * Used to contextualise Forex signals:
 *   - STRONG_USD → favour USD-long pairs (e.g. USDJPY LONG, EURUSD SHORT)
 *   - WEAK_USD   → favour USD-short pairs (e.g. EURUSD LONG, USDJPY SHORT)
 *   - NEUTRAL    → no macro filter applied
 */
export async function getForexRegime(): Promise<ForexRegime> {
  if (forexCache && Date.now() < forexCache.expiresAt) {
    return forexCache.value;
  }
  const value = await resolveForexRegime();
  forexCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/**
 * Returns both regimes in a single call.
 */
export async function getMacroRegime(): Promise<MacroRegime> {
  const [crypto, forex] = await Promise.all([getCryptoRegime(), getForexRegime()]);
  return { crypto, forex };
}

/**
 * Force-invalidates both caches (useful for testing or manual overrides).
 */
export function invalidateRegimeCache(): void {
  cryptoCache = null;
  forexCache  = null;
}
