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
      // Periodic cleanup of expired paper trades (8 hour limit)
      try {
        const { paperTradingService } = await import('@/services/paper-trading');
        await paperTradingService.cleanupExpiredOrders();
      } catch (cleanupErr) {
        console.error('[Auto Signals] Failed to run expired paper trade cleanup:', cleanupErr);
      }

      const candidates = await selectBestSignalCandidate({
        timeframe,
        sideFilter,
        assetQuery,
      }, 5); // Generate up to 5 signals per cycle

      if (candidates.length === 0) {
        console.log('[Auto Signals] No candidate passed filters in this cycle.');
      } else {
        for (const candidate of candidates) {
          await redis?.set(`market:${candidate.symbol}:${timeframe}:latest`, JSON.stringify(candidate.candle));
          await signalQueue.add('generate-signal', { candle: candidate.candle });
          console.log(
            `[Auto Signals] Queued ${candidate.symbol} (${timeframe}) | side=${candidate.inferredSide} | score=${candidate.score.toFixed(4)}`
          );
        }
      }

      // Note: Random unconditional signal generation was removed to improve win rate.
      // All signals now go through the indicator-filtered candidate selection pipeline.
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

