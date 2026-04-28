'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Dashboard Error]', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="kx-card p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
             style={{ background: 'rgba(239, 68, 68, 0.12)' }}>
          <AlertTriangle className="w-8 h-8" style={{ color: 'var(--kx-danger)' }} />
        </div>
        <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--kx-text-primary)' }}>
          Something went wrong
        </h2>
        <p className="text-sm mb-6" style={{ color: 'var(--kx-text-muted)' }}>
          {error.message || 'An unexpected error occurred while loading this page.'}
        </p>
        <button onClick={reset} className="kx-btn kx-btn-primary w-full">
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
        {error.digest && (
          <p className="text-xs mt-4 font-mono" style={{ color: 'var(--kx-text-muted)' }}>
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
