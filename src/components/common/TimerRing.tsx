/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface TimerRingProps {
  timeLeft: number;
  totalTime: number;
  size?: number;
  strokeWidth?: number;
  isUrgentThreshold?: number;
  className?: string;
}

export const TimerRing: React.FC<TimerRingProps> = ({
  timeLeft,
  totalTime,
  size = 80,
  strokeWidth = 7,
  isUrgentThreshold = 5,
  className = '',
}) => {
  const safeTotal = totalTime > 0 ? totalTime : 20;
  const safeLeft = Math.max(0, timeLeft);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, safeLeft / safeTotal));
  const strokeDashoffset = circumference * (1 - progress);
  const isUrgent = safeLeft <= isUrgentThreshold && safeLeft > 0;

  const strokeColor = isUrgent
    ? 'var(--accent)'
    : safeLeft <= safeTotal / 2
    ? 'var(--accent-2-bg)'
    : 'var(--ok)';

  return (
    <div
      className={`relative inline-flex items-center justify-center select-none ${
        isUrgent ? 'animate-pulse' : ''
      } ${className}`}
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`${safeLeft} seconds remaining`}
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90 transform"
        aria-hidden="true"
      >
        {/* Track circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--surface-2)"
          strokeWidth={strokeWidth}
          fill="var(--surface)"
        />
        {/* Animated countdown stroke */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          style={{ transition: 'stroke-dashoffset 0.8s linear, stroke 0.3s ease' }}
        />
      </svg>
      {/* Centered time display */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span
          className={`font-mono-code font-black leading-none ${
            size >= 90 ? 'text-2xl sm:text-3xl' : 'text-lg sm:text-xl'
          } ${isUrgent ? 'text-[var(--accent)] font-black' : 'text-[var(--text)]'}`}
        >
          {safeLeft}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] leading-none mt-0.5">
          sec
        </span>
      </div>
    </div>
  );
};

