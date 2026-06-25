'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { motion, AnimatePresence } from 'framer-motion';
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
  Download,
  FlaskConical,
  TrendingUp,
  TrendingDown,
  CandlestickChart,
  DollarSign,
} from 'lucide-react';

const fetcher = async (url: string) => {
  const res  = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to load signals');
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
  if (seconds < 60)  return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)  return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatSignalPrice(price: number): string {
  const p = Number(price);
  if (!Number.isFinite(p) || p === 0) return '—';
  if (p >= 100)  return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return p.toFixed(4);
  if (p >= 0.01) return p.toFixed(5);
  return p.toFixed(6);
}

/** Human-readable label for forex order type enum */
function forexOrderLabel(orderType: string): string {
  return {
    BUY_LIMIT:  'Buy Limit',
    SELL_LIMIT: 'Sell Limit',
    BUY_STOP:   'Buy Stop',
    SELL_STOP:  'Sell Stop',
  }[orderType] || orderType;
}

// ── Default symbols ──────────────────────────────────────────────────────────
const DEFAULT_CRYPTO_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'];
const FOREX_SYMBOLS = [
  'XAU/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF',
  'AUD/USD', 'NZD/USD', 'USD/CAD', 'EUR/JPY', 'GBP/JPY',
];

// ── Market type toggle ───────────────────────────────────────────────────────
type MarketTab = 'ALL' | 'CRYPTO' | 'FOREX';

const MARKET_TABS: { val: MarketTab; label: string; icon: any; gradient: string }[] = [
  { val: 'ALL',    label: 'All Markets',  icon: CandlestickChart, gradient: 'from-slate-500 to-slate-600' },
  { val: 'CRYPTO', label: '🪙 Crypto',    icon: TrendingUp,       gradient: 'from-indigo-500 to-blue-600' },
  { val: 'FOREX',  label: '💱 Forex',     icon: DollarSign,       gradient: 'from-amber-500 to-orange-600' },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function SignalsPage() {
  // Market type
  const [activeMarket, setActiveMarket] = useState<MarketTab>('ALL');

  // Filters
  const [filterAsset,   setFilterAsset]   = useState('ALL');
  const [filterStatus,  setFilterStatus]  = useState('ALL');
  const [filterSide,    setFilterSide]    = useState('ALL');
  const [filterQuality, setFilterQuality] = useState('ALL');
  const [searchQuery,   setSearchQuery]   = useState('');
  const [displayLimit,  setDisplayLimit]  = useState(10);

  // Crypto generation
  const [generateSymbol, setGenerateSymbol] = useState('AUTO');
  const [isGenerating,   setIsGenerating]   = useState(false);

  // Forex generation
  const [forexSymbol,        setForexSymbol]        = useState('XAU/USD');
  const [forexTimeframe,     setForexTimeframe]      = useState('4h');
  const [isForexGenerating,  setIsForexGenerating]   = useState(false);
  const [isForexAutoSelect,  setIsForexAutoSelect]   = useState(false);

  // Shared
  const [isSyncingAssets, setIsSyncingAssets] = useState(false);
  const [isExporting,     setIsExporting]     = useState(false);
  const [isLogsOpen,      setIsLogsOpen]      = useState(false);
  const [actionMessage,   setActionMessage]   = useState('');
  const [shadowTestingIds, setShadowTestingIds] = useState<Record<string, 'loading' | 'done' | 'error'>>({});

  const { data: assets } = useSWR<any[]>('/api/assets', fetcher, { refreshInterval: 30000 });

  // Build API URL with marketType param
  const signalsUrl = `/api/signals?asset=${filterAsset}&status=${filterStatus}&side=${filterSide}&limit=${displayLimit}&marketType=${activeMarket}`;
  const { data: signals, error, isLoading, mutate } = useSWR<any[]>(signalsUrl, fetcher, { refreshInterval: 5000 });

  const { data: logs } = useSWR<any[]>(
    isLogsOpen ? '/api/logs' : null,
    fetcher,
    { refreshInterval: 3000 }
  );

  // ── Actions ──────────────────────────────────────────────────────────────────

  const deleteSignal = async (id: string) => {
    if (!confirm('Are you sure you want to delete this signal?')) return;
    try {
      const res = await fetch(`/api/signals/${id}`, { method: 'DELETE' });
      if (res.ok) mutate();
    } catch (err) { console.error('Failed to delete signal', err); }
  };

  const updateSignalStatus = async (id: string, newStatus: 'APPROVED' | 'BLOCKED') => {
    try {
      const res = await fetch(`/api/signals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) mutate();
    } catch (err) { console.error('Failed to update signal status', err); }
  };

  const triggerSignalGeneration = async () => {
    const autoSelect = generateSymbol === 'AUTO';
    const symbol     = autoSelect ? undefined : generateSymbol;
    setIsGenerating(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe: '4h', autoSelect, sideFilter: 'ALL' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to queue signal generation');
      const symbols = data?.symbols || [data?.symbol || symbol || 'BTCUSDT'];
      setActionMessage(
        autoSelect
          ? `Scanning top assets… Queued: ${symbols.join(', ')}.`
          : `Signal generation queued for ${symbols[0]}.`
      );
      mutate();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to queue signal generation');
    } finally {
      setIsGenerating(false);
    }
  };

  const triggerForexGeneration = async () => {
    setIsForexGenerating(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/forex-signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol:     isForexAutoSelect ? undefined : forexSymbol,
          timeframe:  forexTimeframe,
          autoSelect: isForexAutoSelect,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to queue forex signal');
      const symbols = data?.symbols || [data?.symbol || forexSymbol];
      setActionMessage(
        isForexAutoSelect
          ? `Forex Auto-Scan queued: ${symbols.join(', ')}.`
          : `Forex signal queued for ${symbols[0]}.`
      );
      mutate();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to queue forex signal');
    } finally {
      setIsForexGenerating(false);
    }
  };

  const syncAssets = async () => {
    setIsSyncingAssets(true);
    setActionMessage('');
    try {
      const res  = await fetch('/api/assets', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to sync assets');
      setActionMessage(`Assets synced successfully (${data.count || 0} symbols).`);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to sync assets');
    } finally {
      setIsSyncingAssets(false);
    }
  };

  const exportSignalsCsv = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (filterSide   !== 'ALL') params.set('side',   filterSide);
      if (filterStatus !== 'ALL') params.set('status', filterStatus);
      params.set('limit', '0');
      const url = `/api/signals/export?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Export failed');
      const blob     = await res.blob();
      const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.at(1) ?? 'kairox-signals.csv';
      const link = document.createElement('a');
      link.href     = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const triggerShadowTest = async (signalId: string) => {
    setShadowTestingIds(prev => ({ ...prev, [signalId]: 'loading' }));
    try {
      const res  = await fetch(`/api/signals/${signalId}/paper-test`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create shadow trade');
      setShadowTestingIds(prev => ({ ...prev, [signalId]: 'done' }));
    } catch (err) {
      console.error('Shadow trade failed:', err);
      setShadowTestingIds(prev => ({ ...prev, [signalId]: 'error' }));
      setActionMessage(err instanceof Error ? err.message : 'Shadow trade failed');
      setTimeout(() => {
        setShadowTestingIds(prev => {
          const next = { ...prev };
          if (next[signalId] === 'error') delete next[signalId];
          return next;
        });
      }, 3000);
    }
  };

  // ── Filtered signals ─────────────────────────────────────────────────────────

  const filtered = (signals || []).filter(s => {
    const symbol = String(s?.asset?.symbol || s?.symbol || '').toLowerCase();
    const query  = searchQuery.toLowerCase().trim();
    if (query && !symbol.includes(query)) return false;
    if (filterQuality === 'HIGH_PROB'  && s.confidence < 0.7)  return false;
    if (filterQuality === 'ELITE_ONLY' && s.confidence < 0.85) return false;
    return true;
  });

  const assetOptions = Array.from(new Set([
    ...DEFAULT_CRYPTO_SYMBOLS,
    ...(assets || []).map(a => String(a?.symbol || '').toUpperCase()).filter(Boolean),
  ])).sort();

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--kx-text-primary)' }}>Signals Board</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--kx-text-muted)' }}>
          Review, filter, and manage AI-generated trading signals — Crypto &amp; Forex
        </p>
        {actionMessage && (
          <p className="text-xs mt-2" style={{ color: 'var(--kx-text-muted)' }}>{actionMessage}</p>
        )}
      </div>

      {/* ── Market Type Toggle ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 bg-white/5 backdrop-blur-md rounded-xl p-1.5 border border-white/10 shadow-xl">
          {MARKET_TABS.map(tab => {
            const Icon    = tab.icon;
            const active  = activeMarket === tab.val;
            return (
              <button
                key={tab.val}
                onClick={() => { setActiveMarket(tab.val); setFilterAsset('ALL'); setSearchQuery(''); }}
                className={`relative px-5 py-2 text-xs font-bold tracking-wider rounded-lg transition-all duration-300 flex items-center gap-2 ${
                  active
                    ? `bg-gradient-to-r ${tab.gradient} text-white shadow-lg scale-105`
                    : 'text-kx-text-muted hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                {active && (
                  <motion.div
                    layoutId="active-market-tab"
                    className="absolute inset-0 rounded-lg bg-white/10"
                    initial={false}
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Display Limit + Logs */}
        <div className="ml-auto flex items-center gap-2">
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
              { val: 50, label: 'TOP 50', color: 'from-cyan-500 to-emerald-600' },
            ].map(limit => (
              <button
                key={limit.val}
                onClick={() => setDisplayLimit(limit.val)}
                className={`relative px-4 py-1.5 text-[10px] font-black tracking-widest rounded-lg transition-all duration-300 overflow-hidden ${
                  displayLimit === limit.val
                    ? `bg-gradient-to-r ${limit.color} text-white shadow-lg shadow-blue-500/20 scale-105`
                    : 'text-kx-text-muted hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="relative z-10">{limit.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Generation Panels ─────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {/* Crypto Generation Panel */}
        {(activeMarket === 'ALL' || activeMarket === 'CRYPTO') && (
          <motion.div
            key="crypto-panel"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="kx-card p-4"
          >
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2" style={{ color: 'var(--kx-accent)' }}>
                <Zap className="w-4 h-4" />
                <span className="text-sm font-medium">🪙 Crypto Signal:</span>
              </div>
              <input
                list="generate-coins-list"
                value={generateSymbol}
                onChange={e => setGenerateSymbol(e.target.value.toUpperCase())}
                placeholder="Type coin (e.g. BTCUSDT)"
                className="kx-input font-mono"
                style={{ width: '240px', padding: '6px 10px', fontSize: '13px' }}
              />
              <datalist id="generate-coins-list">
                <option value="AUTO">🤖 Auto-Select Best Candidates</option>
                {assetOptions.filter(a => a !== 'ALL').map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </datalist>
              <button
                onClick={triggerSignalGeneration}
                disabled={isGenerating}
                className="kx-btn kx-btn-primary px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2"
                style={{ opacity: isGenerating ? 0.7 : 1 }}
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                {generateSymbol === 'AUTO' ? 'Run Auto-Selector' : 'Generate 4H Signal'}
              </button>
            </div>
          </motion.div>
        )}

        {/* Forex Generation Panel */}
        {(activeMarket === 'ALL' || activeMarket === 'FOREX') && (
          <motion.div
            key="forex-panel"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="kx-card p-4"
            style={{ borderLeft: '3px solid #f59e0b' }}
          >
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2" style={{ color: '#f59e0b' }}>
                <DollarSign className="w-4 h-4" />
                <span className="text-sm font-medium">💱 Forex Signal:</span>
              </div>

              {/* Auto / Manual toggle */}
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--kx-text-muted)' }}>
                <input
                  type="checkbox"
                  checked={isForexAutoSelect}
                  onChange={e => setIsForexAutoSelect(e.target.checked)}
                  className="rounded"
                />
                Auto-Select
              </label>

              {!isForexAutoSelect && (
                <>
                  <select
                    value={forexSymbol}
                    onChange={e => setForexSymbol(e.target.value)}
                    className="kx-input"
                    style={{ width: 'auto', padding: '6px 28px 6px 10px', fontSize: '13px' }}
                  >
                    {FOREX_SYMBOLS.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>

                  <select
                    value={forexTimeframe}
                    onChange={e => setForexTimeframe(e.target.value)}
                    className="kx-input"
                    style={{ width: 'auto', padding: '6px 28px 6px 10px', fontSize: '13px' }}
                  >
                    <option value="1h">1H</option>
                    <option value="4h">4H</option>
                    <option value="1d">Daily</option>
                  </select>
                </>
              )}

              <button
                onClick={triggerForexGeneration}
                disabled={isForexGenerating}
                className="kx-btn px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2"
                style={{
                  background: isForexGenerating ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.15)',
                  color: '#f59e0b',
                  border: '1px solid rgba(245,158,11,0.3)',
                  opacity: isForexGenerating ? 0.7 : 1,
                }}
              >
                {isForexGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DollarSign className="w-3.5 h-3.5" />}
                {isForexAutoSelect ? 'Scan Best Forex Pairs' : `Generate ${forexTimeframe.toUpperCase()} Signal`}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Filters Bar ───────────────────────────────────────────────────── */}
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
            { label: 'Status',  value: filterStatus,  setter: setFilterStatus,  options: ['ALL', 'PENDING', 'APPROVED', 'BLOCKED', 'EXPIRED'] },
            { label: 'Side',    value: filterSide,    setter: setFilterSide,    options: ['ALL', 'LONG', 'SHORT', 'HOLD'] },
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
                  {opt === 'ALL'        ? `All ${filter.label}s` :
                   opt === 'HIGH_PROB'  ? 'High Prob (>70%)'     :
                   opt === 'ELITE_ONLY' ? 'Elite (>85%)'         : opt}
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
            onClick={exportSignalsCsv}
            disabled={isExporting}
            className="kx-btn px-3 py-2 text-xs font-medium flex items-center gap-1.5"
            style={{ background: 'rgba(0,212,170,0.08)', color: 'var(--kx-success)', opacity: isExporting ? 0.7 : 1 }}
          >
            {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Signals List ──────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin mb-4" style={{ color: 'var(--kx-accent)' }} />
            <p style={{ color: 'var(--kx-text-muted)' }}>Loading AI signals...</p>
          </div>
        )}

        {!isLoading && filtered.map((signal, i) => {
          const isForex      = signal.marketType === 'FOREX';
          const riskVerdict  = signal.riskAssessment?.verdict || 'BLOCKED';
          const primaryVote  = signal.votes?.find((v: any) => v.role === 'PRIMARY')?.side      || 'HOLD';
          const confVote     = signal.votes?.find((v: any) => v.role === 'CONFIRMATION')?.side || 'HOLD';
          const agreement    = primaryVote === confVote;

          const SideIcon    = signal.side === 'LONG' ? ArrowUpRight : signal.side === 'SHORT' ? ArrowDownRight : Minus;
          const sideBadge   = signal.side === 'LONG'  ? 'kx-badge-long'  : signal.side === 'SHORT' ? 'kx-badge-short' : 'kx-badge-hold';
          const verdictBadge = riskVerdict === 'APPROVED' ? 'kx-verdict-approved' : riskVerdict === 'REDUCED' ? 'kx-verdict-reduced' : riskVerdict === 'WATCH_ONLY' ? 'kx-verdict-watch' : 'kx-verdict-blocked';
          const VerdictIcon  = riskVerdict === 'APPROVED' ? CheckCircle2 : riskVerdict === 'REDUCED' ? AlertTriangle : riskVerdict === 'BLOCKED' ? XCircle : Eye;

          // Forex order type badge colours
          const isForexBuy  = signal.forexOrderType === 'BUY_LIMIT'  || signal.forexOrderType === 'BUY_STOP';
          const isForexSell = signal.forexOrderType === 'SELL_LIMIT' || signal.forexOrderType === 'SELL_STOP';
          const forexOrderBadgeStyle = isForexBuy
            ? { background: 'rgba(0,212,170,0.15)',  color: 'var(--kx-long)',  border: '1px solid rgba(0,212,170,0.25)' }
            : isForexSell
            ? { background: 'rgba(255,71,87,0.15)',   color: 'var(--kx-short)', border: '1px solid rgba(255,71,87,0.25)' }
            : { background: 'rgba(148,163,184,0.1)',  color: 'var(--kx-text-muted)' };

          const displaySymbol = signal.displaySymbol || signal.asset?.symbol || signal.symbol || '';
          const cardAccent    = isForex
            ? '#f59e0b'
            : signal.side === 'LONG' ? 'var(--kx-long)' : signal.side === 'SHORT' ? 'var(--kx-short)' : 'var(--kx-hold)';

          return (
            <motion.div
              key={signal.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="kx-card p-5"
              style={{ borderLeft: `3px solid ${cardAccent}` }}
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Header row */}
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {/* Market type badge */}
                    {isForex ? (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider"
                        style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}
                      >
                        💱 FOREX
                      </span>
                    ) : (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider"
                        style={{ background: 'rgba(99,102,241,0.15)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.3)' }}
                      >
                        🪙 CRYPTO
                      </span>
                    )}

                    <span className="font-bold font-mono text-lg" style={{ color: 'var(--kx-text-primary)' }}>
                      {isForex ? `#${displaySymbol.replace('/', '')}` : displaySymbol}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--kx-bg-surface)', color: 'var(--kx-text-muted)' }}>
                      {signal.timeframe}
                    </span>

                    {/* Forex: show order type badge instead of side badge */}
                    {isForex && signal.forexOrderType ? (
                      <span className="px-2.5 py-0.5 rounded-md text-xs font-bold flex items-center gap-1" style={forexOrderBadgeStyle}>
                        {isForexBuy ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        {forexOrderLabel(signal.forexOrderType)}
                      </span>
                    ) : (
                      <span className={`${sideBadge} px-2.5 py-0.5 rounded-md text-xs font-bold flex items-center gap-1`}>
                        <SideIcon className="w-3.5 h-3.5" />{signal.side}
                      </span>
                    )}

                    <span className={`${verdictBadge} px-2 py-0.5 rounded-md text-xs font-medium flex items-center gap-1`}>
                      <VerdictIcon className="w-3 h-3" />{riskVerdict.replace('_', ' ')}
                    </span>
                    <span className="text-xs flex items-center gap-1" style={{ color: 'var(--kx-text-muted)' }}>
                      <Clock className="w-3 h-3" />{timeAgo(signal.createdAt)}
                    </span>
                  </div>

                  {/* Price row */}
                  {signal.side !== 'HOLD' && (
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3">
                      <span style={{ color: 'var(--kx-text-muted)' }}>
                        Entry:{' '}
                        <span className="font-mono font-medium" style={{ color: 'var(--kx-text-primary)' }}>
                          {isForex ? signal.entry?.toFixed(signal.symbol?.includes('JPY') ? 3 : signal.symbol?.includes('XAU') || signal.symbol?.includes('XAG') ? 2 : 5) : `$${formatSignalPrice(signal.entry)}`}
                        </span>
                      </span>
                      <span style={{ color: 'var(--kx-text-muted)' }}>
                        {isForex ? 'SL' : 'Stop'}:{' '}
                        <span className="font-mono font-medium" style={{ color: 'var(--kx-short)' }}>
                          {isForex ? signal.stopLoss?.toFixed(signal.symbol?.includes('JPY') ? 3 : signal.symbol?.includes('XAU') || signal.symbol?.includes('XAG') ? 2 : 5) : `$${formatSignalPrice(signal.stopLoss)}`}
                        </span>
                      </span>

                      {/* Targets — for forex show TP1/TP2/TP3 with "open" for zero */}
                      {isForex ? (
                        <>
                          {(['TP1', 'TP2', 'TP3'] as const).map(label => {
                            const tp = signal.targets?.find((t: any) => t.label === label);
                            const decimals = signal.symbol?.includes('JPY') ? 3 : (signal.symbol?.includes('XAU') || signal.symbol?.includes('XAG')) ? 2 : 5;
                            return (
                              <span key={label} style={{ color: 'var(--kx-text-muted)' }}>
                                {label}:{' '}
                                <span className="font-mono font-medium" style={{ color: tp && tp.price > 0 ? 'var(--kx-long)' : 'var(--kx-text-muted)', fontStyle: tp && tp.price > 0 ? 'normal' : 'italic' }}>
                                  {tp && tp.price > 0 ? tp.price.toFixed(decimals) : 'open'}
                                </span>
                              </span>
                            );
                          })}
                        </>
                      ) : (
                        signal.targets?.map((t: any) => (
                          <span key={t.label} style={{ color: 'var(--kx-text-muted)' }}>
                            {t.label}: <span className="font-mono font-medium" style={{ color: 'var(--kx-long)' }}>${formatSignalPrice(t.price)}</span>
                          </span>
                        ))
                      )}
                    </div>
                  )}

                  <p className="text-sm" style={{ color: 'var(--kx-text-secondary)' }}>{signal.reasoning}</p>

                  {/* Blocked reasons */}
                  {riskVerdict === 'BLOCKED' && signal.riskAssessment?.reasons?.length > 0 && (
                    <div className="mt-3 p-3 rounded-md bg-red-500/10 border border-red-500/20">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Blocked by Risk Engine
                        </span>
                        {signal.side !== 'HOLD' && (
                          <button
                            onClick={() => triggerShadowTest(signal.id)}
                            disabled={shadowTestingIds[signal.id] === 'loading' || shadowTestingIds[signal.id] === 'done'}
                            className="kx-btn px-3 py-1.5 text-[11px] font-semibold rounded-md flex items-center gap-1.5 transition-all duration-200 hover:scale-[1.03]"
                            style={{
                              background: shadowTestingIds[signal.id] === 'done' ? 'rgba(0,212,170,0.12)' : shadowTestingIds[signal.id] === 'error' ? 'rgba(255,71,87,0.12)' : 'rgba(245,158,11,0.12)',
                              color: shadowTestingIds[signal.id] === 'done' ? 'var(--kx-success)' : shadowTestingIds[signal.id] === 'error' ? 'var(--kx-short)' : '#f59e0b',
                              opacity: shadowTestingIds[signal.id] === 'loading' ? 0.7 : 1,
                            }}
                          >
                            {shadowTestingIds[signal.id] === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : shadowTestingIds[signal.id] === 'done' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <FlaskConical className="w-3.5 h-3.5" />}
                            {shadowTestingIds[signal.id] === 'done' ? 'Shadow Trade Created ✓' : shadowTestingIds[signal.id] === 'error' ? 'Failed — Retry' : 'Test in Paper Trading'}
                          </button>
                        )}
                      </div>
                      <ul className="list-disc pl-5 space-y-1 text-xs text-red-300/90 mt-2">
                        {signal.riskAssessment.reasons.map((reason: string, idx: number) => (
                          <li key={idx}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Model disagreement */}
                  {riskVerdict !== 'BLOCKED' && !agreement && (
                    <div className="mt-3 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-bold text-yellow-400 uppercase tracking-wider flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Model Disagreement (Not Auto-Traded)
                        </span>
                        {signal.side !== 'HOLD' && (
                          <button
                            onClick={() => triggerShadowTest(signal.id)}
                            disabled={shadowTestingIds[signal.id] === 'loading' || shadowTestingIds[signal.id] === 'done'}
                            className="kx-btn px-3 py-1.5 text-[11px] font-semibold rounded-md flex items-center gap-1.5 transition-all duration-200 hover:scale-[1.03]"
                            style={{
                              background: shadowTestingIds[signal.id] === 'done' ? 'rgba(0,212,170,0.12)' : 'rgba(245,158,11,0.12)',
                              color: shadowTestingIds[signal.id] === 'done' ? 'var(--kx-success)' : '#f59e0b',
                              opacity: shadowTestingIds[signal.id] === 'loading' ? 0.7 : 1,
                            }}
                          >
                            {shadowTestingIds[signal.id] === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : shadowTestingIds[signal.id] === 'done' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <FlaskConical className="w-3.5 h-3.5" />}
                            {shadowTestingIds[signal.id] === 'done' ? 'Shadow Trade Created ✓' : 'Test in Paper Trading'}
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-yellow-300/90 mt-1">
                        Primary model suggested <span className="font-semibold">{primaryVote}</span> while confirmation model suggested <span className="font-semibold">{confVote}</span>.
                      </p>
                    </div>
                  )}
                </div>

                {/* Right sidebar — confidence ring or forex order icon */}
                <div className="flex lg:flex-col items-center gap-4 lg:gap-3 shrink-0">
                  {isForex ? (
                    /* Forex: show order type icon block instead of confidence ring */
                    <div className="w-16 h-16 rounded-xl flex flex-col items-center justify-center border" style={{
                      background: isForexBuy ? 'rgba(0,212,170,0.1)' : 'rgba(255,71,87,0.1)',
                      borderColor: isForexBuy ? 'rgba(0,212,170,0.25)' : 'rgba(255,71,87,0.25)',
                    }}>
                      {isForexBuy
                        ? <TrendingUp className="w-6 h-6 mb-1" style={{ color: 'var(--kx-long)' }} />
                        : <TrendingDown className="w-6 h-6 mb-1" style={{ color: 'var(--kx-short)' }} />
                      }
                      <span className="text-[8px] uppercase tracking-tighter font-bold opacity-60">
                        {signal.forexOrderType === 'BUY_LIMIT' || signal.forexOrderType === 'SELL_LIMIT' ? 'LIMIT' : 'STOP'}
                      </span>
                    </div>
                  ) : (
                    /* Crypto: confidence ring */
                    <div className="relative w-16 h-16">
                      <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                        <circle cx="32" cy="32" r="28" fill="none" stroke="var(--kx-border)" strokeWidth="3" />
                        <circle cx="32" cy="32" r="28" fill="none"
                          stroke={signal.side === 'LONG' ? 'var(--kx-long)' : signal.side === 'SHORT' ? 'var(--kx-short)' : 'var(--kx-hold)'}
                          strokeWidth="3"
                          strokeDasharray={`${2 * Math.PI * 28 * signal.confidence} ${2 * Math.PI * 28}`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-sm font-bold font-mono" style={{ color: 'var(--kx-text-primary)' }}>
                          {Math.round(signal.confidence * 100)}%
                        </span>
                        <span className="text-[8px] uppercase tracking-tighter opacity-50 font-bold">Confidence</span>
                      </div>
                    </div>
                  )}

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

        {!isLoading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <CandlestickChart className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-sm" style={{ color: 'var(--kx-text-muted)' }}>
              No {activeMarket !== 'ALL' ? activeMarket.toLowerCase() + ' ' : ''}signals found. Generate one above!
            </p>
          </div>
        )}
      </div>

      {/* ── Logs Modal ────────────────────────────────────────────────────── */}
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
              {logs?.map(log => {
                const levelColors = { INFO: 'text-kx-text-secondary', WARN: 'text-kx-warning', ERROR: 'text-kx-short', SUCCESS: 'text-kx-success' };
                return (
                  <div key={log.id} className="flex gap-3 py-1 border-b border-white/5 last:border-0">
                    <span className="text-kx-text-muted shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                    <span className={`font-bold shrink-0 w-24 ${levelColors[log.level as keyof typeof levelColors]}`}>[{log.source}]</span>
                    <span className="text-kx-text-primary break-all">{log.message}</span>
                  </div>
                );
              })}
            </div>
            <div className="p-3 bg-kx-bg-surface border-t border-kx-border flex justify-end">
              <button onClick={() => setIsLogsOpen(false)} className="kx-btn kx-btn-primary px-4 py-1.5 text-xs font-medium">Close</button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
