import 'dotenv/config';
import { marketDataService } from '@/services/market-data';
import { signalWorker } from '@/workers/signal-worker';
import { alertWorker } from '@/workers/alert-worker';

console.log('🚀 Starting Kairox Background Workers...');

// Start BullMQ workers (they auto-connect on instantiation)
console.log(`[Workers] Signal Worker initialized (Queue: ${signalWorker.name})`);
console.log(`[Workers] Alert Worker initialized (Queue: ${alertWorker.name})`);

// Start Market Data Stream
console.log('🚀 Starting Market Data WebSocket Stream...');
marketDataService.startStream();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down...');
  await signalWorker.close();
  await alertWorker.close();
  process.exit(0);
});
