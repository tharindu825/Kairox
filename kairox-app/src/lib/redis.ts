import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

/**
 * Whether a Redis URL is configured.
 * On Vercel (serverless), Redis is typically unavailable — the app
 * falls back to direct REST API calls for market data.
 */
export const isRedisConfigured = !!(process.env.REDIS_URL && process.env.REDIS_URL !== 'redis://localhost:6379');

function createRedisClient(): Redis | null {
  // If no Redis URL is configured and we're in production (Vercel),
  // skip Redis entirely to avoid connection errors.
  if (!process.env.REDIS_URL && process.env.NODE_ENV === 'production') {
    console.log('[Redis] No REDIS_URL configured — running without Redis (serverless mode).');
    return null;
  }

  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        // In production without explicit Redis, don't retry endlessly
        if (!isRedisConfigured && times > 3) return null;
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    client.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    client.on('connect', () => {
      console.log('✓ Redis connected');
    });

    return client;
  } catch (err) {
    console.warn('[Redis] Failed to create client:', err);
    return null;
  }
}

const _redis = globalForRedis.redis ?? createRedisClient();

// Export a possibly-null Redis client
export const redis = _redis;

if (process.env.NODE_ENV !== 'production' && _redis) {
  globalForRedis.redis = _redis;
}

/**
 * Safe helper — performs a Redis operation or returns a fallback value.
 * Use this in API routes to avoid crashes when Redis is unavailable.
 */
export async function safeRedis<T>(
  fn: (client: Redis) => Promise<T>,
  fallback: T
): Promise<T> {
  if (!redis) return fallback;
  try {
    return await fn(redis);
  } catch (err) {
    console.warn('[Redis] Operation failed, using fallback:', (err as Error).message);
    return fallback;
  }
}

// Separate connection for BullMQ (requires maxRetriesPerRequest: null)
// Only used by the worker process, not the Vercel web app.
export function createBullMQConnection(): Redis {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
