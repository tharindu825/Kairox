'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  TrendingUp,
  TrendingDown,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  Clock,
  Loader2,
  BarChart3,
  Signal,
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
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AssetDetailPage() {
  const params = useParams();
  const symbol = params.symbol as string;
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<any>(null);

  const { data, error, isLoading } = useSWR(`/api/assets/${symbol}`, fetcher, {
    refreshInterval: 15000,
  });

  // Initialize Lightweight Charts
  useEffect(() => {
    if (!data?.candles || !chartRef.current) return;
    if (chartInstanceRef.current) return; // Already initialized

    let cancelled = false;

    (async () => {
      const { createChart, CandlestickSeries, HistogramSeries } = await import('lightweight-charts');
      if (cancelled || !chartRef.current) return;

      const chart = createChart(chartRef.current, {
        width: chartRef.current.clientWidth,
        height: 420,
        layout: {
          background: { color: '#111827' },
          textColor: '#94a3b8',
          fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
        },
        grid: {
          vertLines: { color: 'rgba(42, 58, 78, 0.3)' },
          horzLines: { color: 'rgba(42, 58, 78, 0.3)' },
        },
        crosshair: {
          vertLine: { color: 'rgba(59, 130, 246, 0.3)', width: 1, style: 3 },
          horzLine: { color: 'rgba(59, 130, 246, 0.3)', width: 1, style: 3 },
        },
        timeScale: {
          borderColor: '#2a3a4e',
          timeVisible: true,
          secondsVisible: false,
        },
        rightPriceScale: {
          borderColor: '#2a3a4e',
        },
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#00d4aa',
        downColor: '#ff4757',
        borderUpColor: '#00d4aa',
        borderDownColor: '#ff4757',
        wickUpColor: '#00d4aa',
        wickDownColor: '#ff4757',
      });

      candleSeries.setData(data.candles);

      // Volume as histogram
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });

      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });

      volumeSeries.setData(
        data.candles.map((c: any) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(0,212,170,0.2)' : 'rgba(255,71,87,0.2)',
        }))
      );

      // Note: Signal markers shown in the table below (setMarkers removed in LC v5)

      chart.timeScale().fitContent();

      chartInstanceRef.current = chart;

      // Responsive resize
      const observer = new ResizeObserver(() => {
        if (chartRef.current) {
          chart.applyOptions({ width: chartRef.current.clientWidth });
        }
      });
      observer.observe(chartRef.current);

      return () => {
        observer.disconnect();
        chart.remove();
      };
    })();

    return () => {
      cancelled = true;
    };
  }, [data?.candles]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 animate-spin mb-4" style={{ color: 'var(--kx-accent)' }} />
        <p style={{ color: 'var(--kx-text-muted)' }}>Loading {symbol} data...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-20" style={{ color: 'var(--kx-text-muted)' }}>
        <p className="text-lg">Failed to load asset data</p>
        <Link href="/dashboard/assets" className="text-sm mt-2 hover:underline" style={{ color: 'var(--kx-accent)' }}>
          ← Back to Assets
        </Link>
      </div>
    );
  }

  const latestSignal = data.signals?.[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/assets" className="p-2 rounded-lg hover:bg-white/5 transition-colors"
                style={{ color: 'var(--kx-text-muted)' }}>
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold font-mono" style={{ color: 'var(--kx-text-primary)' }}>
              {symbol}
            </h1>
            <p className="text-sm" style={{ color: 'var(--kx-text-muted)' }}>
              {data.asset?.name} • Real-time workspace
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-2xl font-bold font-mono" style={{ color: 'var(--kx-text-primary)' }}>
              ${data.currentPrice?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="flex items-center gap-1 justify-end">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--kx-success)' }} />
              <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>Live</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="kx-card overflow-hidden"
      >
        <div className="p-4 flex items-center justify-between"
             style={{ borderBottom: '1px solid var(--kx-glass-border)' }}>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" style={{ color: 'var(--kx-accent)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--kx-text-primary)' }}>
              Price Chart • 1H
            </span>
          </div>
          <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>
            {data.candles?.length || 0} candles loaded
          </span>
        </div>
        <div ref={chartRef} />
      </motion.div>

      {/* Grid: Latest Signal + Signals History */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Signal Card */}
        <div className="lg:col-span-1 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--kx-text-primary)' }}>
            <TrendingUp className="w-4 h-4" style={{ color: 'var(--kx-accent)' }} />
            Latest Signal
          </h3>

          {latestSignal ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="kx-card p-5"
              style={{
                borderLeft: `3px solid ${
                  latestSignal.side === 'LONG' ? 'var(--kx-long)' :
                  latestSignal.side === 'SHORT' ? 'var(--kx-short)' : 'var(--kx-hold)'
                }`
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className={`${
                  latestSignal.side === 'LONG' ? 'kx-badge-long' :
                  latestSignal.side === 'SHORT' ? 'kx-badge-short' : 'kx-badge-hold'
                } px-2.5 py-0.5 rounded-md text-xs font-bold flex items-center gap-1`}>
                  {latestSignal.side === 'LONG' ? <ArrowUpRight className="w-3.5 h-3.5" /> :
                   latestSignal.side === 'SHORT' ? <ArrowDownRight className="w-3.5 h-3.5" /> :
                   <Minus className="w-3.5 h-3.5" />}
                  {latestSignal.side}
                </span>
                <span className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>
                  {timeAgo(latestSignal.createdAt)}
                </span>
              </div>

              {/* Confidence */}
              <div className="flex items-center gap-3 mb-4">
                <div className="relative w-12 h-12">
                  <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="var(--kx-border)" strokeWidth="2.5" />
                    <circle cx="24" cy="24" r="20" fill="none"
                      stroke={latestSignal.side === 'LONG' ? 'var(--kx-long)' : latestSignal.side === 'SHORT' ? 'var(--kx-short)' : 'var(--kx-hold)'}
                      strokeWidth="2.5"
                      strokeDasharray={`${2 * Math.PI * 20 * latestSignal.confidence} ${2 * Math.PI * 20}`}
                      strokeLinecap="round" />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold font-mono"
                        style={{ color: 'var(--kx-text-primary)' }}>
                    {Math.round(latestSignal.confidence * 100)}%
                  </span>
                </div>
                <div className="flex-1">
                  <div className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>Confidence</div>
                  <div className="text-sm font-medium" style={{ color: 'var(--kx-text-primary)' }}>
                    {latestSignal.confidence >= 0.7 ? 'High' : latestSignal.confidence >= 0.5 ? 'Moderate' : 'Low'}
                  </div>
                </div>
              </div>

              {/* Price levels */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--kx-text-muted)' }}>Entry</span>
                  <span className="font-mono font-medium" style={{ color: 'var(--kx-text-primary)' }}>
                    ${Number(latestSignal.entry).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--kx-text-muted)' }}>Stop Loss</span>
                  <span className="font-mono font-medium" style={{ color: 'var(--kx-short)' }}>
                    ${Number(latestSignal.stopLoss).toLocaleString()}
                  </span>
                </div>
                {(latestSignal.targets as any[])?.map((t: any) => (
                  <div key={t.label} className="flex justify-between">
                    <span style={{ color: 'var(--kx-text-muted)' }}>{t.label}</span>
                    <span className="font-mono font-medium" style={{ color: 'var(--kx-long)' }}>
                      ${Number(t.price).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>

              {/* Risk verdict */}
              {latestSignal.riskAssessment && (
                <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--kx-glass-border)' }}>
                  <div className="flex items-center gap-2">
                    {latestSignal.riskAssessment.verdict === 'APPROVED' && <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--kx-success)' }} />}
                    {latestSignal.riskAssessment.verdict === 'BLOCKED' && <XCircle className="w-4 h-4" style={{ color: 'var(--kx-danger)' }} />}
                    {latestSignal.riskAssessment.verdict === 'REDUCED' && <AlertTriangle className="w-4 h-4" style={{ color: 'var(--kx-warning)' }} />}
                    {latestSignal.riskAssessment.verdict === 'WATCH_ONLY' && <Eye className="w-4 h-4" style={{ color: 'var(--kx-accent)' }} />}
                    <span className="text-xs font-medium" style={{ color: 'var(--kx-text-secondary)' }}>
                      Risk: {latestSignal.riskAssessment.verdict.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--kx-text-muted)' }}>
                    R:R {latestSignal.riskAssessment.rewardToRisk?.toFixed(2)} • Size: {Number(latestSignal.riskAssessment.positionSize).toFixed(4)}
                  </div>
                </div>
              )}

              {/* Reasoning */}
              <p className="text-xs mt-3 leading-relaxed" style={{ color: 'var(--kx-text-secondary)' }}>
                {latestSignal.reasoning}
              </p>

              {/* Model votes */}
              {latestSignal.votes?.length > 0 && (
                <div className="flex gap-2 mt-3">
                  {latestSignal.votes.map((v: any, i: number) => (
                    <div key={i} className="text-xs px-2 py-1 rounded"
                         style={{
                           background: v.role === 'PRIMARY' ? 'rgba(59,130,246,0.15)' : 'rgba(139,92,246,0.15)',
                           color: v.role === 'PRIMARY' ? 'var(--kx-accent)' : '#8b5cf6',
                         }}>
                      {v.role === 'PRIMARY' ? 'OR' : 'OA'}: {v.side}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <div className="kx-card p-8 text-center" style={{ color: 'var(--kx-text-muted)' }}>
              <Signal className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No signals generated yet</p>
            </div>
          )}
        </div>

        {/* Signals History */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--kx-text-primary)' }}>
            <Clock className="w-4 h-4" style={{ color: 'var(--kx-text-muted)' }} />
            Signal History
          </h3>

          <div className="kx-card overflow-hidden">
            <table className="kx-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Side</th>
                  <th>Entry</th>
                  <th>Stop</th>
                  <th>Target</th>
                  <th>Conf.</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {data.signals?.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8" style={{ color: 'var(--kx-text-muted)' }}>
                      No signal history available
                    </td>
                  </tr>
                )}
                {data.signals?.map((signal: any) => (
                  <tr key={signal.id}>
                    <td className="text-xs" style={{ color: 'var(--kx-text-muted)' }}>
                      {timeAgo(signal.createdAt)}
                    </td>
                    <td>
                      <span className={`${
                        signal.side === 'LONG' ? 'kx-badge-long' :
                        signal.side === 'SHORT' ? 'kx-badge-short' : 'kx-badge-hold'
                      } px-2 py-0.5 rounded text-xs font-bold`}>
                        {signal.side}
                      </span>
                    </td>
                    <td className="font-mono text-xs">${Number(signal.entry).toLocaleString()}</td>
                    <td className="font-mono text-xs" style={{ color: 'var(--kx-short)' }}>
                      ${Number(signal.stopLoss).toLocaleString()}
                    </td>
                    <td className="font-mono text-xs" style={{ color: 'var(--kx-long)' }}>
                      ${(signal.targets as any[])?.[0]?.price ? Number((signal.targets as any[])[0].price).toLocaleString() : '—'}
                    </td>
                    <td className="font-mono text-xs">{Math.round(signal.confidence * 100)}%</td>
                    <td>
                      <span className={`${
                        signal.riskAssessment?.verdict === 'APPROVED' ? 'kx-verdict-approved' :
                        signal.riskAssessment?.verdict === 'REDUCED' ? 'kx-verdict-reduced' :
                        signal.riskAssessment?.verdict === 'WATCH_ONLY' ? 'kx-verdict-watch' : 'kx-verdict-blocked'
                      } px-1.5 py-0.5 rounded text-xs`}>
                        {signal.riskAssessment?.verdict?.replace('_', ' ') || 'N/A'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}


