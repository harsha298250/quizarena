/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { sound } from '../../lib/sound';
import { useSoundMuted } from '../../hooks/useSoundMuted';
import { ThemeMode } from '../../hooks/useTheme';
import { ThemeToggle } from './ThemeToggle';
import { AccountDeletionResult, retryAccountDeletion } from '../../services/quizService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: ThemeMode;
  setTheme?: (theme: ThemeMode) => void;
  onDeleteMyData?: () => Promise<AccountDeletionResult | void> | void;
  currentUserEmail?: string | null;
  currentUserName?: string | null;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  theme = 'light',
  setTheme,
  onDeleteMyData,
  currentUserEmail,
  currentUserName,
}) => {
  const [isMuted, handleToggleSound] = useSoundMuted();
  const [deletePhase, setDeletePhase] = useState<'idle' | 'confirm' | 'processing' | 'success' | 'failed'>('idle');
  const [confirmText, setConfirmText] = useState('');
  const [deletionResult, setDeletionResult] = useState<AccountDeletionResult | null>(null);

  if (!isOpen) return null;

  const isBusy = deletePhase === 'processing';

  const handleConfirmDelete = async () => {
    if (!onDeleteMyData || confirmText.trim().toUpperCase() !== 'DELETE') return;
    setDeletePhase('processing');
    try {
      const res = await onDeleteMyData();
      if (res && typeof res === 'object' && 'status' in res) {
        setDeletionResult(res);
        setDeletePhase(res.success ? 'success' : 'failed');
      } else {
        setDeletePhase('success');
      }
    } catch {
      setDeletionResult({
        success: false,
        status: 'failed',
        deletedQuizzes: 0,
        clearedLocalKeys: 0,
        accountDeleted: false,
        errors: ['Unexpected error while initiating account deletion.'],
      });
      setDeletePhase('failed');
    }
  };

  const handleRetryDelete = async () => {
    if (!deletionResult?.jobId || !deletionResult?.recoveryToken) {
      await handleConfirmDelete();
      return;
    }
    setDeletePhase('processing');
    const res = await retryAccountDeletion(deletionResult.jobId, deletionResult.recoveryToken);
    setDeletionResult(res);
    setDeletePhase(res.success ? 'success' : 'failed');
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
              if (isBusy) return;
              sound.playClick();
              onClose();
            }}
            disabled={isBusy}
            className="paper-btn paper-btn-sm p-1.5 text-xs font-bold leading-none disabled:opacity-50"
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

        {/* Setting 4: GDPR Privacy & Account Deletion */}
        <div className="pt-2 border-t border-[var(--border)]/20 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <span>🛡️</span> Data Privacy &amp; GDPR
          </div>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Permanently delete your account and personal data. Quizzes, drafts, profile, and pending emails are deleted; shared tournament results and issued certificates are anonymized without revealing your identity.
          </p>
          {deletePhase === 'idle' && (
            <button
              type="button"
              onClick={() => {
                sound.playClick();
                setConfirmText('');
                setDeletePhase('confirm');
              }}
              className="w-full text-left px-3 py-2 text-xs font-bold rounded-lg border-2 border-red-500/40 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50 flex items-center justify-between transition-colors shadow-xs"
            >
              <span className="flex items-center gap-2">
                <span>🗑️</span>
                <span>Delete Account &amp; Personal Data</span>
              </span>
              <span className="text-[10px] font-bold underline">Review &amp; Confirm</span>
            </button>
          )}
        </div>

        {/* Explicit Multi-Step Confirmation & Lifecycle States */}
        {deletePhase === 'confirm' && (
          <div className="p-4 rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-950/70 text-red-900 dark:text-red-100 space-y-3 animate-pop-in">
            <div className="text-xs font-black flex items-center gap-1.5">
              <span>⚠️</span> Irreversible Account Deletion
            </div>
            <p className="text-[11px] font-medium leading-relaxed">
              This will permanently delete your Firebase Authentication account, profile, quizzes, question bank, and pending emails. Active hosted tournaments will be cancelled, and completed competition records will be anonymized. Type <strong>DELETE</strong> below to confirm:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
              aria-label="Type DELETE to confirm account deletion"
              className="w-full px-2.5 py-1.5 text-xs font-mono-code rounded-lg border-2 border-red-400 bg-[var(--surface)] text-[var(--text)]"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmText('');
                  setDeletePhase('idle');
                }}
                className="paper-btn paper-btn-sm text-xs font-bold px-3 py-1 bg-[var(--surface)] text-[var(--text)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmText.trim().toUpperCase() !== 'DELETE'}
                onClick={handleConfirmDelete}
                className="paper-btn paper-btn-sm paper-btn-danger text-xs font-bold px-3 py-1 shadow-[2px_2px_0px_var(--shadow)] disabled:opacity-40"
              >
                Permanently Delete Account
              </button>
            </div>
          </div>
        )}

        {deletePhase === 'processing' && (
          <div className="p-4 rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/50 text-xs font-bold space-y-1">
            <div>⏳ Deletion in progress...</div>
            <p className="text-[11px] font-normal text-[var(--text-muted)]">
              Purging personal records, anonymizing shared history, and revoking your session. Please do not close this window.
            </p>
          </div>
        )}

        {deletePhase === 'success' && (
          <div className="p-4 rounded-xl border-2 border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 text-xs space-y-2">
            <div className="font-black text-emerald-800 dark:text-emerald-300">✓ Account Permanently Deleted</div>
            <p className="text-[11px] leading-relaxed">
              Your account, personal data, and session have been permanently removed. Shared historical tournament and certificate records remain anonymized.
            </p>
          </div>
        )}

        {deletePhase === 'failed' && (
          <div className="p-4 rounded-xl border-2 border-red-600 bg-red-50 dark:bg-red-950/70 text-xs space-y-2">
            <div className="font-black text-red-800 dark:text-red-300">⚠️ Deletion Incomplete</div>
            <p className="text-[11px] leading-relaxed">
              {deletionResult?.errors?.[0] || 'One or more deletion stages did not complete. Your account remains locked for deletion.'}
            </p>
            {deletionResult?.currentStage && (
              <div className="text-[10px] font-mono-code opacity-80">
                Stage: {deletionResult.currentStage}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleRetryDelete}
                className="paper-btn paper-btn-sm paper-btn-danger text-xs font-bold px-3 py-1"
              >
                Retry Deletion
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end pt-2 border-t border-[var(--border)]/20">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              if (isBusy) return;
              sound.playClick();
              onClose();
            }}
            className="paper-btn paper-btn-primary paper-btn-sm text-xs font-bold px-4 py-1.5 disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

