/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { sound } from '../../lib/sound';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutSection {
  title: string;
  icon: string;
  entries: ShortcutEntry[];
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;
      modalRef.current?.focus();
    } else if (previousActiveElementRef.current) {
      previousActiveElementRef.current.focus?.();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        sound.playClick();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sections: ShortcutSection[] = [
    {
      title: 'Global & Quick Actions',
      icon: '⚡',
      entries: [
        { keys: ['?'], description: 'Open Keyboard Shortcuts Help' },
        { keys: ['Ctrl', 'K'], description: 'Open Quick Command Palette' },
        { keys: ['Esc'], description: 'Close Open Dialog or Modal' },
      ],
    },
    {
      title: 'Two-Key Navigation (Press G then letter)',
      icon: '🧭',
      entries: [
        { keys: ['G', 'D'], description: 'Navigate to Dashboard' },
        { keys: ['G', 'A'], description: 'Navigate to Live Arena / Join Quiz' },
        { keys: ['G', 'S'], description: 'Navigate to Quiz Studio (Builder)' },
        { keys: ['G', 'I'], description: 'Navigate to AI Quiz Generator' },
        { keys: ['G', 'T'], description: 'Navigate to Tournaments & Brackets' },
        { keys: ['G', 'L'], description: 'Navigate to Cohort Analytics' },
        { keys: ['G', 'C'], description: 'Navigate to Digital Certificates' },
        { keys: ['G', 'O'], description: 'Navigate to Email Delivery Outbox' },
      ],
    },
    {
      title: 'Live Player Arena (In-Game Controls)',
      icon: '🎮',
      entries: [
        { keys: ['1'], description: 'Select Option 1 (Red / Triangle)' },
        { keys: ['2'], description: 'Select Option 2 (Blue / Diamond)' },
        { keys: ['3'], description: 'Select Option 3 (Yellow / Circle)' },
        { keys: ['4'], description: 'Select Option 4 (Green / Square)' },
        { keys: ['Enter'], description: 'Submit Multi-select or Typed Answer' },
      ],
    },
    {
      title: 'Command Palette Controls',
      icon: '🔍',
      entries: [
        { keys: ['↑', '↓'], description: 'Navigate Command Options' },
        { keys: ['Enter'], description: 'Execute Selected Command' },
        { keys: ['Tab'], description: 'Focus Filter Search Input' },
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard Shortcuts"
      onClick={e => {
        if (e.target === e.currentTarget) {
          sound.playClick();
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="paper-card p-0 max-w-2xl w-full bg-[var(--surface)] border-3 border-[var(--border)] shadow-[8px_8px_0px_var(--shadow)] overflow-hidden max-h-[85vh] flex flex-col focus:outline-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-[var(--border)] bg-[var(--surface-2)]">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">⌨️</span>
            <div>
              <h2 className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text)] leading-tight">
                Keyboard Shortcuts
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Boost your productivity with quick navigation and gameplay keys
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              onClose();
            }}
            className="paper-btn paper-btn-sm text-xs font-bold px-2.5 py-1"
            aria-label="Close shortcuts modal"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-6">
          {sections.map(section => (
            <div key={section.title} className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[var(--accent)] border-b border-[var(--border)]/20 pb-1">
                <span>{section.icon}</span>
                <span>{section.title}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {section.entries.map((entry, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 rounded-lg bg-[var(--surface-2)]/60 border border-[var(--border)]/30 text-xs"
                  >
                    <span className="text-[var(--text)] font-medium pr-2 truncate">
                      {entry.description}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {entry.keys.map((k, kidx) => (
                        <React.Fragment key={kidx}>
                          <kbd className="px-1.5 py-0.5 text-[11px] font-mono-code font-bold bg-[var(--surface)] text-[var(--text)] rounded border border-[var(--border)] shadow-2xs">
                            {k}
                          </kbd>
                          {kidx < entry.keys.length - 1 && (
                            <span className="text-[10px] text-[var(--text-muted)] font-mono-code">
                              +
                            </span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Conflict Guard Callout */}
          <div className="p-3 rounded-xl bg-[var(--ok-bg,rgba(16,185,129,0.1))] border border-[var(--ok)] text-xs text-[var(--text)] space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-[var(--ok)]">
              <span>🛡️</span>
              <span>Intelligent Input & Live Game Protection</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Global navigation shortcuts are automatically disabled when typing inside text boxes, textareas, dropdowns, and during active live quiz gameplay.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t-2 border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>Press <kbd className="px-1 py-0.5 font-mono-code bg-[var(--surface)] border border-[var(--border)] rounded text-[10px]">Esc</kbd> anytime to dismiss</span>
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              onClose();
            }}
            className="paper-btn paper-btn-sm paper-btn-accent text-xs font-bold py-1 px-4"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
