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

export class OpenAIService {
  private model: string;
  private fallbackModel: string;
  private client: OpenAI | null = null;

  constructor() {
    this.model = process.env.CONFIRMATION_MODEL || 'gpt-4o';
    this.fallbackModel = process.env.CONFIRMATION_FALLBACK_MODEL || 'gpt-4o-mini';

    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    }
  }

  async generateCompletion(
    symbol: string,
    timeframe: string,
    features: FeatureBundle
  ): Promise<OpenAIResult> {
    if (!this.client) {
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
    if (!this.client) throw new Error('OpenAI client not initialized');

    for (let attempt = 0; attempt < retries; attempt++) {
      const start = Date.now();

      try {
        const completion = await this.client.chat.completions.create({
          model: modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'trading_signal',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  side: { type: 'string', enum: ['LONG', 'SHORT', 'HOLD'] },
                  confidence: { type: 'number' },
                  entry: { type: 'number' },
                  stopLoss: { type: 'number' },
                  targets: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        price: { type: 'number' },
                        label: { type: 'string' },
                      },
                      required: ['price', 'label'],
                      additionalProperties: false,
                    },
                  },
                  invalidation: { type: 'string' },
                  reasoning: { type: 'string' },
                  keyFactors: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
                required: ['side', 'confidence', 'entry', 'stopLoss', 'targets', 'reasoning', 'keyFactors'],
                additionalProperties: false,
              },
            },
          },
          temperature: 0.3,
          max_tokens: 2000,
        });

        const latencyMs = Date.now() - start;
        const content = completion.choices?.[0]?.message?.content;

        if (!content) throw new Error('Empty response from model');

        const parsed = JSON.parse(content);
        const validated = AISignalResponseSchema.parse(parsed);

        return {
          success: true,
          data: validated,
          latencyMs,
          tokenUsage: {
            prompt: completion.usage?.prompt_tokens || 0,
            completion: completion.usage?.completion_tokens || 0,
            total: completion.usage?.total_tokens || 0,
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
    return `You are a professional quantitative trading analyst providing confirmation analysis. You independently analyze technical indicators, market structure, and price action to generate structured trading signals.

RULES:
1. Always respond with a valid JSON object matching the exact schema provided.
2. Confidence must be between 0.0 and 1.0, where 0.7+ indicates a strong setup.
3. If evidence is mixed or insufficient, return side: "HOLD" with reasoning.
4. Stop loss must respect ATR and market structure.
5. Targets must have a minimum reward-to-risk ratio of 1.5:1.
6. Invalidation describes what would make this signal wrong.
7. Be specific about key factors — reference actual indicator values.
8. You are acting as an INDEPENDENT confirmation model. Form your own view.`;
  }

  private buildUserPrompt(symbol: string, timeframe: string, features: FeatureBundle): string {
    return `Analyze the following market data and generate an independent trading signal:

ASSET: ${symbol}
TIMEFRAME: ${timeframe}

TECHNICAL INDICATORS:
- RSI(14): ${features.rsi.toFixed(2)}
- MACD: ${features.macd.macd.toFixed(4)} | Signal: ${features.macd.signal.toFixed(4)} | Histogram: ${features.macd.histogram.toFixed(4)}
- ATR(14): ${features.atr.toFixed(4)}
- EMA(20): ${features.ema20.toFixed(2)}
- EMA(50): ${features.ema50.toFixed(2)}
- EMA(200): ${features.ema200.toFixed(2)}
- Bollinger Bands: Upper ${features.bb.upper.toFixed(2)} | Middle ${features.bb.middle.toFixed(2)} | Lower ${features.bb.lower.toFixed(2)}

MARKET CONTEXT:
- Trend: ${features.trend}
- Volume Profile: ${features.volumeProfile}

Generate an independent trading signal as a JSON object.`;
  }

  private getMockResult(symbol: string): OpenAIResult {
    return {
      success: true,
      data: {
        side: 'HOLD',
        confidence: 0.40,
        entry: 65000,
        stopLoss: 64000,
        targets: [{ price: 67000, label: 'TP1' }],
        reasoning: `Mock confirmation for ${symbol} — OpenAI API key not configured. Set OPENAI_API_KEY in .env to enable real AI confirmation.`,
        keyFactors: ['Mock signal — API key not set'],
      },
      latencyMs: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
    };
  }
}

export const openAIService = new OpenAIService();
