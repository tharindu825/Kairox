import { FeatureBundle } from '../indicators';
import { AISignalResponseSchema, type AISignalResponse } from '@/types';

interface OpenRouterResult {
  success: boolean;
  data?: AISignalResponse;
  error?: string;
  latencyMs?: number;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

const SIGNAL_JSON_SCHEMA = {
  name: 'trading_signal',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      side: { type: 'string' as const, enum: ['LONG', 'SHORT', 'HOLD'] },
      winProbability: { type: 'number' as const },
      entry: { type: 'number' as const },
      stopLoss: { type: 'number' as const },
      targets: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            price: { type: 'number' as const },
            label: { type: 'string' as const },
          },
          required: ['price', 'label'],
          additionalProperties: false,
        },
      },
      invalidation: { type: 'string' as const },
      reasoning: { type: 'string' as const },
      keyFactors: {
        type: 'array' as const,
        items: { type: 'string' as const },
      },
    },
    required: ['side', 'winProbability', 'entry', 'stopLoss', 'targets', 'invalidation', 'reasoning', 'keyFactors'],
    additionalProperties: false,
  },
};

export class OpenRouterService {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private fallbackModel: string;
  private role: 'PRIMARY' | 'CONFIRMATION';

  constructor(role: 'PRIMARY' | 'CONFIRMATION' = 'PRIMARY') {
    this.role = role;
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
    this.baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    
    if (role === 'PRIMARY') {
      this.model = process.env.PRIMARY_MODEL || 'google/gemini-2.0-flash-001';
      this.fallbackModel = process.env.PRIMARY_FALLBACK_MODEL || 'google/gemini-2.5-flash';
    } else {
      this.model = process.env.CONFIRMATION_MODEL || 'google/gemini-2.0-flash-001';
      this.fallbackModel = process.env.CONFIRMATION_FALLBACK_MODEL || 'meta-llama/llama-3.1-8b-instruct';
    }
  }

  async generateCompletion(
    symbol: string,
    timeframe: string,
    features: FeatureBundle
  ): Promise<OpenRouterResult> {
    if (!this.apiKey) {
      console.warn('[OpenRouter] No API key configured — returning mock signal');
      return this.getMockResult(symbol);
    }

    const systemPrompt = this.buildSystemPrompt(timeframe);
    const userPrompt = this.buildUserPrompt(symbol, timeframe, features);

    // Try primary model, then fallback
    for (const modelId of [this.model, this.fallbackModel]) {
      try {
        console.log(`[OpenRouter] Attempting AI analysis with model: ${modelId} (${this.role})`);
        const result = await this.callAPI(modelId, systemPrompt, userPrompt);
        return result;
      } catch (error) {
        console.warn(`[OpenRouter] Model ${modelId} failed:`, (error as Error).message);
      }
    }

    return { success: false, error: 'All OpenRouter models failed' };
  }

  private async callAPI(
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    retries = 3
  ): Promise<OpenRouterResult> {
    for (let attempt = 0; attempt < retries; attempt++) {
      const start = Date.now();

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
            'X-Title': 'Kairox Trading AI',
          },
          body: JSON.stringify({
            model: modelId,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: SIGNAL_JSON_SCHEMA,
            },
            temperature: 0.1, // Lowered from 0.3 for more consistent, deterministic analysis
            max_tokens: 2500, // Increased from 2000 to accommodate richer reasoning with SMC/EW
          }),
        });

        const latencyMs = Date.now() - start;

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) throw new Error('Empty response from model');

        const parsed = JSON.parse(content);
        const validated = AISignalResponseSchema.parse(parsed);

        return {
          success: true,
          data: validated,
          latencyMs,
          tokenUsage: {
            prompt: data.usage?.prompt_tokens || 0,
            completion: data.usage?.completion_tokens || 0,
            total: data.usage?.total_tokens || 0,
          },
        };
      } catch (error) {
        if (attempt < retries - 1) {
          const delay = Math.pow(4, attempt) * 1000;
          console.warn(`[OpenRouter] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw error;
        }
      }
    }

    throw new Error('Exhausted retries');
  }

  // ── System Prompts ──────────────────────────────────────────────────────────

  private buildSystemPrompt(timeframe: string): string {
    if (this.role === 'CONFIRMATION') {
      return `You are a Senior Quantitative Analyst providing confirmation analysis for the Kairox Trading Platform. 
Your role is to independently verify signals. Your PRIMARY GOAL is to CONFIRM valid setups — not to find reasons to reject them.

STRUCTURED ANALYSIS FRAMEWORK — Evaluate in this order:
1. MARKET STRUCTURE: Analyze BOS/CHoCH, swing highs/lows, and trend direction.
2. TREND DIRECTION: Verify EMA stack alignment and price position.
3. MOMENTUM: Check RSI, Stochastic RSI, MACD, and ADX confluence.
4. SMART MONEY CONCEPTS: Evaluate order blocks, fair value gaps, liquidity zones.
5. ELLIOTT WAVE: If a wave count is provided, consider the wave phase.
6. VOLUME: Check if volume supports the trade direction.
7. FINAL DECISION: Confirm or reject based on overall confluence.

RULES:
1. CONFIRM BY DEFAULT: If the setup has 2+ confluence factors (e.g. order block + trend alignment, or BOS + momentum), you should CONFIRM it. Only reject if there is a clear, specific structural contradiction.
2. DO NOT DEFAULT TO HOLD: You are a confirmation model, not a filter. If the primary signal has reasonable technical backing, confirm it. Reserve HOLD only for setups with zero confluence or direct structural opposition.
3. RANGING MARKETS ARE VALID: In ranging markets (ADX < 20), SMC structures (order blocks, FVGs, BOS) ARE sufficient confluence. Do not require trending EMAs to confirm.
4. WIN PROBABILITY: Output winProbability (0.0-1.0) representing the likelihood of TP1 being hit before Stop Loss. If probability is < 0.45, signal MUST be HOLD.
5. Invalidation must be a precise price point or technical event.
6. If the signal aligns with an unmitigated order block or unfilled FVG, increase confidence.
7. RESPOND ONLY WITH JSON.`;
    }

    return `You are a Senior Quantitative Trader at Kairox AI.
Your goal is to generate ACTIONABLE trading signals for the ${timeframe} timeframe. You should bias towards generating signals rather than defaulting to HOLD. A trade with 55% probability and 1:1 R:R is profitable over time — do not demand perfection.

ANALYSIS FRAMEWORK — Analyze in this order:
1. MARKET STRUCTURE (SMC): Identify BOS/CHoCH, trend direction from swing highs/lows.
2. KEY LEVELS (SMC): Nearest order blocks, unfilled FVGs, and liquidity zones.
3. TREND & MOMENTUM: EMA stack (20/50/200), ADX, RSI, Stochastic RSI, MACD.
4. ELLIOTT WAVE: If a wave count is provided, use Fibonacci projections for targets.
5. VOLUME: Check if volume supports the direction.
6. RISK ASSESSMENT: ATR-based stops and R:R ratio.
7. FINAL DECISION: Generate a signal if 2+ factors align. Do NOT default to HOLD.

TRADING RULES:
1. ⚠️ R:R IS MANDATORY — THIS IS YOUR MOST IMPORTANT RULE:
   - stopDistance = abs(entry - stopLoss)
   - TP1 MUST be at least 1.0 × stopDistance away from entry (in the trade direction).
   - For a LONG: TP1 >= entry + stopDistance. For a SHORT: TP1 <= entry - stopDistance.
   - Example: entry=0.01515, stopLoss=0.01545 → stopDistance=0.00030 → TP1 must be ≤ 0.01485 (for SHORT).
   - Example: entry=1.0000, stopLoss=0.9700 → stopDistance=0.0300 → TP1 must be ≥ 1.0300 (for LONG).
   - TP2 should be 2.0 × stopDistance from entry.
   - The system will BLOCK signals where TP1 does not meet this minimum. Do not submit signals with bad R:R.
2. TREND ALIGNMENT: Prefer LONG if Price > EMA200 and structure is BULLISH. Prefer SHORT if Price < EMA200 and structure is BEARISH. Counter-trend setups require CHoCH + order block confluence.
3. MOMENTUM CAUTION: If RSI > 75 or StochRSI %K > 85, exercise caution with LONGs but do not automatically reject if SMC structure supports the trade. Similarly for RSI < 25 / StochRSI %K < 15 with SHORTs.
4. RANGING MARKETS: If ADX < 20, take range-bound trades at key order blocks, BB extremes, or FVG zones. SMC-based setups ARE valid signals in ranging markets.
5. ORDER BLOCKS & FVGs: Prioritize entries near unmitigated order blocks and unfilled FVGs — these are high-probability zones.
6. EXPECTANCY: Your primary metric is 'winProbability' (0.0-1.0) of hitting TP1 before Stop Loss. Be realistic but not overly pessimistic. If probability is < 0.45, signal MUST be HOLD. Assign 0.55+ to setups with structure alignment. Assign 0.65+ to high-conviction setups.
7. STOP LOSS: Place stop loss at 1.0-2.5x ATR from entry. Prefer placing stops beyond key order blocks or swing points.
8. ENTRY PRICE: Entry MUST be within 0.5% of the CURRENT PRICE. Use market-entry pricing.
9. RESPOND ONLY WITH JSON matching the schema precisely.

PRICE PRECISION RULES:
- For coins priced above $100: use 2 decimal places (e.g., 65432.10).
- For coins priced $1-$100: use 3-4 decimal places (e.g., 1.2345).
- For coins priced $0.01-$1: use 4-5 decimal places (e.g., 0.08523).
- For coins priced below $0.01: use 5-6 decimal places (e.g., 0.008523).
- Entry, stopLoss, and targets MUST be meaningfully different values.
- The distance between entry and first target MUST be at least 1x the stopLoss distance (Rule #1 above).`;
  }

  // ── User Prompt ─────────────────────────────────────────────────────────────

  private buildUserPrompt(symbol: string, timeframe: string, features: FeatureBundle): string {
    const price = features.closePrice;
    const pricePrecision = price >= 100 ? 2 : price >= 1 ? 4 : price >= 0.01 ? 5 : 6;
    const formatPrice = (p: number) => p.toFixed(pricePrecision);

    let vpInfo = 'Volume Profile data unavailable.';
    if (features.vp) {
      vpInfo = `Volume Profile: POC=${features.vp.poc.toFixed(4)}, VAH=${features.vp.vah.toFixed(4)}, VAL=${features.vp.val.toFixed(4)}`;
    }

    // Build recent candles table
    const candleTable = features.recentCandles.length > 0
      ? features.recentCandles.map((c, i) =>
          `  ${i + 1}. O:${formatPrice(c.o)} H:${formatPrice(c.h)} L:${formatPrice(c.l)} C:${formatPrice(c.c)} V:${c.v.toFixed(0)}`
        ).join('\n')
      : '  No recent candle data available';

    // Build SMC section
    let smcSection = 'SMART MONEY CONCEPTS:\n  No SMC data available';
    if (features.smc) {
      const smc = features.smc;
      const smcLines: string[] = [];
      smcLines.push(`  Structure: ${smc.structureTrend}`);
      smcLines.push(`  Zone: ${smc.premiumDiscount}`);

      if (smc.lastBOS) {
        smcLines.push(`  Last BOS: ${smc.lastBOS.side} (${smc.lastBOS.candlesAgo} candles ago @ $${formatPrice(smc.lastBOS.price)})`);
      }
      if (smc.lastCHoCH) {
        smcLines.push(`  ⚠️ CHoCH: ${smc.lastCHoCH.side} (${smc.lastCHoCH.candlesAgo} candles ago @ $${formatPrice(smc.lastCHoCH.price)})`);
      }
      if (smc.nearestOB) {
        smcLines.push(`  Nearest Order Block: ${smc.nearestOB.type} @ $${formatPrice(smc.nearestOB.low)}-$${formatPrice(smc.nearestOB.high)} (${smc.nearestOB.distancePercent.toFixed(2)}% away)`);
      }
      if (smc.nearestFVG) {
        smcLines.push(`  Nearest Unfilled FVG: ${smc.nearestFVG.type} @ $${formatPrice(smc.nearestFVG.lower)}-$${formatPrice(smc.nearestFVG.upper)} (${smc.nearestFVG.distancePercent.toFixed(2)}% away)`);
      }
      if (smc.orderBlocks.length > 0) {
        smcLines.push(`  Active Order Blocks: ${smc.orderBlocks.length} (${smc.orderBlocks.map(ob => `${ob.type} $${formatPrice(ob.low)}-$${formatPrice(ob.high)}`).join(', ')})`);
      }
      if (smc.fairValueGaps.length > 0) {
        smcLines.push(`  Unfilled FVGs: ${smc.fairValueGaps.length} (${smc.fairValueGaps.map(fvg => `${fvg.type} $${formatPrice(fvg.lower)}-$${formatPrice(fvg.upper)}`).join(', ')})`);
      }
      if (smc.liquidityZones.length > 0) {
        const buyside = smc.liquidityZones.filter(z => z.type === 'BUYSIDE');
        const sellside = smc.liquidityZones.filter(z => z.type === 'SELLSIDE');
        if (buyside.length > 0) smcLines.push(`  Buyside Liquidity: ${buyside.map(z => `$${formatPrice(z.price)} (${z.touchCount}x)`).join(', ')}`);
        if (sellside.length > 0) smcLines.push(`  Sellside Liquidity: ${sellside.map(z => `$${formatPrice(z.price)} (${z.touchCount}x)`).join(', ')}`);
      }

      smcSection = 'SMART MONEY CONCEPTS:\n' + smcLines.join('\n');
    }

    // Build Elliott Wave section
    let ewSection = 'ELLIOTT WAVE:\n  No reliable wave pattern detected';
    if (features.elliottWave && features.elliottWave.currentWave) {
      const ew = features.elliottWave;
      const wave = ew.currentWave!;
      const ewLines: string[] = [];
      ewLines.push(`  Pattern: ${wave.degree} ${wave.type} (${wave.direction})`);
      ewLines.push(`  Current Wave: ${wave.number} (confidence: ${(wave.confidence * 100).toFixed(0)}%)`);

      if (ew.waves.length > 0) {
        const waveDesc = ew.waves.map(w =>
          `W${w.number}: $${formatPrice(w.startPrice)}→$${formatPrice(w.endPrice)}${w.fibRatio ? ` (${(w.fibRatio * 100).toFixed(1)}%)` : ''}`
        ).join(' | ');
        ewLines.push(`  Waves: ${waveDesc}`);
      }

      if (ew.projectedTarget) ewLines.push(`  Projected Target: $${formatPrice(ew.projectedTarget)}`);
      if (ew.invalidationLevel) ewLines.push(`  Invalidation: $${formatPrice(ew.invalidationLevel)}`);

      ewSection = 'ELLIOTT WAVE:\n' + ewLines.join('\n');
    }

    const atr = features.atr || 0;
    // Compute a concrete minimum stop distance for the AI (1x ATR is the baseline)
    const minStopDist = atr > 0 ? atr : price * 0.005; // fallback: 0.5% of price
    const minTP1Long  = price + minStopDist;
    const minTP1Short = price - minStopDist;

    return `Analyze the following market data and generate a trading signal:

ASSET: ${symbol}
TIMEFRAME: ${timeframe}
CURRENT PRICE: ${formatPrice(price)}

⚠️ R:R REQUIREMENT (RULE #1 — MANDATORY):
- ATR: ${atr.toFixed(pricePrecision)} | Minimum stop distance reference: ${formatPrice(minStopDist)}
- If you go LONG  → entry ≈ ${formatPrice(price)}, so TP1 MUST be ≥ ${formatPrice(minTP1Long)}
- If you go SHORT → entry ≈ ${formatPrice(price)}, so TP1 MUST be ≤ ${formatPrice(minTP1Short)}
- Place your stopLoss first (at a logical level beyond structure), then set TP1 at least 1× that stop distance away.
- The system will AUTO-CORRECT targets that are too close, but try to pick technically valid levels.

TECHNICAL INDICATORS:
- RSI(14): ${features.rsi.toFixed(2)}
- Stochastic RSI: %K=${features.stochRsi.k.toFixed(2)} | %D=${features.stochRsi.d.toFixed(2)}
- MACD: ${features.macd.macd.toFixed(6)} | Signal: ${features.macd.signal.toFixed(6)} | Histogram: ${features.macd.histogram.toFixed(6)}
- ADX(14): ${features.adx.toFixed(2)} (${features.adx >= 25 ? 'TRENDING' : features.adx >= 20 ? 'WEAK TREND' : 'RANGING'})
- EMA(20): ${formatPrice(features.ema20)}
- EMA(50): ${formatPrice(features.ema50)}
- EMA(200): ${formatPrice(features.ema200)}
- Bollinger Bands: Upper ${formatPrice(features.bb.upper)} | Middle ${formatPrice(features.bb.middle)} | Lower ${formatPrice(features.bb.lower)}

MARKET CONTEXT:
- Trend: ${features.trend}
-## Volatility & Volume
ATR: ${features.atr.toFixed(4)}
Volatility Regime: ${features.volatilityRegime}
Volume Profile: ${features.volumeProfile}
${vpInfo}

${smcSection}

${ewSection}

RECENT CANDLES (last ${features.recentCandles.length}, newest last):
${candleTable}

IMPORTANT: Use ${pricePrecision} decimal places for entry, stopLoss, and target prices. Entry, stopLoss, and targets MUST be different values — never round them to the same number. TP1 MUST satisfy Rule #1 (R:R ≥ 1.0) as computed above.

Generate a trading signal as a JSON object.`;
  }

  private getMockResult(symbol: string): OpenRouterResult {
    return {
      success: true,
      data: {
        side: 'HOLD',
        winProbability: 0.45,
        entry: 65000,
        stopLoss: 64000,
        targets: [{ price: 67000, label: 'TP1' }],
        invalidation: 'Mock mode: OpenRouter API key not configured',
        reasoning: `Mock signal for ${symbol} — OpenRouter API key not configured. Set OPENROUTER_API_KEY in .env to enable real AI analysis.`,
        keyFactors: ['Mock signal — API key not set'],
      },
      latencyMs: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
    };
  }
}

export const openRouterService = new OpenRouterService('PRIMARY');
export const openRouterConfirmationService = new OpenRouterService('CONFIRMATION');
