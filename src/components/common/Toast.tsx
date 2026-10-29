/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';

export interface ToastMessage {
  id: string;
  type: 'error' | 'success' | 'info' | 'warning';
  title?: string;
  message: string;
  duration?: number;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4"
    >
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss,
}) => {
  useEffect(() => {
    const duration = toast.duration ?? 5000;
    if (duration > 0) {
      const timer = setTimeout(() => {
        onDismiss(toast.id);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.duration, onDismiss]);

  const typeConfig = {
    error: {
      bg: 'bg-[var(--accent)] text-[var(--text-on-accent)]',
      icon: '⚠️',
      border: 'border-[var(--border)]',
    },
    success: {
      bg: 'bg-[var(--ok)] text-[var(--text-on-accent)]',
      icon: '✓',
      border: 'border-[var(--border)]',
    },
    warning: {
      bg: 'bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)]',
      icon: '⚡',
      border: 'border-[var(--border)]',
    },
    info: {
      bg: 'bg-[var(--info)] text-[var(--text-on-accent)]',
      icon: 'ℹ️',
      border: 'border-[var(--border)]',
    },
  }[toast.type];

  return (
    <div
      role="alert"
      className={`pointer-events-auto paper-card p-3.5 flex items-start justify-between gap-3 shadow-[4px_4px_0px_var(--shadow)] border-2 ${typeConfig.border} ${typeConfig.bg} animate-slideUp transition-all`}
    >
      <div className="flex items-start gap-2.5">
        <span className="text-base select-none shrink-0" aria-hidden="true">
          {typeConfig.icon}
        </span>
        <div className="space-y-0.5">
          {toast.title && (
            <div className="font-['Bricolage_Grotesque'] font-black text-xs uppercase tracking-wide">
              {toast.title}
            </div>
          )}
          <p className="text-xs font-semibold leading-snug">{toast.message}</p>
        </div>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="p-1 rounded-md opacity-80 hover:opacity-100 hover:bg-black/10 transition shrink-0 text-xs font-bold"
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
};

