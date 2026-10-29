/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface EmptyStateProps {
  icon?: string | React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = '📝',
  title,
  description,
  actionLabel,
  onAction,
  className = '',
}) => {
  return (
    <div
      className={`paper-card p-8 sm:p-12 text-center space-y-4 border-2 shadow-[4px_4px_0px_var(--shadow)] ${className}`}
    >
      <div className="flex justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-[var(--border)] bg-[var(--surface-2)] shadow-[2.5px_2.5px_0px_var(--shadow)] text-3xl select-none animate-bounce">
          {icon}
        </div>
      </div>

      <div className="space-y-1.5 max-w-md mx-auto">
        <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
          {title}
        </h3>
        <p className="text-xs sm:text-sm font-semibold text-[var(--text-muted)] leading-relaxed">
          {description}
        </p>
      </div>

      {actionLabel && onAction && (
        <div className="pt-2">
          <button
            onClick={onAction}
            className="paper-btn paper-btn-primary px-5 py-2.5 text-xs sm:text-sm font-black shadow-[3px_3px_0px_var(--shadow)]"
          >
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
};

