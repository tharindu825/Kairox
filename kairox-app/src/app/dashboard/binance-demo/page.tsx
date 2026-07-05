'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight, RefreshCw, XCircle } from 'lucide-react';
import useSWR from 'swr';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || 'Failed to fetch data');
  }
  return data;
};

export default function BinanceDemoPage() {
  const { data, error, isLoading, mutate } = useSWR('/api/binance/positions', fetcher, {
    refreshInterval: 10000 // Poll every 10s
  });

  const [closing, setClosing] = useState<string | null>(null);

  const handleClosePosition = async (symbol: string) => {
    if (!confirm(`Are you sure you want to market close ${symbol}?`)) return;
    
    setClosing(symbol);
    try {
      const res = await fetch('/api/binance/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        mutate();
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Failed to close position');
    } finally {
      setClosing(null);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <XCircle className="w-12 h-12 mb-4 text-red-500" />
        <h2 className="text-xl font-bold text-[var(--kx-text-primary)] mb-2">Connection Failed</h2>
        <p className="text-[var(--kx-text-secondary)]">{error.message || 'Could not connect to Binance Testnet.'}</p>
      </div>
    );
  }

  const positions = data?.positions || [];
  const balance = data?.balance || 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--kx-text-primary)]">Binance Demo</h1>
          <p className="text-sm text-[var(--kx-text-muted)]">Live Testnet Execution Tracking</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[var(--kx-text-muted)] text-xs">Testnet Balance</div>
            <div className="font-bold text-[var(--kx-text-primary)] text-lg">${balance.toFixed(2)}</div>
          </div>
          <button 
            onClick={() => mutate()}
            disabled={isLoading}
            className="p-2 rounded-lg bg-[var(--kx-bg-card)] hover:bg-white/5 border border-[var(--kx-border)] transition-colors"
          >
            <RefreshCw className={`w-5 h-5 text-[var(--kx-text-secondary)] ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="bg-[var(--kx-bg-card)] border border-[var(--kx-glass-border)] rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-[var(--kx-glass-border)]">
          <h2 className="font-semibold text-[var(--kx-text-primary)]">Active Positions</h2>
        </div>
        
        {positions.length === 0 ? (
          <div className="p-8 text-center text-[var(--kx-text-muted)]">
            No active positions on Binance Testnet right now.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[var(--kx-bg-surface)] text-[var(--kx-text-muted)] text-xs uppercase font-medium">
                <tr>
                  <th className="px-5 py-3">Symbol</th>
                  <th className="px-5 py-3">Side</th>
                  <th className="px-5 py-3 text-right">Size</th>
                  <th className="px-5 py-3 text-right">Entry Price</th>
                  <th className="px-5 py-3 text-right">Mark Price</th>
                  <th className="px-5 py-3 text-right">Unrealized PnL</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--kx-glass-border)]">
                {positions.map((pos: any) => (
                  <tr key={pos.symbol} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-4 font-bold text-[var(--kx-text-primary)]">{pos.symbol}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold ${
                        pos.side === 'long' 
                          ? 'bg-[var(--kx-long)]/10 text-[var(--kx-long)]' 
                          : 'bg-[var(--kx-short)]/10 text-[var(--kx-short)]'
                      }`}>
                        {pos.side === 'long' ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                        {pos.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right text-[var(--kx-text-secondary)]">{pos.contracts}</td>
                    <td className="px-5 py-4 text-right text-[var(--kx-text-primary)] font-medium">${pos.entryPrice.toFixed(4)}</td>
                    <td className="px-5 py-4 text-right text-[var(--kx-text-primary)] font-medium">${pos.markPrice.toFixed(4)}</td>
                    <td className={`px-5 py-4 text-right font-bold ${
                      pos.unrealizedPnl >= 0 ? 'text-[var(--kx-long)]' : 'text-[var(--kx-short)]'
                    }`}>
                      {pos.unrealizedPnl >= 0 ? '+' : ''}{pos.unrealizedPnl.toFixed(2)} USDT
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => handleClosePosition(pos.symbol)}
                        disabled={closing === pos.symbol}
                        className="px-3 py-1.5 text-xs font-semibold rounded-md bg-[var(--kx-bg-surface)] hover:bg-[var(--kx-short)] hover:text-white border border-[var(--kx-border)] transition-colors"
                      >
                        {closing === pos.symbol ? 'Closing...' : 'Close'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
