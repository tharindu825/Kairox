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

    const systemPrompt = this.buildSystemPrompt();
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
      return `You are a Senior Quantitative Analyst providing confirmation analysis for the Kairox Trading Platform. 
Your role is to independently verify signals. You must be extremely critical and skeptical.

RULES:
1. INDEPENDENT ANALYSIS: Independently evaluate technical confluence and price action.
2. STRICT ACCURACY: Only confirm a trade if indicators show strong agreement (e.g., RSI, MACD, and EMA alignment).
3. HOLD BY DEFAULT: If there is any ambiguity or weak trend, suggest "HOLD".
4. CONFIDENCE: 0.8+ indicates high-probability setups.
5. Invalidation must be a precise price point or technical event.
6. RESPOND ONLY WITH JSON.`;
    }

    return `You are a Senior Quantitative Trader and Risk Manager at Kairox AI. 
Your goal is to provide HIGH-ACCURACY trading signals for the 4-hour (4h) timeframe.

CRITICAL TRADING RULES:
1. TREND ALIGNMENT: Only suggest LONG if Price > EMA200. Only suggest SHORT if Price < EMA200.
2. OVEREXTENDED MARKETS: Do NOT suggest LONG if RSI > 65. Do NOT suggest SHORT if RSI < 35.
3. MOMENTUM: MACD histogram must be increasing for LONGs and decreasing for SHORTs.
4. CONSERVATIVE R:R: Minimum 2:1 Reward-to-Risk ratio is REQUIRED. 
5. HOLD BIAS: When in doubt, or if market is sideways, ALWAYS return "HOLD". We value capital preservation over trade quantity.
6. ACCURACY: Accuracy is your primary metric. A signal with < 0.7 confidence should be a "HOLD".
7. STOP LOSS: Use ATR-based stops (1.5x to 2x ATR) to avoid being stopped out by noise.
8. RESPOND ONLY WITH JSON matching the schema precisely.`;
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
