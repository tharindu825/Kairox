import { z } from 'zod';

// ─── Signal Schemas ─────────────────────────────────────────────────────────

export const SignalSideEnum = z.enum(['LONG', 'SHORT', 'HOLD']);
export type SignalSide = z.infer<typeof SignalSideEnum>;

export const SignalStatusEnum = z.enum(['PENDING', 'APPROVED', 'BLOCKED', 'EXPIRED', 'INVALIDATED']);
export type SignalStatus = z.infer<typeof SignalStatusEnum>;

export const TargetSchema = z.object({
  price: z.number().positive(),
  label: z.string(),
});

export const AISignalResponseSchema = z.object({
  side: SignalSideEnum,
  confidence: z.number().min(0).max(1),
  entry: z.number().positive(),
  stopLoss: z.number().positive(),
  targets: z.array(TargetSchema).min(1).max(5),
  invalidation: z.string().optional(),
  reasoning: z.string().min(10),
  keyFactors: z.array(z.string()).min(1).max(10),
});
export type AISignalResponse = z.infer<typeof AISignalResponseSchema>;

// ─── Feature Bundle Schema ──────────────────────────────────────────────────

export const IndicatorBundleSchema = z.object({
  rsi: z.number(),
  macd: z.object({
    macd: z.number(),
    signal: z.number(),
    histogram: z.number(),
  }),
  atr: z.number(),
  ema20: z.number(),
  ema50: z.number(),
  ema200: z.number(),
  bollingerBands: z.object({
    upper: z.number(),
    middle: z.number(),
    lower: z.number(),
  }),
  volume24h: z.number(),
  volumeRatio: z.number(),
  priceChange24h: z.number(),
  priceChangePercent24h: z.number(),
});
export type IndicatorBundle = z.infer<typeof IndicatorBundleSchema>;

export const FeatureBundleSchema = z.object({
  asset: z.string(),
  timeframe: z.string(),
  currentPrice: z.number().positive(),
  timestamp: z.string(),
  indicators: IndicatorBundleSchema,
  marketContext: z.object({
    trend: z.enum(['BULLISH', 'BEARISH', 'NEUTRAL']),
    volatilityRegime: z.enum(['LOW', 'NORMAL', 'HIGH', 'EXTREME']),
    volumeProfile: z.enum(['LOW', 'NORMAL', 'HIGH']),
    session: z.string().optional(),
  }),
  recentCandles: z.array(z.object({
    time: z.number(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number(),
  })).max(50),
});
export type FeatureBundle = z.infer<typeof FeatureBundleSchema>;

// ─── Risk Assessment Schema ─────────────────────────────────────────────────

export const RiskVerdictEnum = z.enum(['APPROVED', 'REDUCED', 'WATCH_ONLY', 'BLOCKED']);
export type RiskVerdict = z.infer<typeof RiskVerdictEnum>;

export const RiskAssessmentResultSchema = z.object({
  positionSize: z.number().nonnegative(),
  riskPercent: z.number().min(0).max(100),
  rewardToRisk: z.number(),
  exposureCheck: z.boolean(),
  correlationFlag: z.boolean(),
  verdict: RiskVerdictEnum,
  reasons: z.array(z.string()),
});
export type RiskAssessmentResult = z.infer<typeof RiskAssessmentResultSchema>;

// ─── Model Config Types ─────────────────────────────────────────────────────

export const VoteRoleEnum = z.enum(['PRIMARY', 'CONFIRMATION', 'RISK_REVIEW']);
export type VoteRole = z.infer<typeof VoteRoleEnum>;

export const ApiProviderEnum = z.enum(['openrouter', 'openai']);
export type ApiProvider = z.infer<typeof ApiProviderEnum>;

export interface ModelRoutingConfig {
  role: VoteRole;
  apiProvider: ApiProvider;
  modelId: string;
  fallbackModelId: string;
  parameters: {
    temperature: number;
    maxTokens: number;
    topP?: number;
  };
}

// ─── Dashboard Types ────────────────────────────────────────────────────────

export interface DashboardKPIs {
  totalSignalsToday: number;
  activeSignals: number;
  winRate: number;
  totalPnL: number;
  openExposure: number;
  systemHealth: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  dataFreshness: Date;
  modelLatency: number;
}

export interface SignalCard {
  id: string;
  asset: string;
  timeframe: string;
  side: SignalSide;
  confidence: number;
  entry: number;
  stopLoss: number;
  targets: Array<{ price: number; label: string }>;
  invalidation?: string;
  reasoning: string;
  keyFactors: string[];
  status: SignalStatus;
  riskVerdict?: RiskVerdict;
  votes: Array<{
    modelId: string;
    apiProvider: string;
    role: string;
    side: SignalSide;
    confidence: number;
  }>;
  createdAt: Date;
}

// ─── Candle Type ────────────────────────────────────────────────────────────

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
