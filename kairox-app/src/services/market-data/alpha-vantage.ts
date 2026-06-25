import type { NormalizedCandle } from './binance';

// ── Symbol helpers ─────────────────────────────────────────────────────────────

/**
 * Convert internal symbol key (e.g. "XAUUSD") to Alpha Vantage
 * from_currency / to_currency pair.
 */
function toAlphaVantageSymbol(symbol: string): { from: string; to: string } {
  const known: Record<string, { from: string; to: string }> = {
    XAUUSD: { from: 'XAU', to: 'USD' },
    XAGUSD: { from: 'XAG', to: 'USD' },
    EURUSD: { from: 'EUR', to: 'USD' },
    GBPUSD: { from: 'GBP', to: 'USD' },
    USDJPY: { from: 'USD', to: 'JPY' },
    USDCHF: { from: 'USD', to: 'CHF' },
    AUDUSD: { from: 'AUD', to: 'USD' },
    NZDUSD: { from: 'NZD', to: 'USD' },
    USDCAD: { from: 'USD', to: 'CAD' },
    EURJPY: { from: 'EUR', to: 'JPY' },
    GBPJPY: { from: 'GBP', to: 'JPY' },
    EURAUD: { from: 'EUR', to: 'AUD' },
    EURGBP: { from: 'EUR', to: 'GBP' },
    GBPAUD: { from: 'GBP', to: 'AUD' },
    GBPCHF: { from: 'GBP', to: 'CHF' },
    EURCAD: { from: 'EUR', to: 'CAD' },
    AUDCAD: { from: 'AUD', to: 'CAD' },
    AUDCHF: { from: 'AUD', to: 'CHF' },
    AUDNZD: { from: 'AUD', to: 'NZD' },
    NZDCAD: { from: 'NZD', to: 'CAD' },
  };
  if (known[symbol]) return known[symbol];
  // Generic fallback — split at 3 chars
  if (symbol.length === 6) {
    return { from: symbol.slice(0, 3), to: symbol.slice(3) };
  }
  return { from: symbol, to: 'USD' };
}

/**
 * Maps Kairox timeframe codes to Alpha Vantage FX_INTRADAY intervals
 * or FX_DAILY / FX_WEEKLY / FX_MONTHLY.
 */
function toAlphaVantageParams(timeframe: string): {
  function: string;
  interval?: string;
  outputsize: string;
} {
  switch (timeframe) {
    case '1m':
      return { function: 'FX_INTRADAY', interval: '1min',  outputsize: 'full' };
    case '5m':
      return { function: 'FX_INTRADAY', interval: '5min',  outputsize: 'full' };
    case '15m':
      return { function: 'FX_INTRADAY', interval: '15min', outputsize: 'full' };
    case '30m':
      return { function: 'FX_INTRADAY', interval: '30min', outputsize: 'full' };
    case '1h':
      return { function: 'FX_INTRADAY', interval: '60min', outputsize: 'full' };
    case '4h':
      // Alpha Vantage has no native 4h — use 60min and resample
      return { function: 'FX_INTRADAY', interval: '60min', outputsize: 'full' };
    case '1d':
    case 'D1':
      return { function: 'FX_DAILY',    outputsize: 'full' };
    case '1w':
      return { function: 'FX_WEEKLY',   outputsize: 'full' };
    case '1M':
      return { function: 'FX_MONTHLY',  outputsize: 'full' };
    default:
      return { function: 'FX_INTRADAY', interval: '60min', outputsize: 'full' };
  }
}

/**
 * Resample 1h candles into 4h OHLCV candles.
 * Groups by flooring timestamp to the nearest 4-hour boundary.
 */
function resampleTo4h(candles: NormalizedCandle[]): NormalizedCandle[] {
  const groups = new Map<number, NormalizedCandle[]>();

  for (const c of candles) {
    const boundary = Math.floor(c.timestamp / (4 * 3600 * 1000)) * (4 * 3600 * 1000);
    const group = groups.get(boundary) || [];
    group.push(c);
    groups.set(boundary, group);
  }

  const result: NormalizedCandle[] = [];
  for (const [ts, group] of Array.from(groups.entries()).sort((a, b) => a[0] - b[0])) {
    if (group.length === 0) continue;
    result.push({
      symbol:    group[0].symbol,
      timeframe: '4h',
      timestamp: ts,
      open:      group[0].open,
      high:      Math.max(...group.map(c => c.high)),
      low:       Math.min(...group.map(c => c.low)),
      close:     group[group.length - 1].close,
      volume:    group.reduce((s, c) => s + c.volume, 0),
      isClosed:  true,
    });
  }
  return result;
}

// ── Service ────────────────────────────────────────────────────────────────────

export class AlphaVantageService {
  private baseUrl = 'https://www.alphavantage.co/query';
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.ALPHA_VANTAGE_API_KEY || 'demo';
  }

  get isConfigured(): boolean {
    return !!this.apiKey && this.apiKey !== 'demo' && this.apiKey !== 'your_alphavantage_api_key_here';
  }

  /**
   * Fetches OHLCV candles for a forex pair from Alpha Vantage.
   * Returns NormalizedCandle[] compatible with the existing indicator service.
   *
   * @param symbol  Internal key e.g. "XAUUSD"
   * @param timeframe  Kairox timeframe code e.g. "4h"
   * @param limit  Max candles to return (newest last)
   */
  async getKlines(symbol: string, timeframe: string, limit = 250): Promise<NormalizedCandle[]> {
    const { from, to } = toAlphaVantageSymbol(symbol);
    const avParams     = toAlphaVantageParams(timeframe);

    // Build query params
    const params = new URLSearchParams({
      function:   avParams.function,
      from_symbol: from,
      to_symbol:   to,
      outputsize:  avParams.outputsize,
      datatype:    'json',
      apikey:      this.apiKey,
    });

    if (avParams.interval) {
      params.set('interval', avParams.interval);
    }

    // FX_DAILY / FX_WEEKLY / FX_MONTHLY use different param names
    if (avParams.function !== 'FX_INTRADAY') {
      params.delete('from_symbol');
      params.delete('to_symbol');
      params.set('from_symbol', from);
      params.set('to_symbol',   to);
    }

    try {
      const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
        cache: 'no-store',
        headers: { 'User-Agent': 'Kairox/1.0' },
      });

      if (!response.ok) {
        throw new Error(`Alpha Vantage HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();

      // Check for API error / note messages
      if (json['Note']) {
        console.warn(`[AlphaVantage] Rate limit note: ${json['Note']}`);
      }
      if (json['Information']) {
        throw new Error(`Alpha Vantage API: ${json['Information']}`);
      }

      // Locate the time series key dynamically
      const timeSeriesKey = Object.keys(json).find(k =>
        k.toLowerCase().includes('time series') || k.toLowerCase().includes('forex')
      );

      if (!timeSeriesKey || !json[timeSeriesKey]) {
        console.error('[AlphaVantage] Response:', JSON.stringify(json).slice(0, 300));
        throw new Error(`Alpha Vantage: no time series data found for ${symbol} (${timeframe})`);
      }

      const series: Record<string, Record<string, string>> = json[timeSeriesKey];

      // Convert to NormalizedCandle[] (Alpha Vantage is newest-first)
      let candles: NormalizedCandle[] = Object.entries(series)
        .map(([dateStr, bar]) => ({
          symbol,
          timeframe,
          timestamp: new Date(dateStr).getTime(),
          open:      parseFloat(bar['1. open']),
          high:      parseFloat(bar['2. high']),
          low:       parseFloat(bar['3. low']),
          close:     parseFloat(bar['4. close']),
          volume:    0, // AV forex has no volume — use 0
          isClosed:  true,
        }))
        .filter(c => !isNaN(c.timestamp) && c.close > 0)
        .sort((a, b) => a.timestamp - b.timestamp); // chronological order

      // Resample 1h → 4h if needed
      if (timeframe === '4h') {
        candles = resampleTo4h(candles);
      }

      // Return newest `limit` candles
      return candles.slice(-limit);

    } catch (error) {
      console.error(`[AlphaVantage] Failed to fetch ${symbol} (${timeframe}):`, error);
      return [];
    }
  }

  /**
   * Returns the current exchange rate for a forex pair.
   */
  async getPrice(symbol: string): Promise<number | null> {
    const { from, to } = toAlphaVantageSymbol(symbol);
    const params = new URLSearchParams({
      function:    'CURRENCY_EXCHANGE_RATE',
      from_currency: from,
      to_currency:   to,
      apikey:        this.apiKey,
    });

    try {
      const response = await fetch(`${this.baseUrl}?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) return null;
      const json = await response.json();
      const rate = json?.['Realtime Currency Exchange Rate']?.['5. Exchange Rate'];
      return rate ? parseFloat(rate) : null;
    } catch {
      return null;
    }
  }
}

export const alphaVantageService = new AlphaVantageService();
