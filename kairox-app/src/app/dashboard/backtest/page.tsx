'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { FlaskConical, Play, BarChart3, Loader2, TrendingDown, Trophy, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export default function BacktestPage() {
  const [asset, setAsset] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState('1h');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState('');

  const handleRun = async () => {
    if (!startDate || !endDate) { setError('Please select start and end dates'); return; }
    setLoading(true);
    setError('');
    setResults(null);

    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, timeframe, startDate, endDate }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Backtest failed');
      setResults(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const r = results?.results as any;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--kx-text-primary)' }}>Backtest Lab</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--kx-text-muted)' }}>Replay signals against historical data to evaluate strategy performance</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="kx-card p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--kx-text-muted)' }}>Asset</label>
            <select className="kx-input" value={asset} onChange={e => setAsset(e.target.value)}>
              <option>BTCUSDT</option><option>ETHUSDT</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--kx-text-muted)' }}>Timeframe</label>
            <select className="kx-input" value={timeframe} onChange={e => setTimeframe(e.target.value)}>
              <option value="1h">1H</option><option value="4h">4H</option><option value="1d">1D</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--kx-text-muted)' }}>Start Date</label>
            <input type="date" className="kx-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--kx-text-muted)' }}>End Date</label>
            <input type="date" className="kx-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>

        {error && <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--kx-danger)', border: '1px solid rgba(239,68,68,0.2)' }}>{error}</div>}

        <button onClick={handleRun} disabled={loading} className="kx-btn kx-btn-primary">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {loading ? 'Running...' : 'Run Backtest'}
        </button>
      </motion.div>

      {/* Results */}
      {r && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Win Rate', value: `${r.winRate}%`, icon: Trophy, color: r.winRate >= 50 ? 'var(--kx-long)' : 'var(--kx-short)' },
              { label: 'Expectancy', value: `${r.expectancy > 0 ? '+' : ''}${r.expectancy}%`, icon: BarChart3, color: r.expectancy >= 0 ? 'var(--kx-long)' : 'var(--kx-short)' },
              { label: 'Max Drawdown', value: `-${r.maxDrawdown}%`, icon: TrendingDown, color: 'var(--kx-short)' },
              { label: 'Total Trades', value: r.totalTrades.toString(), icon: FlaskConical, color: 'var(--kx-accent)' },
            ].map((stat, i) => (
              <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="kx-card p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>{stat.label}</span>
                  <stat.icon className="w-4 h-4" style={{ color: stat.color }} />
                </div>
                <div className="text-2xl font-bold font-mono" style={{ color: stat.color }}>{stat.value}</div>
              </motion.div>
            ))}
          </div>

          {/* Trade Table */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="kx-card overflow-hidden">
            <div className="p-4" style={{ borderBottom: '1px solid var(--kx-glass-border)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--kx-text-primary)' }}>Trade History ({r.totalTrades} trades)</h3>
            </div>
            <table className="kx-table">
              <thead>
                <tr><th>Side</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Hold</th><th>Entry Time</th></tr>
              </thead>
              <tbody>
                {(results?.trades as any[])?.slice(0, 20).map((t: any, i: number) => (
                  <tr key={i}>
                    <td>
                      <span className={`${t.side === 'LONG' ? 'kx-badge-long' : 'kx-badge-short'} px-2 py-0.5 rounded text-xs font-bold`}>
                        {t.side === 'LONG' ? <ArrowUpRight className="w-3 h-3 inline" /> : <ArrowDownRight className="w-3 h-3 inline" />} {t.side}
                      </span>
                    </td>
                    <td className="font-mono text-xs">${t.entry.toLocaleString()}</td>
                    <td className="font-mono text-xs">${t.exit.toLocaleString()}</td>
                    <td className="font-mono text-sm" style={{ color: t.pnl >= 0 ? 'var(--kx-long)' : 'var(--kx-short)' }}>
                      {t.pnl >= 0 ? '+' : ''}{t.pnl}%
                    </td>
                    <td className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>{t.holdingPeriod} candles</td>
                    <td className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>{new Date(t.entryTime).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </>
      )}

      {!r && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="kx-card p-16 flex flex-col items-center justify-center" style={{ color: 'var(--kx-text-muted)' }}>
          <FlaskConical className="w-12 h-12 mb-4 opacity-30" />
          <p className="text-lg font-medium">No backtest results yet</p>
          <p className="text-sm mt-1">Configure parameters above and run a backtest</p>
        </motion.div>
      )}
    </div>
  );
}
