import { Queue } from 'bullmq';
import { createBullMQConnection } from '@/lib/redis';

// Queue for processing indicators and generating signals
export const signalQueue = new Queue('signal-generation', { 
  connection: createBullMQConnection()
});

// Queue for alerts (Telegram, etc)
export const alertQueue = new Queue('alerts', {
  connection: createBullMQConnection()
});
