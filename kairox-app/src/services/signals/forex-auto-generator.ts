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
 * Checks if the forex market is currently open.
 *
 * Forex trading hours (approximate):
 *   Open:  Sunday  ~22:00 UTC (Sydney session opens)
 *   Close: Friday  ~22:00 UTC (New York session closes)
 *
 * We use a small buffer:
 *   - Skip from Saturday 00:00 UTC through Sunday 21:00 UTC
 *   - This avoids generating signals on stale weekend data
 *   - Also skips the thin-liquidity window just after Sunday open
 */
export function isForexMarketOpen(): boolean {
  const now = new Date();
  const dayUTC = now.getUTCDay();    // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const hourUTC = now.getUTCHours();

  // Saturday: always closed
  if (dayUTC === 6) return false;

  // Sunday: closed until 21:00 UTC (market reopens ~22:00 UTC, we allow 21:00 for pre-open)
  if (dayUTC === 0 && hourUTC < 21) return false;

  // Friday after 22:00 UTC: closing — skip to avoid stale fills
  if (dayUTC === 5 && hourUTC >= 22) return false;

  return true;
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
      // Skip when forex market is closed (weekends)
      if (!isForexMarketOpen()) {
        console.log('[Forex Auto Signals] Market closed (weekend) — skipping cycle.');
        return;
      }

      console.log(`[Forex Auto Signals] Starting cycle | timeframe=${timeframe}`);

      // Select top 3 forex pairs with the best signal setups
      const candidates = await selectBestForexCandidate({ timeframe, sideFilter: 'ALL' }, 3);

      if (candidates.length === 0) {
        console.log('[Forex Auto Signals] No forex candidates passed filters in this cycle.');
      } else {
        for (const { symbol, candle, inferredSide, score } of candidates) {
          const displaySymbol = toTwelveSymbol(symbol); // e.g. "XAU/USD"
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

