'use client';

import { motion } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Signal,
  Shield,
  Activity,
  BarChart3,
  Clock,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
} from 'lucide-react';

// Demo data — will be replaced with real API calls
const kpis = [
  { label: 'Signals Today', value: '7', change: '+3', trend: 'up', icon: Signal, color: '#3b82f6' },
  { label: 'Win Rate (7d)', value: '68%', change: '+5%', trend: 'up', icon: BarChart3, color: '#00d4aa' },
  { label: 'Active Trades', value: '3', change: '0', trend: 'neutral', icon: Activity, color: '#f59e0b' },
  { label: 'Paper P&L', value: '+$1,284', change: '+12%', trend: 'up', icon: TrendingUp, color: '#10b981' },
];

const recentSignals = [
  {
    id: '1',
    asset: 'BTCUSDT',
    side: 'LONG' as const,
    confidence: 0.82,
    entry: 67450,
    stopLoss: 66800,
    targets: [{ price: 68500, label: 'TP1' }, { price: 69800, label: 'TP2' }],
    status: 'APPROVED' as const,
    riskVerdict: 'APPROVED' as const,
    reasoning: 'RSI divergence on 4H with EMA200 bounce. Volume surge confirms buyer interest.',
    keyFactors: ['RSI Divergence', 'EMA200 Support', 'Volume Breakout'],
    createdAt: new Date(Date.now() - 1800000),
    votes: { primary: 'LONG', confirmation: 'LONG', agreement: true },
  },
  {
    id: '2',
    asset: 'ETHUSDT',
    side: 'SHORT' as const,
    confidence: 0.71,
    entry: 3285,
    stopLoss: 3340,
    targets: [{ price: 3200, label: 'TP1' }, { price: 3120, label: 'TP2' }],
    status: 'PENDING' as const,
    riskVerdict: 'REDUCED' as const,
    reasoning: 'Bearish engulfing at resistance with declining volume. MACD crossover confirms momentum shift.',
    keyFactors: ['Bearish Engulfing', 'Resistance Zone', 'MACD Crossover'],
    createdAt: new Date(Date.now() - 3600000),
    votes: { primary: 'SHORT', confirmation: 'SHORT', agreement: true },
  },
  {
    id: '3',
    asset: 'BTCUSDT',
    side: 'HOLD' as const,
    confidence: 0.45,
    entry: 67200,
    stopLoss: 66500,
    targets: [{ price: 68000, label: 'TP1' }],
    status: 'BLOCKED' as const,
    riskVerdict: 'BLOCKED' as const,
    reasoning: 'Mixed signals between models. RSI neutral, no clear structure break.',
    keyFactors: ['Model Disagreement', 'Neutral RSI', 'No Structure Break'],
    createdAt: new Date(Date.now() - 7200000),
    votes: { primary: 'LONG', confirmation: 'HOLD', agreement: false },
  },
];

const systemHealth = {
  dataFreshness: '< 1s',
  queueDepth: 0,
  modelLatency: '1.2s',
  uptime: '99.8%',
};

const getSideColor = (side: string) => {
  switch (side) {
    case 'LONG': return 'var(--kx-long)';
    case 'SHORT': return 'var(--kx-short)';
    default: return 'var(--kx-hold)';
  }
};

const getSideBadge = (side: string) => {
  switch (side) {
    case 'LONG': return 'kx-badge-long';
    case 'SHORT': return 'kx-badge-short';
    default: return 'kx-badge-hold';
  }
};

const getVerdictBadge = (verdict: string) => {
  switch (verdict) {
    case 'APPROVED': return 'kx-verdict-approved';
    case 'REDUCED': return 'kx-verdict-reduced';
    case 'WATCH_ONLY': return 'kx-verdict-watch';
    case 'BLOCKED': return 'kx-verdict-blocked';
    default: return '';
  }
};

const getVerdictIcon = (verdict: string) => {
  switch (verdict) {
    case 'APPROVED': return CheckCircle2;
    case 'REDUCED': return AlertTriangle;
    case 'WATCH_ONLY': return Eye;
    case 'BLOCKED': return XCircle;
    default: return Shield;
  }
};

const getSideIcon = (side: string) => {
  switch (side) {
    case 'LONG': return ArrowUpRight;
    case 'SHORT': return ArrowDownRight;
    default: return Minus;
  }
};

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--kx-text-primary)' }}>Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--kx-text-muted)' }}>
          AI signal overview and portfolio status
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
            className="kx-card p-5"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                   style={{ background: `${kpi.color}15` }}>
                <kpi.icon className="w-5 h-5" style={{ color: kpi.color }} />
              </div>
              {kpi.trend !== 'neutral' && (
                <span className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md"
                      style={{
                        color: kpi.trend === 'up' ? 'var(--kx-long)' : 'var(--kx-short)',
                        background: kpi.trend === 'up' ? 'var(--kx-long-bg)' : 'var(--kx-short-bg)',
                      }}>
                  {kpi.trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {kpi.change}
                </span>
              )}
            </div>
            <div className="text-2xl font-bold font-mono" style={{ color: 'var(--kx-text-primary)' }}>
              {kpi.value}
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--kx-text-muted)' }}>
              {kpi.label}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Signals — takes 2 columns */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--kx-text-primary)' }}>
              Latest Signals
            </h2>
            <a href="/dashboard/signals" className="text-sm font-medium hover:underline" style={{ color: 'var(--kx-accent)' }}>
              View All →
            </a>
          </div>

          <div className="space-y-3">
            {recentSignals.map((signal, i) => {
              const SideIcon = getSideIcon(signal.side);
              const VerdictIcon = getVerdictIcon(signal.riskVerdict);

              return (
                <motion.div
                  key={signal.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                  className="kx-card p-4"
                  style={{ borderLeft: `3px solid ${getSideColor(signal.side)}` }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex-1">
                      {/* Header row */}
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-bold font-mono text-base" style={{ color: 'var(--kx-text-primary)' }}>
                          {signal.asset}
                        </span>
                        <span className={`${getSideBadge(signal.side)} px-2.5 py-0.5 rounded-md text-xs font-bold uppercase flex items-center gap-1`}>
                          <SideIcon className="w-3.5 h-3.5" />
                          {signal.side}
                        </span>
                        <span className={`${getVerdictBadge(signal.riskVerdict)} px-2 py-0.5 rounded-md text-xs font-medium flex items-center gap-1`}>
                          <VerdictIcon className="w-3 h-3" />
                          {signal.riskVerdict}
                        </span>
                      </div>

                      {/* Price levels */}
                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm mb-2">
                        <span style={{ color: 'var(--kx-text-muted)' }}>
                          Entry: <span className="font-mono font-medium" style={{ color: 'var(--kx-text-primary)' }}>${signal.entry.toLocaleString()}</span>
                        </span>
                        <span style={{ color: 'var(--kx-text-muted)' }}>
                          Stop: <span className="font-mono font-medium" style={{ color: 'var(--kx-short)' }}>${signal.stopLoss.toLocaleString()}</span>
                        </span>
                        {signal.targets.map(t => (
                          <span key={t.label} style={{ color: 'var(--kx-text-muted)' }}>
                            {t.label}: <span className="font-mono font-medium" style={{ color: 'var(--kx-long)' }}>${t.price.toLocaleString()}</span>
                          </span>
                        ))}
                      </div>

                      {/* Reasoning */}
                      <p className="text-sm leading-relaxed" style={{ color: 'var(--kx-text-secondary)' }}>
                        {signal.reasoning}
                      </p>

                      {/* Key factors */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {signal.keyFactors.map(factor => (
                          <span key={factor} className="text-xs px-2 py-0.5 rounded-md"
                                style={{ background: 'var(--kx-bg-surface)', color: 'var(--kx-text-muted)' }}>
                            {factor}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Right side — confidence + meta */}
                    <div className="flex sm:flex-col items-center sm:items-end gap-3 sm:gap-2 shrink-0">
                      {/* Confidence ring */}
                      <div className="relative w-14 h-14">
                        <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                          <circle cx="28" cy="28" r="24" fill="none" stroke="var(--kx-border)" strokeWidth="3" />
                          <circle
                            cx="28" cy="28" r="24" fill="none"
                            stroke={getSideColor(signal.side)}
                            strokeWidth="3"
                            strokeDasharray={`${2 * Math.PI * 24 * signal.confidence} ${2 * Math.PI * 24}`}
                            strokeLinecap="round"
                          />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold font-mono"
                              style={{ color: 'var(--kx-text-primary)' }}>
                          {Math.round(signal.confidence * 100)}%
                        </span>
                      </div>

                      {/* Model agreement */}
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ background: signal.votes.agreement ? 'var(--kx-success)' : 'var(--kx-warning)' }} />
                        <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>
                          {signal.votes.agreement ? 'Models agree' : 'Disagreement'}
                        </span>
                      </div>

                      <span className="text-xs flex items-center gap-1" style={{ color: 'var(--kx-text-muted)' }}>
                        <Clock className="w-3 h-3" />
                        {timeAgo(signal.createdAt)}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Right sidebar — System Health + Quick Stats */}
        <div className="space-y-4">
          {/* System Health */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="kx-card p-5"
          >
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--kx-text-primary)' }}>
              <Zap className="w-4 h-4" style={{ color: 'var(--kx-accent)' }} />
              System Health
            </h3>

            <div className="space-y-3">
              {[
                { label: 'Data Freshness', value: systemHealth.dataFreshness, status: 'good' },
                { label: 'Queue Depth', value: systemHealth.queueDepth.toString(), status: 'good' },
                { label: 'Model Latency', value: systemHealth.modelLatency, status: 'ok' },
                { label: 'Uptime', value: systemHealth.uptime, status: 'good' },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--kx-text-muted)' }}>{item.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium" style={{ color: 'var(--kx-text-primary)' }}>
                      {item.value}
                    </span>
                    <div className="w-2 h-2 rounded-full"
                         style={{ background: item.status === 'good' ? 'var(--kx-success)' : 'var(--kx-warning)' }} />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Risk Exposure */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="kx-card p-5"
          >
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--kx-text-primary)' }}>
              <Shield className="w-4 h-4" style={{ color: 'var(--kx-warning)' }} />
              Risk Exposure
            </h3>

            {/* Risk meter */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>Capital at Risk</span>
                <span className="text-sm font-mono font-bold" style={{ color: 'var(--kx-long)' }}>4.2%</span>
              </div>
              <div className="w-full h-2 rounded-full" style={{ background: 'var(--kx-bg-surface)' }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, #10b981, #f59e0b)', width: '42%' }}
                  initial={{ width: 0 }}
                  animate={{ width: '42%' }}
                  transition={{ delay: 0.8, duration: 0.8, ease: 'easeOut' }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>0%</span>
                <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>10% limit</span>
              </div>
            </div>

            {/* Daily Drawdown */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>Daily Drawdown</span>
                <span className="text-sm font-mono font-bold" style={{ color: 'var(--kx-short)' }}>-1.8%</span>
              </div>
              <div className="w-full h-2 rounded-full" style={{ background: 'var(--kx-bg-surface)' }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, #ef4444, #ff4757)', width: '36%' }}
                  initial={{ width: 0 }}
                  animate={{ width: '36%' }}
                  transition={{ delay: 0.9, duration: 0.8, ease: 'easeOut' }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>0%</span>
                <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>-5% lock</span>
              </div>
            </div>
          </motion.div>

          {/* Model Performance */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="kx-card p-5"
          >
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--kx-text-primary)' }}>
              <Activity className="w-4 h-4" style={{ color: '#8b5cf6' }} />
              Model Performance
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium" style={{ color: 'var(--kx-text-secondary)' }}>OpenRouter</div>
                  <div className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>Claude Sonnet</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono font-bold" style={{ color: 'var(--kx-long)' }}>72%</div>
                  <div className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>accuracy</div>
                </div>
              </div>

              <div className="w-full h-px" style={{ background: 'var(--kx-glass-border)' }} />

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium" style={{ color: 'var(--kx-text-secondary)' }}>OpenAI Direct</div>
                  <div className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>GPT-4o</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono font-bold" style={{ color: 'var(--kx-long)' }}>68%</div>
                  <div className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>accuracy</div>
                </div>
              </div>

              <div className="w-full h-px" style={{ background: 'var(--kx-glass-border)' }} />

              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>Agreement Rate</span>
                <span className="text-sm font-mono font-bold" style={{ color: 'var(--kx-accent)' }}>78%</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
