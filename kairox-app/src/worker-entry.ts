import 'dotenv/config';
import { marketDataService } from '@/services/market-data';
import { signalWorker } from '@/workers/signal-worker';
import { alertWorker } from '@/workers/alert-worker';
import { startAutoSignalGeneration } from '@/services/signals/auto-generator';
import { binanceREST } from '@/services/market-data/binance-rest';
import { indicatorService } from '@/services/indicators';

async function bootstrap() {
  console.log('Starting Kairox background workers...');

  // 1. Priming Indicators
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT'];
  const timeframes = ['1h', '4h'];

  console.log('[Bootstrap] Priming indicators with historical data...');
  for (const symbol of symbols) {
    for (const tf of timeframes) {
      const klines = await binanceREST.getKlines(symbol, tf, 250);
      indicatorService.initialize(symbol, tf, klines);
    }
  }
  console.log('[Bootstrap] Indicators primed successfully.');

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
}

bootstrap().catch(err => {
  console.error('[Bootstrap] Critical failure during startup:', err);
  process.exit(1);
});

