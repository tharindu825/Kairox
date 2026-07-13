import { registerQueueHandler } from './queues';

export interface AlertJobData {
  signalId?: string;
  message: string;
}

async function alertJobHandler(data: AlertJobData): Promise<any> {
    const { message, signalId } = data;
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
}

/** No-op close for compatibility with worker-entry.ts */
export const alertWorker = {
  name: 'alerts',
  close: async () => {},
};

// Register handler with the in-process queue shim
registerQueueHandler('alerts', alertJobHandler);
