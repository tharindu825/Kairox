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

export class IndicatorService {
  private rsi: RSI;
  private macd: MACD;
  private ema20: EMA;
  private ema50: EMA;
  private ema200: EMA;
  private atr: ATR;
  private bb: BollingerBands;

  constructor() {
    this.rsi = new RSI(14);
    this.macd = new MACD(new EMA(12) as any, new EMA(26) as any, new EMA(9) as any);
    this.ema20 = new EMA(20);
    this.ema50 = new EMA(50);
    this.ema200 = new EMA(200);
    this.atr = new ATR(14);
    this.bb = new BollingerBands(20, 2);
  }

  /**
   * Initializes the indicators with historical candles.
   * Required to build up the necessary data window before generating accurate signals.
   */
  initialize(historicalCandles: NormalizedCandle[]) {
    for (const candle of historicalCandles) {
      this.update(candle);
    }
  }

  /**
   * Updates all indicators with a new closed candle.
   */
  update(candle: NormalizedCandle) {
    this.rsi.update(candle.close, false);
    this.macd.update(candle.close, false);
    this.ema20.update(candle.close, false);
    this.ema50.update(candle.close, false);
    this.ema200.update(candle.close, false);
    
    // ATR requires High, Low, Close
    this.atr.update({ high: candle.high, low: candle.low, close: candle.close }, false);
    
    this.bb.update(candle.close, false);
  }

  /**
   * Extracts the current indicator states into a structured bundle for the AI.
   */
  getFeatureBundle(currentCandle: NormalizedCandle): FeatureBundle {
    const rsiVal = this.rsi.isStable ? this.rsi.getResult()?.valueOf() : 50;
    
    let macdVal = { macd: 0, signal: 0, histogram: 0 };
    if (this.macd.isStable) {
      const result = this.macd.getResult() as any;
      if (result) {
        macdVal = {
          macd: result.macd?.valueOf() || 0,
          signal: result.signal?.valueOf() || 0,
          histogram: result.histogram?.valueOf() || 0,
        };
      }
    }

    const ema20Val = this.ema20.isStable ? this.ema20.getResult()?.valueOf() : currentCandle.close;
    const ema50Val = this.ema50.isStable ? this.ema50.getResult()?.valueOf() : currentCandle.close;
    const ema200Val = this.ema200.isStable ? this.ema200.getResult()?.valueOf() : currentCandle.close;

    const atrVal = this.atr.isStable ? this.atr.getResult()?.valueOf() : 0;
    
    let bbVal = { lower: 0, middle: 0, upper: 0 };
    if (this.bb.isStable) {
      const result = this.bb.getResult() as any;
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
    // In a real system, we compare against a volume moving average
    // For now, this is a placeholder
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
