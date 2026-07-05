import ccxt, { binanceusdm } from 'ccxt';
import { env } from '@/lib/env';

export class BinanceDemoService {
  private exchange: binanceusdm;
  private initialized = false;

  constructor() {
    this.exchange = new ccxt.binanceusdm({
      apiKey: env.BINANCE_TESTNET_API_KEY,
      secret: env.BINANCE_TESTNET_API_SECRET,
      enableRateLimit: true,
      options: {
        defaultType: 'future',
        disableFuturesSandboxWarning: true,
      },
    });
    // Use testnet
    this.exchange.setSandboxMode(true);
  }

  private async ensureInitialized() {
    if (this.initialized) return;
    if (!env.BINANCE_TESTNET_API_KEY || !env.BINANCE_TESTNET_API_SECRET) {
      throw new Error('Binance Testnet API keys not configured');
    }
    await this.exchange.loadMarkets();
    this.initialized = true;
  }

  private getStandardSymbol(rawSymbol: string): string {
    // If it already has a slash, assume it's standard
    if (rawSymbol.includes('/')) return rawSymbol;
    
    const market = Object.values(this.exchange.markets).find((m: any) => m.id === rawSymbol);
    if (!market) {
      throw new Error(`Symbol ${rawSymbol} not found on Binance Testnet.`);
    }
    return market.symbol;
  }

  /**
   * Places an entry order (Market or Limit) and associated Reduce-Only SL/TP orders.
   * If the current price is within 0.15% of the entry price, it uses a Market order.
   * Otherwise, it uses a Limit order.
   */
  async placeTrade(
    rawSymbol: string,
    side: 'LONG' | 'SHORT',
    quantity: number,
    entryPrice: number,
    stopLoss: number,
    takeProfit: number
  ) {
    await this.ensureInitialized();
    const symbol = this.getStandardSymbol(rawSymbol);
    const ticker = await this.exchange.fetchTicker(symbol).catch(() => ({ last: undefined }));
    const currentPrice = ticker.last;

    // Load markets to get precision rules
    if (!this.exchange.markets[symbol]) {
      await this.exchange.loadMarkets();
    }
    
    // Format quantities and prices to Binance specifications
    const formattedQty = Number(this.exchange.amountToPrecision(symbol, quantity));
    const formattedEntry = Number(this.exchange.priceToPrecision(symbol, entryPrice));
    const formattedSL = Number(this.exchange.priceToPrecision(symbol, stopLoss));
    const formattedTP = Number(this.exchange.priceToPrecision(symbol, takeProfit));

    // Check if we should use Market or Limit
    let isMarket = false;
    if (currentPrice) {
      const slippagePct = Math.abs(currentPrice - formattedEntry) / formattedEntry;
      isMarket = slippagePct <= 0.0015; // 0.15% tolerance
    }

    const ccxtSide = side === 'LONG' ? 'buy' : 'sell';
    const oppositeSide = side === 'LONG' ? 'sell' : 'buy';

    console.log(`[Binance Demo] Executing ${ccxtSide.toUpperCase()} ${formattedQty} ${symbol}... (Type: ${isMarket ? 'MARKET' : 'LIMIT'})`);

    const orders = [];

    // 1. Entry Order
    if (isMarket) {
      const entryOrder = await this.exchange.createOrder(symbol, 'market', ccxtSide, formattedQty);
      orders.push(entryOrder);
    } else {
      const entryOrder = await this.exchange.createOrder(symbol, 'limit', ccxtSide, formattedQty, formattedEntry);
      orders.push(entryOrder);
    }

    // 2. Stop Loss Order (Stop Market, Reduce Only)
    try {
      const slOrder = await this.exchange.createOrder(symbol, 'stop_market', oppositeSide, formattedQty, formattedSL, {
        stopPrice: formattedSL,
        reduceOnly: true,
      });
      orders.push(slOrder);
    } catch (err: any) {
      console.error(`[Binance Demo] Failed to place SL for ${symbol}:`, err.message);
    }

    // 3. Take Profit Order (Take Profit Market, Reduce Only)
    try {
      if (formattedTP > 0) {
        const tpOrder = await this.exchange.createOrder(symbol, 'take_profit_market', oppositeSide, formattedQty, formattedTP, {
          stopPrice: formattedTP,
          reduceOnly: true,
        });
        orders.push(tpOrder);
      }
    } catch (err: any) {
      console.error(`[Binance Demo] Failed to place TP for ${symbol}:`, err.message);
    }

    return orders;
  }

  async fetchPositions() {
    await this.ensureInitialized();
    const positions = await this.exchange.fetchPositions();
    // Return only active positions
    return positions.filter(p => p.contracts && p.contracts > 0);
  }

  async fetchOpenOrders(rawSymbol?: string) {
    await this.ensureInitialized();
    const symbol = rawSymbol ? this.getStandardSymbol(rawSymbol) : undefined;
    return await this.exchange.fetchOpenOrders(symbol);
  }

  async fetchBalance() {
    await this.ensureInitialized();
    return await this.exchange.fetchBalance();
  }

  async closePosition(rawSymbol: string) {
    await this.ensureInitialized();
    const symbol = this.getStandardSymbol(rawSymbol);
    
    // 1. Cancel all open limit/conditional orders for this symbol first
    try {
      await this.exchange.cancelAllOrders(symbol);
      console.log(`[Binance Demo] Canceled all open orders for ${symbol}`);
    } catch (err: any) {
      console.error(`[Binance Demo] Failed to cancel open orders for ${symbol}:`, err.message);
    }

    // 2. Fetch active position
    const positions = await this.fetchPositions();
    const pos = positions.find(p => p.symbol === symbol || p.symbol === rawSymbol);
    if (!pos || !pos.contracts || pos.contracts === 0) {
      // If there's no active position, just returning is fine since we already canceled the limit orders
      return { status: 'closed', message: `No active position to close, but open orders were canceled for ${symbol}` };
    }

    const side = pos.side === 'long' ? 'sell' : 'buy';
    
    // 3. Market close the position
    const closeOrder = await this.exchange.createOrder(symbol, 'market', side, pos.contracts, undefined, {
      reduceOnly: true
    });

    return true;
  }
}

export const binanceDemoService = new BinanceDemoService();
