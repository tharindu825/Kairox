import OpenAI from 'openai';
import { FeatureBundle } from '../indicators';
import { AISignalResponseSchema, type AISignalResponse } from '@/types';

interface OpenAIResult {
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

export class OpenAIService {
  private openai: OpenAI | null = null;
  private model: string;
  private fallbackModel: string;
  private role: 'PRIMARY' | 'CONFIRMATION';

  constructor(role: 'PRIMARY' | 'CONFIRMATION' = 'CONFIRMATION') {
    this.role = role;
    
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }

    if (role === 'PRIMARY') {
      this.model = process.env.PRIMARY_MODEL || 'gpt-4o';
      this.fallbackModel = process.env.PRIMARY_FALLBACK_MODEL || 'gpt-4o-mini';
    } else {
      this.model = process.env.CONFIRMATION_MODEL || 'gpt-4o';
      this.fallbackModel = process.env.CONFIRMATION_FALLBACK_MODEL || 'gpt-4o-mini';
    }
  }

  async generateCompletion(
    symbol: string,
    timeframe: string,
    features: FeatureBundle
  ): Promise<OpenAIResult> {
    if (!this.openai) {
      console.warn('[OpenAI] No API key configured — returning mock signal');
      return this.getMockResult(symbol);
    }

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(symbol, timeframe, features);

    // Try primary model, then fallback
    for (const modelId of [this.model, this.fallbackModel]) {
      try {
        const result = await this.callAPI(modelId, systemPrompt, userPrompt);
        return result;
      } catch (error) {
        console.warn(`[OpenAI] Model ${modelId} failed:`, (error as Error).message);
      }
    }

    return { success: false, error: 'All OpenAI models failed' };
  }

  private async callAPI(
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    retries = 3
  ): Promise<OpenAIResult> {
    if (!this.openai) throw new Error('OpenAI client not initialized');

    for (let attempt = 0; attempt < retries; attempt++) {
      const start = Date.now();

      try {
        const response = await this.openai.chat.completions.create({
          model: modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: SIGNAL_JSON_SCHEMA,
          },
          temperature: 0.3,
          max_tokens: 2000,
        });

        const latencyMs = Date.now() - start;
        const content = response.choices[0]?.message?.content;

        if (!content) throw new Error('Empty response from model');

        const parsed = JSON.parse(content);
        const validated = AISignalResponseSchema.parse(parsed);

        return {
          success: true,
          data: validated,
          latencyMs,
          tokenUsage: {
            prompt: response.usage?.prompt_tokens || 0,
            completion: response.usage?.completion_tokens || 0,
            total: response.usage?.total_tokens || 0,
          },
        };
      } catch (error) {
        if (attempt < retries - 1) {
          const delay = Math.pow(4, attempt) * 1000;
          console.warn(`[OpenAI] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw error;
        }
      }
    }

    throw new Error('Exhausted retries');
  }

  private buildSystemPrompt(): string {
    if (this.role === 'CONFIRMATION') {
      return `You are a professional quantitative trading analyst providing confirmation analysis. You independently analyze technical indicators, market structure, and price action to generate structured trading signals.

RULES:
1. Always respond with a valid JSON object matching the exact schema provided.
2. Confidence must be between 0.0 and 1.0, where 0.7+ indicates a strong setup.
3. If evidence is mixed or insufficient, return side: "HOLD" with reasoning.
4. Stop loss must respect ATR and market structure.
5. Targets must have a minimum reward-to-risk ratio of 1.5:1.
6. Invalidation describes what would make this signal wrong.
7. Be specific about key factors — reference actual indicator values.
8. You are acting as an INDEPENDENT confirmation model. Form your own view.

PRICE PRECISION RULES (CRITICAL):
- Entry, Stop Loss, and Target prices MUST use proper decimal precision.
- For coins priced above $100: use 2 decimal places (e.g., 65432.10).
- For coins priced $1-$100: use 3-4 decimal places (e.g., 1.2345).
- For coins priced $0.01-$1: use 4-5 decimal places (e.g., 0.08523).
- For coins priced below $0.01: use 5-6 decimal places (e.g., 0.008523).
- NEVER round entry, stopLoss, or targets to the same value. They MUST be meaningfully different.`;
    }

    return `You are a professional quantitative trading analyst. You analyze technical indicators, market structure, and price action to generate structured trading signals.

RULES:
1. Always respond with a valid JSON object matching the exact schema provided.
2. Confidence must be between 0.0 and 1.0, where 0.7+ indicates a strong setup.
3. If evidence is mixed or insufficient, return side: "HOLD" with reasoning explaining why.
4. Stop loss must respect the ATR and market structure — never place stops at arbitrary round numbers.
5. Targets must have a minimum reward-to-risk ratio of 1.5:1 from entry to first target.
6. Do NOT emit a trade if risk-reward is below 1.5:1.
7. Invalidation describes what would make this signal wrong.
8. Be specific about key factors — reference actual indicator values.
9. ACTIONABLE ENTRY: Your recommended entry price MUST be very close to the CURRENT PRICE. Do not suggest deep pullback entries that are unlikely to trigger.
10. Never guess or fabricate data. Use only the provided indicators.

PRICE PRECISION RULES (CRITICAL):
- Entry, Stop Loss, and Target prices MUST use proper decimal precision.
- For coins priced above $100: use 2 decimal places (e.g., 65432.10).
- For coins priced $1-$100: use 3-4 decimal places (e.g., 1.2345).
- For coins priced $0.01-$1: use 4-5 decimal places (e.g., 0.08523).
- For coins priced below $0.01: use 5-6 decimal places (e.g., 0.008523).
- NEVER round entry, stopLoss, or targets to the same value. They MUST be meaningfully different.
- The distance between entry and stopLoss must be at least 1x ATR.
- The distance between entry and first target must be at least 1.5x the stopLoss distance.`;
  }

  private buildUserPrompt(symbol: string, timeframe: string, features: FeatureBundle): string {
    // Determine appropriate decimal precision based on price level
    const price = features.closePrice; // Use actual current close price
    const pricePrecision = price >= 100 ? 2 : price >= 1 ? 4 : price >= 0.01 ? 5 : 6;
    const formatPrice = (p: number) => p.toFixed(pricePrecision);

    return `Analyze the following market data and generate a trading signal:

ASSET: ${symbol}
TIMEFRAME: ${timeframe}
CURRENT PRICE: ${formatPrice(price)}

TECHNICAL INDICATORS:
- RSI(14): ${features.rsi.toFixed(2)}
- MACD: ${features.macd.macd.toFixed(6)} | Signal: ${features.macd.signal.toFixed(6)} | Histogram: ${features.macd.histogram.toFixed(6)}
- ATR(14): ${features.atr.toFixed(6)}
- EMA(20): ${formatPrice(features.ema20)}
- EMA(50): ${formatPrice(features.ema50)}
- EMA(200): ${formatPrice(features.ema200)}
- Bollinger Bands: Upper ${formatPrice(features.bb.upper)} | Middle ${formatPrice(features.bb.middle)} | Lower ${formatPrice(features.bb.lower)}

MARKET CONTEXT:
- Trend: ${features.trend}
- Volume Profile: ${features.volumeProfile}

IMPORTANT: Use ${pricePrecision} decimal places for entry, stopLoss, and target prices. Entry, stopLoss, and targets MUST be different values — never round them to the same number.

Generate a trading signal as a JSON object.`;
  }

  private getMockResult(symbol: string): OpenAIResult {
    return {
      success: true,
      data: {
        side: 'HOLD',
        winProbability: 0.45,
        entry: 65000,
        stopLoss: 64000,
        targets: [{ price: 67000, label: 'TP1' }],
        invalidation: 'If price drops below support',
        reasoning: `Mock signal for ${symbol} — OpenAI API key not configured. Set OPENAI_API_KEY in .env to enable real AI analysis.`,
        keyFactors: ['Mock signal — API key not set'],
      },
      latencyMs: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
    };
  }
}

export const openAIService = new OpenAIService('CONFIRMATION');
