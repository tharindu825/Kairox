import { redis } from '@/lib/redis';
import { forexSignalQueue } from '@/workers/queues';
import { selectBestForexCandidate } from './forex-auto-selector';
import { toTwelveSymbol } from '@/services/market-data/twelve-data';

function getIntervalMs(): number {
  // Default: 4 hours (same as crypto). Configurable via env.
  const parsed = Number(process.env.AUTO_FOREX_SIGNAL_INTERVAL_SECONDS || 14400);
  if (!Number.isFinite(parsed) || parsed <= 0) return 14_400_000;
  return parsed * 1000;
}

/**
 * Starts the recurring forex signal auto-generation loop.
 * Mirrors startAutoSignalGeneration() for crypto.
 * Returns a stop function — call it on SIGINT to clear the timer.
 */
export function startAutoForexSignalGeneration(): () => void {
  const enabled = String(process.env.AUTO_FOREX_SIGNAL_ENABLED || 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[Forex Auto Signals] Disabled (AUTO_FOREX_SIGNAL_ENABLED=false).');
    return () => {};
  }

  const timeframe  = process.env.AUTO_FOREX_SIGNAL_TIMEFRAME || '4h';
  const intervalMs = getIntervalMs();
  let running      = false;

  const run = async () => {
    if (running) return;
    running = true;

    try {
      console.log(`[Forex Auto Signals] Starting cycle | timeframe=${timeframe}`);

      // Select top 3 forex pairs with the best signal setups
      const candidates = await selectBestForexCandidate({ timeframe, sideFilter: 'ALL' }, 3);

      if (candidates.length === 0) {
        console.log('[Forex Auto Signals] No forex candidates passed filters in this cycle.');
      } else {
        for (const { symbol, candle, inferredSide, score } of candidates) {
          const displaySymbol = toTwelveSymbol(symbol); // e.g. "XAU/USD"
          await redis.set(`market:${symbol}:${timeframe}:latest`, JSON.stringify(candle));
          await forexSignalQueue.add('generate-forex-signal', { candle, displaySymbol });
          console.log(
            `[Forex Auto Signals] Queued ${displaySymbol} (${timeframe}) | side=${inferredSide} | score=${score.toFixed(4)}`
          );
        }
      }
    } catch (error) {
      console.error('[Forex Auto Signals] Cycle failed:', error);
    } finally {
      running = false;
    }
  };

  console.log(
    `[Forex Auto Signals] Enabled | interval=${Math.round(intervalMs / 1000)}s (${Math.round(intervalMs / 3_600_000)}h) | timeframe=${timeframe}`
  );

  // Run immediately on startup, then on interval
  void run();
  const timer = setInterval(() => { void run(); }, intervalMs);

  return () => { clearInterval(timer); };
}
