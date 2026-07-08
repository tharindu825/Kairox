import { getDb } from '@/lib/mongodb';
import { IndicatorService } from '@/services/indicators';
import { SmartMoneyService } from '@/services/indicators/smc-service';
import type { NormalizedCandle } from '@/services/market-data/binance';
import { binanceREST } from '@/services/market-data/binance-rest';

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

const DEFAULT_SYMBOLS = [
  // Top 30 Binance USDT pairs by trading volume
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'TRXUSDT', 'DOTUSDT',
  'LINKUSDT', 'MATICUSDT', 'SHIBUSDT', 'LTCUSDT', 'BCHUSDT',
  'UNIUSDT', 'APTUSDT', 'NEARUSDT', 'ICPUSDT', 'SUIUSDT',
  'PEPEUSDT', 'WIFUSDT', 'FETUSDT', 'RENDERUSDT', 'INJUSDT',
  'ARBUSDT', 'OPUSDT', 'FILUSDT', 'AAVEUSDT', 'ATOMUSDT',
];

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map((symbol) => String(symbol).toUpperCase()).filter(Boolean)));
}

async function resolveCandidateSymbols(explicitSymbols?: string[]): Promise<string[]> {
  if (explicitSymbols && explicitSymbols.length > 0) {
    return normalizeSymbols(explicitSymbols);
  }

  const db = await getDb();
  const assets = await db.collection('assets').find({ category: 'CRYPTO' }).toArray();
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

/**
 * Enhanced scoring function — normalizes momentum by ATR, increases volume weight,
 * and adds SMC-aware bonuses.
 */
function scoreCandidate(
  candle: NormalizedCandle,
  trendStrength: number,
  macdStrength: number,
  atr: number,
  adx: number,
  smcBonus: number,
): number {
  // ATR-normalized momentum (how many ATRs did this candle move?)
  const candleBody = Math.abs(candle.close - candle.open);
  const atrNormalizedMomentum = atr > 0 ? candleBody / atr : 0;

  // Volume: normalize to a 0-1 range using log scale, capped so majors don't dominate
  const logVolume = Math.min(Math.log10(Math.max(candle.volume, 1)) / 10, 1);

  // Normalize MACD relative to price so BTC ($60k MACD) doesn't dominate altcoins ($0.01 MACD)
  const normalizedMacd = candle.close > 0 ? macdStrength / candle.close : 0;

  // ADX bonus: reward strong trends (ADX > 25)
  const adxBonus = adx >= 25 ? 0.3 : adx >= 20 ? 0.1 : 0;

  // Score breakdown:
  //   ATR-normalized momentum (45%) — replaces raw percentage momentum
  //   MACD alignment (20%)
  //   Volume bonus (20%) — increased from 10%
  //   ADX strength (10%)
  //   SMC bonus (5%)
  const baseScore =
    (atrNormalizedMomentum * trendStrength) * 0.45 +
    (normalizedMacd * 1000) * 0.20 +
    logVolume * 0.20 +
    adxBonus * 0.10 +
    smcBonus * 0.05;

  return baseScore;
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
    adx: number;
    volatilityRegime: string;
    volumeProfile: string;
    smc?: { lastBOS?: unknown; nearestOB?: unknown } | null;
  },
  close: number
): boolean {
  // Only hard-gate on data quality and extreme risk — let the AI + risk engine handle directional filtering
  if (!Number.isFinite(features.atr) || features.atr <= 0) return false;

  // Skip EXTREME volatility — too risky for automated signals
  if (features.volatilityRegime === 'EXTREME') return false;

  // Minimum trend strength — very flat markets rarely produce good signals
  if (features.adx < 10) return false;

  // All other filters (MACD alignment, RSI range, EMA alignment, trend direction,
  // volume profile) have been removed from the pre-selector. The AI model receives
  // full indicator data and makes its own directional decision, and the risk engine
  // validates R:R and EV before approving.
  return true;
}

/**
 * Calculate SMC-aware scoring bonus for a candidate.
 * Returns a 0-1 score representing SMC confluence.
 */
function calculateSMCBonus(
  candles: NormalizedCandle[],
  inferredSide: 'LONG' | 'SHORT',
): number {
  const smcService = new SmartMoneyService();
  const analysis = smcService.analyze(candles);
  if (!analysis) return 0;

  let bonus = 0;

  // +0.20 if near an aligned order block
  if (analysis.nearestOB) {
    const isAligned =
      (inferredSide === 'LONG' && analysis.nearestOB.type === 'BULLISH') ||
      (inferredSide === 'SHORT' && analysis.nearestOB.type === 'BEARISH');
    if (isAligned && analysis.nearestOB.distancePercent <= 2.0) {
      bonus += 0.20;
    }
  }

  // +0.15 if recent BOS confirms direction
  if (analysis.lastBOS) {
    const isAligned =
      (inferredSide === 'LONG' && analysis.lastBOS.side === 'BULL') ||
      (inferredSide === 'SHORT' && analysis.lastBOS.side === 'BEAR');
    if (isAligned && analysis.lastBOS.candlesAgo <= 20) {
      bonus += 0.15;
    }
  }

  // -0.30 if recent CHoCH opposes direction
  if (analysis.lastCHoCH) {
    const isOpposing =
      (inferredSide === 'LONG' && analysis.lastCHoCH.side === 'BEAR') ||
      (inferredSide === 'SHORT' && analysis.lastCHoCH.side === 'BULL');
    if (isOpposing && analysis.lastCHoCH.candlesAgo <= 15) {
      bonus -= 0.30;
    }
  }

  // +0.10 if in correct zone (discount for LONG, premium for SHORT)
  if (
    (inferredSide === 'LONG' && analysis.premiumDiscount === 'DISCOUNT') ||
    (inferredSide === 'SHORT' && analysis.premiumDiscount === 'PREMIUM')
  ) {
    bonus += 0.10;
  }

  // +0.10 if near an unfilled FVG aligned with direction
  if (analysis.nearestFVG) {
    const isAligned =
      (inferredSide === 'LONG' && analysis.nearestFVG.type === 'BULLISH') ||
      (inferredSide === 'SHORT' && analysis.nearestFVG.type === 'BEARISH');
    if (isAligned && analysis.nearestFVG.distancePercent <= 1.5) {
      bonus += 0.10;
    }
  }

  return Math.max(0, Math.min(1, bonus)); // Clamp to 0-1
}

async function evaluateSymbol(
  symbol: string,
  timeframe: string,
  sideFilter: SideFilter
): Promise<SignalSelectionResult | null> {
  const mtfTimeframes = ['1w', '1d', '4h', '1h', '15m'];
  
  // Fetch all timeframes concurrently
  const mtfCandles = await Promise.all(
    mtfTimeframes.map(tf => fetchRecentCandles(symbol, tf, 220))
  );

  const execCandles = mtfCandles[mtfTimeframes.indexOf(timeframe)];
  if (!execCandles || execCandles.length < 60) return null;

  const latestCandle = execCandles[execCandles.length - 1];
  // Dead coin check: If the latest candle open time is older than 7 days, it's likely delisted or halted
  if (Date.now() - latestCandle.timestamp > 7 * 24 * 60 * 60 * 1000) {
    return null;
  }

  // Process all timeframes to get trends
  const mtfTrends: Record<string, string> = {};
  for (let i = 0; i < mtfTimeframes.length; i++) {
    const tf = mtfTimeframes[i];
    const candles = mtfCandles[i];
    if (candles && candles.length >= 60) {
      const indicator = new IndicatorService();
      for (const candle of candles) indicator.update(candle);
      const features = indicator.getEnhancedFeatureBundle(candles);
      mtfTrends[tf] = features.trend;
    }
  }

  const indicator = new IndicatorService();
  for (const candle of execCandles) {
    indicator.update(candle);
  }

  const latest = execCandles[execCandles.length - 1];
  const features = indicator.getEnhancedFeatureBundle(execCandles);

  // Fetch Crypto Futures Context
  const [fundingRate, openInterest] = await Promise.all([
    binanceREST.getFundingRate(symbol),
    binanceREST.getOpenInterest(symbol),
  ]);

  if (!features.marketContext) features.marketContext = {};
  if (fundingRate !== null) features.marketContext.fundingRate = fundingRate;
  if (openInterest !== null) features.marketContext.openInterest = openInterest;

  // Infer side — in NEUTRAL trend, use RSI + MACD + SMC to pick direction
  let inferredSide: 'LONG' | 'SHORT';
  if (features.trend.includes('BULL')) {
    inferredSide = 'LONG';
  } else if (features.trend.includes('BEAR')) {
    inferredSide = 'SHORT';
  } else {
    // NEUTRAL: use momentum signals to infer direction
    const bullVotes = [
      features.rsi < 50,
      features.macd.histogram > 0,
      features.smc?.lastBOS && (features.smc.lastBOS as any).side === 'BULL',
    ].filter(Boolean).length;
    inferredSide = bullVotes >= 2 ? 'LONG' : 'SHORT';
  }

  if (sideFilter !== 'ALL' && sideFilter !== inferredSide) return null;
  if (!passesIndicatorFilters(inferredSide, features, latest.close)) return null;

  // ── True MTF Alignment Check ──
  // Calculate how many timeframes align with the inferred side
  let mtfScore = 0;
  let structuralConflict = false;

  for (const tf of mtfTimeframes) {
    const trend = mtfTrends[tf];
    if (!trend) continue;

    if (inferredSide === 'LONG' && trend.includes('BULL')) mtfScore++;
    if (inferredSide === 'SHORT' && trend.includes('BEAR')) mtfScore++;

    // Check for structural conflict (e.g. 15m LONG vs 1w/1d STRONG_BEAR)
    if (tf === '1w' || tf === '1d') {
      if (inferredSide === 'LONG' && trend === 'STRONG_BEAR') structuralConflict = true;
      if (inferredSide === 'SHORT' && trend === 'STRONG_BULL') structuralConflict = true;
    }
  }

  // Structural conflict is now a score penalty (-0.3) instead of a hard reject.
  // This allows mean-reversion setups at key SMC levels while still deprioritising them.

  const trendStrength = features.trend.startsWith('STRONG') ? 2 : 1;

  // Calculate SMC bonus for this candidate
  const smcBonus = calculateSMCBonus(execCandles, inferredSide);

  // Add MTF alignment bonus to the score (e.g., up to 20% boost for 5/5 alignment)
  const mtfAlignmentRatio = mtfScore / mtfTimeframes.length;
  const mtfBonus = mtfAlignmentRatio * 0.2;

  // Structural conflict penalty (instead of hard reject)
  const conflictPenalty = structuralConflict ? -0.3 : 0;

  const score = scoreCandidate(
    latest,
    trendStrength,
    Math.abs(features.macd.histogram || 0),
    features.atr,
    features.adx,
    smcBonus,
  ) + mtfBonus + conflictPenalty;

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
  const dbSymbols = await resolveCandidateSymbols(options.candidateSymbols);

  // Always include the top 30 major coins so BTC/ETH/SOL etc. are scanned every cycle
  const mergedSymbols = Array.from(new Set([...DEFAULT_SYMBOLS, ...dbSymbols]));
  const filteredSymbols = assetQuery ? mergedSymbols.filter((symbol) => symbol.includes(assetQuery)) : mergedSymbols;

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

  // Hard 4-hour cooldown: exclude symbols that already have a signal created in the last 4 hours
  const db = await getDb();
  const SIGNAL_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
  const cooldownCutoff = new Date(Date.now() - SIGNAL_COOLDOWN_MS);
  const recentSignals = await db.collection('signals')
    .find({ createdAt: { $gte: cooldownCutoff } })
    .project({ symbol: 1 })
    .toArray();
  const recentSymbols = new Set(recentSignals.map((s) => s.symbol));

  // 4-hour block for symbols that hit stop-loss (reduced from 24h to allow same-day re-entry)
  const LOSS_BLOCK_MS = 4 * 60 * 60 * 1000; // 4 hours
  const lossBlockCutoff = new Date(Date.now() - LOSS_BLOCK_MS);
  const recentLosses = await db.collection('paperOrders')
    .find({
      closedAt: { $gte: lossBlockCutoff },
      status: 'STOPPED',
      pnl: { $lt: 0 }
    })
    .project({ symbol: 1 })
    .toArray();
  const lossSymbols = new Set(recentLosses.map((o) => o.symbol));

  // Filter out symbols in cooldown entirely or that have lost within 4h
  const eligible = candidates.filter((c) => !recentSymbols.has(c.symbol) && !lossSymbols.has(c.symbol));

  if (eligible.length === 0) return [];

  // Return the top N candidates sorted by score
  return eligible.sort((a, b) => b.score - a.score).slice(0, limit);
}
