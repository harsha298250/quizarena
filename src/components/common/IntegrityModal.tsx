/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { IntegrityWarningModalState } from '../../hooks/useIntegrityGuard';

interface IntegrityModalProps {
  modalState: IntegrityWarningModalState | null;
  onDismiss: () => void;
  blockedByExtension?: boolean;
  extensionReason?: string;
  onReScanClean?: () => void;
  requireFullscreen?: boolean;
  isFullscreen?: boolean;
  onRequestFullscreen?: () => void;
}

export const IntegrityModal: React.FC<IntegrityModalProps> = ({
  modalState,
  onDismiss,
  blockedByExtension,
  extensionReason,
  onReScanClean,
  requireFullscreen,
  isFullscreen,
  onRequestFullscreen,
}) => {
  // Strong signal extension block screen
  if (blockedByExtension) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 animate-fadeIn">
        <div className="paper-modal p-6 sm:p-8 max-w-md w-full text-center space-y-4 border-3 border-[var(--accent)]">
          <div className="text-5xl animate-bounce">🛡️</div>
          <h2 className="font-['Bricolage_Grotesque'] font-black text-2xl text-[var(--accent)]">
            Security Notice
          </h2>
          <p className="text-xs sm:text-sm font-semibold text-[var(--text)] leading-relaxed">
            Turn off all extensions that read or modify this page, then reload.
          </p>
          <div className="p-3 bg-red-100 dark:bg-red-950/40 border border-red-300 rounded-xl text-xs font-mono font-bold text-red-800 dark:text-red-200 text-left break-words">
            Signal: {extensionReason || 'Third-party extension/overlay detected modifying DOM'}
          </div>
          <div className="p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] text-xs font-bold text-[var(--text-muted)]">
            ♿ Note: Built-in operating system screen readers, dyslexia fonts, and approved accessibility tools are always permitted.
          </div>
          <div className="p-2.5 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] text-[10.5px] font-medium text-[var(--text-muted)] text-left space-y-1">
            <span className="font-bold text-[var(--text)] block">ℹ️ Browser Security Notice:</span>
            <span>While QuizArena detects active DOM injections, overlays, DevTools, and common assistant signatures, web browsers technically cannot detect every external extension, OS-level screen sharing app, or hardware capture device. Academic integrity ultimately relies on trust and human proctoring.</span>
          </div>
          <div className="flex gap-2">
            {onReScanClean && (
              <button
                onClick={onReScanClean}
                className="paper-btn paper-btn-secondary flex-1 py-2.5 text-xs font-black shadow-[3px_3px_0px_var(--shadow)]"
              >
                🔍 Re-Scan Now
              </button>
            )}
            <button
              onClick={() => window.location.reload()}
              className="paper-btn paper-btn-primary flex-1 py-2.5 text-xs font-black shadow-[3px_3px_0px_var(--shadow)]"
            >
              🔄 Reload Arena
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Fullscreen Required Prompt in Secure Mode
  if (requireFullscreen && !isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-fadeIn">
        <div className="paper-modal p-6 sm:p-8 max-w-md w-full text-center space-y-4 border-3">
          <div className="text-5xl animate-pulse">📺</div>
          <h2 className="font-['Bricolage_Grotesque'] font-black text-2xl text-[var(--text)]">
            Fullscreen Arena Required
          </h2>
          <p className="text-xs sm:text-sm font-semibold text-[var(--text-muted)]">
            The host has enabled Secure Mode with mandatory fullscreen. Please click below to enter fullscreen and continue answering.
          </p>
          <div className="p-2.5 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] text-[11px] font-bold text-[var(--text-muted)]">
            ♿ Assistive accommodations remain active.
          </div>
          <button
            onClick={onRequestFullscreen}
            className="paper-btn paper-btn-primary w-full py-2.5 text-sm font-black shadow-[3px_3px_0px_var(--shadow)]"
          >
            ⛶ Enter Fullscreen
          </button>
        </div>
      </div>
    );
  }

  // Strike Warning Modal (Strike 1, Strike 2, Strike 3)
  if (!modalState || !modalState.open) return null;

  const strikeConfig = {
    1: {
      badge: '⚠️ Advisory Warning (Strike 1 of 3)',
      badgeClass: 'sticker-badge-sunshine',
      border: 'border-[var(--accent-2)]',
    },
    2: {
      badge: '⚡ Serious Notice (Strike 2 of 3)',
      badgeClass: 'sticker-badge-tomato',
      border: 'border-[var(--accent)]',
    },
    3: {
      badge: '🚨 Flagged to Host (Strike 3)',
      badgeClass: 'sticker-badge-tomato',
      border: 'border-red-600',
    },
  }[Math.min(modalState.strike, 3) as 1 | 2 | 3];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="integrity-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 animate-fadeIn"
    >
      <div className={`paper-modal p-6 sm:p-7 max-w-md w-full space-y-4 border-3 ${strikeConfig.border} shadow-[6px_6px_0px_var(--shadow)]`}>
        <div className="text-center space-y-2">
          <span className={`sticker-badge ${strikeConfig.badgeClass} text-xs font-black uppercase tracking-wider`}>
            {strikeConfig.badge}
          </span>
          <h2 id="integrity-modal-title" className="font-['Bricolage_Grotesque'] font-black text-2xl text-[var(--text)]">
            {modalState.title}
          </h2>
        </div>

        <p className="text-xs sm:text-sm font-semibold text-[var(--text)] text-center leading-relaxed">
          {modalState.message}
        </p>

        {modalState.penaltyPoints && modalState.penaltyPoints > 0 && (
          <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 rounded-xl border border-rose-500 text-center text-xs font-black text-rose-700 dark:text-rose-300">
            Advisory Deduction: -{modalState.penaltyPoints} Points
          </div>
        )}

        {modalState.isLocked && (
          <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-500 text-center text-xs font-black text-amber-800 dark:text-amber-300">
            🔒 Answering locked for the remainder of this question.
          </div>
        )}

        {/* Clear Accessibility & Advisory Statement */}
        <div className="p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] text-[11px] font-semibold text-[var(--text-muted)] space-y-1">
          <div className="font-black text-[var(--text)] flex items-center gap-1.5">
            <span>♿</span>
            <span>Accessibility &amp; Human Review</span>
          </div>
          <p>
            Screen readers, dyslexia fonts, and approved accommodations are always permitted. All recorded flags are strictly advisory and reviewed human-to-human by your host/teacher. Please note that web browsers cannot detect all external extensions or OS-level screen-sharing applications.
          </p>
        </div>

        <button
          onClick={onDismiss}
          className="paper-btn paper-btn-primary w-full py-2.5 text-xs sm:text-sm font-black shadow-[3px_3px_0px_var(--shadow)]"
        >
          Understood, Return to Quiz
        </button>
      </div>
    </div>
  );
};

