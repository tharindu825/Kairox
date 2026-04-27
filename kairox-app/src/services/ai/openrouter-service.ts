import { FeatureBundle } from '../indicators';

export class OpenRouterService {
  async generateCompletion(symbol: string, timeframe: string, features: FeatureBundle) {
    // Mock implementation for compilation. In real life, calls openrouter.ai
    return {
      success: true,
      data: {
        side: 'LONG' as const,
        confidence: 0.85,
        entry: 65000,
        stopLoss: 64000,
        targets: [{ price: 68000, label: 'TP1' }],
        reasoning: 'RSI is oversold and price is above EMA200',
        keyFactors: ['RSI oversold', 'EMA200 support']
      }
    };
  }
}

export const openRouterService = new OpenRouterService();
