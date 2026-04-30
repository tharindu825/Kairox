import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { marketDataService } from '@/services/market-data';
import { redis } from '@/lib/redis';

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  volume: string;
  highPrice: string;
  lowPrice: string;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDb();
    const assets = await db.collection('assets').find({}).toArray();
    const formattedAssets = assets.map(doc => ({ id: doc._id.toString(), ...doc } as any));

    if (assets.length === 0) {
      const redisSymbols = await redis.hkeys('market:ticker').catch(() => []);
      const fallbackSymbols = redisSymbols.length > 0
        ? redisSymbols
        : ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];

      assets = fallbackSymbols.map((symbol) => ({
        id: symbol,
        symbol,
        name: symbol.replace('USDT', ''),
        category: 'CRYPTO',
        signalsCount: 0,
      }));
    }

    // Fetch 24h ticker data from Binance for all symbols in one batch
    const symbols = assets.map(a => a.symbol);
    const tickerMap = new Map<string, BinanceTicker>();

    try {
      const tickerUrl = `https://api.binance.com/api/v3/ticker/24hr?symbols=${JSON.stringify(symbols)}`;
      const tickerRes = await fetch(tickerUrl, { next: { revalidate: 30 } });
      if (tickerRes.ok) {
        const tickers: BinanceTicker[] = await tickerRes.json();
        for (const t of tickers) {
          tickerMap.set(t.symbol, t);
        }
      }
    } catch (err) {
      console.warn('[API] Failed to fetch Binance tickers:', err);
    }

    // Hydrate with real-time price and 24h data
    const populated = await Promise.all(assets.map(async (asset) => {
      const ticker = tickerMap.get(asset.symbol);
      const redisPrice = await marketDataService.getLatestPrice(asset.symbol);
      const currentPrice = redisPrice || (ticker ? parseFloat(ticker.lastPrice) : 0);

      const rawVolume = ticker ? parseFloat(ticker.volume) : 0;
      let volumeStr = '0';
      if (rawVolume >= 1e9) volumeStr = `${(rawVolume / 1e9).toFixed(1)}B`;
      else if (rawVolume >= 1e6) volumeStr = `${(rawVolume / 1e6).toFixed(1)}M`;
      else if (rawVolume >= 1e3) volumeStr = `${(rawVolume / 1e3).toFixed(1)}K`;
      else volumeStr = rawVolume.toFixed(0);

      return {
        ...asset,
        currentPrice,
        change24h: ticker ? parseFloat(parseFloat(ticker.priceChangePercent).toFixed(2)) : 0,
        volume: volumeStr,
        signalsCount: asset.signalsCount || 0,
      };
    }));

    return NextResponse.json(populated);
  } catch (error) {
    console.error('[API] Failed to fetch assets:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all tickers from Binance
    const tickerUrl = 'https://api.binance.com/api/v3/ticker/24hr';
    const tickerRes = await fetch(tickerUrl, { next: { revalidate: 60 } });
    if (!tickerRes.ok) {
      throw new Error('Failed to fetch tickers from Binance');
    }

    const allTickers: any[] = await tickerRes.json();
    
    // Filter for USDT pairs and sort by volume
    const top200Symbols = allTickers
      .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('UP') && !t.symbol.includes('DOWN') && !t.symbol.includes('BEAR') && !t.symbol.includes('BULL'))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 200)
      .map(t => t.symbol);

    const db = await getDb();
    
    for (const symbol of top200Symbols) {
      await db.collection('assets').updateOne(
        { symbol },
        {
          $set: {
            symbol,
            name: symbol.replace('USDT', ''),
            category: 'CRYPTO',
            updatedAt: new Date(),
          },
          $setOnInsert: {
            signalsCount: 0,
          }
        },
        { upsert: true }
      );
    }

    return NextResponse.json({ message: 'Assets synced', count: top200Symbols.length }, { status: 200 });
  } catch (error) {
    console.error('[API] Failed to sync assets:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
