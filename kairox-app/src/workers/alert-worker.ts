import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '@/lib/redis';

export interface AlertJobData {
  signalId?: string;
  message: string;
}

export const alertWorker = new Worker(
  'alerts',
  async (job: Job<AlertJobData>) => {
    const { message, signalId } = job.data;
    console.log(`[Alert Worker] Processing alert for signal ${signalId || 'system'}`);

    try {
      const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;

      if (!telegramToken || !chatId) {
        console.warn('[Alert Worker] Telegram credentials not configured. Printing to console instead:');
        console.log('----------------------------------------');
        console.log(message);
        console.log('----------------------------------------');
        return { status: 'skipped', reason: 'no_credentials' };
      }

      // Production implementation
      const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API Error: ${errorText}`);
      }

      console.log(`[Alert Worker] Successfully sent Telegram alert.`);
      return { status: 'success' };

    } catch (error) {
      console.error(`[Alert Worker] Failed to send alert:`, error);
      throw error;
    }
  },
  { connection: createBullMQConnection() }
);

alertWorker.on('failed', (job, err) => {
  console.error(`[Alert Worker] Job ${job?.id} failed:`, err);
});
