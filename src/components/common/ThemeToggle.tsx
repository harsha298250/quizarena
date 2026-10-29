/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ThemeMode } from '../../hooks/useTheme';
import { sound } from '../../lib/sound';

interface ThemeToggleProps {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, setTheme, className = '' }) => {
  const options: { mode: ThemeMode; label: string; icon: string; title: string }[] = [
    { mode: 'light', label: 'Light', icon: '☀️', title: 'Light mode' },
    { mode: 'dark', label: 'Dark', icon: '🌙', title: 'Dark mode' },
    { mode: 'system', label: 'System', icon: '💻', title: 'Follow system appearance' },
  ];

  const handleSelect = (mode: ThemeMode) => {
    sound.playClick();
    setTheme(mode);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (index + 1) % options.length;
      handleSelect(options[next].mode);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (index - 1 + options.length) % options.length;
      handleSelect(options[prev].mode);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme mode"
      className={`inline-flex items-center rounded-xl border-2 border-[var(--border)] bg-[var(--surface-2)] p-0.5 shadow-[2px_2px_0px_var(--shadow)] ${className}`}
    >
      {options.map((opt, idx) => {
        const isSelected = theme === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => handleSelect(opt.mode)}
            onKeyDown={e => handleKeyDown(e, idx)}
            title={opt.title}
            aria-label={opt.title}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-bold rounded-lg transition-all ${
              isSelected
                ? 'bg-[var(--surface)] text-[var(--text)] shadow-[1px_1px_0px_var(--shadow)] ring-1 ring-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            <span aria-hidden="true" className="text-sm leading-none">{opt.icon}</span>
            <span className="hidden md:inline leading-none">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
};

