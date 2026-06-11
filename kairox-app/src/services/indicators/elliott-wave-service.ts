/**
 * Elliott Wave Theory Detection Engine
 *
 * Detects impulse (1-2-3-4-5) and corrective (A-B-C) wave patterns from
 * swing points with strict axiom validation and Fibonacci ratio scoring.
 *
 * Elliott Wave Axioms (hard rules — violation = rejected count):
 *  1. Wave 2 never retraces more than 100% of Wave 1
 *  2. Wave 3 is never the shortest among waves 1, 3, and 5
 *  3. Wave 4 never enters the price territory of Wave 1
 *
 * Fibonacci ratio validation (soft scoring):
 *  - Wave 2: 50–78.6% retracement of Wave 1 (ideal 61.8%)
 *  - Wave 3: 161.8–261.8% extension of Wave 1 (ideal 161.8%)
 *  - Wave 4: 23.6–50% retracement of Wave 3 (ideal 38.2%)
 *  - Wave 5: 61.8–100% of Wave 1 from Wave 4 end
 *
 * Pure TypeScript, no external dependencies.
 * Uses swing points from SMC service (shared, not recomputed).
 */

import type { SwingPoint } from './smc-service';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface WaveSegment {
  number: number | string; // 1-5 for impulse, 'A'|'B'|'C' for corrective
  startPrice: number;
  endPrice: number;
  startIndex: number;
  endIndex: number;
  fibRatio: number | null; // Ratio relative to Wave 1 or Wave A
}

export interface ElliottWaveAnalysis {
  currentWave: {
    degree: 'PRIMARY' | 'INTERMEDIATE' | 'MINOR';
    type: 'IMPULSE' | 'CORRECTIVE';
    number: number | string; // Which wave we're currently in
    direction: 'UP' | 'DOWN';
    confidence: number; // 0-1, based on Fibonacci compliance
  } | null;

  waves: WaveSegment[];

  // Predictions
  projectedTarget: number | null;
  projectedReversal: number | null;
  invalidationLevel: number | null;

  // Summary for AI prompt
  summary: string;
}

// ─── Fibonacci Constants ────────────────────────────────────────────────────────

const FIB = {
  '0.236': 0.236,
  '0.382': 0.382,
  '0.500': 0.500,
  '0.618': 0.618,
  '0.786': 0.786,
  '1.000': 1.000,
  '1.272': 1.272,
  '1.618': 1.618,
  '2.000': 2.000,
  '2.618': 2.618,
};

// ─── Service ────────────────────────────────────────────────────────────────────

export class ElliottWaveService {
  /**
   * Analyze swing points for Elliott Wave patterns.
   * Requires at least 6 swing points (alternating H/L) for impulse detection.
   */
  analyze(
    swingPoints: SwingPoint[],
    currentPrice: number,
  ): ElliottWaveAnalysis | null {
    if (swingPoints.length < 4) return null;

    // Build alternating swing sequence (H-L-H-L or L-H-L-H)
    const alternating = this.buildAlternatingSequence(swingPoints);

    if (alternating.length < 4) return null;

    // Try impulse wave detection first (needs 6 points = 5 waves)
    const impulse = this.detectImpulseWave(alternating, currentPrice);
    if (impulse && impulse.currentWave && impulse.currentWave.confidence >= 0.30) {
      return impulse;
    }

    // Fall back to corrective wave detection (needs 4 points = 3 waves)
    const corrective = this.detectCorrectiveWave(alternating, currentPrice);
    if (corrective && corrective.currentWave && corrective.currentWave.confidence >= 0.30) {
      return corrective;
    }

    // No reliable pattern found
    return {
      currentWave: null,
      waves: [],
      projectedTarget: null,
      projectedReversal: null,
      invalidationLevel: null,
      summary: 'No reliable Elliott Wave pattern detected',
    };
  }

  // ── Build Alternating Sequence ──────────────────────────────────────────────

  /**
   * From raw swing points, build a clean alternating H-L-H-L or L-H-L-H sequence.
   * When consecutive swings of the same type appear, keep only the most extreme.
   */
  private buildAlternatingSequence(swings: SwingPoint[]): SwingPoint[] {
    if (swings.length === 0) return [];

    const result: SwingPoint[] = [swings[0]];

    for (let i = 1; i < swings.length; i++) {
      const last = result[result.length - 1];
      const curr = swings[i];

      if (curr.type === last.type) {
        // Same type — keep the more extreme one
        if (curr.type === 'HIGH' && curr.price > last.price) {
          result[result.length - 1] = curr;
        } else if (curr.type === 'LOW' && curr.price < last.price) {
          result[result.length - 1] = curr;
        }
        // Otherwise skip (keep existing)
      } else {
        result.push(curr);
      }
    }

    return result;
  }

  // ── Impulse Wave Detection (1-2-3-4-5) ──────────────────────────────────────

  private detectImpulseWave(
    swings: SwingPoint[],
    currentPrice: number,
  ): ElliottWaveAnalysis | null {
    // Try to find the best 6-point sequence from recent swings
    // We need at least 6 alternating points to form waves 1-5

    // Try both bullish impulse (starts from LOW) and bearish (starts from HIGH)
    const bullish = this.tryImpulseFromEnd(swings, 'UP', currentPrice);
    const bearish = this.tryImpulseFromEnd(swings, 'DOWN', currentPrice);

    // Return the one with higher confidence
    if (bullish && bearish) {
      return (bullish.currentWave?.confidence ?? 0) >= (bearish.currentWave?.confidence ?? 0)
        ? bullish : bearish;
    }
    return bullish || bearish;
  }

  private tryImpulseFromEnd(
    swings: SwingPoint[],
    direction: 'UP' | 'DOWN',
    currentPrice: number,
  ): ElliottWaveAnalysis | null {
    // For UP impulse: need L-H-L-H-L-H (6 points, starting with LOW)
    // For DOWN impulse: need H-L-H-L-H-L (6 points, starting with HIGH)
    const startType = direction === 'UP' ? 'LOW' : 'HIGH';

    // Scan from end for sequences of 6 alternating points starting with the right type
    for (let end = swings.length - 1; end >= 5; end--) {
      // Find the start point
      let start = end;
      let count = 1;
      let expectedType = swings[end].type;

      for (let i = end - 1; i >= 0 && count < 6; i--) {
        const needed = expectedType === 'HIGH' ? 'LOW' : 'HIGH';
        if (swings[i].type === needed) {
          start = i;
          count++;
          expectedType = needed;
        }
      }

      if (count < 6) continue;

      // Extract the 6-point sequence
      const seq: SwingPoint[] = [];
      let nextType = startType;
      for (let i = start; i <= end && seq.length < 6; i++) {
        if (swings[i].type === nextType) {
          seq.push(swings[i]);
          nextType = nextType === 'HIGH' ? 'LOW' : 'HIGH';
        }
      }

      if (seq.length < 6) continue;
      if (seq[0].type !== startType) continue;

      // Validate wave structure
      const result = this.validateImpulse(seq, direction, currentPrice);
      if (result) return result;
    }

    return null;
  }

  private validateImpulse(
    points: SwingPoint[], // 6 points: wave 0(start), 1, 2, 3, 4, 5(end)
    direction: 'UP' | 'DOWN',
    currentPrice: number,
  ): ElliottWaveAnalysis | null {
    // Wave lengths
    const w1 = Math.abs(points[1].price - points[0].price);
    const w2 = Math.abs(points[2].price - points[1].price);
    const w3 = Math.abs(points[3].price - points[2].price);
    const w4 = Math.abs(points[4].price - points[3].price);
    const w5 = Math.abs(points[5].price - points[4].price);

    if (w1 === 0) return null; // Degenerate

    // ─── Axiom Validation ───────────────────────────────────────────────

    // Axiom 1: Wave 2 must retrace less than 100% of Wave 1
    const w2Retrace = w2 / w1;
    if (w2Retrace >= 1.0) return null;

    // Axiom 2: Wave 3 must NOT be the shortest
    if (w3 < w1 && w3 < w5) return null;

    // Axiom 3: Wave 4 must not enter Wave 1 territory
    if (direction === 'UP') {
      if (points[4].price <= points[1].price) return null; // W4 low below W1 high — invalid
    } else {
      if (points[4].price >= points[1].price) return null; // W4 high above W1 low — invalid
    }

    // ─── Direction Validation ───────────────────────────────────────────
    if (direction === 'UP') {
      // Impulse up: waves 1,3,5 should go up (higher highs)
      if (points[1].price <= points[0].price) return null;
      if (points[3].price <= points[1].price) return null;
    } else {
      // Impulse down: waves 1,3,5 should go down (lower lows)
      if (points[1].price >= points[0].price) return null;
      if (points[3].price >= points[1].price) return null;
    }

    // ─── Fibonacci Scoring ──────────────────────────────────────────────
    let fibScore = 0;
    let fibChecks = 0;

    // Wave 2: ideal 50-78.6% retracement of Wave 1
    fibChecks++;
    if (w2Retrace >= 0.50 && w2Retrace <= 0.786) {
      fibScore += this.fibProximityScore(w2Retrace, 0.618);
    } else if (w2Retrace >= 0.382 && w2Retrace < 0.50) {
      fibScore += 0.3; // Acceptable but not ideal
    }

    // Wave 3: ideal 161.8% extension of Wave 1
    const w3Extension = w3 / w1;
    fibChecks++;
    if (w3Extension >= 1.618 && w3Extension <= 2.618) {
      fibScore += this.fibProximityScore(w3Extension, 1.618);
    } else if (w3Extension >= 1.0 && w3Extension < 1.618) {
      fibScore += 0.3; // Acceptable
    }

    // Wave 4: ideal 23.6-50% retracement of Wave 3
    const w4Retrace = w4 / w3;
    fibChecks++;
    if (w4Retrace >= 0.236 && w4Retrace <= 0.50) {
      fibScore += this.fibProximityScore(w4Retrace, 0.382);
    } else if (w4Retrace > 0.50 && w4Retrace <= 0.618) {
      fibScore += 0.2; // Deep correction but possible
    }

    // Wave 5: ideal 61.8-100% of Wave 1
    const w5toW1 = w5 / w1;
    fibChecks++;
    if (w5toW1 >= 0.618 && w5toW1 <= 1.618) {
      fibScore += this.fibProximityScore(w5toW1, 1.0);
    } else if (w5toW1 > 0 && w5toW1 < 0.618) {
      fibScore += 0.2; // Truncated wave 5
    }

    const confidence = fibChecks > 0 ? fibScore / fibChecks : 0;

    // ─── Determine Current Wave ─────────────────────────────────────────
    // Check where the current price sits relative to the wave structure
    const currentWaveInfo = this.identifyCurrentPosition(points, currentPrice, direction, confidence);

    // ─── Projections ────────────────────────────────────────────────────
    const projectedTarget = this.projectTarget(points, direction, w1);
    const projectedReversal = this.projectReversal(points, direction);
    const invalidationLevel = direction === 'UP' ? points[0].price : points[0].price;

    // ─── Build Waves Array ──────────────────────────────────────────────
    const waves: WaveSegment[] = [
      { number: 1, startPrice: points[0].price, endPrice: points[1].price, startIndex: points[0].index, endIndex: points[1].index, fibRatio: null },
      { number: 2, startPrice: points[1].price, endPrice: points[2].price, startIndex: points[1].index, endIndex: points[2].index, fibRatio: w2Retrace },
      { number: 3, startPrice: points[2].price, endPrice: points[3].price, startIndex: points[2].index, endIndex: points[3].index, fibRatio: w3Extension },
      { number: 4, startPrice: points[3].price, endPrice: points[4].price, startIndex: points[3].index, endIndex: points[4].index, fibRatio: w4Retrace },
      { number: 5, startPrice: points[4].price, endPrice: points[5].price, startIndex: points[4].index, endIndex: points[5].index, fibRatio: w5toW1 },
    ];

    // ─── Degree Classification ──────────────────────────────────────────
    const totalCandles = points[5].index - points[0].index;
    const degree = totalCandles > 100 ? 'PRIMARY' : totalCandles > 40 ? 'INTERMEDIATE' : 'MINOR';

    const summary = this.buildImpulseSummary(currentWaveInfo, direction, confidence, degree, projectedTarget, invalidationLevel, waves);

    return {
      currentWave: currentWaveInfo ? {
        degree,
        type: 'IMPULSE',
        number: currentWaveInfo.number,
        direction,
        confidence,
      } : null,
      waves,
      projectedTarget,
      projectedReversal,
      invalidationLevel,
      summary,
    };
  }

  // ── Corrective Wave Detection (A-B-C) ───────────────────────────────────────

  private detectCorrectiveWave(
    swings: SwingPoint[],
    currentPrice: number,
  ): ElliottWaveAnalysis | null {
    // Corrective wave needs 4 alternating points (A start, A end/B start, B end/C start, C end)
    // Try from the end of the swing sequence

    for (let end = swings.length - 1; end >= 3; end--) {
      const seq = swings.slice(end - 3, end + 1);
      if (seq.length < 4) continue;

      // Determine direction: corrective after up-move = down correction (A-B-C down)
      const isDownCorrection = seq[0].type === 'HIGH';
      const direction: 'UP' | 'DOWN' = isDownCorrection ? 'DOWN' : 'UP';

      const result = this.validateCorrective(seq, direction, currentPrice);
      if (result) return result;
    }

    return null;
  }

  private validateCorrective(
    points: SwingPoint[], // 4 points: A start, A end, B end, C end
    direction: 'UP' | 'DOWN',
    currentPrice: number,
  ): ElliottWaveAnalysis | null {
    const wA = Math.abs(points[1].price - points[0].price);
    const wB = Math.abs(points[2].price - points[1].price);
    const wC = Math.abs(points[3].price - points[2].price);

    if (wA === 0) return null;

    // ─── Fibonacci Scoring ──────────────────────────────────────────────
    let fibScore = 0;
    let fibChecks = 0;

    // Wave B: ideal 38.2-78.6% retracement of Wave A
    const bRetrace = wB / wA;
    fibChecks++;
    if (bRetrace >= 0.382 && bRetrace <= 0.786) {
      fibScore += this.fibProximityScore(bRetrace, 0.618);
    } else if (bRetrace > 0.786 && bRetrace <= 1.0) {
      fibScore += 0.2; // Deep B wave
    }

    // Wave C: ideal 61.8-161.8% of Wave A
    const cExtension = wC / wA;
    fibChecks++;
    if (cExtension >= 0.618 && cExtension <= 1.618) {
      fibScore += this.fibProximityScore(cExtension, 1.0);
    } else if (cExtension > 1.618 && cExtension <= 2.618) {
      fibScore += 0.2; // Extended C
    }

    const confidence = fibChecks > 0 ? fibScore / fibChecks : 0;

    // ─── Wave Segments ──────────────────────────────────────────────────
    const waves: WaveSegment[] = [
      { number: 'A', startPrice: points[0].price, endPrice: points[1].price, startIndex: points[0].index, endIndex: points[1].index, fibRatio: null },
      { number: 'B', startPrice: points[1].price, endPrice: points[2].price, startIndex: points[1].index, endIndex: points[2].index, fibRatio: bRetrace },
      { number: 'C', startPrice: points[2].price, endPrice: points[3].price, startIndex: points[2].index, endIndex: points[3].index, fibRatio: cExtension },
    ];

    // Degree
    const totalCandles = points[3].index - points[0].index;
    const degree = totalCandles > 100 ? 'PRIMARY' : totalCandles > 40 ? 'INTERMEDIATE' : 'MINOR';

    // After C wave completes, next move is likely in the opposite direction of the correction
    const projectedTarget = direction === 'DOWN'
      ? points[0].price // Return to start of correction (bullish)
      : points[0].price; // Return to start of correction (bearish)

    const invalidationLevel = direction === 'DOWN'
      ? points[3].price // If price goes below C in a down correction, continuation
      : points[3].price;

    const summary = this.buildCorrectiveSummary(direction, confidence, degree, waves, currentPrice, projectedTarget);

    return {
      currentWave: {
        degree,
        type: 'CORRECTIVE',
        number: 'C',
        direction,
        confidence,
      },
      waves,
      projectedTarget,
      projectedReversal: projectedTarget,
      invalidationLevel,
      summary,
    };
  }

  // ── Helper Methods ──────────────────────────────────────────────────────────

  /**
   * Score how close a ratio is to the ideal Fibonacci level (0-1).
   */
  private fibProximityScore(actual: number, ideal: number): number {
    const distance = Math.abs(actual - ideal) / ideal;
    return Math.max(0, 1 - distance);
  }

  /**
   * Identify which wave the current price is in.
   */
  private identifyCurrentPosition(
    points: SwingPoint[],
    currentPrice: number,
    direction: 'UP' | 'DOWN',
    confidence: number,
  ): { number: number; phase: string } | null {
    const lastPoint = points[points.length - 1];

    // If current price is beyond the last swing point, we might be in a new wave
    if (direction === 'UP') {
      if (currentPrice > lastPoint.price && lastPoint.type === 'LOW') {
        return { number: 5, phase: 'extending' };
      }
      if (currentPrice < lastPoint.price && lastPoint.type === 'HIGH') {
        // Price is pulling back from wave 5 high — possible correction starting
        return { number: 5, phase: 'completed' };
      }
    } else {
      if (currentPrice < lastPoint.price && lastPoint.type === 'HIGH') {
        return { number: 5, phase: 'extending' };
      }
      if (currentPrice > lastPoint.price && lastPoint.type === 'LOW') {
        return { number: 5, phase: 'completed' };
      }
    }

    return { number: 5, phase: 'near_completion' };
  }

  /**
   * Project the target based on Fibonacci extensions.
   */
  private projectTarget(
    points: SwingPoint[],
    direction: 'UP' | 'DOWN',
    w1Length: number,
  ): number | null {
    if (points.length < 5) return null;

    // Wave 5 target: Wave 1 length projected from Wave 4 end
    const w4End = points[4].price;

    if (direction === 'UP') {
      return w4End + w1Length * 1.0; // 100% extension of W1 from W4
    } else {
      return w4End - w1Length * 1.0;
    }
  }

  /**
   * Project where a reversal might occur.
   */
  private projectReversal(
    points: SwingPoint[],
    direction: 'UP' | 'DOWN',
  ): number | null {
    if (points.length < 6) return null;

    // After a 5-wave impulse, expect an A-B-C correction
    // The correction typically retraces to the Wave 4 area
    return points[4].price;
  }

  // ── Summary Builders ────────────────────────────────────────────────────────

  private buildImpulseSummary(
    currentWave: { number: number; phase: string } | null,
    direction: 'UP' | 'DOWN',
    confidence: number,
    degree: string,
    projectedTarget: number | null,
    invalidationLevel: number | null,
    waves: WaveSegment[],
  ): string {
    const parts: string[] = [];

    parts.push(`Elliott Wave: ${degree} ${direction} impulse detected (confidence: ${(confidence * 100).toFixed(0)}%)`);

    if (currentWave) {
      parts.push(`Currently in Wave ${currentWave.number} (${currentWave.phase})`);
    }

    // Key ratios
    const w2Ratio = waves.find(w => w.number === 2)?.fibRatio;
    const w3Ratio = waves.find(w => w.number === 3)?.fibRatio;
    if (w2Ratio) parts.push(`W2 retrace: ${(w2Ratio * 100).toFixed(1)}%`);
    if (w3Ratio) parts.push(`W3 extension: ${(w3Ratio * 100).toFixed(1)}%`);

    if (projectedTarget) {
      parts.push(`Projected target: $${projectedTarget.toPrecision(6)}`);
    }
    if (invalidationLevel) {
      parts.push(`Invalidation: $${invalidationLevel.toPrecision(6)}`);
    }

    return parts.join(' | ');
  }

  private buildCorrectiveSummary(
    direction: 'UP' | 'DOWN',
    confidence: number,
    degree: string,
    waves: WaveSegment[],
    currentPrice: number,
    projectedTarget: number | null,
  ): string {
    const parts: string[] = [];

    const corrDir = direction === 'DOWN' ? 'bearish' : 'bullish';
    parts.push(`Elliott Wave: ${degree} A-B-C ${corrDir} correction detected (confidence: ${(confidence * 100).toFixed(0)}%)`);

    const bRatio = waves.find(w => w.number === 'B')?.fibRatio;
    const cRatio = waves.find(w => w.number === 'C')?.fibRatio;
    if (bRatio) parts.push(`B retrace: ${(bRatio * 100).toFixed(1)}%`);
    if (cRatio) parts.push(`C extension: ${(cRatio * 100).toFixed(1)}% of A`);

    // After correction completes, expect reversal
    const nextDir = direction === 'DOWN' ? 'bullish' : 'bearish';
    parts.push(`Post-correction expectation: ${nextDir} reversal`);

    if (projectedTarget) {
      parts.push(`Recovery target: $${projectedTarget.toPrecision(6)}`);
    }

    return parts.join(' | ');
  }
}

export const elliottWaveService = new ElliottWaveService();
