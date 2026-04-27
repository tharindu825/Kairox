import { z } from 'zod';
import { AISignalResponseSchema, type AISignalResponse, type FeatureBundle } from '@/types';

export interface AIServiceConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  fallbackModel: string;
  provider: 'openrouter' | 'openai';
}

export interface AIRequestOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface AIServiceResult {
  response: AISignalResponse;
  modelId: string;
  apiProvider: string;
  latencyMs: number;
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };
  rawResponse: Record<string, unknown>;
}

const SIGNAL_JSON_SCHEMA = {
  name: 'trading_signal',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      side: { type: 'string' as const, enum: ['LONG', 'SHORT', 'HOLD'], description: 'Trade direction' },
      confidence: { type: 'number' as const, description: 'Confidence score from 0.0 to 1.0' },
      entry: { type: 'number' as const, description: 'Entry price' },
      stopLoss: { type: 'number' as const, description: 'Stop loss price' },
      targets: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            price: { type: 'number' as const, description: 'Target price' },
            label: { type: 'string' as const, description: 'Target label e.g. TP1, TP2' },
          },
          required: ['price', 'label'],
          additionalProperties: false,
        },
        description: 'Take profit targets',
      },
      invalidation: { type: 'string' as const, description: 'Conditions that invalidate this signal' },
      reasoning: { type: 'string' as const, description: 'Structured explanation of the trade thesis' },
      keyFactors: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Key factors supporting the signal',
      },
    },
    required: ['side', 'confidence', 'entry', 'stopLoss', 'targets', 'reasoning', 'keyFactors'],
    additionalProperties: false,
  },
};

export abstract class BaseAIService {
  protected config: AIServiceConfig;

  constructor(config: AIServiceConfig) {
    this.config = config;
  }

  abstract generateCompletion(
    systemPrompt: string,
    userPrompt: string,
    options?: AIRequestOptions
  ): Promise<AIServiceResult>;

  async generateSignal(
    bundle: FeatureBundle,
    promptTemplate: string,
    options?: AIRequestOptions
  ): Promise<AIServiceResult> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(bundle, promptTemplate);

    let lastError: Error | null = null;

    // Try primary model
    try {
      const result = await this.generateCompletion(systemPrompt, userPrompt, {
        ...options,
        model: options?.model || this.config.defaultModel,
      });
      return result;
    } catch (error) {
      lastError = error as Error;
      console.warn(`Primary model failed (${this.config.defaultModel}):`, (error as Error).message);
    }

    // Try fallback model
    try {
      const result = await this.generateCompletion(systemPrompt, userPrompt, {
        ...options,
        model: this.config.fallbackModel,
      });
      return result;
    } catch (error) {
      lastError = error as Error;
      console.error(`Fallback model also failed (${this.config.fallbackModel}):`, (error as Error).message);
    }

    throw new Error(`All models failed. Last error: ${lastError?.message}`);
  }

  protected buildSystemPrompt(): string {
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

  protected buildUserPrompt(bundle: FeatureBundle, promptTemplate: string): string {
    const dataContext = `
MARKET DATA SNAPSHOT:
- Asset: ${bundle.asset}
- Timeframe: ${bundle.timeframe}
- Current Price: ${bundle.currentPrice}
- Timestamp: ${bundle.timestamp}

TECHNICAL INDICATORS:
- RSI(14): ${bundle.indicators.rsi.toFixed(2)}
- MACD: ${bundle.indicators.macd.macd.toFixed(4)} | Signal: ${bundle.indicators.macd.signal.toFixed(4)} | Histogram: ${bundle.indicators.macd.histogram.toFixed(4)}
- ATR(14): ${bundle.indicators.atr.toFixed(4)}
- EMA(20): ${bundle.indicators.ema20.toFixed(2)}
- EMA(50): ${bundle.indicators.ema50.toFixed(2)}
- EMA(200): ${bundle.indicators.ema200.toFixed(2)}
- Bollinger Bands: Upper ${bundle.indicators.bollingerBands.upper.toFixed(2)} | Middle ${bundle.indicators.bollingerBands.middle.toFixed(2)} | Lower ${bundle.indicators.bollingerBands.lower.toFixed(2)}
- 24h Volume: ${bundle.indicators.volume24h.toFixed(2)}
- Volume Ratio: ${bundle.indicators.volumeRatio.toFixed(2)}
- 24h Price Change: ${bundle.indicators.priceChange24h.toFixed(2)} (${bundle.indicators.priceChangePercent24h.toFixed(2)}%)

MARKET CONTEXT:
- Trend: ${bundle.marketContext.trend}
- Volatility Regime: ${bundle.marketContext.volatilityRegime}
- Volume Profile: ${bundle.marketContext.volumeProfile}

RECENT CANDLES (last ${bundle.recentCandles.length}):
${bundle.recentCandles.slice(-10).map(c =>
  `  [${new Date(c.time * 1000).toISOString()}] O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume}`
).join('\n')}`;

    return `${promptTemplate}\n\n${dataContext}\n\nAnalyze the above data and generate a trading signal as a JSON object.`;
  }

  protected getJsonSchema() {
    return SIGNAL_JSON_SCHEMA;
  }

  protected validateResponse(raw: unknown): AISignalResponse {
    const parsed = AISignalResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Signal schema validation failed: ${parsed.error.message}`);
    }

    // Additional business logic validation
    const signal = parsed.data;
    if (signal.side !== 'HOLD') {
      if (signal.side === 'LONG' && signal.stopLoss >= signal.entry) {
        throw new Error('LONG signal: stopLoss must be below entry');
      }
      if (signal.side === 'SHORT' && signal.stopLoss <= signal.entry) {
        throw new Error('SHORT signal: stopLoss must be above entry');
      }
    }

    return signal;
  }
}
