import { z } from 'zod';

// ─── Signal Schemas ─────────────────────────────────────────────────────────

export const SignalSideEnum = z.enum(['LONG', 'SHORT', 'HOLD']);
export type SignalSide = z.infer<typeof SignalSideEnum>;

export const SignalStatusEnum = z.enum(['PENDING', 'APPROVED', 'BLOCKED', 'EXPIRED', 'INVALIDATED']);
export type SignalStatus = z.infer<typeof SignalStatusEnum>;

// ─── Market Type ─────────────────────────────────────────────────────────────

export const MarketTypeEnum = z.enum(['CRYPTO', 'FOREX']);
export type MarketType = z.infer<typeof MarketTypeEnum>;

// ─── Forex Order Types ────────────────────────────────────────────────────────

export const ForexOrderTypeEnum = z.enum(['BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP']);
export type ForexOrderType = z.infer<typeof ForexOrderTypeEnum>;

/** Default forex symbols to scan */
export const FOREX_DEFAULT_SYMBOLS = [
  'XAU/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF',
  'AUD/USD', 'NZD/USD', 'USD/CAD', 'EUR/JPY', 'GBP/JPY',
];

export const TargetSchema = z.object({
  price: z.number().positive(),
  label: z.string(),
});

export const AISignalResponseSchema = z.object({
  side: SignalSideEnum,
  winProbability: z.number().min(0).max(1),
  entry: z.number().nonnegative(),
  stopLoss: z.number().nonnegative(),
  targets: z.array(TargetSchema).max(5),
  invalidation: z.string().optional(),
  reasoning: z.string().min(10),
  keyFactors: z.array(z.string()).min(0).max(10),
});
export type AISignalResponse = z.infer<typeof AISignalResponseSchema>;

/** Extended AI response for Forex signals — adds order type + allows price=0 for open targets */
export const ForexTargetSchema = z.object({
  price: z.number().min(0), // 0 = "open" / indefinite target (shown as "open" in Telegram)
  label: z.string(),
});

export const ForexAISignalResponseSchema = AISignalResponseSchema.extend({
  forexOrderType: ForexOrderTypeEnum,
  targets: z.array(ForexTargetSchema).max(5), // Override: allow price=0
});
export type ForexAISignalResponse = z.infer<typeof ForexAISignalResponseSchema>;

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
    fundingRate: z.number().optional(),
    openInterest: z.number().optional(),
  }),
  vp: z.object({
    poc: z.number(),
    vah: z.number(),
    val: z.number(),
  }).nullable().optional(),
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
  winProbability: number;
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
    winProbability: number;
  }>;
  createdAt: Date;
  /** CRYPTO or FOREX — defaults to CRYPTO for legacy signals */
  marketType?: MarketType;
  /** Forex-only: the pending order type used for the Telegram format */
  forexOrderType?: ForexOrderType;
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
