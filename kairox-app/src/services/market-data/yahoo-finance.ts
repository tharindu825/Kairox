import type { NormalizedCandle } from './binance';

// ── Ticker mapping ─────────────────────────────────────────────────────────────

/**
 * Maps internal symbol keys to Yahoo Finance tickers.
 *
 * Forex pairs use the "=X" suffix convention.
 * Commodities use futures contracts which closely track spot prices.
 */
const YAHOO_TICKER_MAP: Record<string, string> = {
  XAUUSD: 'GC=F',      // Gold futures (spot proxy)
  XAGUSD: 'SI=F',      // Silver futures
  EURUSD: 'EURUSD=X',
  GBPUSD: 'GBPUSD=X',
  USDJPY: 'USDJPY=X',
  USDCHF: 'USDCHF=X',
  AUDUSD: 'AUDUSD=X',
  NZDUSD: 'NZDUSD=X',
  USDCAD: 'USDCAD=X',
  EURJPY: 'EURJPY=X',
  GBPJPY: 'GBPJPY=X',
  EURGBP: 'EURGBP=X',
  EURAUD: 'EURAUD=X',
  GBPAUD: 'GBPAUD=X',
  GBPCHF: 'GBPCHF=X',
  EURCAD: 'EURCAD=X',
  AUDCAD: 'AUDCAD=X',
  AUDCHF: 'AUDCHF=X',
  AUDNZD: 'AUDNZD=X',
  NZDCAD: 'NZDCAD=X',
};

function toYahooTicker(symbol: string): string {
  if (YAHOO_TICKER_MAP[symbol]) return YAHOO_TICKER_MAP[symbol];
  // Generic fallback for standard 6-char forex pairs
  if (symbol.length === 6) return `${symbol}=X`;
  return symbol;
}

// ── Interval / range helpers ───────────────────────────────────────────────────

interface YahooParams {
  interval: string;
  range:    string;
}

/**
 * Maps Kairox timeframe codes to Yahoo Finance chart API params.
 * For 4h: fetch 60min candles and resample (YF has no native 4h).
 */
function toYahooParams(timeframe: string): YahooParams {
  switch (timeframe) {
    case '1m':  return { interval: '1m',  range: '7d'  };
    case '5m':  return { interval: '5m',  range: '60d' };
    case '15m': return { interval: '15m', range: '60d' };
    case '30m': return { interval: '30m', range: '60d' };
    case '1h':  return { interval: '60m', range: '60d' };
    case '4h':  return { interval: '60m', range: '60d' }; // resample after
    case '1d':
    case 'D1':  return { interval: '1d',  range: '2y'  };
    case '1w':  return { interval: '1wk', range: 'max' };
    case '1M':  return { interval: '1mo', range: 'max' };
    default:    return { interval: '60m', range: '60d' };
  }
}

// ── 4H resampler ──────────────────────────────────────────────────────────────

function resampleTo4h(candles: NormalizedCandle[]): NormalizedCandle[] {
  const groups = new Map<number, NormalizedCandle[]>();

  for (const c of candles) {
    const boundary = Math.floor(c.timestamp / (4 * 3_600_000)) * (4 * 3_600_000);
    const group = groups.get(boundary) || [];
    group.push(c);
    groups.set(boundary, group);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .filter(([, g]) => g.length > 0)
    .map(([ts, g]) => ({
      symbol:    g[0].symbol,
      timeframe: '4h',
      timestamp: ts,
      open:      g[0].open,
      high:      Math.max(...g.map(c => c.high)),
      low:       Math.min(...g.map(c => c.low)),
      close:     g[g.length - 1].close,
      volume:    g.reduce((s, c) => s + c.volume, 0),
      isClosed:  true,
    }));
}

// ── Service ────────────────────────────────────────────────────────────────────

export class YahooFinanceService {
  private readonly BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

  /**
   * Fetches OHLCV candles from Yahoo Finance for any forex pair or commodity.
   * No API key required.
   *
   * @param symbol   Internal key e.g. "XAUUSD" or "EURUSD"
   * @param timeframe Kairox timeframe code e.g. "4h"
   * @param limit    Max candles to return (newest last)
   */
  async getKlines(symbol: string, timeframe: string, limit = 250): Promise<NormalizedCandle[]> {
    const ticker = toYahooTicker(symbol);
    const { interval, range } = toYahooParams(timeframe);

    const url = `${this.BASE}/${ticker}?interval=${interval}&range=${range}&includePrePost=false`;

    try {
      const response = await fetch(url, {
        cache:   'no-store',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Kairox/1.0)',
          'Accept':     'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Yahoo Finance HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();
      const result = json?.chart?.result?.[0];

      if (!result) {
        const error = json?.chart?.error;
        throw new Error(`Yahoo Finance: ${error?.description || 'no data returned'} (${ticker})`);
      }

      const timestamps: number[] = result.timestamp || [];
      const quote = result.indicators?.quote?.[0];

      if (!quote || timestamps.length === 0) {
        throw new Error(`Yahoo Finance: empty quote data for ${ticker}`);
      }

      const opens:   (number | null)[] = quote.open   || [];
      const highs:   (number | null)[] = quote.high   || [];
      const lows:    (number | null)[] = quote.low    || [];
      const closes:  (number | null)[] = quote.close  || [];
      const volumes: (number | null)[] = quote.volume || [];

      // Build candles, skip any bars with null OHLC (YF returns nulls for gaps)
      let candles: NormalizedCandle[] = timestamps
        .map((ts, i): NormalizedCandle | null => {
          const o = opens[i];
          const h = highs[i];
          const l = lows[i];
          const c = closes[i];
          if (o == null || h == null || l == null || c == null) return null;
          if (c === 0 || isNaN(c)) return null;
          return {
            symbol,
            timeframe,
            timestamp: ts * 1000,   // YF returns Unix seconds → ms
            open:      o,
            high:      h,
            low:       l,
            close:     c,
            volume:    volumes[i] ?? 0,
            isClosed:  true,
          };
        })
        .filter((c): c is NormalizedCandle => c !== null);

      // Resample to 4h if needed
      if (timeframe === '4h') {
        candles = resampleTo4h(candles);
      }

      // Return newest `limit` candles
      return candles.slice(-limit);

    } catch (error) {
      console.error(`[YahooFinance] Failed to fetch ${symbol} (${ticker} ${timeframe}):`, error);
      return [];
    }
  }

  /**
   * Returns the latest price for a forex pair or commodity.
   */
  async getPrice(symbol: string): Promise<number | null> {
    const ticker = toYahooTicker(symbol);
    const url = `${this.BASE}/${ticker}?interval=1d&range=1d`;

    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Kairox/1.0)' },
      });
      if (!response.ok) return null;
      const json = await response.json();
      const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
      return typeof price === 'number' ? price : null;
    } catch {
      return null;
    }
  }
}

export const yahooFinanceService = new YahooFinanceService();
