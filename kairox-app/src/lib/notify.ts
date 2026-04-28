import { redis } from './redis';

export const NOTIFICATION_CHANNEL = 'kairox:notifications';

export async function publishNotification(data: any) {
  try {
    await redis.publish(NOTIFICATION_CHANNEL, JSON.stringify(data));
  } catch (error) {
    console.error('[Notify] Failed to publish notification:', error);
  }
}
