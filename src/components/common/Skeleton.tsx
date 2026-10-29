/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '', width, height }) => {
  return (
    <div
      style={{ width, height }}
      className={`animate-pulse rounded-lg bg-[var(--surface-2)]/80 border border-[var(--border)]/10 ${className}`}
      aria-hidden="true"
    />
  );
};

export const QuizCardSkeleton: React.FC = () => {
  return (
    <div className="paper-card p-5 space-y-3 border-2 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24 rounded-full" />
        <Skeleton className="h-4 w-16 rounded-full" />
      </div>
      <Skeleton className="h-6 w-3/4 rounded-md" />
      <Skeleton className="h-4 w-full rounded-md" />
      <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]/10">
        <Skeleton className="h-8 w-20 rounded-lg" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
    </div>
  );
};

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => {
  return (
    <div className="paper-card p-4 space-y-3 border-2 animate-pulse">
      <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]/10">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-20" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between py-2 border-b border-[var(--border)]/5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
};

