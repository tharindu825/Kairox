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
Your role is to independently verify signals using a structured analysis framework. Be critical but balanced—do not reject high-accuracy, actionable setups over minor technical divergences if the overall price structure and localized confluence strongly support the primary signal's direction.

STRUCTURED ANALYSIS FRAMEWORK — Evaluate in this order:
1. MARKET STRUCTURE: Analyze BOS/CHoCH, swing highs/lows, and trend direction from the Smart Money data provided.
2. TREND DIRECTION: Verify EMA stack alignment and price position.
3. MOMENTUM: Check RSI, Stochastic RSI, MACD, and ADX confluence.
4. SMART MONEY CONCEPTS: Evaluate order blocks, fair value gaps, liquidity zones, and premium/discount context.
5. ELLIOTT WAVE: If a wave count is provided, consider the wave phase in your confirmation.
6. VOLUME: Confirm volume supports the trade direction.
7. FINAL DECISION: Confirm or reject based on overall confluence.

RULES:
1. INDEPENDENT ANALYSIS: Independently evaluate technical confluence, price action, and Smart Money structures.
2. CONSTRUCTIVE ACCURACY: Confirm the trade if the primary setup has high-probability support (e.g. key order block, BOS confirmation, RSI divergence, FVG retest, or EMA alignment).
3. REDUCED HOLD BIAS: Do not default to "HOLD" if the primary signal aligns with a clear BOS breakout, order block retest, or high-probability continuation setup. Reject or suggest "HOLD" only if the setup poses excessive risk or complete structural contradiction. In ranging markets, SMC structures (order blocks, FVGs, BOS) ARE sufficient confluence — do not require a trending EMA stack to confirm.
4. WIN PROBABILITY: Output a statistical 'winProbability' (0.0 to 1.0) representing the true likelihood of the setup hitting TP1 before the Stop Loss. A 0.55 probability means you expect this setup to win 55 out of 100 times. If win probability is < 0.50, the signal MUST be "HOLD".
5. Invalidation must be a precise price point or technical event.
6. VOLUME & ATR VALIDATION: Independently verify that volume supports the trade direction (avoid LOW volume breakouts) and that the stop loss is at least 1.5x ATR from entry. Penalize entries that are more than 0.3% from the current price.
7. SMC VALIDATION: If the signal aligns with an unmitigated order block or unfilled FVG, increase confidence. If the trade is counter to structure (CHoCH detected), flag it.
8. RESPOND ONLY WITH JSON.`;
    }

    return `You are a Senior Quantitative Trader and Risk Manager at Kairox AI.
Your goal is to provide HIGH-ACCURACY trading signals for the ${timeframe} timeframe using a multi-layered analysis framework combining traditional technical analysis, Smart Money Concepts (SMC), and Elliott Wave Theory.

STRUCTURED ANALYSIS FRAMEWORK — You MUST analyze in this exact order:
1. MARKET STRUCTURE (SMC): Identify BOS/CHoCH, trend direction from swing highs/lows. Is the market making higher highs & higher lows (bullish) or lower highs & lower lows (bearish)?
2. KEY LEVELS (SMC): Identify nearest order blocks, unfilled fair value gaps, and liquidity zones from the SMC data provided. These are your primary support/resistance levels.
3. TREND & MOMENTUM: Verify with EMA stack (20/50/200), ADX strength, RSI, Stochastic RSI, and MACD.
4. ELLIOTT WAVE: If a wave count is provided, identify which wave we're in and use Fibonacci projections for targets.
5. VOLUME: Confirm volume supports the trade direction.
6. PREMIUM/DISCOUNT: Only enter LONGs in the discount zone and SHORTs in the premium zone (unless extreme momentum breakout).
7. RISK ASSESSMENT: Calculate ATR-based stops and R:R ratio.
8. FINAL DECISION: Only generate a signal if 3+ factors align. Do NOT default to HOLD in ranging or low-ADX markets — if SMC detects a clear order block, BOS, or FVG setup, that counts as strong confluence even without trending EMAs.

CRITICAL TRADING RULES:
1. TREND ALIGNMENT: Prefer LONG if Price > EMA200 and market structure is BULLISH (higher highs/lows). Prefer SHORT if Price < EMA200 and structure is BEARISH. Counter-trend setups require a confirmed CHoCH + order block confluence + win probability >= 0.70.
2. OVEREXTENDED MARKETS: Do NOT suggest LONG if RSI > 70 or StochRSI %K > 80. Do NOT suggest SHORT if RSI < 30 or StochRSI %K < 20.
3. TREND STRENGTH: If ADX < 20, the market is ranging — only take range-bound trades at key order blocks or BB extremes. If ADX > 25, follow the trend.
4. MOMENTUM: Verify MACD histogram alignment with trade direction. For LONGs, histogram should be positive or turning positive. For SHORTs, negative or turning negative.
5. ORDER BLOCKS: Prioritize entries at unmitigated order blocks. A LONG entry near a bullish OB has much higher probability. A SHORT entry near a bearish OB likewise.
6. FAIR VALUE GAPS: Use unfilled FVGs as entry zones and targets. Price tends to revisit and fill these gaps.
7. LIQUIDITY ZONES: Be aware of equal highs/lows clusters — smart money often sweeps these before reversing. If price is approaching a liquidity zone, wait for the sweep.
8. CONSERVATIVE R:R: Minimum 1.5:1 Reward-to-Risk ratio is REQUIRED. Use Elliott Wave projected targets when available.
9. EXPECTANCY & PROBABILITY: Your primary metric is raw statistical 'winProbability' (0.0 to 1.0) of hitting TP1 before the Stop Loss. Be realistic. If the probability is < 0.50, the signal MUST be a "HOLD". Assign 0.55+ probability to setups where structure and key levels align. Assign 0.70+ to high-conviction setups with full confluence. In ranging markets (ADX < 20), SMC-based setups (order block + BOS + FVG) ARE sufficient for a signal.
10. VOLUME PROFILE (POC, VAH, VAL): Use the Point of Control (POC) as a magnet for price. Place Stop Losses safely beyond high-volume nodes (e.g. beyond POC or VAH/VAL) rather than in thin liquidity. Target the POC if price is reverting from the extremes.
11. STOP LOSS: Use ATR-based stops. Place the stop loss at a minimum of 1.5x ATR from entry but no more than 3x ATR. Prefer placing stops below/above key order blocks.
12. ACTIONABLE ENTRY: Entry price MUST be within 0.3% of the CURRENT PRICE. Do NOT suggest deep pullback entries.
13. VOLUME CONFIRMATION: Avoid trades during LOW or DECLINING volume unless there is overwhelming SMC confluence (order block + BOS + FVG alignment).
14. ELLIOTT WAVE TARGETS: If a wave count is detected with probability > 50%, use the projected Fibonacci target for TP placement and the invalidation level for stop-loss reference.
15. RESPOND ONLY WITH JSON matching the schema precisely.

PRICE PRECISION RULES (CRITICAL):
- Entry, Stop Loss, and Target prices MUST use proper decimal precision.
- For coins priced above $100: use 2 decimal places (e.g., 65432.10).
- For coins priced $1-$100: use 3-4 decimal places (e.g., 1.2345).
- For coins priced $0.01-$1: use 4-5 decimal places (e.g., 0.08523).
- For coins priced below $0.01: use 5-6 decimal places (e.g., 0.008523).
- NEVER round entry, stopLoss, or targets to the same value. They MUST be meaningfully different.
- The distance between entry and stopLoss must be at least 1.5x ATR.
- The distance between entry and first target must be at least 1.5x the stopLoss distance.`;
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

    return `Analyze the following market data and generate a trading signal:

ASSET: ${symbol}
TIMEFRAME: ${timeframe}
CURRENT PRICE: ${formatPrice(price)}

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

IMPORTANT: Use ${pricePrecision} decimal places for entry, stopLoss, and target prices. Entry, stopLoss, and targets MUST be different values — never round them to the same number.

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
