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
} from 'lucide-react';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to load signals');
  }
  return data;
};

function timeAgo(date: Date | string): string {
  const d = new Date(date);
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
  const [searchQuery, setSearchQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSyncingAssets, setIsSyncingAssets] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const { data: assets } = useSWR<any[]>('/api/assets', fetcher, { refreshInterval: 30000 });

  // Fetch signals from API
  const { data: signals, error, isLoading, mutate } = useSWR<any[]>(
    `/api/signals?asset=${filterAsset}&status=${filterStatus}&side=${filterSide}`, 
    fetcher,
    { refreshInterval: 5000 } // Poll every 5s
  );

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
      const selectedSymbol = data?.symbol || symbol || 'BTCUSDT';
      setActionMessage(
        autoSelect
          ? `Auto-selected ${selectedSymbol}. Signal generation queued (${data?.timeframe || '1h'}).`
          : `Signal generation queued for ${selectedSymbol} (${data?.timeframe || '1h'}).`
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
        {error && (
          <p className="text-xs mt-2" style={{ color: 'var(--kx-short)' }}>
            {error.message}
          </p>
        )}
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
          ].map(filter => (
            <select
              key={filter.label}
              value={filter.value}
              onChange={e => filter.setter(e.target.value)}
              className="kx-input"
              style={{ width: 'auto', padding: '6px 28px 6px 10px', fontSize: '13px' }}
            >
              {filter.options.map(opt => (
                <option key={opt} value={opt}>{opt === 'ALL' ? `All ${filter.label}s` : opt}</option>
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

                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3">
                    <span style={{ color: 'var(--kx-text-muted)' }}>Entry: <span className="font-mono font-medium" style={{ color: 'var(--kx-text-primary)' }}>${Number(signal.entry).toLocaleString()}</span></span>
                    <span style={{ color: 'var(--kx-text-muted)' }}>Stop: <span className="font-mono font-medium" style={{ color: 'var(--kx-short)' }}>${Number(signal.stopLoss).toLocaleString()}</span></span>
                    {signal.targets.map((t: any) => (
                      <span key={t.label} style={{ color: 'var(--kx-text-muted)' }}>{t.label}: <span className="font-mono font-medium" style={{ color: 'var(--kx-long)' }}>${Number(t.price).toLocaleString()}</span></span>
                    ))}
                  </div>

                  <p className="text-sm" style={{ color: 'var(--kx-text-secondary)' }}>{signal.reasoning}</p>
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
                    <span className="absolute inset-0 flex items-center justify-center text-sm font-bold font-mono" style={{ color: 'var(--kx-text-primary)' }}>
                      {Math.round(signal.confidence * 100)}%
                    </span>
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
                  {signal.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <button onClick={() => updateSignalStatus(signal.id, 'APPROVED')} className="kx-btn p-2 rounded-lg hover:scale-105" style={{ background: 'rgba(0,212,170,0.12)', color: 'var(--kx-long)' }}>
                        <ThumbsUp className="w-4 h-4" />
                      </button>
                      <button onClick={() => updateSignalStatus(signal.id, 'BLOCKED')} className="kx-btn p-2 rounded-lg hover:scale-105" style={{ background: 'rgba(255,71,87,0.12)', color: 'var(--kx-short)' }}>
                        <ThumbsDown className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}

        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-16" style={{ color: 'var(--kx-text-muted)' }}>
            <p className="text-lg">No signals match your filters</p>
            <p className="text-sm mt-1">Try adjusting the filter criteria</p>
          </div>
        )}
      </div>
    </div>
  );
}
