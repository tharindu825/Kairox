'use client';

import useSWR from 'swr';
import { motion } from 'framer-motion';
import { ShieldAlert, AlertTriangle, Crosshair, TrendingDown, Clock, ShieldCheck, FileWarning, Loader2 } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function RiskPage() {
  const { data, error, isLoading } = useSWR('/api/risk', fetcher, { refreshInterval: 5000 });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-mono" style={{ color: 'var(--kx-text-primary)' }}>Risk Center</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--kx-text-muted)' }}>Deterministic risk controls and portfolio exposure</p>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted">
          <Loader2 className="w-10 h-10 animate-spin mb-4" style={{ color: 'var(--kx-warning)' }} />
          <p style={{ color: 'var(--kx-text-muted)' }}>Loading risk metrics...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="kx-card p-5">
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium" style={{ color: 'var(--kx-text-muted)' }}>Capital at Risk</span>
                <ShieldAlert className="w-4 h-4" style={{ color: 'var(--kx-warning)' }} />
              </div>
              <div className="text-2xl font-bold font-mono mb-1" style={{ color: 'var(--kx-text-primary)' }}>{data?.metrics.capitalAtRisk}%</div>
              <div className="w-full bg-black/20 rounded-full h-1.5 mt-3">
                <div className="h-1.5 rounded-full" style={{ width: `${((data?.metrics.capitalAtRisk || 0) / (data?.metrics.maxCapitalRisk || 1)) * 100}%`, background: 'var(--kx-warning)' }} />
              </div>
              <div className="text-xs mt-2 text-right" style={{ color: 'var(--kx-text-muted)' }}>Max {data?.metrics.maxCapitalRisk}%</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="kx-card p-5">
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium" style={{ color: 'var(--kx-text-muted)' }}>Daily Drawdown</span>
                <TrendingDown className="w-4 h-4" style={{ color: 'var(--kx-short)' }} />
              </div>
              <div className="text-2xl font-bold font-mono mb-1" style={{ color: 'var(--kx-short)' }}>{data?.metrics.dailyDrawdown}%</div>
              <div className="w-full bg-black/20 rounded-full h-1.5 mt-3">
                <div className="h-1.5 rounded-full" style={{ width: `${((data?.metrics.dailyDrawdown || 0) / (data?.metrics.maxDrawdown || -1)) * 100}%`, background: 'var(--kx-short)' }} />
              </div>
              <div className="text-xs mt-2 text-right" style={{ color: 'var(--kx-text-muted)' }}>Limit {data?.metrics.maxDrawdown}%</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="kx-card p-5">
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium" style={{ color: 'var(--kx-text-muted)' }}>Active Trades</span>
                <Crosshair className="w-4 h-4" style={{ color: 'var(--kx-accent)' }} />
              </div>
              <div className="text-2xl font-bold font-mono mb-1" style={{ color: 'var(--kx-text-primary)' }}>{data?.metrics.openTrades} <span className="text-sm" style={{ color: 'var(--kx-text-muted)' }}>/ {data?.metrics.maxOpenTrades}</span></div>
              <div className="w-full bg-black/20 rounded-full h-1.5 mt-3">
                <div className="h-1.5 rounded-full" style={{ width: `${((data?.metrics.openTrades || 0) / (data?.metrics.maxOpenTrades || 1)) * 100}%`, background: 'var(--kx-accent)' }} />
              </div>
              <div className="text-xs mt-2 text-right" style={{ color: 'var(--kx-text-muted)' }}>Capacity</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="kx-card p-5">
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium" style={{ color: 'var(--kx-text-muted)' }}>Correlation Exposure</span>
                <AlertTriangle className="w-4 h-4" style={{ color: 'var(--kx-text-primary)' }} />
              </div>
              <div className="text-2xl font-bold font-mono mb-1" style={{ color: 'var(--kx-text-primary)' }}>{data?.metrics.correlatedPairs} <span className="text-sm" style={{ color: 'var(--kx-text-muted)' }}>/ {data?.metrics.maxCorrelated}</span></div>
              <div className="w-full bg-black/20 rounded-full h-1.5 mt-3">
                <div className="h-1.5 rounded-full" style={{ width: `${((data?.metrics.correlatedPairs || 0) / (data?.metrics.maxCorrelated || 1)) * 100}%`, background: 'var(--kx-text-primary)' }} />
              </div>
              <div className="text-xs mt-2 text-right" style={{ color: 'var(--kx-text-muted)' }}>Max Pairs</div>
            </motion.div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <h3 className="font-semibold flex items-center gap-2" style={{ color: 'var(--kx-text-primary)' }}>
                <FileWarning className="w-4 h-4" /> Blocked Signals Log
              </h3>
              
              <div className="space-y-3">
                {data?.blockedSignals?.length === 0 ? (
                  <div className="kx-card p-8 text-center" style={{ color: 'var(--kx-text-muted)' }}>
                    <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No blocked signals recently.</p>
                  </div>
                ) : (
                  data?.blockedSignals?.map((signal: any, i: number) => (
                    <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }} className="kx-card p-4 border-l-2" style={{ borderLeftColor: 'var(--kx-short)' }}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold">{signal.asset.symbol}</span>
                          <span className="kx-badge-short px-2 py-0.5 rounded text-xs">{signal.side}</span>
                        </div>
                        <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>Just now</span>
                      </div>
                      <div className="text-sm" style={{ color: 'var(--kx-text-secondary)' }}>
                        <span className="font-semibold" style={{ color: 'var(--kx-short)' }}>Blocked:</span> {signal.riskAssessment?.reasons?.[0] || 'Risk limit exceeded'}
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2" style={{ color: 'var(--kx-text-primary)' }}>
                <Clock className="w-4 h-4" /> System Status
              </h3>
              <div className="kx-card p-5 space-y-4">
                <div>
                  <div className="text-sm mb-1" style={{ color: 'var(--kx-text-muted)' }}>Stop-Out Streak</div>
                  <div className="font-mono">{data?.metrics.consecutiveStops} / 3 trades</div>
                </div>
                <div>
                  <div className="text-sm mb-1" style={{ color: 'var(--kx-text-muted)' }}>Cooldown Status</div>
                  {data?.metrics.cooldownActive ? (
                    <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--kx-warning)' }}>
                      <AlertTriangle className="w-4 h-4" /> Active (45m remaining)
                    </div>
                  ) : (
                    <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--kx-success)' }}>
                      <ShieldCheck className="w-4 h-4" /> Trading Enabled
                    </div>
                  )}
                </div>
                
                <div className="pt-4 mt-4 border-t" style={{ borderColor: 'var(--kx-border)' }}>
                  <button className="w-full kx-btn py-2 rounded-lg font-medium" style={{ background: 'rgba(255,71,87,0.1)', color: 'var(--kx-short)' }}>
                    Trigger Emergency Kill Switch
                  </button>
                  <p className="text-xs mt-2 text-center" style={{ color: 'var(--kx-text-muted)' }}>
                    Instantly closes all paper trades and halts AI generation.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
