/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { sound } from '../../lib/sound';
import { useSoundMuted } from '../../hooks/useSoundMuted';
import { ThemeMode } from '../../hooks/useTheme';
import { ThemeToggle } from './ThemeToggle';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: ThemeMode;
  setTheme?: (theme: ThemeMode) => void;
  onDeleteMyData?: any;
  currentUserEmail?: string | null;
  currentUserName?: string | null;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  theme = 'light',
  setTheme,
  currentUserEmail,
  currentUserName,
}) => {
  const [isMuted, handleToggleSound] = useSoundMuted();

  if (!isOpen) return null;

  const handleThemeChange = (newTheme: ThemeMode) => {
    sound.playClick();
    if (setTheme) setTheme(newTheme);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
    >
      <div className="paper-card p-6 max-w-md w-full space-y-5 bg-[var(--surface)] border-3 border-[var(--border)] shadow-[6px_6px_0px_var(--shadow)] text-[var(--text)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)]/20 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚙️</span>
            <h2 id="settings-dialog-title" className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
              Preferences & Settings
            </h2>
          </div>
          <button
            onClick={() => {
              sound.playClick();
              onClose();
            }}
            className="paper-btn paper-btn-sm p-1.5 text-xs font-bold leading-none"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        {/* User Identity Info */}
        {(currentUserEmail || currentUserName) && (
          <div className="p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-xs font-bold text-[var(--text)] truncate">
                {currentUserName || 'Signed In User'}
              </div>
              <div className="text-[11px] font-mono-code text-[var(--text-muted)] truncate">
                {currentUserEmail || ''}
              </div>
            </div>
            <span className="sticker-badge sticker-badge-ok text-[10px] px-2 py-0.5 shrink-0">
              Active Session
            </span>
          </div>
        )}

        {/* Setting 1: Theme */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <span>🎨</span> Color Theme & Appearance
          </label>
          <div className="flex items-center justify-between p-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
            <span className="text-xs font-bold text-[var(--text)]">Mode</span>
            <ThemeToggle theme={theme} setTheme={handleThemeChange} />
          </div>
        </div>

        {/* Setting 2: Sound toggle */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <span>🔊</span> Sound Effects & Auditory Feedback
          </label>
          <button
            type="button"
            onClick={handleToggleSound}
            aria-pressed={!isMuted}
            className={`w-full text-left px-3 py-2 text-xs font-bold rounded-xl border-2 border-[var(--border)] flex items-center justify-between transition-colors shadow-xs ${
              isMuted
                ? 'bg-[var(--surface-2)] text-[var(--text-muted)]'
                : 'bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)]'
            }`}
          >
            <span className="flex items-center gap-2">
              <span>{isMuted ? '🔇' : '🔊'}</span>
              <span>Audio Feedback</span>
            </span>
            <span className="sticker-badge text-[10px] py-0.5 px-2 font-mono-code font-bold">
              {isMuted ? 'Muted' : 'Sound Enabled'}
            </span>
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end pt-2 border-t border-[var(--border)]/20">
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              onClose();
            }}
            className="paper-btn paper-btn-primary paper-btn-sm text-xs font-bold px-4 py-1.5"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
