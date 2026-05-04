'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Filter,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  Clock,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  Zap,
  RefreshCw,
  ScrollText,
} from 'lucide-react';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to load signals');
  }
  return data;
};

function timeAgo(date: any): string {
  if (!date) return 'Just now';
  let d: Date;
  if (date.toDate && typeof date.toDate === 'function') {
    d = date.toDate();
  } else {
    d = new Date(date);
  }
  if (isNaN(d.getTime())) return 'Recently';
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function SignalsPage() {
  const defaultSymbols = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];
  const [filterAsset, setFilterAsset] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterSide, setFilterSide] = useState('ALL');
  const [filterQuality, setFilterQuality] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [displayLimit, setDisplayLimit] = useState(10);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSyncingAssets, setIsSyncingAssets] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const { data: assets } = useSWR<any[]>('/api/assets', fetcher, { refreshInterval: 30000 });

  // Fetch signals from API
  const { data: signals, error, isLoading, mutate } = useSWR<any[]>(
    `/api/signals?asset=${filterAsset}&status=${filterStatus}&side=${filterSide}&limit=${displayLimit}`, 
    fetcher,
    { refreshInterval: 5000 } // Poll every 5s
  );
  
  // Fetch system logs
  const { data: logs } = useSWR<any[]>(
    isLogsOpen ? '/api/logs' : null,
    fetcher,
    { refreshInterval: 3000 }
  );

  const deleteSignal = async (id: string) => {
    if (!confirm('Are you sure you want to delete this signal?')) return;
    try {
      const res = await fetch(`/api/signals/${id}`, { method: 'DELETE' });
      if (res.ok) {
        mutate();
      }
    } catch (err) {
      console.error('Failed to delete signal', err);
    }
  };

  const updateSignalStatus = async (id: string, newStatus: 'APPROVED' | 'BLOCKED') => {
    try {
      const res = await fetch(`/api/signals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        mutate();
      }
    } catch (err) {
      console.error('Failed to update signal status', err);
    }
  };

  const triggerSignalGeneration = async () => {
    const autoSelect = filterAsset === 'ALL';
    const symbol = autoSelect ? undefined : filterAsset;
    setIsGenerating(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe: '1h',
          autoSelect,
          sideFilter: filterSide,
          assetQuery: searchQuery.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to queue signal generation');
      }
      
      const symbols = data?.symbols || [data?.symbol || symbol || 'BTCUSDT'];
      setActionMessage(
        autoSelect
          ? `Scanning top 200 assets... Found and queued: ${symbols.join(', ')}.`
          : `Signal generation queued for ${symbols[0]} (${data?.timeframe || '1h'}).`
      );
      mutate();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to queue signal generation');
    } finally {
      setIsGenerating(false);
    }
  };

  const syncAssets = async () => {
    setIsSyncingAssets(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/assets', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sync assets');
      }
      setActionMessage(`Assets synced successfully (${data.count || 0} symbols).`);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to sync assets');
    } finally {
      setIsSyncingAssets(false);
    }
  };

  const filtered = (signals || []).filter(s => {
    const symbol = String(s?.asset?.symbol || s?.symbol || '').toLowerCase();
    const query = searchQuery.toLowerCase().trim();
    if (query && !symbol.includes(query)) return false;

    // Quality Filter
    if (filterQuality === 'HIGH_PROB' && s.confidence < 0.7) return false;
    if (filterQuality === 'ELITE_ONLY' && s.confidence < 0.85) return false;

    return true;
  });

  const assetOptions = Array.from(
    new Set([
      ...defaultSymbols,
      ...(assets || []).map((asset) => String(asset?.symbol || '').toUpperCase()).filter(Boolean),
    ])
  ).sort();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--kx-text-primary)' }}>Signals Board</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--kx-text-muted)' }}>
          Review, filter, and manage AI-generated trading signals
        </p>
        {actionMessage && (
          <p className="text-xs mt-2" style={{ color: 'var(--kx-text-muted)' }}>
            {actionMessage}
          </p>
        )}
      </div>

      {/* Header Actions */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsLogsOpen(true)}
            className="kx-btn px-3 py-2 text-xs font-medium flex items-center gap-1.5"
            style={{ background: 'rgba(59,130,246,0.08)', color: 'var(--kx-accent)' }}
          >
            <ScrollText className="w-3.5 h-3.5" />
            System Logs
          </button>
          
          <div className="flex items-center gap-1 bg-white/5 backdrop-blur-md rounded-xl p-1 border border-white/10 shadow-xl">
            {[
              { val: 10, label: 'TOP 10', color: 'from-indigo-500 to-blue-600' },
              { val: 20, label: 'TOP 20', color: 'from-blue-500 to-cyan-600' },
              { val: 50, label: 'TOP 50', color: 'from-cyan-500 to-emerald-600' }
            ].map(limit => (
              <button
                key={limit.val}
                onClick={() => setDisplayLimit(limit.val)}
                className={`relative px-4 py-1.5 text-[10px] font-black tracking-widest rounded-lg transition-all duration-300 overflow-hidden group ${
                  displayLimit === limit.val 
                    ? `bg-gradient-to-r ${limit.color} text-white shadow-lg shadow-blue-500/20 scale-105` 
                    : 'text-kx-text-muted hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="relative z-10">{limit.label}</span>
                {displayLimit === limit.val && (
                  <motion.div
                    layoutId="active-limit"
                    className="absolute inset-0 bg-white/20 backdrop-blur-sm"
                    initial={false}
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filters bar */}
      <div className="kx-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2" style={{ color: 'var(--kx-text-muted)' }}>
            <Filter className="w-4 h-4" />
            <span className="text-sm font-medium">Filters:</span>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--kx-text-muted)' }} />
            <input
              type="text"
              placeholder="Search asset..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="kx-input pl-9 w-40"
              style={{ padding: '6px 10px 6px 36px', fontSize: '13px' }}
            />
          </div>

          {[
            { label: 'Asset', value: filterAsset, setter: setFilterAsset, options: ['ALL', ...assetOptions] },
            { label: 'Status', value: filterStatus, setter: setFilterStatus, options: ['ALL', 'PENDING', 'APPROVED', 'BLOCKED', 'EXPIRED'] },
            { label: 'Side', value: filterSide, setter: setFilterSide, options: ['ALL', 'LONG', 'SHORT', 'HOLD'] },
            { label: 'Quality', value: filterQuality, setter: setFilterQuality, options: ['ALL', 'HIGH_PROB', 'ELITE_ONLY'] },
          ].map(filter => (
            <select
              key={filter.label}
              value={filter.value}
              onChange={e => filter.setter(e.target.value)}
              className="kx-input"
              style={{ width: 'auto', padding: '6px 28px 6px 10px', fontSize: '13px' }}
            >
              {filter.options.map(opt => (
                <option key={opt} value={opt}>
                  {opt === 'ALL' ? `All ${filter.label}s` : 
                   opt === 'HIGH_PROB' ? 'High Prob (>70%)' :
                   opt === 'ELITE_ONLY' ? 'Elite (>85%)' : opt}
                </option>
              ))}
            </select>
          ))}

          <span className="text-xs ml-auto" style={{ color: 'var(--kx-text-muted)' }}>
            {filtered.length} signal{filtered.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={syncAssets}
            disabled={isSyncingAssets}
            className="kx-btn px-3 py-2 text-xs font-medium flex items-center gap-1.5"
            style={{ opacity: isSyncingAssets ? 0.7 : 1 }}
          >
            {isSyncingAssets ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync Assets
          </button>
          <button
            onClick={triggerSignalGeneration}
            disabled={isGenerating}
            className="kx-btn kx-btn-primary px-3 py-2 text-xs font-medium flex items-center gap-1.5"
            style={{ opacity: isGenerating ? 0.7 : 1 }}
          >
            {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Generate Signal
          </button>
        </div>
      </div>

      {/* Signals list */}
      <div className="space-y-3">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 text-muted">
            <Loader2 className="w-8 h-8 animate-spin mb-4" style={{ color: 'var(--kx-accent)' }} />
            <p style={{ color: 'var(--kx-text-muted)' }}>Loading AI signals...</p>
          </div>
        )}
        {!isLoading && filtered.map((signal, i) => {
          const riskVerdict = signal.riskAssessment?.verdict || 'BLOCKED';
          const primaryVote = signal.votes?.find((v: any) => v.role === 'PRIMARY')?.side || 'HOLD';
          const confVote = signal.votes?.find((v: any) => v.role === 'CONFIRMATION')?.side || 'HOLD';
          
          const SideIcon = signal.side === 'LONG' ? ArrowUpRight : signal.side === 'SHORT' ? ArrowDownRight : Minus;
          const sideBadge = signal.side === 'LONG' ? 'kx-badge-long' : signal.side === 'SHORT' ? 'kx-badge-short' : 'kx-badge-hold';
          const verdictBadge = riskVerdict === 'APPROVED' ? 'kx-verdict-approved' : riskVerdict === 'REDUCED' ? 'kx-verdict-reduced' : riskVerdict === 'WATCH_ONLY' ? 'kx-verdict-watch' : 'kx-verdict-blocked';
          const VerdictIcon = riskVerdict === 'APPROVED' ? CheckCircle2 : riskVerdict === 'REDUCED' ? AlertTriangle : riskVerdict === 'BLOCKED' ? XCircle : Eye;
          const agreement = primaryVote === confVote;

          return (
            <motion.div
              key={signal.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="kx-card p-5"
              style={{ borderLeft: `3px solid ${signal.side === 'LONG' ? 'var(--kx-long)' : signal.side === 'SHORT' ? 'var(--kx-short)' : 'var(--kx-hold)'}` }}
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="font-bold font-mono text-lg" style={{ color: 'var(--kx-text-primary)' }}>{signal.asset.symbol}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--kx-bg-surface)', color: 'var(--kx-text-muted)' }}>{signal.timeframe}</span>
                    <span className={`${sideBadge} px-2.5 py-0.5 rounded-md text-xs font-bold flex items-center gap-1`}>
                      <SideIcon className="w-3.5 h-3.5" />{signal.side}
                    </span>
                    <span className={`${verdictBadge} px-2 py-0.5 rounded-md text-xs font-medium flex items-center gap-1`}>
                      <VerdictIcon className="w-3 h-3" />{riskVerdict.replace('_', ' ')}
                    </span>
                    <span className="text-xs flex items-center gap-1" style={{ color: 'var(--kx-text-muted)' }}>
                      <Clock className="w-3 h-3" />{timeAgo(signal.createdAt)}
                    </span>
                  </div>

                  {signal.side !== 'HOLD' && (
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3">
                      <span style={{ color: 'var(--kx-text-muted)' }}>Entry: <span className="font-mono font-medium" style={{ color: 'var(--kx-text-primary)' }}>${Number(signal.entry).toLocaleString()}</span></span>
                      <span style={{ color: 'var(--kx-text-muted)' }}>Stop: <span className="font-mono font-medium" style={{ color: 'var(--kx-short)' }}>${Number(signal.stopLoss).toLocaleString()}</span></span>
                      {signal.targets?.map((t: any) => (
                        <span key={t.label} style={{ color: 'var(--kx-text-muted)' }}>{t.label}: <span className="font-mono font-medium" style={{ color: 'var(--kx-long)' }}>${Number(t.price).toLocaleString()}</span></span>
                      ))}
                    </div>
                  )}

                  <p className="text-sm" style={{ color: 'var(--kx-text-secondary)' }}>{signal.reasoning}</p>

                  {riskVerdict === 'BLOCKED' && signal.riskAssessment?.reasons?.length > 0 && (
                    <div className="mt-3 p-3 rounded-md bg-red-500/10 border border-red-500/20">
                      <span className="text-xs font-bold text-red-400 uppercase tracking-wider mb-1 block flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Blocked by Risk Engine
                      </span>
                      <ul className="list-disc pl-5 space-y-1 text-xs text-red-300/90 mt-2">
                        {signal.riskAssessment.reasons.map((reason: string, idx: number) => (
                          <li key={idx}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex lg:flex-col items-center gap-4 lg:gap-3 shrink-0">
                  {/* Confidence */}
                  <div className="relative w-16 h-16">
                    <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                      <circle cx="32" cy="32" r="28" fill="none" stroke="var(--kx-border)" strokeWidth="3" />
                      <circle cx="32" cy="32" r="28" fill="none"
                        stroke={signal.side === 'LONG' ? 'var(--kx-long)' : signal.side === 'SHORT' ? 'var(--kx-short)' : 'var(--kx-hold)'}
                        strokeWidth="3" strokeDasharray={`${2 * Math.PI * 28 * signal.confidence} ${2 * Math.PI * 28}`} strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-sm font-bold font-mono" style={{ color: 'var(--kx-text-primary)' }}>
                        {Math.round(signal.confidence * 100)}%
                      </span>
                      <span className="text-[8px] uppercase tracking-tighter opacity-50 font-bold">Confidence</span>
                    </div>
                  </div>

                  {/* Model votes */}
                  <div className="text-center">
                    <div className="text-xs mb-1" style={{ color: 'var(--kx-text-muted)' }}>Votes</div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.15)', color: 'var(--kx-accent)' }}>OR: {primaryVote}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }}>OA: {confVote}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 justify-center">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: agreement ? 'var(--kx-success)' : 'var(--kx-warning)' }} />
                      <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>{agreement ? 'Agree' : 'Disagree'}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {signal.status === 'PENDING' && (
                      <>
                        <button onClick={() => updateSignalStatus(signal.id, 'APPROVED')} className="kx-btn p-2 rounded-lg hover:scale-105" style={{ background: 'rgba(0,212,170,0.12)', color: 'var(--kx-long)' }}>
                          <ThumbsUp className="w-4 h-4" />
                        </button>
                        <button onClick={() => updateSignalStatus(signal.id, 'BLOCKED')} className="kx-btn p-2 rounded-lg hover:scale-105" style={{ background: 'rgba(255,71,87,0.12)', color: 'var(--kx-short)' }}>
                          <ThumbsDown className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <button 
                      onClick={() => deleteSignal(signal.id)} 
                      className="kx-btn p-2 rounded-lg hover:scale-105" 
                      style={{ background: 'rgba(255,71,87,0.08)', color: 'var(--kx-text-muted)' }}
                      title="Delete signal"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Logs Modal */}
      {isLogsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="kx-card w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden shadow-2xl border-kx-accent/20"
          >
            <div className="p-4 border-b border-kx-border flex items-center justify-between bg-kx-bg-surface">
              <div className="flex items-center gap-2">
                <ScrollText className="w-5 h-5 text-kx-accent" />
                <h2 className="font-bold">System Worker Logs</h2>
              </div>
              <button onClick={() => setIsLogsOpen(false)} className="p-1 hover:bg-kx-border rounded-md transition-colors">
                <XCircle className="w-6 h-6 text-kx-text-muted" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs bg-black/40">
              {logs?.length === 0 && <p className="text-center py-8 text-kx-text-muted italic">No logs found yet...</p>}
              {logs?.map((log) => {
                const levelColors = {
                  INFO: 'text-kx-text-secondary',
                  WARN: 'text-kx-warning',
                  ERROR: 'text-kx-short',
                  SUCCESS: 'text-kx-success',
                };
                return (
                  <div key={log.id} className="flex gap-3 py-1 border-b border-white/5 last:border-0 group">
                    <span className="text-kx-text-muted shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                    <span className={`font-bold shrink-0 w-24 ${levelColors[log.level as keyof typeof levelColors]}`}>[{log.source}]</span>
                    <span className="text-kx-text-primary break-all">{log.message}</span>
                  </div>
                );
              })}
            </div>
            
            <div className="p-3 bg-kx-bg-surface border-t border-kx-border flex justify-end">
              <button 
                onClick={() => setIsLogsOpen(false)}
                className="kx-btn kx-btn-primary px-4 py-1.5 text-xs font-medium"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
