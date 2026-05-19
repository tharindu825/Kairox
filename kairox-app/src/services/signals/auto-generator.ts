import { redis } from '@/lib/redis';
import { signalQueue } from '@/workers/queues';
import { selectBestSignalCandidate, fetchRecentCandles, type SideFilter } from './auto-selector';
import { getDb } from '@/lib/mongodb';

function getSideFilter(): SideFilter {
  const configured = String(process.env.AUTO_SIGNAL_SIDE_FILTER || 'ALL').toUpperCase();
  if (configured === 'LONG' || configured === 'SHORT') return configured;
  return 'ALL';
}

function getIntervalMs(): number {
  const parsed = Number(process.env.AUTO_SIGNAL_INTERVAL_SECONDS || 300);
  if (!Number.isFinite(parsed) || parsed <= 0) return 300_000;
  return parsed * 1000;
}

export function startAutoSignalGeneration(): () => void {
  const enabled = String(process.env.AUTO_SIGNAL_ENABLED || 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[Auto Signals] Disabled (AUTO_SIGNAL_ENABLED=false).');
    return () => {};
  }

  const timeframe = process.env.AUTO_SIGNAL_TIMEFRAME || '1h';
  const sideFilter = getSideFilter();
  const assetQuery = process.env.AUTO_SIGNAL_ASSET_QUERY || '';
  const intervalMs = getIntervalMs();
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const candidates = await selectBestSignalCandidate({
        timeframe,
        sideFilter,
        assetQuery,
      }, 5); // Generate up to 5 signals per cycle

      if (candidates.length === 0) {
        console.log('[Auto Signals] No candidate passed filters in this cycle.');
      } else {
        for (const candidate of candidates) {
          await redis.set(`market:${candidate.symbol}:${timeframe}:latest`, JSON.stringify(candidate.candle));
          await signalQueue.add('generate-signal', { candle: candidate.candle });
          console.log(
            `[Auto Signals] Queued ${candidate.symbol} (${timeframe}) | side=${candidate.inferredSide} | score=${candidate.score.toFixed(4)}`
          );
        }
      }

      // ALSO generate one completely random coinpair unconditionally
      try {
        const db = await getDb();
        const assets = await db.collection('assets').find({}).toArray();
        if (assets.length > 0) {
          const randomAsset = assets[Math.floor(Math.random() * assets.length)];
          const symbol = randomAsset.symbol;
          const candles = await fetchRecentCandles(symbol, timeframe, 50);
          if (candles && candles.length > 0) {
            const candle = candles[candles.length - 1];
            await redis.set(`market:${symbol}:${timeframe}:latest`, JSON.stringify(candle));
            await signalQueue.add('generate-signal', { candle });
            console.log(`[Auto Signals] Queued RANDOM unconditional signal for ${symbol} (${timeframe})`);
          }
        }
      } catch (err) {
        console.error('[Auto Signals] Failed to generate random signal:', err);
      }
    } catch (error) {
      console.error('[Auto Signals] Cycle failed:', error);
    } finally {
      running = false;
    }
  };

  console.log(
    `[Auto Signals] Enabled | interval=${Math.round(intervalMs / 1000)}s | timeframe=${timeframe} | side=${sideFilter} | query=${assetQuery || 'ALL'}`
  );

  void run();
  const timer = setInterval(() => {
    void run();
  }, intervalMs);

  return () => {
    clearInterval(timer);
  };
}

