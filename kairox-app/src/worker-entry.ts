import 'dotenv/config';
import { marketDataService } from '@/services/market-data';
import { signalWorker } from '@/workers/signal-worker';
import { alertWorker } from '@/workers/alert-worker';
import { startAutoSignalGeneration } from '@/services/signals/auto-generator';

console.log('Starting Kairox background workers...');

console.log(`[Workers] Signal Worker initialized (Queue: ${signalWorker.name})`);
console.log(`[Workers] Alert Worker initialized (Queue: ${alertWorker.name})`);

console.log('Starting market data websocket stream...');
marketDataService.startStream();

const stopAutoSignalGeneration = startAutoSignalGeneration();

process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down...');
  stopAutoSignalGeneration();
  await signalWorker.close();
  await alertWorker.close();
  process.exit(0);
});

