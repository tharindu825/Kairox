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
    const rawAssets = await db.collection('assets').find({}).toArray();
    let assetList = rawAssets.map(doc => ({ id: doc._id.toString(), ...doc } as any));

    if (assetList.length === 0) {
      const redisSymbols = await redis.hkeys('market:ticker').catch(() => []);
      const fallbackSymbols = redisSymbols.length > 0
        ? redisSymbols
        : ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];

      assetList = fallbackSymbols.map((symbol: string) => ({
        id: symbol,
        symbol,
        name: symbol.replace('USDT', ''),
        category: 'CRYPTO',
        signalsCount: 0,
      }));
    }

    // Fetch 24h ticker data from Binance for all symbols in one batch
    const symbols = assetList.map(a => a.symbol);
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
    const populated = await Promise.all(assetList.map(async (asset) => {
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
    
    // Stablecoins and index tokens that are NOT tradable crypto signals
    const EXCLUDED_PREFIXES = new Set([
      'USDC', 'TUSD', 'FDUSD', 'BUSD', 'DAI', 'USDD', 'USDP', 'PYUSD', 'EURI', 'AEUR',
    ]);
    const EXCLUDED_SUBSTRINGS = ['UP', 'DOWN', 'BEAR', 'BULL', 'DOM', 'PERP'];

    // Filter for real crypto USDT spot pairs and sort by 24h quote volume
    const allUsdtSymbols = allTickers
      .filter(t => {
        const sym: string = t.symbol;
        if (!sym.endsWith('USDT')) return false;
        const base = sym.slice(0, -4); // strip 'USDT'
        if (EXCLUDED_PREFIXES.has(base)) return false;
        if (EXCLUDED_SUBSTRINGS.some(s => sym.includes(s))) return false;
        return true;
      })
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .map(t => t.symbol);

    const db = await getDb();
    const liveSymbolSet = new Set(allUsdtSymbols);

    // Upsert all live symbols from Binance
    for (const symbol of allUsdtSymbols) {
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

    // Remove any assets that are no longer listed on Binance (e.g. delisted / rebranded tokens)
    const deleteResult = await db.collection('assets').deleteMany({
      symbol: { $nin: Array.from(liveSymbolSet) }
    });

    if (deleteResult.deletedCount > 0) {
      console.log(`[API] Removed ${deleteResult.deletedCount} delisted asset(s) from the database.`);
    }

    return NextResponse.json({ message: 'Assets synced', count: allUsdtSymbols.length, removed: deleteResult.deletedCount }, { status: 200 });
  } catch (error) {
    console.error('[API] Failed to sync assets:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
