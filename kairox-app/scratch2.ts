import dotenv from 'dotenv';
dotenv.config();
import { binanceDemoService } from './src/services/execution/binance-demo';

async function testTrade() {
  try {
    const symbol = 'DOGEUSDT';
    const side = 'LONG';
    const positionSize = 100; // e.g. 100 DOGE
    
    // Create a limit order below the current market price
    const fillPrice = 0.07; 
    const stopLoss = 0.06;
    const targetPrice = 0.12;

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
