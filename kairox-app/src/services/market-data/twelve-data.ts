import { NormalizedCandle } from './binance';

/**
 * Converts a Twelve Data symbol (e.g. "XAU/USD") to a clean key (e.g. "XAUUSD")
 * used as the internal symbol throughout the system.
 */
export function normalizeTwelveSymbol(symbol: string): string {
  return symbol.replace('/', '').toUpperCase();
}

/**
 * Converts an internal symbol key (e.g. "XAUUSD") back to a Twelve Data
 * API-compatible symbol (e.g. "XAU/USD").
 */
export function toTwelveSymbol(symbol: string): string {
  // Common 3+3 forex pairs
  const known: Record<string, string> = {
    XAUUSD: 'XAU/USD', EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD',
    USDJPY: 'USD/JPY', USDCHF: 'USD/CHF', AUDUSD: 'AUD/USD',
    NZDUSD: 'NZD/USD', USDCAD: 'USD/CAD', EURJPY: 'EUR/JPY',
    GBPJPY: 'GBP/JPY', XAGUSD: 'XAG/USD', EURAUD: 'EUR/AUD',
    EURGBP: 'EUR/GBP', GBPAUD: 'GBP/AUD', GBPCHF: 'GBP/CHF',
    EURCAD: 'EUR/CAD', AUDCAD: 'AUD/CAD', AUDCHF: 'AUD/CHF',
    AUDNZD: 'AUD/NZD', NZDCAD: 'NZD/CAD',
  };
  if (known[symbol]) return known[symbol];
  // Generic fallback — insert slash after 3 chars
  if (symbol.length === 6) return `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
  return symbol;
}

/**
 * Maps Kairox timeframe codes to Twelve Data interval codes.
 */
function toTwelveInterval(timeframe: string): string {
  const map: Record<string, string> = {
    '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min',
    '1h': '1h', '4h': '4h', '1d': '1day', 'D1': '1day',
    '1w': '1week', '1M': '1month',
  };
  return map[timeframe] || timeframe;
}

export class TwelveDataService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.TWELVE_DATA_BASE_URL || 'https://api.twelvedata.com';
    this.apiKey  = process.env.TWELVE_DATA_API_KEY  || '';
  }

  /**
   * Fetches historical OHLCV candles from Twelve Data for a forex pair.
   *
   * @param symbol  Internal symbol key e.g. "XAUUSD"
   * @param timeframe  Kairox timeframe string e.g. "4h"
   * @param limit  Number of candles (max 5000 on Twelve Data)
   */
  async getKlines(symbol: string, timeframe: string, limit: number = 250): Promise<NormalizedCandle[]> {
    const tdSymbol   = toTwelveSymbol(symbol);
    const tdInterval = toTwelveInterval(timeframe);

    const params = new URLSearchParams({
      symbol:     tdSymbol,
      interval:   tdInterval,
      outputsize: String(limit),
      format:     'JSON',
    });

    if (this.apiKey && this.apiKey !== 'your_twelvedata_api_key_here') {
      params.set('apikey', this.apiKey);
    }

    const url = `${this.baseUrl}/time_series?${params.toString()}`;

    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Twelve Data API HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();

      if (json.status === 'error' || !json.values || !Array.isArray(json.values)) {
        throw new Error(`Twelve Data API error: ${json.message || JSON.stringify(json)}`);
      }

      // Twelve Data returns newest-first; reverse for chronological order
      const values: Array<{
        datetime: string;
        open: string;
        high: string;
        low: string;
        close: string;
        volume?: string;
      }> = [...json.values].reverse();

      return values.map(v => ({
        symbol,           // Internal key (e.g. "XAUUSD")
        timeframe,
        timestamp: new Date(v.datetime).getTime(),
        open:   parseFloat(v.open),
        high:   parseFloat(v.high),
        low:    parseFloat(v.low),
        close:  parseFloat(v.close),
        volume: parseFloat(v.volume || '0'),
        isClosed: true,
      }));
    } catch (error) {
      console.error(`[TwelveData] Failed to fetch klines for ${symbol} (${tdSymbol}):`, error);
      return [];
    }
  }

  /**
   * Returns the latest price for a forex pair.
   */
  async getPrice(symbol: string): Promise<number | null> {
    const tdSymbol = toTwelveSymbol(symbol);
    const params = new URLSearchParams({ symbol: tdSymbol, format: 'JSON' });
    if (this.apiKey && this.apiKey !== 'your_twelvedata_api_key_here') {
      params.set('apikey', this.apiKey);
    }

    try {
      const response = await fetch(`${this.baseUrl}/price?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) return null;
      const json = await response.json();
      return json.price ? parseFloat(json.price) : null;
    } catch {
      return null;
    }
  }
}

export const twelveDataService = new TwelveDataService();
