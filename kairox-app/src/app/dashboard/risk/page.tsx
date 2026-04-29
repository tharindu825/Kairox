'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import {
  ShieldAlert, AlertTriangle, Crosshair, TrendingDown, Clock, ShieldCheck,
  FileWarning, Loader2, DollarSign, Target, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function timeAgo(date: Date | string): string {
  const d = new Date(date);
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function RiskPage() {
  const { data, error, isLoading, mutate: mutateRisk } = useSWR('/api/risk', fetcher, { refreshInterval: 5000 });
  const { data: paperData, mutate: mutatePaper } = useSWR('/api/paper-trades', fetcher, { refreshInterval: 5000 });
  const [isKilling, setIsKilling] = useState(false);
  const metrics = data?.metrics ?? {
    capitalAtRisk: 0,
    maxCapitalRisk: 1,
    dailyPnL: 0,
    dailyDrawdown: 0,
    maxDrawdown: -5,
    openTrades: 0,
    maxOpenTrades: 1,
    paperBalance: 10000,
    consecutiveStops: 0,
    cooldownActive: false,
  };

  const executeKillSwitch = async () => {
    if (!window.confirm('Are you sure you want to trigger the emergency kill switch? This will close all open paper trades and block all pending signals.')) return;
    
    setIsKilling(true);
    try {
      const res = await fetch('/api/risk/kill-switch', { method: 'POST' });
      if (res.ok) {
        alert('Kill switch executed successfully.');
        mutateRisk();
        mutatePaper();
      } else {
        alert('Failed to execute kill switch.');
      }
    } catch (err) {
      console.error(err);
      alert('Error executing kill switch.');
    } finally {
      setIsKilling(false);
    }
  };

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
          {/* Risk Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="kx-card p-5">
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium" style={{ color: 'var(--kx-text-muted)' }}>Capital at Risk</span>
                <ShieldAlert className="w-4 h-4" style={{ color: 'var(--kx-warning)' }} />
              </div>
              <div className="text-2xl font-bold font-mono mb-1" style={{ color: 'var(--kx-text-primary)' }}>{metrics.capitalAtRisk}%</div>
              <div className="w-full bg-black/20 rounded-full h-1.5 mt-3">
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min((metrics.capitalAtRisk / metrics.maxCapitalRisk) * 100, 100)}%`, background: 'var(--kx-warning)' }} />
              </div>
              <div className="text-xs mt-2 text-right" style={{ color: 'var(--kx-text-muted)' }}>Max {metrics.maxCapitalRisk}%</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="kx-card p-5">
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium" style={{ color: 'var(--kx-text-muted)' }}>Daily P&L</span>
                <TrendingDown className="w-4 h-4" style={{ color: metrics.dailyPnL >= 0 ? 'var(--kx-long)' : 'var(--kx-short)' }} />
              </div>
              <div className="text-2xl font-bold font-mono mb-1" style={{ color: metrics.dailyPnL >= 0 ? 'var(--kx-long)' : 'var(--kx-short)' }}>
                {metrics.dailyPnL >= 0 ? '+' : ''}${metrics.dailyPnL}
              </div>
              <div className="w-full bg-black/20 rounded-full h-1.5 mt-3">
                <div className="h-1.5 rounded-full transition-all" style={{
                  width: `${Math.min(Math.abs(metrics.dailyDrawdown) / Math.abs(metrics.maxDrawdown) * 100, 100)}%`,
                  background: 'var(--kx-short)'
                }} />
              </div>
              <div className="text-xs mt-2 text-right" style={{ color: 'var(--kx-text-muted)' }}>DD Limit {metrics.maxDrawdown}%</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="kx-card p-5">
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium" style={{ color: 'var(--kx-text-muted)' }}>Active Trades</span>
                <Crosshair className="w-4 h-4" style={{ color: 'var(--kx-accent)' }} />
              </div>
              <div className="text-2xl font-bold font-mono mb-1" style={{ color: 'var(--kx-text-primary)' }}>{metrics.openTrades} <span className="text-sm" style={{ color: 'var(--kx-text-muted)' }}>/ {metrics.maxOpenTrades}</span></div>
              <div className="w-full bg-black/20 rounded-full h-1.5 mt-3">
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${(metrics.openTrades / metrics.maxOpenTrades) * 100}%`, background: 'var(--kx-accent)' }} />
              </div>
              <div className="text-xs mt-2 text-right" style={{ color: 'var(--kx-text-muted)' }}>Capacity</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="kx-card p-5">
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium" style={{ color: 'var(--kx-text-muted)' }}>Win Rate</span>
                <Target className="w-4 h-4" style={{ color: 'var(--kx-success)' }} />
              </div>
              <div className="text-2xl font-bold font-mono mb-1" style={{ color: 'var(--kx-text-primary)' }}>
                {paperData?.stats?.winRate || 0}%
              </div>
              <div className="text-xs mt-3" style={{ color: 'var(--kx-text-muted)' }}>
                W: {paperData?.stats?.wins || 0} / L: {paperData?.stats?.losses || 0} ({paperData?.stats?.totalTrades || 0} total)
              </div>
            </motion.div>
          </div>

          {/* Paper Trades + Blocked Signals + System Status */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Paper Trades Table */}
            <div className="lg:col-span-2 space-y-4">
              <h3 className="font-semibold flex items-center gap-2" style={{ color: 'var(--kx-text-primary)' }}>
                <DollarSign className="w-4 h-4" /> Paper Trades
              </h3>

              <div className="kx-card overflow-hidden">
                <table className="kx-table">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Side</th>
                      <th>Entry</th>
                      <th>Status</th>
                      <th>P&L</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!paperData?.orders || paperData.orders.length === 0) && (
                      <tr>
                        <td colSpan={6} className="text-center py-8" style={{ color: 'var(--kx-text-muted)' }}>
                          <DollarSign className="w-6 h-6 mx-auto mb-2 opacity-30" />
                          No paper trades yet
                        </td>
                      </tr>
                    )}
                    {paperData?.orders?.slice(0, 15).map((order: any) => (
                      <tr key={order.id}>
                        <td className="font-mono text-sm font-medium">{order.symbol}</td>
                        <td>
                          <span className={`${order.side === 'LONG' ? 'kx-badge-long' : 'kx-badge-short'} px-2 py-0.5 rounded text-xs font-bold`}>
                            {order.side === 'LONG' ? <ArrowUpRight className="w-3 h-3 inline mr-0.5" /> : <ArrowDownRight className="w-3 h-3 inline mr-0.5" />}
                            {order.side}
                          </span>
                        </td>
                        <td className="font-mono text-xs">${order.entryPrice?.toLocaleString()}</td>
                        <td>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            order.status === 'OPEN' ? 'kx-badge-long' :
                            order.status === 'CLOSED' ? 'kx-verdict-approved' :
                            order.status === 'STOPPED' ? 'kx-verdict-blocked' : ''
                          }`}>
                            {order.status}
                          </span>
                        </td>
                        <td className="font-mono text-sm" style={{
                          color: order.pnl != null ? (order.pnl >= 0 ? 'var(--kx-long)' : 'var(--kx-short)') : 'var(--kx-text-muted)'
                        }}>
                          {order.pnl != null ? `${order.pnl >= 0 ? '+' : ''}$${order.pnl.toFixed(2)}` : '—'}
                        </td>
                        <td className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>
                          {timeAgo(order.openedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Blocked Signals */}
              <h3 className="font-semibold flex items-center gap-2 mt-6" style={{ color: 'var(--kx-text-primary)' }}>
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
                        <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>{timeAgo(signal.createdAt)}</span>
                      </div>
                      <div className="text-sm" style={{ color: 'var(--kx-text-secondary)' }}>
                        <span className="font-semibold" style={{ color: 'var(--kx-short)' }}>Blocked:</span> {signal.riskAssessment?.reasons?.[0] || 'Risk limit exceeded'}
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>

            {/* System Status */}
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2" style={{ color: 'var(--kx-text-primary)' }}>
                <Clock className="w-4 h-4" /> System Status
              </h3>
              <div className="kx-card p-5 space-y-4">
                <div>
                  <div className="text-sm mb-1" style={{ color: 'var(--kx-text-muted)' }}>Paper Balance</div>
                  <div className="font-mono text-lg font-bold" style={{ color: 'var(--kx-text-primary)' }}>
                    ${metrics.paperBalance.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-sm mb-1" style={{ color: 'var(--kx-text-muted)' }}>Total P&L</div>
                  <div className="font-mono font-bold" style={{
                    color: (paperData?.stats?.totalPnL || 0) >= 0 ? 'var(--kx-long)' : 'var(--kx-short)'
                  }}>
                    {(paperData?.stats?.totalPnL || 0) >= 0 ? '+' : ''}${paperData?.stats?.totalPnL || 0}
                  </div>
                </div>
                <div>
                  <div className="text-sm mb-1" style={{ color: 'var(--kx-text-muted)' }}>Stop-Out Streak</div>
                  <div className="font-mono">{metrics.consecutiveStops} / 3 trades</div>
                </div>
                <div>
                  <div className="text-sm mb-1" style={{ color: 'var(--kx-text-muted)' }}>Cooldown Status</div>
                  {metrics.cooldownActive ? (
                    <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--kx-warning)' }}>
                      <AlertTriangle className="w-4 h-4" /> Active — Trading Paused
                    </div>
                  ) : (
                    <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--kx-success)' }}>
                      <ShieldCheck className="w-4 h-4" /> Trading Enabled
                    </div>
                  )}
                </div>
                
                <div className="pt-4 mt-4 border-t" style={{ borderColor: 'var(--kx-border)' }}>
                  <button 
                    onClick={executeKillSwitch} 
                    disabled={isKilling}
                    className="w-full kx-btn py-2 rounded-lg font-medium" 
                    style={{ background: 'rgba(255,71,87,0.1)', color: 'var(--kx-short)', opacity: isKilling ? 0.7 : 1 }}
                  >
                    {isKilling ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Trigger Emergency Kill Switch'}
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
