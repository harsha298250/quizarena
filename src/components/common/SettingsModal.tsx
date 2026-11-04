/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { SupportedLanguage } from '../../lib/i18n';
import { sound } from '../../lib/sound';
import { ThemeMode } from '../../hooks/useTheme';
import { ThemeToggle } from './ThemeToggle';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: SupportedLanguage;
  setLang: (lang: SupportedLanguage) => void;
  theme?: ThemeMode;
  setTheme?: (theme: ThemeMode) => void;
  onDeleteMyData?: () => void;
  currentUserEmail?: string | null;
  currentUserName?: string | null;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  lang,
  setLang,
  theme = 'light',
  setTheme,
  onDeleteMyData,
  currentUserEmail,
  currentUserName,
}) => {
  const [isMuted, setIsMuted] = useState(sound.getMuted());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!isOpen) return null;

  const handleToggleSound = () => {
    const next = sound.toggleMute();
    setIsMuted(next);
    if (next) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } else {
      sound.playClick();
    }
  };

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

        {/* Setting 1: Language */}
        <div className="space-y-1.5">
          <label htmlFor="settings-lang-select" className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <span>🌐</span> Interface Language
          </label>
          <div className="flex items-center justify-between p-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
            <span className="text-xs font-semibold text-[var(--text)]">English</span>
            <span className="sticker-badge sticker-badge-sunshine text-[10px] px-2 py-0.5">Default (EN)</span>
          </div>
        </div>

        {/* Setting 2: Theme */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <span>🎨</span> Color Theme & Appearance
          </label>
          <div className="flex items-center justify-between p-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
            <span className="text-xs font-semibold text-[var(--text)]">
              Mode: <strong className="capitalize">{theme}</strong>
            </span>
            <ThemeToggle theme={theme} setTheme={handleThemeChange} />
          </div>
        </div>

        {/* Setting 3: Sound FX */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <span>🔊</span> Sound Effects & Auditory Feedback
          </label>
          <button
            type="button"
            onClick={handleToggleSound}
            className={`w-full p-2.5 rounded-xl border-2 border-[var(--border)] shadow-[2px_2px_0px_var(--shadow)] text-xs font-bold flex items-center justify-between transition-transform active:translate-y-0.5 ${
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

        {/* Setting 4: GDPR Privacy & Data Deletion */}
        <div className="pt-2 border-t border-[var(--border)]/20 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <span>🛡️</span> Data Privacy & GDPR
          </div>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Manage your personal data in compliance with GDPR and CCPA standards. You can purge all quizzes and cached assets.
          </p>
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              setShowDeleteConfirm(true);
            }}
            className="w-full text-left px-3 py-2 text-xs font-bold rounded-lg border-2 border-red-500/40 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50 flex items-center justify-between transition-colors shadow-xs"
          >
            <span className="flex items-center gap-2">
              <span>🗑️</span>
              <span>Delete My Data (Permanent Purge)</span>
            </span>
            <span className="text-[10px] font-bold underline">Request Purge</span>
          </button>
        </div>

        {/* Explicit Confirmation Dialog inside Modal */}
        {showDeleteConfirm && (
          <div className="p-4 rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-950/70 text-red-900 dark:text-red-100 space-y-3 animate-pop-in">
            <div className="text-xs font-black flex items-center gap-1.5">
              <span>⚠️</span> Warning: Irreversible Data Deletion
            </div>
            <p className="text-[11px] font-medium leading-relaxed">
              This will permanently delete all your saved quizzes, question drafts, analytics history, and offline local cache. This action cannot be reversed.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="paper-btn paper-btn-sm text-xs font-bold px-3 py-1 bg-[var(--surface)] text-[var(--text)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  onClose();
                  if (onDeleteMyData) onDeleteMyData();
                }}
                className="paper-btn paper-btn-sm paper-btn-danger text-xs font-bold px-3 py-1 shadow-[2px_2px_0px_var(--shadow)]"
              >
                Yes, Delete Everything
              </button>
            </div>
          </div>
        )}

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

