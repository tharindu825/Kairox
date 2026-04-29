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
      confidence: { type: 'number' as const },
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
    required: ['side', 'confidence', 'entry', 'stopLoss', 'targets', 'invalidation', 'reasoning', 'keyFactors'],
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
      this.model = process.env.PRIMARY_MODEL || 'anthropic/claude-sonnet-4';
      this.fallbackModel = process.env.PRIMARY_FALLBACK_MODEL || 'google/gemini-2.5-pro';
    } else {
      this.model = process.env.CONFIRMATION_MODEL || 'meta-llama/llama-3-70b-instruct';
      this.fallbackModel = process.env.CONFIRMATION_FALLBACK_MODEL || 'anthropic/claude-3-haiku';
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

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(symbol, timeframe, features);

    // Try primary model, then fallback
    for (const modelId of [this.model, this.fallbackModel]) {
      try {
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
            temperature: 0.3,
            max_tokens: 2000,
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
8. You are acting as an INDEPENDENT confirmation model. Form your own view.`;
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
9. Never guess or fabricate data. Use only the provided indicators.`;
  }

  private buildUserPrompt(symbol: string, timeframe: string, features: FeatureBundle): string {
    return `Analyze the following market data and generate a trading signal:

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

Generate a trading signal as a JSON object.`;
  }

  private getMockResult(symbol: string): OpenRouterResult {
    return {
      success: true,
      data: {
        side: 'HOLD',
        confidence: 0.45,
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
