import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { redis } from '@/lib/redis';

export interface BinanceKline {
  t: number; // Kline start time
  T: number; // Kline close time
  s: string; // Symbol
  i: string; // Interval
  f: number; // First trade ID
  L: number; // Last trade ID
  o: string; // Open price
  c: string; // Close price
  h: string; // High price
  l: string; // Low price
  v: string; // Base asset volume
  n: number; // Number of trades
  x: boolean; // Is this kline closed?
  q: string; // Quote asset volume
  V: string; // Taker buy base asset volume
  Q: string; // Taker buy quote asset volume
  B: string; // Ignore
}

export interface NormalizedCandle {
  symbol: string;
  timeframe: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export class BinanceWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private symbols: string[];
  private timeframes: string[];
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private isIntentionalClose = false;

  constructor(symbols: string[] = ['btcusdt', 'ethusdt'], timeframes: string[] = ['1h', '4h']) {
    super();
    this.symbols = symbols.map(s => s.toLowerCase());
    this.timeframes = timeframes;
  }

  connect() {
    this.isIntentionalClose = false;
    const streams = this.symbols.flatMap(symbol => 
      this.timeframes.map(timeframe => `${symbol}@kline_${timeframe}`)
    ).join('/');

    const wsUrl = `wss://stream.binance.com:9443/ws/${streams}`;
    
    console.log(`[Binance WS] Connecting to ${wsUrl}...`);
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('[Binance WS] Connected successfully.');
      this.reconnectAttempts = 0;
      this.emit('connected');
    });

    this.ws.on('message', async (data: string) => {
      try {
        const payload = JSON.parse(data);
        if (payload.e === 'kline') {
          const candle = this.normalizeKline(payload.k);
          
          // Cache the latest price and candle state in Redis
          await this.cacheCandle(candle);
          
          // Emit local event for immediate processor usage
          this.emit('candle', candle);

          // If candle closed, emit special event for feature engineering queue
          if (candle.isClosed) {
            this.emit('candle_closed', candle);
          }
        }
      } catch (error) {
        console.error('[Binance WS] Error parsing message:', error);
      }
    });

    this.ws.on('close', () => {
      console.log('[Binance WS] Connection closed.');
      if (!this.isIntentionalClose) {
        this.handleReconnect();
      }
    });

    this.ws.on('error', (error) => {
      console.error('[Binance WS] WebSocket error:', error);
    });
  }

  disconnect() {
    this.isIntentionalClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = Math.pow(2, this.reconnectAttempts) * 1000; // Exponential backoff
      console.log(`[Binance WS] Reconnecting in ${delay}ms...`);
      setTimeout(() => {
        this.reconnectAttempts++;
        this.connect();
      }, delay);
    } else {
      console.error('[Binance WS] Max reconnect attempts reached. Failing permanently.');
      this.emit('disconnected');
    }
  }

  private normalizeKline(k: BinanceKline): NormalizedCandle {
    return {
      symbol: k.s.toUpperCase(),
      timeframe: k.i,
      timestamp: k.t,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      isClosed: k.x,
    };
  }

  private async cacheCandle(candle: NormalizedCandle) {
    const key = `market:${candle.symbol}:${candle.timeframe}:latest`;
    
    // Store latest state of the current candle
    await redis.set(key, JSON.stringify(candle));

    // Also update a quick-access ticker key for the dashboard
    if (candle.timeframe === '1h') { // Just use 1h for dashboard ticker updates
      await redis.hset('market:ticker', {
        [candle.symbol]: candle.close.toString()
      });
    }
  }
}

// Singleton instance export
export const binanceWS = new BinanceWebSocketClient();
