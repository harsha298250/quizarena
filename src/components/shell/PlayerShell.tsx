/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { SupportedLanguage } from '../../lib/i18n';
import { sound } from '../../lib/sound';
import { ThemeToggle } from '../common/ThemeToggle';
import { ThemeMode } from '../../hooks/useTheme';
import { AuthModal } from '../common/AuthModal';
import { SettingsModal } from '../common/SettingsModal';
import { KeyboardShortcutsModal } from '../common/KeyboardShortcutsModal';
import { useGlobalShortcuts } from '../../hooks/useGlobalShortcuts';
import { User } from 'firebase/auth';

interface PlayerShellProps {
  children?: React.ReactNode;
  lang?: SupportedLanguage;
  setLang?: (lang: SupportedLanguage) => void;
  theme?: ThemeMode;
  setTheme?: (theme: ThemeMode) => void;
  currentUser: User | null;
  onSwitchToHost?: () => void;
  onDeleteMyData?: () => void;
  onNavigate?: (tabId: string) => void;
  isLiveGame?: boolean;
}

export const PlayerShell: React.FC<PlayerShellProps> = ({
  children,
  lang = 'en',
  setLang = () => {},
  theme = 'light',
  setTheme,
  currentUser,
  onSwitchToHost,
  onDeleteMyData,
  onNavigate,
  isLiveGame = false,
}) => {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);

  // Global shortcuts handler respecting active gameplay isolation
  useGlobalShortcuts({
    onNavigate: tab => onNavigate && onNavigate(tab),
    onOpenCommandPalette: () => {},
    onOpenShortcutsHelp: () => setShortcutsModalOpen(true),
    userRole: 'student',
    isLiveGame,
    enabled: true,
  });

  // An authenticated user is one that exists and is not anonymous
  const isAuthenticated = Boolean(currentUser && !currentUser.isAnonymous);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-page)] text-[var(--text)] transition-colors overflow-x-clip min-w-0">
      {/* Accessible Skip Link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--accent)] focus:text-[var(--text-on-accent)] focus:rounded-lg focus:shadow-md focus:font-bold"
      >
        Skip to main content
      </a>

      {/* Slim Top Bar */}
      <header className="sticky top-0 z-40 border-b-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-xs transition-colors overflow-x-clip">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-3 sm:px-6 py-2">
          {/* Brand Wordmark */}
          <div className="flex items-center gap-1.5 sm:gap-2 group select-none shrink-0 min-w-0">
            <div className="relative shrink-0">
              <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl border-2 border-[var(--border)] bg-[var(--accent)] shadow-[2px_2px_0px_var(--shadow)]">
                <span className="font-['Bricolage_Grotesque'] font-black text-base sm:text-lg text-[var(--text-on-accent)]">Q</span>
              </div>
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--accent-2-bg)] border border-[var(--border)] text-[9px] font-bold text-[var(--text-on-accent-2)]">
                ⚡
              </span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-['Bricolage_Grotesque'] text-base sm:text-xl font-black tracking-tight text-[var(--text)] leading-none truncate">
                Quiz<span className="text-[var(--accent)]">Arena</span>
              </span>
              <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-[var(--ok)] dark:text-[var(--accent-2)] truncate">
                Arena Play
              </span>
            </div>
          </div>

          {/* Right Controls: Quick items on desktop/tablet, concise on mobile */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Host Return Pill if authenticated host in player shell (hidden during live quiz) */}
            {onSwitchToHost && !isLiveGame && (
              <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  onSwitchToHost();
                }}
                className="paper-btn paper-btn-sm paper-btn-secondary text-[11px] sm:text-xs font-bold py-1 px-2 sm:px-2.5 flex items-center gap-1 shadow-2xs shrink-0"
                title="Switch back to Host Dashboard"
              >
                <span>🎓</span>
                <span className="hidden sm:inline">Host View</span>
              </button>
            )}

            {/* Theme Toggle (Hidden on < 640px, available in Settings ⚙️) */}
            <div className="hidden sm:block">
              <ThemeToggle theme={theme} setTheme={t => setTheme && setTheme(t)} />
            </div>

            {/* Keyboard Shortcuts button (Hidden during live quiz) */}
            {!isLiveGame && (
              <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  setShortcutsModalOpen(true);
                }}
                className="p-1.5 rounded-lg border-2 border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] shadow-xs transition-transform active:translate-y-0.5 shrink-0"
                title="Keyboard Shortcuts (?)"
                aria-label="Keyboard Shortcuts"
              >
                <span aria-hidden="true">⌨️</span>
              </button>
            )}

            {/* Settings button - Always visible on all screens */}
            <button
              type="button"
              onClick={() => {
                sound.playClick();
                setSettingsOpen(true);
              }}
              className="p-1.5 rounded-lg border-2 border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] shadow-xs transition-transform active:translate-y-0.5 shrink-0"
              title="Settings (Theme, Sound, Privacy)"
              aria-label="Settings"
            >
              <span aria-hidden="true">⚙️</span>
            </button>

            {/* Sign In button for unauthenticated visitors - NEVER show Sign Out to guests, hide during live match */}
            {!isAuthenticated && !isLiveGame && (
              <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  setAuthModalOpen(true);
                }}
                className="paper-btn paper-btn-sm paper-btn-primary py-1 px-2.5 text-xs font-bold whitespace-nowrap shrink-0"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Full-Width Content */}
      <main id="main-content" className="flex-1 py-4 sm:py-6 overflow-x-clip min-w-0">
        {children}
      </main>

      {/* Modals */}
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
        onDeleteMyData={onDeleteMyData}
        currentUserEmail={isAuthenticated ? currentUser?.email : null}
        currentUserName={isAuthenticated ? currentUser?.displayName : null}
      />
      <KeyboardShortcutsModal
        isOpen={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
      />
    </div>
  );
};
