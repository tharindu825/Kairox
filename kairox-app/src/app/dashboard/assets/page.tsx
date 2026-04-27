'use client';

import useSWR from 'swr';
import { motion } from 'framer-motion';
import { LineChart, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function AssetsPage() {
  const { data: assets, error, isLoading } = useSWR<any[]>('/api/assets', fetcher, { refreshInterval: 10000 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--kx-text-primary)' }}>Assets</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--kx-text-muted)' }}>Monitored trading pairs and market data</p>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted">
          <Loader2 className="w-8 h-8 animate-spin mb-4" style={{ color: 'var(--kx-accent)' }} />
          <p style={{ color: 'var(--kx-text-muted)' }}>Loading assets and live prices...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(assets || []).map((asset, i) => (
            <motion.a
              key={asset.symbol}
              href={`/dashboard/assets/${asset.symbol}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="kx-card p-6 cursor-pointer block"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold font-mono text-xl" style={{ color: 'var(--kx-text-primary)' }}>{asset.symbol}</h3>
                  <p className="text-sm" style={{ color: 'var(--kx-text-muted)' }}>{asset.name}</p>
                </div>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ background: asset.change24h >= 0 ? 'var(--kx-long-bg)' : 'var(--kx-short-bg)' }}>
                  <LineChart className="w-5 h-5" style={{ color: asset.change24h >= 0 ? 'var(--kx-long)' : 'var(--kx-short)' }} />
                </div>
              </div>

              <div className="flex items-end justify-between">
                <div>
                  <div className="text-2xl font-bold font-mono" style={{ color: 'var(--kx-text-primary)' }}>
                    ${Number(asset.currentPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    {asset.change24h >= 0 ? (
                      <TrendingUp className="w-4 h-4" style={{ color: 'var(--kx-long)' }} />
                    ) : (
                      <TrendingDown className="w-4 h-4" style={{ color: 'var(--kx-short)' }} />
                    )}
                    <span className="text-sm font-medium" style={{ color: asset.change24h >= 0 ? 'var(--kx-long)' : 'var(--kx-short)' }}>
                      {asset.change24h >= 0 ? '+' : ''}{asset.change24h}%
                    </span>
                    <span className="text-xs ml-2" style={{ color: 'var(--kx-text-muted)' }}>24h</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>Vol: {asset.volume}</div>
                  <div className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>Signals: {asset.signalsCount}</div>
                </div>
              </div>
            </motion.a>
          ))}
        </div>
      )}
    </div>
  );
}
