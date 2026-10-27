/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { SupportedLanguage, translations } from '../../lib/i18n';
import { sound } from '../../lib/sound';
import { PWAInstallButton } from './PWAInstallButton';
import { signInWithPopup, signOut, googleProvider, auth } from '../../lib/firebase';
import { User } from 'firebase/auth';
import { AuthModal } from './AuthModal';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  lang: SupportedLanguage;
  setLang: (l: SupportedLanguage) => void;
  isDarkMode: boolean;
  setIsDarkMode: (dark: boolean) => void;
  onDeleteMyData?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  lang,
  setLang,
  isDarkMode,
  setIsDarkMode,
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

  const handleGoogleLogin = async () => {
    sound.playClick();
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.warn('Google sign in cancelled or failed:', e);
    }
  };

  const handleLogout = async () => {
    sound.playClick();
    await signOut(auth);
  };

  const navItems = [
    { id: 'arena', label: t.joinGame },
    { id: 'builder', label: t.quizBuilder },
    { id: 'ai', label: t.aiGenerator },
    { id: 'competitions', label: t.competitions },
    { id: 'analytics', label: t.analytics },
    { id: 'outbox', label: t.emailOutbox },
    { id: 'practice', label: t.soloPractice },
  ];

  return (
    <header className="sticky top-0 z-40 border-b-3 border-[#16120E] bg-[#FFF6E5] dark:bg-[#16120E] dark:border-[#FFF6E5] transition-colors">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 sm:px-6">
        {/* Brand Wordmark */}
        <div
          onClick={() => handleNavClick('arena')}
          className="flex items-center gap-2.5 cursor-pointer group select-none"
        >
          <div className="relative">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-[#16120E] bg-[#FF5A36] shadow-[2.5px_2.5px_0px_#16120E] group-hover:rotate-6 transition-transform">
              <span className="font-['Bricolage_Grotesque'] font-black text-xl text-white">Q</span>
            </div>
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#FFC83D] border border-[#16120E] text-[10px] font-bold">
              ⚡
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-['Bricolage_Grotesque'] text-2xl font-black tracking-tight text-[#16120E] dark:text-[#FFF6E5] leading-none">
              Quiz<span className="text-[#FF5A36]">Arena</span>
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#14B8A6] dark:text-[#FFC83D]">
              Real-Time Play
            </span>
          </div>
        </div>

        {/* Desktop Navigation Links */}
        <nav className="hidden lg:flex items-center gap-1.5">
          {navItems.map(item => {
            const active = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`px-3 py-1.5 text-xs font-bold font-['Bricolage_Grotesque'] rounded-lg transition-all border-2 ${
                  active
                    ? 'bg-[#FF5A36] text-white border-[#16120E] shadow-[2px_2px_0px_#16120E]'
                    : 'border-transparent text-[#16120E] dark:text-[#FFF6E5] hover:border-[#16120E] hover:bg-[#FFFAEE] dark:hover:bg-[#221c16]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Controls: Language, Sound, PWA, Dark Mode, Auth */}
        <div className="flex items-center gap-2">
          {/* Language Selector */}
          <div className="relative">
            <select
              value={lang}
              onChange={e => {
                sound.playClick();
                setLang(e.target.value as SupportedLanguage);
              }}
              className="text-xs font-bold rounded-lg border-2 border-[#16120E] bg-white dark:bg-[#221c16] dark:text-white px-2 py-1 shadow-[2px_2px_0px_#16120E] focus:outline-none cursor-pointer"
            >
              <option value="en">EN</option>
              <option value="ta">தமிழ்</option>
              <option value="hi">हिन्दी</option>
            </select>
          </div>

          {/* Sound Mute Button */}
          <button
            onClick={handleMuteToggle}
            className={`p-1.5 rounded-lg border-2 border-[#16120E] shadow-[2px_2px_0px_#16120E] transition-transform active:translate-y-0.5 ${
              isMuted ? 'bg-[#FF5A36] text-white' : 'bg-[#FFC83D] text-[#16120E]'
            }`}
            title={isMuted ? 'Unmute Sound FX' : 'Mute Sound FX'}
          >
            {isMuted ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            )}
          </button>

          {/* Dark Mode Toggle */}
          <button
            onClick={() => {
              sound.playClick();
              setIsDarkMode(!isDarkMode);
            }}
            className="p-1.5 rounded-lg border-2 border-[#16120E] bg-white dark:bg-[#221c16] text-[#16120E] dark:text-[#FFC83D] shadow-[2px_2px_0px_#16120E] active:translate-y-0.5"
            title="Toggle Paper Dark/Light"
          >
            {isDarkMode ? '☀️' : '🌙'}
          </button>

          {/* In-App PWA Install */}
          <PWAInstallButton />

          {/* Delete My Data (Privacy / GDPR) */}
          {onDeleteMyData && (
            <button
              onClick={() => {
                sound.playClick();
                onDeleteMyData();
              }}
              className="paper-btn paper-btn-sm bg-[#EF4444] text-white text-xs px-2 py-1 flex items-center gap-1 shadow-[2px_2px_0px_#16120E] hover:bg-[#DC2626] transition-colors"
              title="Delete my data (GDPR / Privacy Data Removal)"
            >
              <span>🗑️</span>
              <span className="hidden xl:inline font-bold">Delete My Data</span>
            </button>
          )}

          {/* User Sign In / Profile */}
          {currentUser ? (
            <div className="flex items-center gap-1.5">
              <span className="hidden sm:inline-block text-xs font-bold text-[#16120E] dark:text-white truncate max-w-[90px]">
                {currentUser.displayName || 'Host'}
              </span>
              <button
                onClick={handleLogout}
                className="paper-btn paper-btn-sm bg-white dark:bg-[#221c16] dark:text-white text-xs px-2 py-1"
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
              className="paper-btn paper-btn-sm bg-[#14B8A6] text-white text-xs px-2.5 py-1"
              title="Sign in with Email or Google"
            >
              Sign In
            </button>
          )}

          {/* Mobile hamburger menu toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-1.5 rounded-lg border-2 border-[#16120E] bg-[#FFC83D] shadow-[2px_2px_0px_#16120E]"
          >
            <svg className="w-5 h-5 text-[#16120E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t-2 border-[#16120E] bg-[#FFF6E5] dark:bg-[#16120E] px-4 py-3 space-y-1.5">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`w-full text-left px-3 py-2 text-sm font-bold rounded-lg border-2 ${
                currentTab === item.id
                  ? 'bg-[#FF5A36] text-white border-[#16120E]'
                  : 'border-transparent text-[#16120E] dark:text-white hover:bg-[#FFFAEE]'
              }`}
            >
              {item.label}
            </button>
          ))}

          {onDeleteMyData && (
            <div className="pt-2 border-t border-[#16120E]/20">
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onDeleteMyData();
                }}
                className="w-full text-left px-3 py-2 text-sm font-bold rounded-lg border-2 border-[#16120E] bg-[#EF4444] text-white shadow-[2px_2px_0px_#16120E] flex items-center gap-2"
              >
                <span>🗑️</span>
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
