/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { SupportedLanguage, translations } from '../../lib/i18n';
import { sound } from '../../lib/sound';
import { PWAInstallButton } from './PWAInstallButton';
import { ThemeToggle } from './ThemeToggle';
import { ThemeMode } from '../../hooks/useTheme';
import { signInWithPopup, signOut, googleProvider, auth } from '../../lib/firebase';
import { User } from 'firebase/auth';
import { AuthModal } from './AuthModal';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  lang: SupportedLanguage;
  setLang: (l: SupportedLanguage) => void;
  isDarkMode?: boolean;
  setIsDarkMode?: (dark: boolean) => void;
  theme?: ThemeMode;
  setTheme?: (t: ThemeMode) => void;
  onDeleteMyData?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  lang,
  setLang,
  isDarkMode,
  setIsDarkMode,
  theme,
  setTheme,
  onDeleteMyData,
}) => {
  const [isMuted, setIsMuted] = useState(sound.getMuted());
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const t = translations[lang];

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      setCurrentUser(user);
    });
    return () => unsub();
  }, []);

  const handleMuteToggle = () => {
    const newMute = sound.toggleMute();
    setIsMuted(newMute);
    if (!newMute) sound.playClick();
  };

  const handleNavClick = (tabId: string) => {
    sound.playClick();
    setCurrentTab(tabId);
    setMobileMenuOpen(false);
  };

  const handleLogout = async () => {
    sound.playClick();
    await signOut(auth);
  };

  const currentThemeMode: ThemeMode = theme || (isDarkMode ? 'dark' : 'light');
  const handleThemeChange = (newTheme: ThemeMode) => {
    if (setTheme) {
      setTheme(newTheme);
    } else if (setIsDarkMode) {
      setIsDarkMode(newTheme === 'dark');
    }
  };

  const navItems = [
    { id: 'arena', label: t.navJoin, icon: '🎮' },
    { id: 'builder', label: t.navBuilder, icon: '✏️' },
    { id: 'ai', label: t.navAI, icon: '✨' },
    { id: 'competitions', label: t.navCompetitions, icon: '🏆' },
    { id: 'analytics', label: t.navAnalytics, icon: '📊' },
    { id: 'outbox', label: t.navOutbox, icon: '📬' },
    { id: 'practice', label: t.navPractice, icon: '🎯' },
  ];

  return (
    <header className="sticky top-0 z-40 border-b-3 border-[var(--border)] bg-[var(--bg-page)] text-[var(--text)] transition-colors">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 sm:px-6">
        {/* Brand Wordmark */}
        <div
          onClick={() => handleNavClick('arena')}
          className="flex items-center gap-2.5 cursor-pointer group select-none"
        >
          <div className="relative">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-[var(--border)] bg-[var(--accent)] shadow-[2.5px_2.5px_0px_var(--shadow)] group-hover:rotate-6 transition-transform">
              <span className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text-on-accent)]">Q</span>
            </div>
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-2-bg)] border border-[var(--border)] text-[10px] font-bold text-[var(--text-on-accent-2)]">
              ⚡
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-['Bricolage_Grotesque'] text-2xl font-black tracking-tight text-[var(--text)] leading-none">
              Quiz<span className="text-[var(--accent)]">Arena</span>
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ok)] dark:text-[var(--accent-2)]">
              Real-Time Play
            </span>
          </div>
        </div>

        {/* Desktop Navigation Links (Collapses to Drawer below 1280px) */}
        <nav className="hidden xl:flex items-center gap-1 2xl:gap-1.5" aria-label="Main Navigation">
          {navItems.map(item => {
            const active = currentTab === item.id;
            return (
              <button
                key={item.id}
                data-tab={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`px-2.5 2xl:px-3 py-1.5 text-xs font-bold font-['Bricolage_Grotesque'] rounded-lg transition-all border-2 flex items-center gap-1 2xl:gap-1.5 ${
                  active
                    ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)] shadow-[2px_2px_0px_var(--shadow)]'
                    : 'border-transparent text-[var(--text)] hover:border-[var(--border)] hover:bg-[var(--surface-2)]'
                }`}
              >
                <span aria-hidden="true" className="text-xs select-none">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Controls: Language, Sound, PWA, Dark Mode, Auth */}
        <div className="flex items-center gap-2">
          {/* Language Selector */}
          <div className="relative">
            <select
              aria-label="Select Language"
              value={lang}
              onChange={e => {
                sound.playClick();
                setLang(e.target.value as SupportedLanguage);
              }}
              className="text-xs font-bold rounded-lg border-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)] px-2 py-1 shadow-[2px_2px_0px_var(--shadow)] focus:outline-none cursor-pointer"
            >
              <option value="en">EN</option>
              <option value="ta">தமிழ்</option>
              <option value="hi">हिन्दी</option>
            </select>
          </div>

          {/* Sound Mute Button */}
          <button
            onClick={handleMuteToggle}
            className={`p-1.5 rounded-lg border-2 border-[var(--border)] shadow-[2px_2px_0px_var(--shadow)] transition-transform active:translate-y-0.5 ${
              isMuted ? 'bg-[var(--accent)] text-[var(--text-on-accent)]' : 'bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)]'
            }`}
            title={isMuted ? 'Unmute Sound FX' : 'Mute Sound FX'}
            aria-label={isMuted ? 'Unmute Sound FX' : 'Mute Sound FX'}
          >
            {isMuted ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            )}
          </button>

          {/* Accessible Three-State Theme Toggle */}
          <ThemeToggle theme={currentThemeMode} setTheme={handleThemeChange} />

          {/* In-App PWA Install */}
          <PWAInstallButton />

          {/* Delete My Data (Privacy / GDPR) */}
          {onDeleteMyData && (
            <button
              onClick={() => {
                sound.playClick();
                onDeleteMyData();
              }}
              className="paper-btn paper-btn-sm paper-btn-danger text-xs px-2 py-1 flex items-center gap-1 shadow-[2px_2px_0px_var(--shadow)]"
              title="Delete my data (GDPR / Privacy Data Removal)"
            >
              <span aria-hidden="true">🗑️</span>
              <span className="hidden xl:inline font-bold">Delete My Data</span>
            </button>
          )}

          {/* User Sign In / Profile */}
          {currentUser ? (
            <div className="flex items-center gap-1.5">
              <span className="hidden sm:inline-block text-xs font-bold text-[var(--text)] truncate max-w-[90px]">
                {currentUser.displayName || 'Host'}
              </span>
              <button
                onClick={handleLogout}
                className="paper-btn paper-btn-sm text-xs px-2 py-1"
                title="Sign Out"
              >
                Out
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                sound.playClick();
                setAuthModalOpen(true);
              }}
              className="paper-btn paper-btn-sm paper-btn-ok text-xs px-2.5 py-1"
              title="Sign in with Email or Google"
            >
              Sign In
            </button>
          )}

          {/* Mobile hamburger menu toggle (Active below 1280px) */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle mobile navigation menu"
            className="xl:hidden p-1.5 rounded-lg border-2 border-[var(--border)] bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)] shadow-[2px_2px_0px_var(--shadow)]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Drawer (Collapses below 1280px) */}
      {mobileMenuOpen && (
        <div className="xl:hidden border-t-2 border-[var(--border)] bg-[var(--bg-page)] text-[var(--text)] px-4 py-3 space-y-1.5 animate-fadeIn">
          {navItems.map(item => (
            <button
              key={item.id}
              data-tab={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`w-full text-left px-3 py-2.5 text-sm font-bold rounded-lg border-2 flex items-center gap-2.5 transition-all ${
                currentTab === item.id
                  ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)] shadow-[2px_2px_0px_var(--shadow)]'
                  : 'border-transparent text-[var(--text)] hover:bg-[var(--surface-2)]'
              }`}
            >
              <span aria-hidden="true" className="text-base select-none">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}

          {onDeleteMyData && (
            <div className="pt-2 border-t border-[var(--border)]/20">
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onDeleteMyData();
                }}
                className="w-full text-left px-3 py-2 text-sm font-bold rounded-lg border-2 border-[var(--border)] bg-red-600 text-white shadow-[2px_2px_0px_var(--shadow)] flex items-center gap-2"
              >
                <span aria-hidden="true">🗑️</span>
                <span>Delete My Data (GDPR)</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Host / Teacher Authentication Modal (Google & Email/Password with Password Reset) */}
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </header>
  );
};
