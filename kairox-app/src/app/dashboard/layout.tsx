'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Signal,
  LineChart,
  Shield,
  FlaskConical,
  Settings,
  TrendingUp,
  Menu,
  X,
  ChevronLeft,
  LogOut,
  Bell,
  Wifi,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/signals', label: 'Signals', icon: Signal },
  { href: '/dashboard/assets', label: 'Assets', icon: LineChart },
  { href: '/dashboard/risk', label: 'Risk Center', icon: Shield },
  { href: '/dashboard/backtest', label: 'Backtest Lab', icon: FlaskConical },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--kx-bg-primary)' }}>
      {/* Mobile Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:relative z-50 h-full flex flex-col
          transition-all duration-300 ease-in-out
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        style={{
          width: sidebarCollapsed ? 'var(--kx-sidebar-collapsed)' : 'var(--kx-sidebar-width)',
          background: 'var(--kx-bg-secondary)',
          borderRight: '1px solid var(--kx-glass-border)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 h-16 shrink-0"
             style={{ borderBottom: '1px solid var(--kx-glass-border)' }}>
          <Link href="/dashboard" className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                 style={{ background: 'linear-gradient(135deg, #3b82f6, #00d4aa)' }}>
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            {!sidebarCollapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="font-bold text-lg whitespace-nowrap"
                style={{ color: 'var(--kx-text-primary)' }}
              >
                Kairox
              </motion.span>
            )}
          </Link>

          {/* Collapse button (desktop) */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden lg:flex w-7 h-7 items-center justify-center rounded-md hover:bg-white/5 transition-colors"
            style={{ color: 'var(--kx-text-muted)' }}
          >
            <ChevronLeft className={`w-4 h-4 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} />
          </button>

          {/* Close button (mobile) */}
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden"
            style={{ color: 'var(--kx-text-muted)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                  transition-all duration-200 group relative
                  ${sidebarCollapsed ? 'justify-center' : ''}
                `}
                style={{
                  color: isActive ? 'var(--kx-text-primary)' : 'var(--kx-text-muted)',
                  background: isActive ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
                }}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeNav"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                    style={{ background: 'var(--kx-accent)' }}
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <item.icon className="w-5 h-5 shrink-0" style={{ color: isActive ? 'var(--kx-accent)' : undefined }} />
                {!sidebarCollapsed && <span>{item.label}</span>}

                {/* Tooltip for collapsed */}
                {sidebarCollapsed && (
                  <div className="absolute left-full ml-3 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap
                    opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50"
                    style={{ background: 'var(--kx-bg-surface)', color: 'var(--kx-text-primary)', border: '1px solid var(--kx-border)' }}>
                    {item.label}
                  </div>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="p-3 shrink-0" style={{ borderTop: '1px solid var(--kx-glass-border)' }}>
          <div className={`flex items-center gap-2 px-3 py-2 text-xs ${sidebarCollapsed ? 'justify-center' : ''}`}
               style={{ color: 'var(--kx-text-muted)' }}>
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--kx-success)' }} />
            {!sidebarCollapsed && <span>System Online</span>}
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header
          className="flex items-center justify-between px-4 lg:px-6 shrink-0"
          style={{
            height: 'var(--kx-topbar-height)',
            background: 'var(--kx-bg-secondary)',
            borderBottom: '1px solid var(--kx-glass-border)',
          }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-white/5"
              style={{ color: 'var(--kx-text-secondary)' }}
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
                 style={{ background: 'rgba(0, 212, 170, 0.08)', color: 'var(--kx-long)', border: '1px solid rgba(0, 212, 170, 0.2)' }}>
              <Wifi className="w-3.5 h-3.5" />
              <span className="font-medium">Live</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="relative p-2 rounded-lg hover:bg-white/5 transition-colors"
                    style={{ color: 'var(--kx-text-muted)' }}>
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
                    style={{ background: 'var(--kx-accent)' }} />
            </button>

            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold"
                 style={{ background: 'linear-gradient(135deg, #3b82f6, #00d4aa)', color: 'white' }}>
              K
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
