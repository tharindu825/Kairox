/**
 * Smart Money Concepts (SMC) Detection Engine
 *
 * Detects institutional footprint patterns from OHLCV candle data:
 * - Swing Highs / Swing Lows (pivot detection)
 * - Break of Structure (BOS) — trend continuation
 * - Change of Character (CHoCH) — trend reversal
 * - Order Blocks (OB) — institutional entry zones
 * - Fair Value Gaps (FVG) — price imbalances
 * - Liquidity Zones — equal highs/lows clusters (stop-hunt targets)
 * - Premium / Discount Zones — relative to last major swing
 *
 * Pure TypeScript, no external dependencies.
 */

import type { NormalizedCandle } from '../market-data/binance';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SwingPoint {
  type: 'HIGH' | 'LOW';
  price: number;
  index: number;
  candlesAgo: number; // relative to the latest candle
}

export interface StructureBreak {
  type: 'BOS' | 'CHoCH';
  side: 'BULL' | 'BEAR';
  price: number;
  index: number;
  candlesAgo: number;
}

export interface OrderBlock {
  type: 'BULLISH' | 'BEARISH';
  high: number;
  low: number;
  index: number;
  candlesAgo: number;
  strength: number; // impulse magnitude / ATR
  mitigated: boolean; // has price returned to this zone?
}

export interface FairValueGap {
  type: 'BULLISH' | 'BEARISH';
  upper: number;
  lower: number;
  index: number;
  candlesAgo: number;
  filled: boolean; // has price filled this gap?
}

export interface LiquidityZone {
  type: 'BUYSIDE' | 'SELLSIDE';
  price: number;
  touchCount: number;
}

export interface SMCAnalysis {
  // Market Structure
  structureTrend: 'BULLISH' | 'BEARISH' | 'RANGING';
  swingPoints: SwingPoint[];
  lastBOS: StructureBreak | null;
  lastCHoCH: StructureBreak | null;

  // Key Zones
  orderBlocks: OrderBlock[];
  fairValueGaps: FairValueGap[];
  liquidityZones: LiquidityZone[];

  // Context
  premiumDiscount: 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM';
  nearestOB: { type: 'BULLISH' | 'BEARISH'; distancePercent: number; high: number; low: number } | null;
  nearestFVG: { type: 'BULLISH' | 'BEARISH'; distancePercent: number; upper: number; lower: number } | null;

  // Summary for AI prompt
  summary: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Number of candles on each side required to confirm a swing point */
const SWING_LOOKBACK = 3;

/** Minimum impulse size relative to ATR to qualify as an order block origin */
const OB_IMPULSE_THRESHOLD = 1.5;

/** Tolerance for grouping equal highs/lows into liquidity zones (0.1% = 0.001) */
const LIQUIDITY_TOLERANCE = 0.001;

/** Minimum touches to form a liquidity zone */
const MIN_LIQUIDITY_TOUCHES = 2;

/** Maximum number of order blocks / FVGs to keep (most recent) */
const MAX_ZONES = 5;

// ─── Service ────────────────────────────────────────────────────────────────────

export class SmartMoneyService {
  /**
   * Analyze an array of candles for Smart Money Concepts.
   * Requires at least 30 candles for meaningful analysis.
   */
  analyze(candles: NormalizedCandle[]): SMCAnalysis | null {
    if (candles.length < 30) return null;

    const total = candles.length;
    const atr = this.calculateATR(candles, 14);

    // 1. Detect swing points
    const swingPoints = this.detectSwingPoints(candles);
    if (swingPoints.length < 4) {
      return this.emptyAnalysis(swingPoints);
    }

    // 2. Determine structure trend from swing points
    const structureTrend = this.classifyStructure(swingPoints);

    // 3. Detect BOS and CHoCH
    const structureBreaks = this.detectStructureBreaks(swingPoints, structureTrend);
    const lastBOS = structureBreaks.filter(b => b.type === 'BOS').at(-1) ?? null;
    const lastCHoCH = structureBreaks.filter(b => b.type === 'CHoCH').at(-1) ?? null;

    // 4. Detect Order Blocks
    const orderBlocks = this.detectOrderBlocks(candles, atr);

    // 5. Detect Fair Value Gaps
    const fairValueGaps = this.detectFairValueGaps(candles);

    // 6. Detect Liquidity Zones
    const liquidityZones = this.detectLiquidityZones(swingPoints);

    // 7. Premium / Discount
    const premiumDiscount = this.classifyPremiumDiscount(candles, swingPoints, atr);

    // 8. Nearest zones
    const currentPrice = candles[total - 1].close;
    const nearestOB = this.findNearestOB(orderBlocks, currentPrice);
    const nearestFVG = this.findNearestFVG(fairValueGaps, currentPrice);

    // 9. Build summary
    const summary = this.buildSummary(
      structureTrend, lastBOS, lastCHoCH, nearestOB, nearestFVG,
      liquidityZones, premiumDiscount, currentPrice,
    );

    return {
      structureTrend,
      swingPoints,
      lastBOS,
      lastCHoCH,
      orderBlocks,
      fairValueGaps,
      liquidityZones,
      premiumDiscount,
      nearestOB,
      nearestFVG,
      summary,
    };
  }

  // ── Swing Point Detection ───────────────────────────────────────────────────

  detectSwingPoints(candles: NormalizedCandle[]): SwingPoint[] {
    const points: SwingPoint[] = [];
    const total = candles.length;

    for (let i = SWING_LOOKBACK; i < total - SWING_LOOKBACK; i++) {
      const c = candles[i];

      // Check swing high
      let isSwingHigh = true;
      for (let j = 1; j <= SWING_LOOKBACK; j++) {
        if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) {
          isSwingHigh = false;
          break;
        }
      }
      if (isSwingHigh) {
        points.push({
          type: 'HIGH',
          price: c.high,
          index: i,
          candlesAgo: total - 1 - i,
        });
      }

      // Check swing low
      let isSwingLow = true;
      for (let j = 1; j <= SWING_LOOKBACK; j++) {
        if (candles[i - j].low <= c.low || candles[i + j].low <= c.low) {
          isSwingLow = false;
          break;
        }
      }
      if (isSwingLow) {
        points.push({
          type: 'LOW',
          price: c.low,
          index: i,
          candlesAgo: total - 1 - i,
        });
      }
    }

    // Sort by index (chronological)
    return points.sort((a, b) => a.index - b.index);
  }

  // ── Structure Classification ────────────────────────────────────────────────

  private classifyStructure(swings: SwingPoint[]): 'BULLISH' | 'BEARISH' | 'RANGING' {
    // Use the last 6 swing points to determine structure
    const recent = swings.slice(-6);
    const highs = recent.filter(s => s.type === 'HIGH');
    const lows = recent.filter(s => s.type === 'LOW');

    if (highs.length < 2 || lows.length < 2) return 'RANGING';

    // Check for higher highs and higher lows (bullish)
    const lastTwoHighs = highs.slice(-2);
    const lastTwoLows = lows.slice(-2);

    const higherHighs = lastTwoHighs[1].price > lastTwoHighs[0].price;
    const higherLows = lastTwoLows[1].price > lastTwoLows[0].price;
    const lowerHighs = lastTwoHighs[1].price < lastTwoHighs[0].price;
    const lowerLows = lastTwoLows[1].price < lastTwoLows[0].price;

    if (higherHighs && higherLows) return 'BULLISH';
    if (lowerHighs && lowerLows) return 'BEARISH';
    return 'RANGING';
  }

  // ── BOS / CHoCH Detection ──────────────────────────────────────────────────

  private detectStructureBreaks(
    swings: SwingPoint[],
    prevailingTrend: 'BULLISH' | 'BEARISH' | 'RANGING',
  ): StructureBreak[] {
    const breaks: StructureBreak[] = [];
    const highs = swings.filter(s => s.type === 'HIGH');
    const lows = swings.filter(s => s.type === 'LOW');

    // Check each swing high against the previous one
    for (let i = 1; i < highs.length; i++) {
      if (highs[i].price > highs[i - 1].price) {
        // Broke previous swing high — bullish
        const isBOS = prevailingTrend === 'BULLISH';
        breaks.push({
          type: isBOS ? 'BOS' : 'CHoCH',
          side: 'BULL',
          price: highs[i - 1].price,
          index: highs[i].index,
          candlesAgo: highs[i].candlesAgo,
        });
      }
    }

    // Check each swing low against the previous one
    for (let i = 1; i < lows.length; i++) {
      if (lows[i].price < lows[i - 1].price) {
        // Broke previous swing low — bearish
        const isBOS = prevailingTrend === 'BEARISH';
        breaks.push({
          type: isBOS ? 'BOS' : 'CHoCH',
          side: 'BEAR',
          price: lows[i - 1].price,
          index: lows[i].index,
          candlesAgo: lows[i].candlesAgo,
        });
      }
    }

    return breaks.sort((a, b) => a.index - b.index);
  }

  // ── Order Block Detection ──────────────────────────────────────────────────

  private detectOrderBlocks(candles: NormalizedCandle[], atr: number): OrderBlock[] {
    const blocks: OrderBlock[] = [];
    const total = candles.length;

    if (atr <= 0) return [];

    for (let i = 1; i < total - 1; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];

      // Measure impulse: the move from current candle close to the extreme of the next few candles
      const lookAhead = Math.min(i + 4, total);
      let maxMove = 0;
      for (let j = i + 1; j < lookAhead; j++) {
        const moveUp = candles[j].high - curr.close;
        const moveDown = curr.close - candles[j].low;
        maxMove = Math.max(maxMove, moveUp, moveDown);
      }

      const impulseStrength = maxMove / atr;
      if (impulseStrength < OB_IMPULSE_THRESHOLD) continue;

      const isBullishImpulse = candles[Math.min(i + 1, total - 1)].close > curr.close;
      const prevIsBearish = prev.close < prev.open; // red candle
      const prevIsBullish = prev.close > prev.open; // green candle

      // Bullish OB: last bearish candle before a bullish impulse
      if (isBullishImpulse && prevIsBearish) {
        const mitigated = this.isZoneMitigated(candles, i, prev.low, prev.high, 'BULLISH');
        blocks.push({
          type: 'BULLISH',
          high: prev.high,
          low: prev.low,
          index: i - 1,
          candlesAgo: total - i,
          strength: impulseStrength,
          mitigated,
        });
      }

      // Bearish OB: last bullish candle before a bearish impulse
      if (!isBullishImpulse && prevIsBullish) {
        const mitigated = this.isZoneMitigated(candles, i, prev.low, prev.high, 'BEARISH');
        blocks.push({
          type: 'BEARISH',
          high: prev.high,
          low: prev.low,
          index: i - 1,
          candlesAgo: total - i,
          strength: impulseStrength,
          mitigated,
        });
      }
    }

    // Return most recent, unmitigated first
    return blocks
      .filter(ob => !ob.mitigated)
      .sort((a, b) => b.index - a.index)
      .slice(0, MAX_ZONES);
  }

  private isZoneMitigated(
    candles: NormalizedCandle[],
    fromIndex: number,
    zoneLow: number,
    zoneHigh: number,
    obType: 'BULLISH' | 'BEARISH',
  ): boolean {
    for (let i = fromIndex + 2; i < candles.length; i++) {
      if (obType === 'BULLISH' && candles[i].low <= zoneLow) return true;
      if (obType === 'BEARISH' && candles[i].high >= zoneHigh) return true;
    }
    return false;
  }

  // ── Fair Value Gap Detection ────────────────────────────────────────────────

  private detectFairValueGaps(candles: NormalizedCandle[]): FairValueGap[] {
    const gaps: FairValueGap[] = [];
    const total = candles.length;

    for (let i = 2; i < total; i++) {
      const c0 = candles[i - 2]; // two candles ago
      const c2 = candles[i];     // current candle

      // Bullish FVG: gap up — candle[i].low > candle[i-2].high
      if (c2.low > c0.high) {
        const filled = this.isFVGFilled(candles, i, c0.high, c2.low, 'BULLISH');
        gaps.push({
          type: 'BULLISH',
          upper: c2.low,
          lower: c0.high,
          index: i - 1,
          candlesAgo: total - 1 - (i - 1),
          filled,
        });
      }

      // Bearish FVG: gap down — candle[i].high < candle[i-2].low
      if (c2.high < c0.low) {
        const filled = this.isFVGFilled(candles, i, c2.high, c0.low, 'BEARISH');
        gaps.push({
          type: 'BEARISH',
          upper: c0.low,
          lower: c2.high,
          index: i - 1,
          candlesAgo: total - 1 - (i - 1),
          filled,
        });
      }
    }

    // Return most recent unfilled gaps
    return gaps
      .filter(g => !g.filled)
      .sort((a, b) => b.index - a.index)
      .slice(0, MAX_ZONES);
  }

  private isFVGFilled(
    candles: NormalizedCandle[],
    fromIndex: number,
    gapLow: number,
    gapHigh: number,
    type: 'BULLISH' | 'BEARISH',
  ): boolean {
    for (let i = fromIndex + 1; i < candles.length; i++) {
      // Bullish FVG is filled when price comes back down into the gap
      if (type === 'BULLISH' && candles[i].low <= gapLow) return true;
      // Bearish FVG is filled when price comes back up into the gap
      if (type === 'BEARISH' && candles[i].high >= gapHigh) return true;
    }
    return false;
  }

  // ── Liquidity Zone Detection ────────────────────────────────────────────────

  private detectLiquidityZones(swings: SwingPoint[]): LiquidityZone[] {
    const zones: LiquidityZone[] = [];

    // Group swing highs that are within tolerance of each other
    const highs = swings.filter(s => s.type === 'HIGH');
    const lows = swings.filter(s => s.type === 'LOW');

    const highClusters = this.clusterLevels(highs.map(h => h.price));
    const lowClusters = this.clusterLevels(lows.map(l => l.price));

    for (const cluster of highClusters) {
      if (cluster.count >= MIN_LIQUIDITY_TOUCHES) {
        zones.push({
          type: 'BUYSIDE',
          price: cluster.avgPrice,
          touchCount: cluster.count,
        });
      }
    }

    for (const cluster of lowClusters) {
      if (cluster.count >= MIN_LIQUIDITY_TOUCHES) {
        zones.push({
          type: 'SELLSIDE',
          price: cluster.avgPrice,
          touchCount: cluster.count,
        });
      }
    }

    return zones;
  }

  private clusterLevels(prices: number[]): Array<{ avgPrice: number; count: number }> {
    if (prices.length === 0) return [];

    const sorted = [...prices].sort((a, b) => a - b);
    const clusters: Array<{ prices: number[] }> = [];
    let currentCluster: number[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const avg = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
      const tolerance = avg * LIQUIDITY_TOLERANCE;

      if (Math.abs(sorted[i] - avg) <= tolerance) {
        currentCluster.push(sorted[i]);
      } else {
        clusters.push({ prices: currentCluster });
        currentCluster = [sorted[i]];
      }
    }
    clusters.push({ prices: currentCluster });

    return clusters.map(c => ({
      avgPrice: c.prices.reduce((a, b) => a + b, 0) / c.prices.length,
      count: c.prices.length,
    }));
  }

  // ── Premium / Discount Classification ───────────────────────────────────────

  private classifyPremiumDiscount(
    candles: NormalizedCandle[],
    swings: SwingPoint[],
    atr: number,
  ): 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM' {
    const currentPrice = candles[candles.length - 1].close;

    // Find the last significant swing range (> 3x ATR)
    const highs = swings.filter(s => s.type === 'HIGH').map(s => s.price);
    const lows = swings.filter(s => s.type === 'LOW').map(s => s.price);

    if (highs.length === 0 || lows.length === 0) return 'EQUILIBRIUM';

    // Use the overall range of recent swings
    const swingHigh = Math.max(...highs.slice(-4));
    const swingLow = Math.min(...lows.slice(-4));
    const range = swingHigh - swingLow;

    if (range < atr * 2) return 'EQUILIBRIUM'; // Too narrow to classify

    const midpoint = swingLow + range * 0.5;
    const upperEqui = swingLow + range * 0.6; // 60%
    const lowerEqui = swingLow + range * 0.4; // 40%

    if (currentPrice > upperEqui) return 'PREMIUM';
    if (currentPrice < lowerEqui) return 'DISCOUNT';
    return 'EQUILIBRIUM';
  }

  // ── Nearest Zone Helpers ────────────────────────────────────────────────────

  private findNearestOB(
    blocks: OrderBlock[],
    currentPrice: number,
  ): SMCAnalysis['nearestOB'] {
    if (blocks.length === 0) return null;

    let nearest: OrderBlock | null = null;
    let minDist = Infinity;

    for (const ob of blocks) {
      const mid = (ob.high + ob.low) / 2;
      const dist = Math.abs(currentPrice - mid);
      if (dist < minDist) {
        minDist = dist;
        nearest = ob;
      }
    }

    if (!nearest) return null;

    return {
      type: nearest.type,
      distancePercent: (minDist / currentPrice) * 100,
      high: nearest.high,
      low: nearest.low,
    };
  }

  private findNearestFVG(
    gaps: FairValueGap[],
    currentPrice: number,
  ): SMCAnalysis['nearestFVG'] {
    if (gaps.length === 0) return null;

    let nearest: FairValueGap | null = null;
    let minDist = Infinity;

    for (const fvg of gaps) {
      const mid = (fvg.upper + fvg.lower) / 2;
      const dist = Math.abs(currentPrice - mid);
      if (dist < minDist) {
        minDist = dist;
        nearest = fvg;
      }
    }

    if (!nearest) return null;

    return {
      type: nearest.type,
      distancePercent: (minDist / currentPrice) * 100,
      upper: nearest.upper,
      lower: nearest.lower,
    };
  }

  // ── ATR Calculation ─────────────────────────────────────────────────────────

  private calculateATR(candles: NormalizedCandle[], period: number): number {
    if (candles.length < period + 1) return 0;

    const trs: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trs.push(tr);
    }

    // Simple moving average of last `period` TRs
    const recentTRs = trs.slice(-period);
    return recentTRs.reduce((a, b) => a + b, 0) / recentTRs.length;
  }

  // ── Summary Builder ─────────────────────────────────────────────────────────

  private buildSummary(
    structureTrend: string,
    lastBOS: StructureBreak | null,
    lastCHoCH: StructureBreak | null,
    nearestOB: SMCAnalysis['nearestOB'],
    nearestFVG: SMCAnalysis['nearestFVG'],
    liquidityZones: LiquidityZone[],
    premiumDiscount: string,
    currentPrice: number,
  ): string {
    const parts: string[] = [];

    parts.push(`Structure: ${structureTrend}`);

    if (lastBOS) {
      parts.push(`Last BOS: ${lastBOS.side} (${lastBOS.candlesAgo} candles ago @ $${lastBOS.price.toPrecision(6)})`);
    }

    if (lastCHoCH) {
      parts.push(`⚠️ CHoCH detected: ${lastCHoCH.side} (${lastCHoCH.candlesAgo} candles ago @ $${lastCHoCH.price.toPrecision(6)})`);
    }

    if (nearestOB) {
      parts.push(`Nearest OB: ${nearestOB.type} @ $${nearestOB.low.toPrecision(6)}-$${nearestOB.high.toPrecision(6)} (${nearestOB.distancePercent.toFixed(2)}% away)`);
    }

    if (nearestFVG) {
      parts.push(`Nearest unfilled FVG: ${nearestFVG.type} @ $${nearestFVG.lower.toPrecision(6)}-$${nearestFVG.upper.toPrecision(6)} (${nearestFVG.distancePercent.toFixed(2)}% away)`);
    }

    const buyside = liquidityZones.filter(z => z.type === 'BUYSIDE');
    const sellside = liquidityZones.filter(z => z.type === 'SELLSIDE');
    if (buyside.length > 0) {
      parts.push(`Buyside liquidity: ${buyside.map(z => `$${z.price.toPrecision(6)} (${z.touchCount}x)`).join(', ')}`);
    }
    if (sellside.length > 0) {
      parts.push(`Sellside liquidity: ${sellside.map(z => `$${z.price.toPrecision(6)} (${z.touchCount}x)`).join(', ')}`);
    }

    parts.push(`Zone: ${premiumDiscount}`);

    return parts.join(' | ');
  }

  // ── Empty Analysis ──────────────────────────────────────────────────────────

  private emptyAnalysis(swingPoints: SwingPoint[]): SMCAnalysis {
    return {
      structureTrend: 'RANGING',
      swingPoints,
      lastBOS: null,
      lastCHoCH: null,
      orderBlocks: [],
      fairValueGaps: [],
      liquidityZones: [],
      premiumDiscount: 'EQUILIBRIUM',
      nearestOB: null,
      nearestFVG: null,
      summary: 'Insufficient swing data for SMC analysis',
    };
  }
}

export const smartMoneyService = new SmartMoneyService();
