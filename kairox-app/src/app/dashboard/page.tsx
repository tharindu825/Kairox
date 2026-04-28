'use client';

import useSWR from 'swr';
import { motion } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Signal, Shield, Activity, BarChart3, Clock,
  ArrowUpRight, ArrowDownRight, Minus, AlertTriangle, CheckCircle2, XCircle,
  Eye, Loader2, Zap,
} from 'lucide-react';
import Link from 'next/link';

const fetcher = (url: string) => fetch(url).then(r => r.json());

function timeAgo(date: Date | string): string {
  const d = new Date(date);
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function DashboardPage() {
  const { data: signals } = useSWR('/api/signals', fetcher, { refreshInterval: 5000 });
  const { data: risk } = useSWR('/api/risk', fetcher, { refreshInterval: 5000 });
  const { data: paper } = useSWR('/api/paper-trades', fetcher, { refreshInterval: 5000 });

  const todaySignals = signals?.filter((s: any) => {
    const d = new Date(s.createdAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  })?.length || 0;

  const winRate = paper?.stats?.winRate || 0;
  const activeTrades = risk?.metrics?.openTrades || 0;
  const maxTrades = risk?.metrics?.maxOpenTrades || 5;
  const totalPnL = paper?.stats?.totalPnL || 0;
  const recentSignals = (signals || []).slice(0, 5);

  const kpis = [
    { label: 'Signals Today', value: String(todaySignals), icon: Signal, color: '#3b82f6' },
    { label: 'Win Rate', value: `${winRate}%`, icon: BarChart3, color: winRate >= 50 ? '#00d4aa' : '#ff4757' },
    { label: 'Active Trades', value: `${activeTrades}/${maxTrades}`, icon: Activity, color: '#f59e0b' },
    { label: 'Paper P&L', value: `${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}`, icon: TrendingUp, color: totalPnL >= 0 ? '#10b981' : '#ff4757' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--kx-text-primary)' }}>Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--kx-text-muted)' }}>Real-time overview of your AI trading signals</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {kpis.map((kpi, i) => (
          <motion.div key={kpi.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
            className="kx-card p-4 sm:p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center" style={{ background: `${kpi.color}15` }}>
                <kpi.icon className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: kpi.color }} />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-bold font-mono" style={{ color: 'var(--kx-text-primary)' }}>{kpi.value}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--kx-text-muted)' }}>{kpi.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Recent Signals */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2" style={{ color: 'var(--kx-text-primary)' }}>
              <Zap className="w-4 h-4" style={{ color: 'var(--kx-accent)' }} />
              Recent Signals
            </h2>
            <Link href="/dashboard/signals" className="text-xs hover:underline" style={{ color: 'var(--kx-accent)' }}>View All →</Link>
          </div>

          {!signals ? (
            <div className="kx-card p-12 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--kx-accent)' }} />
            </div>
          ) : recentSignals.length === 0 ? (
            <div className="kx-card p-12 text-center" style={{ color: 'var(--kx-text-muted)' }}>
              <Signal className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No signals generated yet</p>
              <p className="text-xs mt-1">Start the worker and market data stream to generate signals</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentSignals.map((signal: any, i: number) => {
                const SideIcon = signal.side === 'LONG' ? ArrowUpRight : signal.side === 'SHORT' ? ArrowDownRight : Minus;
                const VerdictIcon = signal.riskAssessment?.verdict === 'APPROVED' ? CheckCircle2 :
                                    signal.riskAssessment?.verdict === 'BLOCKED' ? XCircle :
                                    signal.riskAssessment?.verdict === 'REDUCED' ? AlertTriangle : Eye;

                return (
                  <motion.div key={signal.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                    className="kx-card p-4 sm:p-5"
                    style={{
                      borderLeft: `3px solid ${signal.side === 'LONG' ? 'var(--kx-long)' : signal.side === 'SHORT' ? 'var(--kx-short)' : 'var(--kx-hold)'}`,
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className="font-mono font-bold text-sm" style={{ color: 'var(--kx-text-primary)' }}>{signal.asset?.symbol}</span>
                      <span className={`${signal.side === 'LONG' ? 'kx-badge-long' : signal.side === 'SHORT' ? 'kx-badge-short' : 'kx-badge-hold'} px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1`}>
                        <SideIcon className="w-3 h-3" />{signal.side}
                      </span>

                      {/* Confidence ring */}
                      <div className="relative w-7 h-7">
                        <svg className="w-7 h-7 -rotate-90" viewBox="0 0 28 28">
                          <circle cx="14" cy="14" r="11" fill="none" stroke="var(--kx-border)" strokeWidth="2" />
                          <circle cx="14" cy="14" r="11" fill="none"
                            stroke={signal.side === 'LONG' ? 'var(--kx-long)' : signal.side === 'SHORT' ? 'var(--kx-short)' : 'var(--kx-hold)'}
                            strokeWidth="2" strokeDasharray={`${2 * Math.PI * 11 * signal.confidence} ${2 * Math.PI * 11}`}
                            strokeLinecap="round" />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold font-mono" style={{ color: 'var(--kx-text-primary)' }}>
                          {Math.round(signal.confidence * 100)}
                        </span>
                      </div>

                      {signal.riskAssessment?.verdict && (
                        <span className={`${
                          signal.riskAssessment.verdict === 'APPROVED' ? 'kx-verdict-approved' :
                          signal.riskAssessment.verdict === 'REDUCED' ? 'kx-verdict-reduced' :
                          signal.riskAssessment.verdict === 'WATCH_ONLY' ? 'kx-verdict-watch' : 'kx-verdict-blocked'
                        } px-2 py-0.5 rounded text-xs flex items-center gap-1`}>
                          <VerdictIcon className="w-3 h-3" />
                          {signal.riskAssessment.verdict.replace('_', ' ')}
                        </span>
                      )}

                      <span className="text-xs ml-auto" style={{ color: 'var(--kx-text-muted)' }}>{timeAgo(signal.createdAt)}</span>
                    </div>

                    {/* Price levels */}
                    <div className="flex flex-wrap gap-4 text-xs">
                      <div>
                        <span style={{ color: 'var(--kx-text-muted)' }}>Entry </span>
                        <span className="font-mono font-medium" style={{ color: 'var(--kx-text-primary)' }}>${Number(signal.entry).toLocaleString()}</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--kx-text-muted)' }}>SL </span>
                        <span className="font-mono font-medium" style={{ color: 'var(--kx-short)' }}>${Number(signal.stopLoss).toLocaleString()}</span>
                      </div>
                      {(signal.targets as any[])?.[0] && (
                        <div>
                          <span style={{ color: 'var(--kx-text-muted)' }}>TP1 </span>
                          <span className="font-mono font-medium" style={{ color: 'var(--kx-long)' }}>${Number((signal.targets as any[])[0].price).toLocaleString()}</span>
                        </div>
                      )}
                    </div>

                    {signal.reasoning && (
                      <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--kx-text-secondary)' }}>{signal.reasoning}</p>
                    )}

                    {/* Model votes */}
                    {signal.votes?.length > 0 && (
                      <div className="flex gap-2 mt-2">
                        {signal.votes.map((v: any, vi: number) => (
                          <div key={vi} className="text-xs px-2 py-0.5 rounded"
                            style={{
                              background: v.role === 'PRIMARY' ? 'rgba(59,130,246,0.12)' : 'rgba(139,92,246,0.12)',
                              color: v.role === 'PRIMARY' ? 'var(--kx-accent)' : '#8b5cf6',
                            }}>
                            {v.role === 'PRIMARY' ? 'OR' : 'OA'}: {v.side}
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* System Status Panel */}
        <div className="space-y-4">
          {/* Risk Overview */}
          <h2 className="font-semibold flex items-center gap-2" style={{ color: 'var(--kx-text-primary)' }}>
            <Shield className="w-4 h-4" style={{ color: 'var(--kx-warning)' }} />
            Risk Overview
          </h2>
          <div className="kx-card p-5 space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span style={{ color: 'var(--kx-text-muted)' }}>Capital at Risk</span>
                <span className="font-mono font-medium" style={{ color: 'var(--kx-text-primary)' }}>{risk?.metrics?.capitalAtRisk || 0}%</span>
              </div>
              <div className="w-full bg-black/20 rounded-full h-1.5">
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min(((risk?.metrics?.capitalAtRisk || 0) / (risk?.metrics?.maxCapitalRisk || 10)) * 100, 100)}%`, background: 'var(--kx-warning)' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1">
                <span style={{ color: 'var(--kx-text-muted)' }}>Daily Drawdown</span>
                <span className="font-mono font-medium" style={{ color: (risk?.metrics?.dailyPnL || 0) >= 0 ? 'var(--kx-long)' : 'var(--kx-short)' }}>
                  {(risk?.metrics?.dailyPnL || 0) >= 0 ? '+' : ''}${risk?.metrics?.dailyPnL || 0}
                </span>
              </div>
              <div className="w-full bg-black/20 rounded-full h-1.5">
                <div className="h-1.5 rounded-full transition-all" style={{
                  width: `${Math.min(Math.abs(risk?.metrics?.dailyDrawdown || 0) / Math.abs(risk?.metrics?.maxDrawdown || 5) * 100, 100)}%`,
                  background: 'var(--kx-short)'
                }} />
              </div>
            </div>

            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--kx-text-muted)' }}>Stop-out Streak</span>
              <span className="font-mono" style={{ color: 'var(--kx-text-primary)' }}>{risk?.metrics?.consecutiveStops || 0} / 3</span>
            </div>

            <div className="pt-3 mt-3" style={{ borderTop: '1px solid var(--kx-glass-border)' }}>
              {risk?.metrics?.cooldownActive ? (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--kx-warning)' }}>
                  <AlertTriangle className="w-4 h-4" /> Cooldown Active
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--kx-success)' }}>
                  <CheckCircle2 className="w-4 h-4" /> Trading Enabled
                </div>
              )}
            </div>

            <Link href="/dashboard/risk" className="block text-center text-xs py-2 rounded-lg hover:bg-white/5 transition-colors" style={{ color: 'var(--kx-accent)' }}>
              Open Risk Center →
            </Link>
          </div>

          {/* Quick Stats */}
          <div className="kx-card p-5 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--kx-text-primary)' }}>
              <BarChart3 className="w-4 h-4" style={{ color: 'var(--kx-accent)' }} />
              Trade Stats
            </h3>
            {[
              { label: 'Total Trades', value: paper?.stats?.totalTrades || 0 },
              { label: 'Wins', value: paper?.stats?.wins || 0, color: 'var(--kx-long)' },
              { label: 'Losses', value: paper?.stats?.losses || 0, color: 'var(--kx-short)' },
              { label: 'Paper Balance', value: `$${(risk?.metrics?.paperBalance || 10000).toLocaleString()}` },
            ].map(s => (
              <div key={s.label} className="flex justify-between text-sm">
                <span style={{ color: 'var(--kx-text-muted)' }}>{s.label}</span>
                <span className="font-mono font-medium" style={{ color: s.color || 'var(--kx-text-primary)' }}>{s.value}</span>
              </div>
            ))}
          </div>

          {/* System Health */}
          <div className="kx-card p-5 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--kx-text-primary)' }}>
              <Clock className="w-4 h-4" style={{ color: 'var(--kx-text-muted)' }} />
              System Health
            </h3>
            {[
              { label: 'Data Stream', status: true },
              { label: 'Signal Worker', status: true },
              { label: 'Alert Worker', status: true },
              { label: 'Database', status: true },
            ].map(s => (
              <div key={s.label} className="flex justify-between items-center text-sm">
                <span style={{ color: 'var(--kx-text-muted)' }}>{s.label}</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: s.status ? 'var(--kx-success)' : 'var(--kx-danger)' }} />
                  <span className="text-xs" style={{ color: s.status ? 'var(--kx-success)' : 'var(--kx-danger)' }}>
                    {s.status ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
