import { NormalizedCandle } from './binance';

export class BinanceRESTService {
  private baseUrl = 'https://api.binance.com';
  private futuresBaseUrl = 'https://fapi.binance.com';

  /**
   * Fetches historical klines from Binance.
   * @param symbol Asset symbol (e.g., BTCUSDT)
   * @param interval Timeframe (e.g., 1h, 4h)
   * @param limit Number of candles (max 1000)
   */
  async getKlines(symbol: string, interval: string, limit: number = 200): Promise<NormalizedCandle[]> {
    const url = `${this.baseUrl}/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Binance API Error: ${response.statusText}`);
      }

      const data = await response.json() as any[][];
      
      return data.map(k => ({
        symbol: symbol.toUpperCase(),
        timeframe: interval,
        timestamp: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        isClosed: true,
      }));
    } catch (error) {
      console.error(`[Binance REST] Failed to fetch klines for ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Fetches the latest ticker price for a symbol.
   */
  async getTicker(symbol: string): Promise<{ symbol: string; price: number }> {
    const url = `${this.baseUrl}/api/v3/ticker/price?symbol=${symbol.toUpperCase()}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Binance API Error: ${response.statusText}`);
    const data = await response.json();
    return {
      symbol: data.symbol,
      price: parseFloat(data.price)
    };
  }

  /**
   * Fetches the current funding rate for a perpetual futures contract.
   */
  async getFundingRate(symbol: string): Promise<number | null> {
    const url = `${this.futuresBaseUrl}/fapi/v1/premiumIndex?symbol=${symbol.toUpperCase()}`;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      return parseFloat(data.lastFundingRate);
    } catch (e) {
      return null;
    }
  }

  /**
   * Fetches current Open Interest for a perpetual futures contract.
   */
  async getOpenInterest(symbol: string): Promise<number | null> {
    const url = `${this.futuresBaseUrl}/fapi/v1/openInterest?symbol=${symbol.toUpperCase()}`;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      return parseFloat(data.openInterest);
    } catch (e) {
      return null;
    }
  }
}

export const binanceREST = new BinanceRESTService();
