import { getDb } from '@/lib/mongodb';
import { redis } from '@/lib/redis';
import { binanceWS, NormalizedCandle } from './binance';
import { signalQueue } from '@/workers/queues';
import { paperTradingService } from '../paper-trading';

export class MarketDataService {
  private lastProcessed: Map<string, number> = new Map();

  /**
   * Starts the Binance WebSocket stream and binds listeners
   * to automatically persist closed candles to the database.
   */
  async startStream() {
    binanceWS.connect();

    // Live tick processing for paper trading
    binanceWS.on('candle', async (candle: NormalizedCandle) => {
      // Throttle: Only process one tick every 15 seconds per symbol
      const now = Date.now();
      const last = this.lastProcessed.get(candle.symbol) || 0;
      if (now - last < 15000) return;
      
      this.lastProcessed.set(candle.symbol, now);

      try {
        await paperTradingService.processLiveTick(candle);
      } catch (error) {
        console.error('[Market Data] Error processing live tick:', error);
      }
    });

    binanceWS.on('candle_closed', async (candle: NormalizedCandle) => {
      console.log(`[Market Data] Candle closed for ${candle.symbol} (${candle.timeframe})`);
      
      try {
        await this.persistCandle(candle);
        // Push an event to BullMQ to trigger feature engineering and AI signal generation
        await signalQueue.add('generate-signal', { candle });
      } catch (error) {
        console.error('[Market Data] Failed to persist candle:', error);
      }
    });
  }

  private async persistCandle(candle: NormalizedCandle) {
    const db = await getDb();
    
    // First, ensure the asset exists in the DB
    await db.collection('assets').updateOne(
      { symbol: candle.symbol },
      {
        $setOnInsert: {
          symbol: candle.symbol,
          name: candle.symbol.replace('USDT', ''),
          category: 'CRYPTO',
          signalsCount: 0,
          createdAt: new Date(),
        }
      },
      { upsert: true }
    );

    // Save the snapshot
    await db.collection('marketSnapshots').insertOne({
      symbol: candle.symbol,
      timeframe: candle.timeframe,
      candles: [candle],
      indicators: {},
      createdAt: new Date(),
    });
  }

  /**
   * Fetches the latest known price from Redis cache, falling back to REST API
   */
  async getLatestPrice(symbol: string): Promise<number | null> {
    try {
      const priceStr = await redis.hget('market:ticker', symbol);
      if (priceStr) return parseFloat(priceStr);

      // Fallback to REST API if not in cache (e.g. symbol not actively streamed)
      const { binanceREST } = await import('./binance-rest');
      const ticker = await binanceREST.getTicker(symbol);
      return ticker.price;
    } catch (error) {
      console.warn(`[Market Data] Failed to get price for ${symbol}:`, (error as Error).message);
      return null;
    }
  }
}

export const marketDataService = new MarketDataService();
