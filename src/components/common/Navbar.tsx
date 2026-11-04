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
  userRole?: 'host' | 'student';
  setUserRole?: (role: 'host' | 'student') => void;
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
  userRole = 'host',
  setUserRole,
}) => {
  const [isMuted, setIsMuted] = useState(sound.getMuted());
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const t = translations[lang];

  const isAuthenticated = Boolean(currentUser && !currentUser.isAnonymous);

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

  // Role-based navigation items
  const hostNavItems = [
    { id: 'host_dashboard', label: 'Dashboard', icon: '🏠' },
    { id: 'arena', label: t.navJoin, icon: '🎮' },
    { id: 'builder', label: t.navBuilder, icon: '✏️' },
    { id: 'ai', label: t.navAI, icon: '✨' },
    { id: 'competitions', label: t.navCompetitions, icon: '🏆' },
    { id: 'analytics', label: t.navAnalytics, icon: '📊' },
    { id: 'outbox', label: t.navOutbox, icon: '📬' },
    { id: 'certificates', label: 'Certificates', icon: '🎓' },
  ];

  const studentNavItems = [
    { id: 'student_dashboard', label: 'My Portal', icon: '🏠' },
    { id: 'arena', label: t.navJoin, icon: '🎮' },
    { id: 'competitions', label: t.navCompetitions, icon: '🏆' },
    { id: 'practice', label: t.navPractice, icon: '🎯' },
    { id: 'certificates', label: 'Certificates', icon: '🎓' },
  ];

  const navItems = userRole === 'student' ? studentNavItems : hostNavItems;

  return (
    <header className="sticky top-0 z-40 border-b-3 border-[var(--border)] bg-[var(--bg-page)] text-[var(--text)] transition-colors overflow-x-clip">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 sm:px-6">
        {/* Brand Wordmark */}
        <div
          onClick={() => handleNavClick('arena')}
          className="flex items-center gap-2 sm:gap-2.5 cursor-pointer group select-none min-w-0"
        >
          <div className="relative shrink-0">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl border-2 border-[var(--border)] bg-[var(--accent)] shadow-[2.5px_2.5px_0px_var(--shadow)] group-hover:rotate-6 transition-transform">
              <span className="font-['Bricolage_Grotesque'] font-black text-lg sm:text-xl text-[var(--text-on-accent)]">Q</span>
            </div>
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-2-bg)] border border-[var(--border)] text-[10px] font-bold text-[var(--text-on-accent-2)]">
              ⚡
            </span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-['Bricolage_Grotesque'] text-xl sm:text-2xl font-black tracking-tight text-[var(--text)] leading-none truncate">
              Quiz<span className="text-[var(--accent)]">Arena</span>
            </span>
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-[var(--ok)] dark:text-[var(--accent-2)] truncate">
              Real-Time Play
            </span>
          </div>
        </div>

        {/* Desktop Navigation Links (Collapses to Drawer below 1400px) */}
        <nav className="hidden min-[1400px]:flex items-center gap-1 min-[1500px]:gap-1.5" aria-label="Main Navigation">
          {navItems.map(item => {
            const active = currentTab === item.id;
            return (
              <button
                key={item.id}
                data-tab={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`px-2.5 min-[1300px]:px-3 py-1.5 text-xs font-bold font-['Bricolage_Grotesque'] rounded-lg transition-all border-2 flex items-center gap-1 min-[1300px]:gap-1.5 whitespace-nowrap ${
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

        {/* Controls: Language, Sound, Theme, PWA, Settings, Auth */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Language Selector (English Only) */}
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
            </select>
          </div>

          {/* Sound Mute Button (Desktop/Tablet) */}
          <button
            onClick={handleMuteToggle}
            className={`hidden sm:inline-flex p-1.5 rounded-lg border-2 border-[var(--border)] shadow-[2px_2px_0px_var(--shadow)] transition-transform active:translate-y-0.5 ${
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

          {/* Accessible Three-State Theme Toggle (Desktop/Tablet) */}
          <div className="hidden sm:inline-flex">
            <ThemeToggle theme={currentThemeMode} setTheme={handleThemeChange} />
          </div>

          {/* In-App PWA Install (Desktop/Tablet) */}
          <div className="hidden sm:inline-flex">
            <PWAInstallButton />
          </div>

          {/* Settings & Privacy Menu Toggle (Desktop/Tablet) */}
          <div className="hidden sm:inline-flex relative">
            <button
              onClick={() => {
                sound.playClick();
                setSettingsOpen(!settingsOpen);
              }}
              aria-label="Settings and Privacy"
              title="Settings and Privacy"
              className="p-1.5 rounded-lg border-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-[2px_2px_0px_var(--shadow)] transition-transform active:translate-y-0.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {/* Settings Dropdown Popover */}
            {settingsOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] p-3 shadow-lg z-50 space-y-3 animate-fadeIn">
                <div className="border-b border-[var(--border)]/20 pb-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-[var(--text)]">Profile & Mode</div>
                    <span className="sticker-badge sticker-badge-primary text-[10px] py-0.5 px-1.5">
                      {userRole === 'host' ? 'Host' : 'Student'}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                    {currentUser ? currentUser.email || currentUser.displayName || 'Signed In' : 'Guest Mode'}
                  </div>
                </div>

                {/* Role Switcher */}
                {setUserRole && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Switch Experience</div>
                    <div className="grid grid-cols-2 gap-1 p-0.5 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                      <button
                        onClick={() => {
                          sound.playClick();
                          setUserRole('host');
                          setCurrentTab('host_dashboard');
                          setSettingsOpen(false);
                        }}
                        className={`py-1 text-[11px] font-bold rounded-md transition-all ${
                          userRole === 'host' ? 'bg-[var(--accent)] text-white shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                        }`}
                      >
                        🎓 Host
                      </button>
                      <button
                        onClick={() => {
                          sound.playClick();
                          setUserRole('student');
                          setCurrentTab('student_dashboard');
                          setSettingsOpen(false);
                        }}
                        className={`py-1 text-[11px] font-bold rounded-md transition-all ${
                          userRole === 'student' ? 'bg-[var(--accent)] text-white shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                        }`}
                      >
                        🎒 Student
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Privacy & Data</div>
                  <button
                    onClick={() => {
                      setSettingsOpen(false);
                      setDeleteConfirmOpen(true);
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-xs font-bold rounded-lg border border-red-500/30 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 hover:bg-red-100 flex items-center gap-2 transition-colors"
                  >
                    <span aria-hidden="true">🗑️</span>
                    <span>Delete My Data (GDPR)</span>
                  </button>
                </div>

                <button
                  onClick={() => setSettingsOpen(false)}
                  className="paper-btn paper-btn-sm w-full py-1 text-xs font-bold"
                >
                  Close
                </button>
              </div>
            )}
          </div>

          {/* User Sign In / Profile (Desktop/Tablet) */}
          {isAuthenticated ? (
            <div className="hidden sm:inline-flex items-center gap-1.5 shrink-0">
              <span
                className="inline-block text-xs font-bold text-[var(--text)] truncate max-w-[120px] md:max-w-[160px]"
                title={currentUser?.displayName || currentUser?.email || 'Host'}
              >
                {currentUser?.displayName || 'Host'}
              </span>
              <button
                onClick={handleLogout}
                className="paper-btn paper-btn-sm text-xs px-2.5 py-1 whitespace-nowrap"
                title="Sign Out"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                sound.playClick();
                setAuthModalOpen(true);
              }}
              className="hidden sm:inline-flex paper-btn paper-btn-sm paper-btn-ok text-xs px-2.5 py-1 shrink-0 whitespace-nowrap"
              title="Sign in with Email or Google"
            >
              Sign In
            </button>
          )}

          {/* Hamburger menu toggle (Active below 1400px) */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle mobile navigation menu"
            className="min-[1400px]:hidden p-1.5 rounded-lg border-2 border-[var(--border)] bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)] shadow-[2px_2px_0px_var(--shadow)]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile / Responsive Drawer (Collapses below 1400px) */}
      {mobileMenuOpen && (
        <div className="min-[1400px]:hidden border-t-2 border-[var(--border)] bg-[var(--bg-page)] text-[var(--text)] px-4 py-3 space-y-1.5 animate-fadeIn">
          {/* Mobile User Profile / Sign In Banner */}
          <div className="sm:hidden pb-2 mb-1 border-b border-[var(--border)]/20">
            {isAuthenticated ? (
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[var(--text)] truncate">
                    {currentUser?.displayName || 'Host'}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] truncate">
                    {currentUser?.email || ''}
                  </div>
                </div>
                <button
                  onClick={() => {
                    handleLogout();
                    setMobileMenuOpen(false);
                  }}
                  className="paper-btn paper-btn-sm text-xs px-2.5 py-1 whitespace-nowrap shrink-0"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  sound.playClick();
                  setMobileMenuOpen(false);
                  setAuthModalOpen(true);
                }}
                className="w-full paper-btn paper-btn-ok py-2 text-xs font-bold flex items-center justify-center gap-2"
              >
                <span>🔑</span>
                <span>Sign In / Register</span>
              </button>
            )}
          </div>

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

          {/* Mobile Drawer Quick Controls: Theme & Sound */}
          <div className="pt-2 sm:hidden border-t border-[var(--border)]/20 space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-[var(--text-muted)]">Theme Appearance</span>
              <ThemeToggle theme={currentThemeMode} setTheme={handleThemeChange} />
            </div>
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-[var(--text-muted)]">Sound Effects</span>
              <button
                onClick={handleMuteToggle}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg border-2 border-[var(--border)] shadow-[2px_2px_0px_var(--shadow)] flex items-center gap-1.5 ${
                  isMuted ? 'bg-[var(--accent)] text-[var(--text-on-accent)]' : 'bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)]'
                }`}
              >
                <span>{isMuted ? '🔇' : '🔊'}</span>
                <span>{isMuted ? 'Muted' : 'Sound On'}</span>
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-[var(--border)]/20">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                setDeleteConfirmOpen(true);
              }}
              className="w-full text-left px-3 py-2 text-sm font-bold rounded-lg border-2 border-[var(--border)] bg-red-600 text-white shadow-[2px_2px_0px_var(--shadow)] flex items-center gap-2"
            >
              <span aria-hidden="true">🗑️</span>
              <span>Privacy: Delete Stored Data</span>
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog for Delete My Data */}
      {deleteConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
        >
          <div className="paper-card p-6 max-w-md w-full space-y-4 bg-[var(--surface)] border-3 border-[var(--border)] shadow-[6px_6px_0px_var(--shadow)]">
            <h2 id="delete-confirm-title" className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--accent)] flex items-center gap-2">
              <span>⚠️</span> Delete My Stored Data
            </h2>
            <p className="text-sm font-medium text-[var(--text)]">
              This action will permanently delete all your saved quizzes, custom avatars, question drafts, and offline cached sessions.
            </p>
            <div className="p-3 bg-[var(--surface-2)] rounded-xl border-2 border-[var(--border)] text-xs text-[var(--text-muted)]">
              This action complies with GDPR / Privacy standards and cannot be reversed.
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                className="paper-btn paper-btn-sm bg-[var(--surface)] text-[var(--text)] text-xs font-bold px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  if (onDeleteMyData) onDeleteMyData();
                }}
                className="paper-btn paper-btn-sm paper-btn-danger text-xs font-bold px-4 py-2 shadow-[2px_2px_0px_var(--shadow)]"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Host / Teacher Authentication Modal (Google & Email/Password with Password Reset) */}
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </header>
  );
};
