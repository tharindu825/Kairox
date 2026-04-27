'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Eye, EyeOff, TrendingUp, Shield, Zap } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      if (isRegister) {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Registration failed');
        }
      }

      const { signIn } = await import('next-auth/react');
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid credentials');
      } else {
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--kx-bg-primary)' }}>
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden items-center justify-center"
           style={{ background: 'linear-gradient(135deg, #0f1923 0%, #1a2332 50%, #0a1628 100%)' }}>
        {/* Animated grid background */}
        <div className="absolute inset-0 opacity-10"
             style={{
               backgroundImage: 'linear-gradient(rgba(59,130,246,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.3) 1px, transparent 1px)',
               backgroundSize: '40px 40px'
             }} />

        {/* Glowing orb */}
        <div className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full opacity-20"
             style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)', filter: 'blur(60px)' }} />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full opacity-15"
             style={{ background: 'radial-gradient(circle, #00d4aa 0%, transparent 70%)', filter: 'blur(50px)' }} />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="relative z-10 px-16 max-w-lg"
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, #3b82f6, #00d4aa)' }}>
              <TrendingUp className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight" style={{ color: 'var(--kx-text-primary)' }}>
              Kairox
            </h1>
          </div>

          <p className="text-lg mb-12" style={{ color: 'var(--kx-text-secondary)', lineHeight: 1.7 }}>
            AI-powered trading intelligence with multi-model analysis, deterministic risk controls, and structured decision support.
          </p>

          <div className="space-y-6">
            {[
              { icon: Zap, title: 'Dual AI Analysis', desc: 'Independent signals from OpenRouter + OpenAI' },
              { icon: Shield, title: 'Risk Engine', desc: '8-point deterministic safety verification' },
              { icon: TrendingUp, title: 'Paper Trading', desc: 'Validate strategies before going live' },
            ].map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.4 + i * 0.15 }}
                className="flex items-start gap-4"
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                     style={{ background: 'rgba(59, 130, 246, 0.15)' }}>
                  <feature.icon className="w-5 h-5" style={{ color: 'var(--kx-accent)' }} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--kx-text-primary)' }}>{feature.title}</h3>
                  <p className="text-sm" style={{ color: 'var(--kx-text-muted)' }}>{feature.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, #3b82f6, #00d4aa)' }}>
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--kx-text-primary)' }}>Kairox</h1>
          </div>

          <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--kx-text-primary)' }}>
            {isRegister ? 'Create Account' : 'Welcome Back'}
          </h2>
          <p className="mb-8" style={{ color: 'var(--kx-text-muted)' }}>
            {isRegister ? 'Set up your trading dashboard' : 'Sign in to your trading dashboard'}
          </p>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-3 rounded-lg text-sm"
              style={{ background: 'rgba(239, 68, 68, 0.12)', color: 'var(--kx-danger)', border: '1px solid rgba(239, 68, 68, 0.3)' }}
            >
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {isRegister && (
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--kx-text-secondary)' }}>
                  Full Name
                </label>
                <input
                  id="name-input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="kx-input"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--kx-text-secondary)' }}>
                Email Address
              </label>
              <input
                id="email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="trader@kairox.io"
                className="kx-input"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--kx-text-secondary)' }}>
                Password
              </label>
              <div className="relative">
                <input
                  id="password-input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="kx-input pr-12"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--kx-text-muted)' }}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              id="submit-btn"
              type="submit"
              disabled={isLoading}
              className="kx-btn kx-btn-primary w-full py-3 text-base"
              style={{ opacity: isLoading ? 0.7 : 1 }}
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                isRegister ? 'Create Account' : 'Sign In'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => { setIsRegister(!isRegister); setError(''); }}
              className="text-sm hover:underline"
              style={{ color: 'var(--kx-accent)' }}
            >
              {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
            </button>
          </div>

          <p className="mt-8 text-xs text-center" style={{ color: 'var(--kx-text-muted)' }}>
            Trading signals are for informational purposes only. Past performance does not guarantee future results.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
