'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import { Key, Bell, Shield, Cpu, Save, Loader2, Check, AlertTriangle } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('models');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const { data: settings, mutate } = useSWR('/api/settings', fetcher);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const tabs = [
    { id: 'models', label: 'AI Models', icon: Cpu },
    { id: 'risk', label: 'Risk Policy', icon: Shield },
    { id: 'alerts', label: 'Alerts', icon: Bell },
    { id: 'api', label: 'API Keys', icon: Key },
  ];

  const saveTo = async (type: string, data: any) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data }),
      });
      if (!res.ok) throw new Error();
      showToast('Saved successfully', 'success');
      mutate();
    } catch { showToast('Failed to save', 'error'); }
    finally { setSaving(false); }
  };

  const handleSavePolicy = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    saveTo('policy', {
      maxRiskPercent: parseFloat(f.get('maxRiskPercent') as string),
      maxOpenTrades: parseInt(f.get('maxOpenTrades') as string),
      maxCorrelated: parseInt(f.get('maxCorrelated') as string),
      minRewardRisk: parseFloat(f.get('minRewardRisk') as string),
      dailyDrawdownLimit: parseFloat(f.get('dailyDrawdownLimit') as string),
      cooldownMinutes: parseInt(f.get('cooldownMinutes') as string),
    });
  };

  const handleSaveModels = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    saveTo('models', {
      primary: { modelId: f.get('pm') as string, fallback: f.get('pf') as string, temperature: parseFloat(f.get('pt') as string), maxTokens: parseInt(f.get('ptk') as string) },
      confirmation: { modelId: f.get('cm') as string, fallback: f.get('cf') as string, temperature: parseFloat(f.get('ct') as string), maxTokens: parseInt(f.get('ctk') as string) },
    });
  };

  const p = settings?.policy;
  const pm = settings?.models?.find((m: any) => m.role === 'PRIMARY');
  const cm = settings?.models?.find((m: any) => m.role === 'CONFIRMATION');

  return (
    <div className="space-y-6">
      {toast && (
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
          className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium"
          style={{ background: toast.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: toast.type === 'success' ? 'var(--kx-success)' : 'var(--kx-danger)', border: `1px solid ${toast.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
          {toast.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.message}
        </motion.div>
      )}

      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--kx-text-primary)' }}>Settings</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--kx-text-muted)' }}>Configure models, risk policies, alerts, and API keys</p>
      </div>

      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--kx-bg-card)' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: activeTab === tab.id ? 'var(--kx-accent)' : 'transparent', color: activeTab === tab.id ? 'white' : 'var(--kx-text-muted)' }}>
            <tab.icon className="w-4 h-4" />{tab.label}
          </button>
        ))}
      </div>

      <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="kx-card p-6">
        {activeTab === 'models' && (
          <form onSubmit={handleSaveModels} className="space-y-6">
            <h3 className="font-semibold" style={{ color: 'var(--kx-text-primary)' }}>Dual API Model Configuration</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 rounded-xl" style={{ background: 'var(--kx-bg-surface)', border: '1px solid var(--kx-border)' }}>
                <div className="flex items-center gap-2 mb-4"><div className="w-2 h-2 rounded-full" style={{ background: 'var(--kx-accent)' }} /><span className="text-sm font-semibold" style={{ color: 'var(--kx-text-primary)' }}>Primary — OpenRouter</span></div>
                <div className="space-y-3">
                  <div><label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Model</label><input name="pm" className="kx-input" defaultValue={pm?.modelId || 'anthropic/claude-sonnet-4'} /></div>
                  <div><label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Fallback</label><input name="pf" className="kx-input" defaultValue={pm?.fallback || 'google/gemini-2.5-pro'} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Temp</label><input name="pt" className="kx-input" type="number" step="0.1" defaultValue={pm?.parameters?.temperature || 0.3} /></div>
                    <div><label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Max Tokens</label><input name="ptk" className="kx-input" type="number" defaultValue={pm?.parameters?.maxTokens || 2000} /></div>
                  </div>
                </div>
              </div>
              <div className="p-4 rounded-xl" style={{ background: 'var(--kx-bg-surface)', border: '1px solid var(--kx-border)' }}>
                <div className="flex items-center gap-2 mb-4"><div className="w-2 h-2 rounded-full" style={{ background: '#8b5cf6' }} /><span className="text-sm font-semibold" style={{ color: 'var(--kx-text-primary)' }}>Confirmation — OpenAI</span></div>
                <div className="space-y-3">
                  <div><label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Model</label><input name="cm" className="kx-input" defaultValue={cm?.modelId || 'gpt-4o'} /></div>
                  <div><label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Fallback</label><input name="cf" className="kx-input" defaultValue={cm?.fallback || 'gpt-4o-mini'} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Temp</label><input name="ct" className="kx-input" type="number" step="0.1" defaultValue={cm?.parameters?.temperature || 0.3} /></div>
                    <div><label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Max Tokens</label><input name="ctk" className="kx-input" type="number" defaultValue={cm?.parameters?.maxTokens || 2000} /></div>
                  </div>
                </div>
              </div>
            </div>
            <button type="submit" disabled={saving} className="kx-btn kx-btn-primary">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save</button>
          </form>
        )}

        {activeTab === 'risk' && (
          <form onSubmit={handleSavePolicy} className="space-y-4">
            <h3 className="font-semibold" style={{ color: 'var(--kx-text-primary)' }}>Risk Policy Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { l: 'Max Risk Per Trade (%)', n: 'maxRiskPercent', v: p?.maxRiskPercent || 2, s: '0.1' },
                { l: 'Max Open Trades', n: 'maxOpenTrades', v: p?.maxOpenTrades || 5, s: '1' },
                { l: 'Max Correlated Pairs', n: 'maxCorrelated', v: p?.maxCorrelated || 3, s: '1' },
                { l: 'Min Reward:Risk', n: 'minRewardRisk', v: p?.minRewardRisk || 1.5, s: '0.1' },
                { l: 'Daily DD Limit (%)', n: 'dailyDrawdownLimit', v: p?.dailyDrawdownLimit || 5, s: '0.1' },
                { l: 'Cooldown (min)', n: 'cooldownMinutes', v: p?.cooldownMinutes || 60, s: '1' },
              ].map(f => (
                <div key={f.n}><label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>{f.l}</label><input name={f.n} className="kx-input" type="number" step={f.s} defaultValue={f.v} /></div>
              ))}
            </div>
            <button type="submit" disabled={saving} className="kx-btn kx-btn-primary">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save</button>
          </form>
        )}

        {activeTab === 'alerts' && (
          <div className="space-y-4">
            <h3 className="font-semibold" style={{ color: 'var(--kx-text-primary)' }}>Alert Configuration</h3>
            <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: settings?.alerts?.telegramConfigured ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)', color: settings?.alerts?.telegramConfigured ? 'var(--kx-success)' : 'var(--kx-warning)', border: `1px solid ${settings?.alerts?.telegramConfigured ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}` }}>
              {settings?.alerts?.telegramConfigured ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              <span className="text-sm">{settings?.alerts?.telegramConfigured ? 'Telegram connected' : 'Set TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID in .env'}</span>
            </div>
            <div><label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Min Confidence</label><input className="kx-input" type="number" step="0.05" defaultValue={0.7} /></div>
          </div>
        )}

        {activeTab === 'api' && (
          <div className="space-y-4">
            <h3 className="font-semibold" style={{ color: 'var(--kx-text-primary)' }}>API Key Management</h3>
            <div><label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>OpenRouter</label><input className="kx-input" type="password" placeholder="OPENROUTER_API_KEY in .env" disabled /></div>
            <div><label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>OpenAI</label><input className="kx-input" type="password" placeholder="OPENAI_API_KEY in .env" disabled /></div>
            <div className="p-3 rounded-lg text-xs" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--kx-warning)', border: '1px solid rgba(245,158,11,0.2)' }}>⚠️ API keys managed via environment variables for security.</div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
