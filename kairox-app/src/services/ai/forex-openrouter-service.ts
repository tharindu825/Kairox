import { FeatureBundle } from '../indicators';
import { ForexAISignalResponseSchema, type ForexAISignalResponse } from '@/types';

interface ForexOpenRouterResult {
  success: boolean;
  data?: ForexAISignalResponse;
  error?: string;
  latencyMs?: number;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

// ── Forex-specific JSON Schema ───────────────────────────────────────────────
// Extends the base signal schema with forexOrderType.

const FOREX_SIGNAL_JSON_SCHEMA = {
  name: 'forex_trading_signal',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      side:           { type: 'string' as const, enum: ['LONG', 'SHORT', 'HOLD'] },
      forexOrderType: { type: 'string' as const, enum: ['BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP'] },
      winProbability:     { type: 'number' as const },
      entry:          { type: 'number' as const },
      stopLoss:       { type: 'number' as const },
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
      reasoning:    { type: 'string' as const },
      keyFactors: {
        type: 'array' as const,
        items: { type: 'string' as const },
      },
    },
    required: [
      'side', 'forexOrderType', 'winProbability', 'entry', 'stopLoss',
      'targets', 'invalidation', 'reasoning', 'keyFactors',
    ],
    additionalProperties: false,
  },
};

// ── Forex Trading Sessions ───────────────────────────────────────────────────

export function getCurrentForexSession(): string {
  const hour = new Date().getUTCHours();
  if (hour >= 22 || hour < 7)  return 'SYDNEY';
  if (hour >= 0  && hour < 9)  return 'TOKYO';
  if (hour >= 7  && hour < 16) return 'LONDON';
  if (hour >= 13 && hour < 22) return 'NEW_YORK';
  return 'LONDON_NY_OVERLAP';
}

// ── Service ──────────────────────────────────────────────────────────────────

export class ForexOpenRouterService {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private fallbackModel: string;
  private role: 'PRIMARY' | 'CONFIRMATION';

  constructor(role: 'PRIMARY' | 'CONFIRMATION' = 'PRIMARY') {
    this.role       = role;
    this.apiKey     = process.env.OPENROUTER_API_KEY || '';
    this.baseUrl    = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

    if (role === 'PRIMARY') {
      this.model         = process.env.PRIMARY_MODEL          || 'deepseek/deepseek-chat-v3.1';
      this.fallbackModel = process.env.PRIMARY_FALLBACK_MODEL || 'qwen/qwen3-32b';
    } else {
      this.model         = process.env.CONFIRMATION_MODEL          || 'google/gemini-2.5-flash';
      this.fallbackModel = process.env.CONFIRMATION_FALLBACK_MODEL || 'deepseek/deepseek-chat-v3.1';
    }
  }

  async generateCompletion(
    symbol: string,
    timeframe: string,
    features: FeatureBundle
  ): Promise<ForexOpenRouterResult> {
    if (!this.apiKey) {
      return this.getMockResult(symbol);
    }

    const systemPrompt = this.buildSystemPrompt(timeframe);
    const userPrompt   = this.buildUserPrompt(symbol, timeframe, features);

    for (const modelId of [this.model, this.fallbackModel]) {
      try {
        console.log(`[ForexOpenRouter] Attempting with model: ${modelId} (${this.role})`);
        return await this.callAPI(modelId, systemPrompt, userPrompt);
      } catch (error) {
        console.warn(`[ForexOpenRouter] Model ${modelId} failed:`, (error as Error).message);
      }
    }

    return { success: false, error: 'All OpenRouter models failed for forex signal' };
  }

  private async callAPI(
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    retries = 3
  ): Promise<ForexOpenRouterResult> {
    for (let attempt = 0; attempt < retries; attempt++) {
      const start = Date.now();
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer':  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
            'X-Title':       'Kairox Forex AI',
          },
          body: JSON.stringify({
            model:   modelId,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user',   content: userPrompt   },
            ],
            response_format: {
              type:        'json_schema',
              json_schema: FOREX_SIGNAL_JSON_SCHEMA,
            },
            temperature: 0.1,
            max_tokens:  2500,
          }),
        });

        const latencyMs = Date.now() - start;

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data    = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error('Empty response from model');

        const parsed = JSON.parse(content);

        // Sanitize: some models return negative prices for "open" targets.
        // Clamp any negative or NaN target prices to 0 (= "open" in our format).
        if (Array.isArray(parsed?.targets)) {
          parsed.targets = parsed.targets.map((t: any) => ({
            ...t,
            price: typeof t.price === 'number' && t.price >= 0 ? t.price : 0,
          }));
        }

        const validated = ForexAISignalResponseSchema.parse(parsed);

        return {
          success: true,
          data:    validated,
          latencyMs,
          tokenUsage: {
            prompt:     data.usage?.prompt_tokens     || 0,
            completion: data.usage?.completion_tokens || 0,
            total:      data.usage?.total_tokens      || 0,
          },
        };
      } catch (error) {
        if (attempt < retries - 1) {
          const delay = 2000; // 2s fixed delay between retries
          console.warn(`[ForexOpenRouter] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
          if (error instanceof Error) {
            // Log Zod validation errors in compact form
            const msg = error.message.slice(0, 300);
            console.warn(`[ForexOpenRouter] Error: ${msg}`);
          }
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw error;
        }
      }
    }
    throw new Error('Exhausted retries');
  }

  // ── System Prompt ────────────────────────────────────────────────────────────

  private buildSystemPrompt(timeframe: string): string {
    const session = getCurrentForexSession();

    if (this.role === 'CONFIRMATION') {
      return `You are a Senior Forex Analyst providing independent signal confirmation for the Kairox Trading Platform.
Your job is to verify forex signals using technical analysis, Smart Money Concepts, and session context.

FOREX-SPECIFIC RULES:
1. Account for spread: SL distance must cover at least 3x typical spread for the pair.
2. Major sessions: LONDON (07:00-16:00 UTC) and NEW_YORK (13:00-22:00 UTC) are highest liquidity.
   Avoid taking reversals during SYDNEY/TOKYO for USD pairs (low liquidity).
3. CURRENT SESSION: ${session} — factor into confidence.
4. Prefer entries at key round numbers, previous day high/low, and weekly open price.
5. For XAUUSD: treat as a commodity; supports large ATR moves — adjust pip expectations.
6. forexOrderType rules:
   - BUY_LIMIT / SELL_LIMIT: entry is BELOW (buy) or ABOVE (sell) current price (pending order).
   - BUY_STOP / SELL_STOP: entry is ABOVE (buy) or BELOW (sell) current price (breakout order).
   - Match the order type to the price action context — do NOT use BUY_LIMIT if price needs to go UP first.
7. Use 5 decimal places for pairs without JPY (e.g. 1.23456). Use 3 decimal places for JPY pairs. Use 2 decimal places for XAUUSD.
8. WIN PROBABILITY: Output a statistical 'winProbability' (0.0 to 1.0) representing the true likelihood of the setup hitting TP1 before the Stop Loss. A 0.55 probability means you expect this setup to win 55 out of 100 times. If win probability is < 0.50, the signal MUST be "HOLD".
9. RESPOND ONLY WITH JSON.`;
    }

    return `You are a Senior Forex Trader at Kairox AI specializing in the ${timeframe} timeframe.
Generate HIGH-ACCURACY forex trading signals using technical analysis, Smart Money Concepts, and market sessions.

ANALYSIS FRAMEWORK (evaluate in order):
1. MARKET STRUCTURE: BOS/CHoCH, swing highs/lows, trend direction.
2. KEY LEVELS: Previous day high/low, weekly open, round numbers (e.g. 1.1000, 2000.00).
3. ORDER BLOCKS & FVGs: Entry zones, unmitigated OBs, unfilled FVGs.
4. INDICATORS: EMA stack, RSI, MACD, ADX, Stochastic RSI.
5. SESSION CONTEXT: CURRENT SESSION = ${session}.
   - Best entries: LONDON open (07:00 UTC) and NY open (13:00 UTC) sessions.
   - Avoid reversals during low-liquidity periods for major pairs.
6. PREMIUM / DISCOUNT zones: Only LONG from discount, SHORT from premium (Fibonacci 50% midpoint).

CRITICAL RULES:
1. TREND: LONG only if price > EMA200 AND bullish structure. SHORT only if price < EMA200 AND bearish structure. Counter-trend requires CHoCH + OB + win probability >= 0.70.
2. R:R minimum 1.5:1. Preferred 2:1 or better.
3. EXPECTANCY & PROBABILITY: Your primary metric is raw statistical 'winProbability' (0.0 to 1.0) of hitting TP1 before the Stop Loss. Be realistic. If the probability is < 0.50, the signal MUST be a "HOLD". Assign 0.55+ probability to setups where structure and key levels align. Assign 0.70+ to high-conviction setups with full confluence.
4. Entry MUST be within 0.5% of current price for MARKET orders; for LIMIT/STOP orders the entry can be further.
5. SL MUST be placed beyond a structural level (swing high/low or OB boundary). Use the Volume Profile Point of Control (POC) or Value Area (VAH/VAL) as liquidity barriers for SL placement.
6. Provide exactly 3 targets (TP1, TP2, TP3). If TP3 is an open target, set its price to 0. Target the POC if price is mean-reverting.
6. forexOrderType selection:
   - BUY_LIMIT: Price must FALL to entry level (buy from support/OB below).
   - SELL_LIMIT: Price must RISE to entry level (sell from resistance/OB above).
   - BUY_STOP: Price must BREAK ABOVE entry (breakout long).
   - SELL_STOP: Price must BREAK BELOW entry (breakdown short).
   - Set side = LONG for BUY_LIMIT/BUY_STOP and side = SHORT for SELL_LIMIT/SELL_STOP.

PRICE PRECISION (CRITICAL):
- JPY pairs (USDJPY, EURJPY, GBPJPY): 3 decimal places (e.g. 157.234)
- XAUUSD, XAGUSD: 2 decimal places (e.g. 3250.45)
- All other pairs: 5 decimal places (e.g. 1.23456)
- NEVER use the same number for entry, SL, or any target.

If signal quality is insufficient (win probability < 0.55), return HOLD with forexOrderType = BUY_LIMIT as placeholder.
RESPOND ONLY WITH JSON.`;
  }

  // ── User Prompt ──────────────────────────────────────────────────────────────

  private buildUserPrompt(symbol: string, timeframe: string, features: FeatureBundle): string {
    const price = features.closePrice;

    // Forex-appropriate decimal precision
    const isJPY    = symbol.includes('JPY');
    const isGold   = symbol.includes('XAU') || symbol.includes('XAG');
    const decimals = isJPY ? 3 : isGold ? 2 : 5;
    const fp       = (n: number) => n.toFixed(decimals);

    const candleTable = features.recentCandles.length > 0
      ? features.recentCandles.map((c, i) =>
          `  ${i + 1}. O:${fp(c.o)} H:${fp(c.h)} L:${fp(c.l)} C:${fp(c.c)} V:${c.v.toFixed(0)}`
        ).join('\n')
      : '  No recent candle data available';

    let vpInfo = 'Volume Profile data unavailable.';
    if (features.vp) {
      vpInfo = `Volume Profile: POC=${features.vp.poc.toFixed(5)}, VAH=${features.vp.vah.toFixed(5)}, VAL=${features.vp.val.toFixed(5)}`;
    }

    let smcSection = 'SMART MONEY CONCEPTS:\n  No SMC data available';
    if (features.smc) {
      const smc = features.smc;
      const lines: string[] = [];
      lines.push(`  Structure: ${smc.structureTrend}`);
      lines.push(`  Zone: ${smc.premiumDiscount}`);
      if (smc.lastBOS)   lines.push(`  Last BOS: ${smc.lastBOS.side} (${smc.lastBOS.candlesAgo} candles ago @ ${fp(smc.lastBOS.price)})`);
      if (smc.lastCHoCH) lines.push(`  ⚠️ CHoCH: ${smc.lastCHoCH.side} (${smc.lastCHoCH.candlesAgo} candles ago @ ${fp(smc.lastCHoCH.price)})`);
      if (smc.nearestOB) lines.push(`  Nearest OB: ${smc.nearestOB.type} @ ${fp(smc.nearestOB.low)}-${fp(smc.nearestOB.high)} (${smc.nearestOB.distancePercent.toFixed(2)}% away)`);
      if (smc.nearestFVG) lines.push(`  Nearest FVG: ${smc.nearestFVG.type} @ ${fp(smc.nearestFVG.lower)}-${fp(smc.nearestFVG.upper)} (${smc.nearestFVG.distancePercent.toFixed(2)}% away)`);
      smcSection = 'SMART MONEY CONCEPTS:\n' + lines.join('\n');
    }

    return `Analyze the following FOREX market data and generate a trading signal:

PAIR: ${symbol}
TIMEFRAME: ${timeframe}
CURRENT PRICE: ${fp(price)}
ACTIVE SESSION: ${getCurrentForexSession()}

TECHNICAL INDICATORS:
- RSI(14): ${features.rsi.toFixed(2)}
- Stochastic RSI: %K=${features.stochRsi.k.toFixed(2)} | %D=${features.stochRsi.d.toFixed(2)}
- MACD: ${features.macd.macd.toFixed(6)} | Signal: ${features.macd.signal.toFixed(6)} | Histogram: ${features.macd.histogram.toFixed(6)}
- ADX(14): ${features.adx.toFixed(2)} (${features.adx >= 25 ? 'TRENDING' : features.adx >= 20 ? 'WEAK TREND' : 'RANGING'})
- EMA(20): ${fp(features.ema20)}
- EMA(50): ${fp(features.ema50)}
- EMA(200): ${fp(features.ema200)}
- Bollinger Bands: Upper ${fp(features.bb.upper)} | Middle ${fp(features.bb.middle)} | Lower ${fp(features.bb.lower)}

MARKET CONTEXT:
- Trend: ${features.trend}
- Volatility & Volume
  ATR: ${features.atr.toFixed(5)}
  Volatility Regime: ${features.volatilityRegime}
  Volume Profile: ${features.volumeProfile}
  ${vpInfo}

${smcSection}

RECENT CANDLES (last ${features.recentCandles.length}, newest last):
${candleTable}

IMPORTANT:
- Use ${decimals} decimal places for all prices.
- Entry, SL, TP1, TP2, TP3 MUST be unique values — never identical.
- Set TP3 price = 0 if it is an open/indefinite target.
- Select forexOrderType based on where entry is relative to current price.

Generate a forex trading signal as a JSON object.`;
  }

  private getMockResult(symbol: string): ForexOpenRouterResult {
    return {
      success: true,
      data: {
        side:           'HOLD',
        forexOrderType: 'BUY_LIMIT',
        winProbability:     0.4,
        entry:          0,
        stopLoss:       0,
        targets:        [{ price: 0, label: 'TP1' }, { price: 0, label: 'TP2' }, { price: 0, label: 'TP3' }],
        invalidation:   'Mock mode: OpenRouter API key not configured',
        reasoning:      `Mock forex signal for ${symbol} — configure OPENROUTER_API_KEY in .env`,
        keyFactors:     ['Mock signal — API key not set'],
      },
      latencyMs: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
    };
  }
}

export const forexOpenRouterService             = new ForexOpenRouterService('PRIMARY');
export const forexOpenRouterConfirmationService = new ForexOpenRouterService('CONFIRMATION');
