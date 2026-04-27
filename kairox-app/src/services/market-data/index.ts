import { db } from '@/lib/db';
import { redis } from '@/lib/redis';
import { binanceWS, NormalizedCandle } from './binance';
import { signalQueue } from '@/workers/queues';
import { paperTradingService } from '../paper-trading';

export class MarketDataService {
  /**
   * Starts the Binance WebSocket stream and binds listeners
   * to automatically persist closed candles to the database.
   */
  async startStream() {
    binanceWS.connect();

    // Live tick processing for paper trading
    binanceWS.on('candle', async (candle: NormalizedCandle) => {
      // Throttle this in production, but for now process every tick
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

  /**
   * Persist a closed candle into PostgreSQL MarketSnapshot structure.
   */
  private async persistCandle(candle: NormalizedCandle) {
    // In production, we'd batch these or queue them.
    
    // First, ensure the asset exists in the DB
    const asset = await db.asset.upsert({
      where: { symbol: candle.symbol },
      create: { 
        symbol: candle.symbol, 
        name: candle.symbol.replace('USDT', ''), 
        category: 'CRYPTO' 
      },
      update: {}
    });

    // Save the snapshot (assuming 'candles' stores an array for backwards lookups, 
    // but for now we store the single latest candle in the array for simplicity)
    await db.marketSnapshot.create({
      data: {
        assetId: asset.id,
        timeframe: candle.timeframe,
        candles: [candle] as any, 
        indicators: {}, // Will be updated by Indicator Pipeline
      }
    });
  }

  /**
   * Fetches the latest known price from Redis cache
   */
  async getLatestPrice(symbol: string): Promise<number | null> {
    const priceStr = await redis.hget('market:ticker', symbol);
    return priceStr ? parseFloat(priceStr) : null;
  }
}

export const marketDataService = new MarketDataService();
