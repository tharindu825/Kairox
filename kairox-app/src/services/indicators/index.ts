import { RSI, MACD, EMA, ATR, BollingerBands } from 'trading-signals';
import { NormalizedCandle } from '../market-data/binance';
import { SmartMoneyService, type SMCAnalysis } from './smc-service';
import { ElliottWaveService, type ElliottWaveAnalysis } from './elliott-wave-service';

// ─── Feature Bundle ─────────────────────────────────────────────────────────────

export interface FeatureBundle {
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  ema20: number;
  ema50: number;
  ema200: number;
  atr: number;
  bb: { lower: number; middle: number; upper: number };
  volumeProfile: string;
  trend: 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';
  closePrice: number;

  // ── New: Accuracy Improvements ──────────────────────────────────────────────
  /** Average Directional Index — 0-100 trend strength (>25 = trending) */
  adx: number;
  /** Stochastic RSI — %K and %D oscillator (0-100) */
  stochRsi: { k: number; d: number };
  /** Volatility regime based on ATR percentile vs 50-period average */
  volatilityRegime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  /** Last 10 candles OHLCV for price action context */
  recentCandles: Array<{ o: number; h: number; l: number; c: number; v: number }>;

  // ── New: Smart Money Concepts ───────────────────────────────────────────────
  smc: SMCAnalysis | null;

  // ── New: Elliott Wave ───────────────────────────────────────────────────────
  elliottWave: ElliottWaveAnalysis | null;
}

// ─── Internal State ─────────────────────────────────────────────────────────────

interface SymbolState {
  rsi: RSI;
  macd: MACD;
  ema20: EMA;
  ema50: EMA;
  ema200: EMA;
  atr: ATR;
  bb: BollingerBands;
  volumeBuffer: number[];

  // ── New: ADX tracking ────────────────────────────────────────────────────────
  /** Rolling candle buffer for manual ADX/StochRSI computation */
  candleBuffer: NormalizedCandle[];
  /** Rolling RSI values for Stochastic RSI */
  rsiBuffer: number[];
  /** Rolling ATR values for volatility regime */
  atrBuffer: number[];
}

const VOLUME_LOOKBACK = 20;
const CANDLE_BUFFER_SIZE = 60; // Enough for ADX(14) + ATR history + StochRSI
const ADX_PERIOD = 14;
const STOCH_RSI_PERIOD = 14;
const STOCH_RSI_K_SMOOTH = 3;
const STOCH_RSI_D_SMOOTH = 3;
const ATR_HISTORY_SIZE = 50; // For volatility regime percentile

// ─── Service ────────────────────────────────────────────────────────────────────

export class IndicatorService {
  private states: Map<string, SymbolState> = new Map();
  private smcService = new SmartMoneyService();
  private ewService = new ElliottWaveService();

  private getOrCreateState(symbol: string, timeframe: string): SymbolState {
    const key = `${symbol.toUpperCase()}_${timeframe}`;
    let state = this.states.get(key);

    if (!state) {
      state = {
        rsi: new RSI(14),
        macd: new MACD(new EMA(12) as any, new EMA(26) as any, new EMA(9) as any),
        ema20: new EMA(20),
        ema50: new EMA(50),
        ema200: new EMA(200),
        atr: new ATR(14),
        bb: new BollingerBands(20, 2),
        volumeBuffer: [],
        candleBuffer: [],
        rsiBuffer: [],
        atrBuffer: [],
      };
      this.states.set(key, state);
    }
    return state;
  }

  /**
   * Initializes the indicators with historical candles.
   */
  initialize(symbol: string, timeframe: string, historicalCandles: NormalizedCandle[]) {
    console.log(`[Indicator Service] Initializing ${symbol} (${timeframe}) with ${historicalCandles.length} candles.`);
    for (const candle of historicalCandles) {
      this.update(candle);
    }
  }

  /**
   * Updates all indicators with a new closed candle.
   */
  update(candle: NormalizedCandle) {
    const state = this.getOrCreateState(candle.symbol, candle.timeframe);
    
    state.rsi.update(candle.close, false);
    state.macd.update(candle.close, false);
    state.ema20.update(candle.close, false);
    state.ema50.update(candle.close, false);
    state.ema200.update(candle.close, false);
    
    // ATR requires High, Low, Close
    state.atr.update({ high: candle.high, low: candle.low, close: candle.close }, false);
    state.bb.update(candle.close, false);

    // Track rolling volume buffer for volume profile analysis
    state.volumeBuffer.push(candle.volume);
    if (state.volumeBuffer.length > VOLUME_LOOKBACK) {
      state.volumeBuffer.shift();
    }

    // Track candle buffer for ADX / StochRSI
    state.candleBuffer.push(candle);
    if (state.candleBuffer.length > CANDLE_BUFFER_SIZE) {
      state.candleBuffer.shift();
    }

    // Track RSI values for StochRSI
    if (state.rsi.isStable) {
      const rsiVal = Number(state.rsi.getResult()?.valueOf() ?? 50);
      state.rsiBuffer.push(rsiVal);
      if (state.rsiBuffer.length > STOCH_RSI_PERIOD + STOCH_RSI_K_SMOOTH + STOCH_RSI_D_SMOOTH) {
        state.rsiBuffer.shift();
      }
    }

    // Track ATR values for volatility regime
    if (state.atr.isStable) {
      const atrVal = Number(state.atr.getResult()?.valueOf() ?? 0);
      state.atrBuffer.push(atrVal);
      if (state.atrBuffer.length > ATR_HISTORY_SIZE) {
        state.atrBuffer.shift();
      }
    }
  }

  /**
   * Extracts the current indicator states into a structured bundle for the AI.
   * This is the ORIGINAL method — preserved for backward compatibility.
   */
  getFeatureBundle(currentCandle: NormalizedCandle): FeatureBundle {
    return this.getEnhancedFeatureBundle([currentCandle]);
  }

  /**
   * Enhanced feature bundle that includes SMC, Elliott Wave, ADX, StochRSI,
   * volatility regime, and recent candle history.
   *
   * @param candles Full candle history (ideally 200+). The last candle is treated as "current".
   */
  getEnhancedFeatureBundle(candles: NormalizedCandle[]): FeatureBundle {
    const currentCandle = candles[candles.length - 1];
    const state = this.getOrCreateState(currentCandle.symbol, currentCandle.timeframe);
    
    // ── Existing indicators ─────────────────────────────────────────────────
    const rsiVal = state.rsi.isStable ? state.rsi.getResult()?.valueOf() : 50;
    
    let macdVal = { macd: 0, signal: 0, histogram: 0 };
    if (state.macd.isStable) {
      const result = state.macd.getResult() as any;
      if (result) {
        macdVal = {
          macd: result.macd?.valueOf() || 0,
          signal: result.signal?.valueOf() || 0,
          histogram: result.histogram?.valueOf() || 0,
        };
      }
    }

    const ema20Val = state.ema20.isStable ? state.ema20.getResult()?.valueOf() : currentCandle.close;
    const ema50Val = state.ema50.isStable ? state.ema50.getResult()?.valueOf() : currentCandle.close;
    const ema200Val = state.ema200.isStable ? state.ema200.getResult()?.valueOf() : currentCandle.close;
    const atrVal = state.atr.isStable ? state.atr.getResult()?.valueOf() : 0;
    
    let bbVal = { lower: 0, middle: 0, upper: 0 };
    if (state.bb.isStable) {
      const result = state.bb.getResult() as any;
      if (result) {
        bbVal = {
          lower: result.lower?.valueOf() || 0,
          middle: result.middle?.valueOf() || 0,
          upper: result.upper?.valueOf() || 0,
        };
      }
    }

    // ── New: ADX ────────────────────────────────────────────────────────────
    const adx = this.calculateADX(state.candleBuffer);

    // ── New: Stochastic RSI ─────────────────────────────────────────────────
    const stochRsi = this.calculateStochRSI(state.rsiBuffer);

    // ── New: Volatility Regime ──────────────────────────────────────────────
    const volatilityRegime = this.classifyVolatilityRegime(state.atrBuffer);

    // ── New: Recent Candles ─────────────────────────────────────────────────
    const recentCandles = candles.slice(-10).map(c => ({
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume,
    }));

    // ── New: Smart Money Concepts ───────────────────────────────────────────
    let smc: SMCAnalysis | null = null;
    try {
      const candlesForSMC = candles.length >= 30 ? candles : state.candleBuffer;
      smc = this.smcService.analyze(candlesForSMC);
    } catch (err) {
      console.warn('[Indicator Service] SMC analysis failed:', (err as Error).message);
    }

    // ── New: Elliott Wave ───────────────────────────────────────────────────
    let elliottWave: ElliottWaveAnalysis | null = null;
    try {
      if (smc && smc.swingPoints.length >= 4) {
        elliottWave = this.ewService.analyze(smc.swingPoints, currentCandle.close);
      }
    } catch (err) {
      console.warn('[Indicator Service] Elliott Wave analysis failed:', (err as Error).message);
    }

    return {
      rsi: Number(rsiVal || 50),
      macd: macdVal,
      ema20: Number(ema20Val || currentCandle.close),
      ema50: Number(ema50Val || currentCandle.close),
      ema200: Number(ema200Val || currentCandle.close),
      atr: Number(atrVal || 0),
      bb: bbVal,
      volumeProfile: this.analyzeVolume(currentCandle),
      trend: this.calculateTrend(currentCandle.close, Number(ema20Val), Number(ema50Val), Number(ema200Val)),
      closePrice: currentCandle.close,
      adx,
      stochRsi,
      volatilityRegime,
      recentCandles,
      smc,
      elliottWave,
    };
  }

  // ── ADX Calculation (Manual) ──────────────────────────────────────────────

  /**
   * Average Directional Index — measures trend strength (0-100).
   * >25 = trending, >50 = strong trend, <20 = ranging.
   * Computed from +DI/-DI using candle high/low/close data.
   */
  private calculateADX(candles: NormalizedCandle[]): number {
    if (candles.length < ADX_PERIOD + 1) return 0;

    const plusDMs: number[] = [];
    const minusDMs: number[] = [];
    const trs: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevHigh = candles[i - 1].high;
      const prevLow = candles[i - 1].low;
      const prevClose = candles[i - 1].close;

      // Directional Movement
      const upMove = high - prevHigh;
      const downMove = prevLow - low;

      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);

      // True Range
      trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }

    if (plusDMs.length < ADX_PERIOD) return 0;

    // Smoothed averages using Wilder's method
    let smoothedPlusDM = plusDMs.slice(0, ADX_PERIOD).reduce((a, b) => a + b, 0);
    let smoothedMinusDM = minusDMs.slice(0, ADX_PERIOD).reduce((a, b) => a + b, 0);
    let smoothedTR = trs.slice(0, ADX_PERIOD).reduce((a, b) => a + b, 0);

    const dxValues: number[] = [];

    for (let i = ADX_PERIOD; i < plusDMs.length; i++) {
      smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / ADX_PERIOD) + plusDMs[i];
      smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / ADX_PERIOD) + minusDMs[i];
      smoothedTR = smoothedTR - (smoothedTR / ADX_PERIOD) + trs[i];

      const plusDI = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
      const minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;
      const diSum = plusDI + minusDI;
      const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
      dxValues.push(dx);
    }

    if (dxValues.length < ADX_PERIOD) {
      return dxValues.length > 0 ? dxValues[dxValues.length - 1] : 0;
    }

    // Smooth DX values to get ADX (Wilder's smoothing)
    let adx = dxValues.slice(0, ADX_PERIOD).reduce((a, b) => a + b, 0) / ADX_PERIOD;
    for (let i = ADX_PERIOD; i < dxValues.length; i++) {
      adx = ((adx * (ADX_PERIOD - 1)) + dxValues[i]) / ADX_PERIOD;
    }

    return Math.round(adx * 100) / 100;
  }

  // ── Stochastic RSI Calculation ────────────────────────────────────────────

  /**
   * Stochastic RSI — applies Stochastic formula to RSI values.
   * Returns %K (fast line) and %D (signal line), both 0-100.
   */
  private calculateStochRSI(rsiBuffer: number[]): { k: number; d: number } {
    const minRequired = STOCH_RSI_PERIOD + STOCH_RSI_K_SMOOTH + STOCH_RSI_D_SMOOTH;
    if (rsiBuffer.length < minRequired) return { k: 50, d: 50 };

    // Calculate raw Stochastic RSI values
    const rawStochRsi: number[] = [];

    for (let i = STOCH_RSI_PERIOD - 1; i < rsiBuffer.length; i++) {
      const window = rsiBuffer.slice(i - STOCH_RSI_PERIOD + 1, i + 1);
      const minRsi = Math.min(...window);
      const maxRsi = Math.max(...window);
      const range = maxRsi - minRsi;

      const stochVal = range > 0
        ? ((rsiBuffer[i] - minRsi) / range) * 100
        : 50;

      rawStochRsi.push(stochVal);
    }

    if (rawStochRsi.length < STOCH_RSI_K_SMOOTH) return { k: 50, d: 50 };

    // %K = SMA of raw StochRSI (smoothing)
    const kValues: number[] = [];
    for (let i = STOCH_RSI_K_SMOOTH - 1; i < rawStochRsi.length; i++) {
      const window = rawStochRsi.slice(i - STOCH_RSI_K_SMOOTH + 1, i + 1);
      kValues.push(window.reduce((a, b) => a + b, 0) / window.length);
    }

    if (kValues.length < STOCH_RSI_D_SMOOTH) return { k: kValues[kValues.length - 1] ?? 50, d: 50 };

    // %D = SMA of %K
    const dWindow = kValues.slice(-STOCH_RSI_D_SMOOTH);
    const d = dWindow.reduce((a, b) => a + b, 0) / dWindow.length;

    return {
      k: Math.round(kValues[kValues.length - 1] * 100) / 100,
      d: Math.round(d * 100) / 100,
    };
  }

  // ── Volatility Regime Classification ──────────────────────────────────────

  /**
   * Classifies current volatility based on ATR percentile vs historical average.
   * LOW (<0.5x avg), NORMAL (0.5-1.5x), HIGH (1.5-3x), EXTREME (>3x)
   */
  private classifyVolatilityRegime(atrBuffer: number[]): 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' {
    if (atrBuffer.length < 10) return 'NORMAL';

    const currentATR = atrBuffer[atrBuffer.length - 1];
    const avgATR = atrBuffer.reduce((a, b) => a + b, 0) / atrBuffer.length;

    if (avgATR <= 0) return 'NORMAL';

    const ratio = currentATR / avgATR;

    if (ratio > 3.0) return 'EXTREME';
    if (ratio > 1.5) return 'HIGH';
    if (ratio < 0.5) return 'LOW';
    return 'NORMAL';
  }

  // ── Existing Methods (preserved) ──────────────────────────────────────────

  private analyzeVolume(candle: NormalizedCandle): string {
    const state = this.getOrCreateState(candle.symbol, candle.timeframe);
    const buf = state.volumeBuffer;

    if (buf.length < 5) return 'NORMAL'; // Not enough data yet

    const avgVolume = buf.reduce((a, b) => a + b, 0) / buf.length;
    if (avgVolume <= 0) return 'LOW';

    const ratio = candle.volume / avgVolume;

    if (ratio > 2.5)  return 'SPIKE';     // Exceptionally high volume
    if (ratio > 1.5)  return 'ELEVATED';  // Above average
    if (ratio < 0.5)  return 'LOW';       // Very low volume
    if (ratio < 0.8)  return 'DECLINING';  // Below average
    return 'NORMAL';
  }

  private calculateTrend(close: number, ema20: number, ema50: number, ema200: number) {
    if (close > ema20 && ema20 > ema50 && ema50 > ema200) return 'STRONG_BULL';
    if (close > ema50 && ema50 > ema200) return 'BULL';
    if (close < ema20 && ema20 < ema50 && ema50 < ema200) return 'STRONG_BEAR';
    if (close < ema50 && ema50 < ema200) return 'BEAR';
    return 'NEUTRAL';
  }
}

export const indicatorService = new IndicatorService();
