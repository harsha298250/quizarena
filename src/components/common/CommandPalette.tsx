/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { sound } from '../../lib/sound';

export interface CommandItem {
  id: string;
  title: string;
  category: string;
  icon: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tabId: string) => void;
  onOpenSettings?: () => void;
  onSwitchRole?: (role: 'host' | 'student') => void;
  userRole?: 'host' | 'student';
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onOpenSettings,
  onSwitchRole,
  userRole = 'host',
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  const commands: CommandItem[] = [
    {
      id: 'nav_dashboard',
      title: 'Go to Dashboard',
      category: 'Navigation',
      icon: '🏠',
      shortcut: 'G D',
      action: () => onNavigate(userRole === 'host' ? 'host_dashboard' : 'student_dashboard'),
    },
    {
      id: 'nav_arena',
      title: 'Live Arena / Join Quiz',
      category: 'Navigation',
      icon: '🎮',
      shortcut: 'G A',
      action: () => onNavigate('arena'),
    },
    {
      id: 'nav_builder',
      title: 'Quiz Studio (Builder)',
      category: 'Create',
      icon: '✏️',
      shortcut: 'G S',
      action: () => onNavigate('builder'),
    },
    {
      id: 'nav_ai',
      title: 'AI Quiz Generator',
      category: 'Create',
      icon: '✨',
      shortcut: 'G I',
      action: () => onNavigate('ai'),
    },
    {
      id: 'nav_competitions',
      title: 'Tournaments & Brackets',
      category: 'Run',
      icon: '🏆',
      shortcut: 'G T',
      action: () => onNavigate('competitions'),
    },
    {
      id: 'nav_analytics',
      title: 'Cohort Learning Analytics',
      category: 'Review',
      icon: '📊',
      shortcut: 'G L',
      action: () => onNavigate('analytics'),
    },
    {
      id: 'nav_certificates',
      title: 'Digital Verified Certificates',
      category: 'Review',
      icon: '🎓',
      shortcut: 'G C',
      action: () => onNavigate('certificates'),
    },
    {
      id: 'nav_outbox',
      title: 'Email Delivery Outbox',
      category: 'Review',
      icon: '📬',
      shortcut: 'G O',
      action: () => onNavigate('outbox'),
    },
    {
      id: 'action_settings',
      title: 'Open Settings & Preferences',
      category: 'Actions',
      icon: '⚙️',
      shortcut: ',',
      action: () => {
        if (onOpenSettings) onOpenSettings();
      },
    },
    {
      id: 'action_switch_role',
      title: userRole === 'host' ? 'Switch to Student View' : 'Switch to Host View',
      category: 'Actions',
      icon: userRole === 'host' ? '🎒' : '🎓',
      action: () => {
        if (onSwitchRole) onSwitchRole(userRole === 'host' ? 'student' : 'host');
      },
    },
  ];

  const filtered = commands.filter(cmd => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      cmd.title.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    if (isOpen) {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else if (previousActiveElementRef.current) {
      previousActiveElementRef.current.focus?.();
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation inside palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      inputRef.current?.focus();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        sound.playClick();
        filtered[selectedIndex].action();
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 bg-black/60 backdrop-blur-xs p-4 animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="paper-card p-0 max-w-xl w-full bg-[var(--surface)] border-3 border-[var(--border)] shadow-[8px_8px_0px_var(--shadow)] overflow-hidden animate-pop-in"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b-2 border-[var(--border)] bg-[var(--surface-2)]">
          <span className="text-base text-[var(--text-muted)]" aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type a command or destination (e.g. Studio, AI, Analytics)..."
            className="flex-1 bg-transparent text-sm font-bold text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
            aria-label="Search commands"
          />
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono-code font-bold bg-[var(--surface)] text-[var(--text-muted)] rounded border border-[var(--border)]">
            ESC
          </kbd>
        </div>

        {/* Command List */}
        <div className="max-h-72 overflow-y-auto p-2 space-y-1" role="listbox">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs font-bold text-[var(--text-muted)]">
              No matching commands or destinations found for &quot;{query}&quot;.
            </div>
          ) : (
            filtered.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    sound.playClick();
                    cmd.action();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all border ${
                    isSelected
                      ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)] shadow-xs'
                      : 'border-transparent text-[var(--text)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-base shrink-0" aria-hidden="true">{cmd.icon}</span>
                    <span className="text-xs font-bold truncate">{cmd.title}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[10px] font-mono-code font-semibold uppercase tracking-wider ${
                        isSelected ? 'text-[var(--text-on-accent)]/80' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {cmd.category}
                    </span>
                    {cmd.shortcut && (
                      <kbd
                        className={`hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono-code rounded border ${
                          isSelected
                            ? 'bg-white/20 text-[var(--text-on-accent)] border-white/30'
                            : 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]'
                        }`}
                      >
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 bg-[var(--surface-2)] border-t border-[var(--border)]/30 flex items-center justify-between text-[11px] font-semibold text-[var(--text-muted)]">
          <div className="flex items-center gap-2">
            <span>↑↓ to navigate</span>
            <span>•</span>
            <span>↵ to select</span>
          </div>
          <span className="font-mono-code">QuizArena QuickJump</span>
        </div>
      </div>
    </div>
  );
};

