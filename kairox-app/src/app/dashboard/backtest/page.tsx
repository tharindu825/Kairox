'use client';

import { motion } from 'framer-motion';
import { FlaskConical, Play, BarChart3 } from 'lucide-react';

export default function BacktestPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--kx-text-primary)' }}>Backtest Lab</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--kx-text-muted)' }}>
          Replay signals against historical data to evaluate model and prompt performance
        </p>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="kx-card p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--kx-text-muted)' }}>Asset</label>
            <select className="kx-input">
              <option>BTCUSDT</option>
              <option>ETHUSDT</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--kx-text-muted)' }}>Timeframe</label>
            <select className="kx-input">
              <option>1H</option>
              <option>4H</option>
              <option>1D</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--kx-text-muted)' }}>Start Date</label>
            <input type="date" className="kx-input" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--kx-text-muted)' }}>End Date</label>
            <input type="date" className="kx-input" />
          </div>
        </div>

        <button className="kx-btn kx-btn-primary">
          <Play className="w-4 h-4" />
          Run Backtest
        </button>
      </motion.div>

      {/* Placeholder results */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Win Rate', value: '—', icon: BarChart3 },
          { label: 'Expectancy', value: '—', icon: BarChart3 },
          { label: 'Max Drawdown', value: '—', icon: BarChart3 },
          { label: 'Total Trades', value: '—', icon: FlaskConical },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.08 }}
            className="kx-card p-5"
          >
            <div className="text-xs mb-2" style={{ color: 'var(--kx-text-muted)' }}>{stat.label}</div>
            <div className="text-2xl font-bold font-mono" style={{ color: 'var(--kx-text-primary)' }}>{stat.value}</div>
          </motion.div>
        ))}
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        className="kx-card p-16 flex flex-col items-center justify-center" style={{ color: 'var(--kx-text-muted)' }}>
        <FlaskConical className="w-12 h-12 mb-4 opacity-30" />
        <p className="text-lg font-medium">No backtest results yet</p>
        <p className="text-sm mt-1">Configure parameters above and run a backtest</p>
      </motion.div>
    </div>
  );
}
