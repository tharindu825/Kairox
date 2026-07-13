/**
 * Redis mock for local development without a Redis server.
 * All operations are no-ops or in-memory fallbacks.
 */

const memStore = new Map<string, string>();

// Minimal mock matching the ioredis API surface used in this codebase
const redisMock = {
  set: async (key: string, value: string) => {
    memStore.set(key, value);
    return 'OK';
  },
  get: async (key: string) => {
    return memStore.get(key) ?? null;
  },
  del: async (...keys: string[]) => {
    keys.forEach(k => memStore.delete(k));
    return keys.length;
  },
  hset: async (key: string, data: Record<string, string>) => {
    // Basic mock: we'll just JSON stringify the object into memStore
    // so it doesn't crash, even though it's not a true hash structure.
    let existing = memStore.get(key);
    let obj: Record<string, string> = {};
    if (existing) {
      try { obj = JSON.parse(existing); } catch (e) {}
    }
    Object.assign(obj, data);
    memStore.set(key, JSON.stringify(obj));
    return 1;
  },
  hget: async (key: string, field: string) => {
    let existing = memStore.get(key);
    if (!existing) return null;
    try {
      const obj = JSON.parse(existing);
      return obj[field] ?? null;
    } catch (e) {
      return null;
    }
  },
  hgetall: async (key: string) => {
    let existing = memStore.get(key);
    if (!existing) return {};
    try {
      return JSON.parse(existing);
    } catch (e) {
      return {};
    }
  },
  publish: async (_channel: string, _message: string) => {
    // No-op: SSE notifications will just be skipped without Redis pub/sub
    return 0;
  },
  subscribe: async () => {},
  on: (_event: string, _cb: (...args: any[]) => void) => redisMock,
  quit: async () => 'OK',
  disconnect: () => {},
  status: 'ready',
  duplicate: () => redisMock,
};

export const redis = redisMock as any;

if (process.env.NODE_ENV !== 'production') {
  (globalThis as any).__redisMock = redisMock;
}

/** Returns the same mock — BullMQ connections are disabled when Redis is absent */
export function createBullMQConnection(): any {
  return redisMock;
}
