import { RSI, MACD, EMA, ATR, BollingerBands } from 'trading-signals';
import { NormalizedCandle } from '../market-data/binance';

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
}

interface SymbolState {
  rsi: RSI;
  macd: MACD;
  ema20: EMA;
  ema50: EMA;
  ema200: EMA;
  atr: ATR;
  bb: BollingerBands;
}

export class IndicatorService {
  private states: Map<string, SymbolState> = new Map();

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
  }

  /**
   * Extracts the current indicator states into a structured bundle for the AI.
   */
  getFeatureBundle(currentCandle: NormalizedCandle): FeatureBundle {
    const state = this.getOrCreateState(currentCandle.symbol, currentCandle.timeframe);
    
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
    };
  }

  private analyzeVolume(candle: NormalizedCandle): string {
    return 'ELEVATED';
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
