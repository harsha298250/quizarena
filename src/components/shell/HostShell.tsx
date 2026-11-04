/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { SupportedLanguage } from '../../lib/i18n';
import { sound } from '../../lib/sound';
import { ThemeMode } from '../../hooks/useTheme';
import { SettingsModal } from '../common/SettingsModal';
import { CommandPalette } from '../common/CommandPalette';
import { User } from 'firebase/auth';
import { signOut, auth } from '../../lib/firebase';

interface HostShellProps {
  children?: React.ReactNode;
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  lang: SupportedLanguage;
  setLang: (lang: SupportedLanguage) => void;
  theme?: ThemeMode;
  setTheme?: (theme: ThemeMode) => void;
  currentUser: User | null;
  userRole: 'host' | 'student';
  setUserRole: (role: 'host' | 'student') => void;
  onDeleteMyData?: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: string;
  section: 'overview' | 'create' | 'run' | 'review';
}

export const HostShell: React.FC<HostShellProps> = ({
  children,
  currentTab,
  setCurrentTab,
  lang,
  setLang,
  theme = 'light',
  setTheme,
  currentUser,
  userRole,
  setUserRole,
  onDeleteMyData,
}) => {
  // Sidebar collapsed state persisted in localStorage and auto-collapsing below 1200px
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if (window.innerWidth < 1200) return true;
    try {
      const saved = localStorage.getItem('quizarena_sidebar_collapsed');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // An authenticated user is one that exists and is not anonymous
  const isAuthenticated = Boolean(currentUser && !currentUser.isAnonymous);

  // Auto-collapse sidebar below 1200px on resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1200) {
        setIsCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleSidebar = () => {
    sound.playClick();
    setIsCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('quizarena_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  const handleNavClick = (tabId: string) => {
    sound.playClick();
    setCurrentTab(tabId);
    setMobileDrawerOpen(false);
  };

  const handleSignOut = async () => {
    sound.playClick();
    await signOut(auth);
  };

  const navItems: NavItem[] = [
    // Overview
    { id: 'host_dashboard', label: 'Dashboard', icon: '🏠', section: 'overview' },
    // Create
    { id: 'builder', label: 'Quiz Studio', icon: '✏️', section: 'create' },
    { id: 'ai', label: 'AI Quiz', icon: '✨', section: 'create' },
    // Run
    { id: 'arena', label: 'Host Live', icon: '🎮', section: 'run' },
    { id: 'competitions', label: 'Tournaments', icon: '🏆', section: 'run' },
    // Review
    { id: 'analytics', label: 'Analytics', icon: '📊', section: 'review' },
    { id: 'certificates', label: 'Certificates', icon: '🎓', section: 'review' },
    { id: 'outbox', label: 'Outbox', icon: '📬', section: 'review' },
  ];

  const renderNavGroup = (section: NavItem['section'], title: string) => {
    const items = navItems.filter(item => item.section === section);
    return (
      <div key={section} className="space-y-1">
        {!isCollapsed && (
          <div className="px-3 text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)] select-none">
            {title}
          </div>
        )}
        {items.map(item => {
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-tab={item.id}
              onClick={() => handleNavClick(item.id)}
              aria-current={isActive ? 'page' : undefined}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-bold font-['Bricolage_Grotesque'] transition-all border ${
                isActive
                  ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)] shadow-[2px_2px_0px_var(--shadow)]'
                  : 'border-transparent text-[var(--text)] hover:bg-[var(--surface-2)] hover:border-[var(--border)]'
              } ${isCollapsed ? 'justify-center px-2' : ''}`}
            >
              <span className="text-base shrink-0 select-none" aria-hidden="true">
                {item.icon}
              </span>
              {!isCollapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text)] transition-colors">
      {/* Skip to Content */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--accent)] focus:text-[var(--text-on-accent)] focus:rounded-lg focus:shadow-md focus:font-bold"
      >
        Skip to main content
      </a>

      {/* Desktop Shell Grid: Sidebar + Flexible Main Content */}
      <div className="hidden md:grid min-h-screen" style={{ gridTemplateColumns: isCollapsed ? '72px 1fr' : '260px 1fr' }}>
        {/* Host Desktop Sidebar */}
        <aside
          className="sticky top-0 h-screen border-r-3 border-[var(--border)] bg-[var(--surface)] text-[var(--text)] flex flex-col justify-between p-3 overflow-y-auto select-none transition-all duration-200 z-30"
          aria-label="Host Management Navigation"
        >
          {/* Top: Brand Header & Collapse Toggle */}
          <div className="space-y-4">
            <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} px-1`}>
              <div
                onClick={() => handleNavClick('host_dashboard')}
                className="flex items-center gap-2 cursor-pointer group min-w-0"
              >
                <div className="relative shrink-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-[var(--border)] bg-[var(--accent)] shadow-[2px_2px_0px_var(--shadow)] group-hover:rotate-6 transition-transform">
                    <span className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text-on-accent)]">Q</span>
                  </div>
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--accent-2-bg)] border border-[var(--border)] text-[8px] font-bold text-[var(--text-on-accent-2)]">
                    ⚡
                  </span>
                </div>
                {!isCollapsed && (
                  <div className="flex flex-col min-w-0">
                    <span className="font-['Bricolage_Grotesque'] text-lg font-black tracking-tight text-[var(--text)] leading-none truncate">
                      Quiz<span className="text-[var(--accent)]">Arena</span>
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--accent)] truncate">
                      Host Studio
                    </span>
                  </div>
                )}
              </div>

              {!isCollapsed && (
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="p-1 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
                  title="Collapse sidebar (72px rail)"
                  aria-label="Collapse sidebar"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  </svg>
                </button>
              )}
            </div>

            {isCollapsed && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
                  title="Expand sidebar (260px)"
                  aria-label="Expand sidebar"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}

            {/* Quick Command Palette Button */}
            {!isCollapsed ? (
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] text-xs font-semibold shadow-2xs transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <span>🔍</span>
                  <span>Quick search...</span>
                </span>
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono-code bg-[var(--surface)] text-[var(--text-muted)] rounded border border-[var(--border)]">
                  Ctrl+K
                </kbd>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                className="w-full flex items-center justify-center p-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] text-xs"
                title="Search commands (Ctrl+K)"
              >
                🔍
              </button>
            )}

            {/* Navigation Groups */}
            <nav className="space-y-3" aria-label="Host Navigation">
              {renderNavGroup('overview', 'Overview')}
              {renderNavGroup('create', 'Create')}
              {renderNavGroup('run', 'Run Match')}
              {renderNavGroup('review', 'Review & Records')}
            </nav>
          </div>

          {/* Bottom Area: Role Segmented Switch, Settings, Profile with Sign Out */}
          <div className="pt-3 border-t-2 border-[var(--border)]/20 space-y-3">
            {/* Host / Student Segmented Switch */}
            {!isCollapsed ? (
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)] px-1">
                  Active Experience
                </div>
                <div className="grid grid-cols-2 gap-1 p-0.5 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => {
                      sound.playClick();
                      setUserRole('host');
                    }}
                    className={`py-1 text-xs font-bold rounded-md transition-all ${
                      userRole === 'host'
                        ? 'bg-[var(--accent)] text-white shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    🎓 Host
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      sound.playClick();
                      setUserRole('student');
                      setCurrentTab('student_dashboard');
                    }}
                    className={`py-1 text-xs font-bold rounded-md transition-all ${
                      userRole === 'student'
                        ? 'bg-[var(--accent)] text-white shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    🎒 Student
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    sound.playClick();
                    setUserRole('student');
                    setCurrentTab('student_dashboard');
                  }}
                  className="p-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface)] text-xs font-bold"
                  title="Switch to Student view"
                  aria-label="Switch to Student view"
                >
                  <span aria-hidden="true">🎒</span>
                  <span className="sr-only">Student</span>
                </button>
              </div>
            )}

            {/* Settings Trigger */}
            <button
              type="button"
              onClick={() => {
                sound.playClick();
                setSettingsOpen(true);
              }}
              className={`w-full flex items-center gap-2 p-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface)] text-xs font-bold transition-colors ${
                isCollapsed ? 'justify-center' : 'justify-between'
              }`}
              title="Settings & Privacy"
            >
              <span className="flex items-center gap-2">
                <span>⚙️</span>
                {!isCollapsed && <span>Preferences</span>}
              </span>
              {!isCollapsed && (
                <span className="text-[10px] font-mono-code text-[var(--text-muted)] uppercase">
                  {lang.toUpperCase()} • {theme}
                </span>
              )}
            </button>

            {/* Profile Card & Prominent Sign Out (ONLY for authenticated hosts) */}
            {isAuthenticated ? (
              <div className={`p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] space-y-2 ${isCollapsed ? 'text-center' : ''}`}>
                <div className={isCollapsed ? 'sr-only' : 'min-w-0'}>
                  <div className="text-xs font-bold text-[var(--text)] truncate" title={currentUser?.displayName || 'Host'}>
                    {currentUser?.displayName || 'Host Teacher'}
                  </div>
                  <div className="text-[10px] font-mono-code text-[var(--text-muted)] truncate" title={currentUser?.email || ''}>
                    {currentUser?.email || ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="paper-btn paper-btn-sm paper-btn-secondary w-full py-1 text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs"
                  title="Sign Out of Host Session"
                  aria-label="Sign Out"
                >
                  <span aria-hidden="true">🚪</span>
                  <span className={isCollapsed ? 'sr-only' : ''}>Sign Out</span>
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        {/* Desktop Main Content Area */}
        <div className="flex flex-col min-w-0 overflow-x-clip">
          <main id="main-content" className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile Shell Layout (below 768px): Top Bar + Content + Bottom Tabs */}
      <div className="md:hidden flex flex-col min-h-screen pb-16">
        {/* Mobile Slim Header */}
        <header className="sticky top-0 z-40 border-b-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)] px-4 py-2.5 flex items-center justify-between shadow-xs">
          <div
            onClick={() => handleNavClick('host_dashboard')}
            className="flex items-center gap-2 cursor-pointer select-none min-w-0"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border-2 border-[var(--border)] bg-[var(--accent)] shadow-[2px_2px_0px_var(--shadow)] shrink-0">
              <span className="font-['Bricolage_Grotesque'] font-black text-base text-[var(--text-on-accent)]">Q</span>
            </div>
            <span className="font-['Bricolage_Grotesque'] text-lg font-black tracking-tight text-[var(--text)] truncate">
              Quiz<span className="text-[var(--accent)]">Arena</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-xs"
              title="Search commands"
              aria-label="Search commands"
            >
              🔍
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-xs"
              title="Settings"
              aria-label="Settings"
            >
              ⚙️
            </button>
          </div>
        </header>

        {/* Mobile Main Content */}
        <main id="main-content" className="flex-1 p-4 min-w-0 overflow-x-clip">
          {children}
        </main>

        {/* Mobile Bottom Navigation Tabs: Dashboard, Studio, AI Quiz, Analytics, More */}
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 border-t-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)] flex items-center justify-around py-1.5 px-2 shadow-lg"
          aria-label="Mobile Navigation"
        >
          <button
            type="button"
            onClick={() => handleNavClick('host_dashboard')}
            className={`flex flex-col items-center p-1.5 rounded-lg text-[10px] font-bold ${
              currentTab === 'host_dashboard' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
            }`}
          >
            <span className="text-base">🏠</span>
            <span>Dashboard</span>
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('builder')}
            className={`flex flex-col items-center p-1.5 rounded-lg text-[10px] font-bold ${
              currentTab === 'builder' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
            }`}
          >
            <span className="text-base">✏️</span>
            <span>Studio</span>
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('ai')}
            className={`flex flex-col items-center p-1.5 rounded-lg text-[10px] font-bold ${
              currentTab === 'ai' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
            }`}
          >
            <span className="text-base">✨</span>
            <span>AI Quiz</span>
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('analytics')}
            className={`flex flex-col items-center p-1.5 rounded-lg text-[10px] font-bold ${
              currentTab === 'analytics' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
            }`}
          >
            <span className="text-base">📊</span>
            <span>Analytics</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            className={`flex flex-col items-center p-1.5 rounded-lg text-[10px] font-bold ${
              mobileDrawerOpen ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
            }`}
          >
            <span className="text-base">⋯</span>
            <span>More</span>
          </button>
        </nav>

        {/* Mobile Slide-Over / Bottom Sheet Drawer for "More" */}
        {mobileDrawerOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end animate-fadeIn"
            onClick={e => {
              if (e.target === e.currentTarget) setMobileDrawerOpen(false);
            }}
          >
            <div className="paper-card p-5 bg-[var(--surface)] border-t-3 border-[var(--border)] rounded-t-2xl shadow-xl space-y-4 max-h-[80vh] overflow-y-auto animate-pop-in">
              <div className="flex items-center justify-between border-b border-[var(--border)]/20 pb-2">
                <span className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text)]">
                  More Host Tools
                </span>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="paper-btn paper-btn-sm p-1 text-xs"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => handleNavClick('arena')}
                  className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] flex items-center gap-2 text-left"
                >
                  <span className="text-lg">🎮</span>
                  <div>
                    <div className="font-black">Host Live</div>
                    <div className="text-[10px] text-[var(--text-muted)]">Launch Arena</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleNavClick('competitions')}
                  className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] flex items-center gap-2 text-left"
                >
                  <span className="text-lg">🏆</span>
                  <div>
                    <div className="font-black">Tournaments</div>
                    <div className="text-[10px] text-[var(--text-muted)]">Brackets</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleNavClick('certificates')}
                  className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] flex items-center gap-2 text-left"
                >
                  <span className="text-lg">🎓</span>
                  <div>
                    <div className="font-black">Certificates</div>
                    <div className="text-[10px] text-[var(--text-muted)]">Credentials</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleNavClick('outbox')}
                  className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] flex items-center gap-2 text-left"
                >
                  <span className="text-lg">📬</span>
                  <div>
                    <div className="font-black">Outbox</div>
                    <div className="text-[10px] text-[var(--text-muted)]">Email Dispatch</div>
                  </div>
                </button>
              </div>

              {/* Mobile Role Switcher */}
              <div className="pt-2 border-t border-[var(--border)]/20 space-y-1">
                <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase">
                  Switch Role
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setUserRole('host');
                      setMobileDrawerOpen(false);
                    }}
                    className={`py-2 rounded-lg text-xs font-bold border ${
                      userRole === 'host' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-2)]'
                    }`}
                  >
                    🎓 Host View
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUserRole('student');
                      setCurrentTab('student_dashboard');
                      setMobileDrawerOpen(false);
                    }}
                    className={`py-2 rounded-lg text-xs font-bold border ${
                      userRole === 'student' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-2)]'
                    }`}
                  >
                    🎒 Student View
                  </button>
                </div>
              </div>

              {/* Mobile Profile & Sign Out (ONLY for authenticated hosts) */}
              {isAuthenticated && (
                <div className="pt-2 border-t border-[var(--border)]/20 space-y-2">
                  <div className="text-xs font-bold text-[var(--text)] truncate">
                    Signed in as: {currentUser?.displayName || currentUser?.email || 'Host'}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileDrawerOpen(false);
                      handleSignOut();
                    }}
                    className="paper-btn paper-btn-secondary w-full py-2 text-xs font-bold flex items-center justify-center gap-2"
                  >
                    <span>🚪</span>
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modals & Command Palette */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        lang={lang}
        setLang={setLang}
        theme={theme}
        setTheme={setTheme}
        onDeleteMyData={onDeleteMyData}
        currentUserEmail={currentUser?.email}
        currentUserName={currentUser?.displayName}
      />
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={handleNavClick}
        onOpenSettings={() => setSettingsOpen(true)}
        onSwitchRole={r => setUserRole(r)}
        userRole={userRole}
      />
    </div>
  );
};
