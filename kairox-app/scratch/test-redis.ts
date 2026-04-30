import 'dotenv/config';
import Redis from 'ioredis';

const url = process.env.REDIS_URL || 'redis://localhost:6379';
console.log(`Connecting to Redis at ${url}...`);

const redis = new Redis(url);

redis.on('connect', () => {
  console.log('Redis connected successfully!');
  process.exit(0);
});

redis.on('error', (err) => {
  console.error('Redis error:', err);
  process.exit(1);
});

setTimeout(() => {
  console.log('Connection timed out');
  process.exit(1);
}, 5000);
