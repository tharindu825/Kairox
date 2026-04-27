'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Settings, Key, Bell, Shield, Cpu, Save } from 'lucide-react';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('models');

  const tabs = [
    { id: 'models', label: 'AI Models', icon: Cpu },
    { id: 'risk', label: 'Risk Policy', icon: Shield },
    { id: 'alerts', label: 'Alerts', icon: Bell },
    { id: 'api', label: 'API Keys', icon: Key },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--kx-text-primary)' }}>Settings</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--kx-text-muted)' }}>
          Configure models, risk policies, alerts, and API keys
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--kx-bg-card)' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{
              background: activeTab === tab.id ? 'var(--kx-accent)' : 'transparent',
              color: activeTab === tab.id ? 'white' : 'var(--kx-text-muted)',
            }}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="kx-card p-6">
        {activeTab === 'models' && (
          <div className="space-y-6">
            <h3 className="font-semibold" style={{ color: 'var(--kx-text-primary)' }}>Dual API Model Configuration</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Primary - OpenRouter */}
              <div className="p-4 rounded-xl" style={{ background: 'var(--kx-bg-surface)', border: '1px solid var(--kx-border)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full" style={{ background: 'var(--kx-accent)' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--kx-text-primary)' }}>Primary — OpenRouter</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Model</label>
                    <input className="kx-input" defaultValue="anthropic/claude-sonnet-4" />
                  </div>
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Fallback</label>
                    <input className="kx-input" defaultValue="google/gemini-2.5-pro" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Temperature</label>
                      <input className="kx-input" type="number" step="0.1" defaultValue="0.3" />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Max Tokens</label>
                      <input className="kx-input" type="number" defaultValue="2000" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Confirmation - OpenAI */}
              <div className="p-4 rounded-xl" style={{ background: 'var(--kx-bg-surface)', border: '1px solid var(--kx-border)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full" style={{ background: '#8b5cf6' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--kx-text-primary)' }}>Confirmation — OpenAI Direct</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Model</label>
                    <input className="kx-input" defaultValue="gpt-4o" />
                  </div>
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Fallback</label>
                    <input className="kx-input" defaultValue="gpt-4o-mini" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Temperature</label>
                      <input className="kx-input" type="number" step="0.1" defaultValue="0.3" />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Max Tokens</label>
                      <input className="kx-input" type="number" defaultValue="2000" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <button className="kx-btn kx-btn-primary">
              <Save className="w-4 h-4" />
              Save Model Config
            </button>
          </div>
        )}

        {activeTab === 'risk' && (
          <div className="space-y-4">
            <h3 className="font-semibold" style={{ color: 'var(--kx-text-primary)' }}>Risk Policy Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { label: 'Max Risk Per Trade (%)', value: '2.0' },
                { label: 'Max Open Trades', value: '5' },
                { label: 'Max Correlated Pairs', value: '3' },
                { label: 'Min Reward:Risk Ratio', value: '1.5' },
                { label: 'Daily Drawdown Limit (%)', value: '5.0' },
                { label: 'Cooldown After Stops (min)', value: '60' },
              ].map(field => (
                <div key={field.label}>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>{field.label}</label>
                  <input className="kx-input" type="number" step="0.1" defaultValue={field.value} />
                </div>
              ))}
            </div>
            <button className="kx-btn kx-btn-primary"><Save className="w-4 h-4" />Save Risk Policy</button>
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="space-y-4">
            <h3 className="font-semibold" style={{ color: 'var(--kx-text-primary)' }}>Alert Configuration</h3>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Telegram Bot Token</label>
              <input className="kx-input" type="password" placeholder="Enter bot token..." />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Telegram Chat ID</label>
              <input className="kx-input" placeholder="Enter chat ID..." />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>Min Confidence for Alert</label>
              <input className="kx-input" type="number" step="0.05" defaultValue="0.7" />
            </div>
            <button className="kx-btn kx-btn-primary"><Save className="w-4 h-4" />Save Alert Settings</button>
          </div>
        )}

        {activeTab === 'api' && (
          <div className="space-y-4">
            <h3 className="font-semibold" style={{ color: 'var(--kx-text-primary)' }}>API Key Management</h3>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>OpenRouter API Key</label>
              <input className="kx-input" type="password" placeholder="sk-or-v1-..." />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--kx-text-muted)' }}>OpenAI API Key</label>
              <input className="kx-input" type="password" placeholder="sk-..." />
            </div>
            <div className="p-3 rounded-lg text-xs" style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--kx-warning)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
              ⚠️ API keys are stored server-side only and never exposed to the frontend.
            </div>
            <button className="kx-btn kx-btn-primary"><Save className="w-4 h-4" />Save API Keys</button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
