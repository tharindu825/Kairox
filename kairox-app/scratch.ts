import dotenv from 'dotenv';
dotenv.config();
import { binanceDemoService } from './src/services/execution/binance-demo';

async function testTrade() {
  try {
    const symbol = 'BTCUSDT';
    const side = 'LONG';
    const positionSize = 0.001; // e.g. 0.001 BTC
    const fillPrice = 65000;
    const stopLoss = 64000;
    const targetPrice = 66000;

    console.log(`Calling placeTrade(${symbol}, ${side}, ${positionSize}, ${fillPrice}, ${stopLoss}, ${targetPrice})`);
    
    const res = await binanceDemoService.placeTrade(
      symbol,
      side,
      positionSize,
      fillPrice,
      stopLoss,
      targetPrice
    );
    console.log('Result:', res);
  } catch (err: any) {
    console.error('FAILED TO PLACE TRADE:', err.message);
  }
}
testTrade().then(() => process.exit(0));
