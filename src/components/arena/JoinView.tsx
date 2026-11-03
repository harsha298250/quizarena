/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Player, PlayerAccommodations } from '../../types/quiz';
import { sanitizeNickname } from '../../lib/profanity';
import { sound } from '../../lib/sound';
import { AvatarBuilder } from '../common/AvatarBuilder';
import { AvatarConfig, getDeterministicAvatar } from '../../types/avatar';
import { scanEnvironmentForExtensions } from '../../lib/extensionDetector';
import { ensureAnonymousAuth, auth } from '../../lib/firebase';
import { measureServerTimeMetrics, NetworkMetrics } from '../../services/networkSync';

interface JoinViewProps {
  initialPin?: string;
  onJoinSuccess: (pin: string, player: Player) => void;
  onHostNewGame: () => void;
}

export const JoinView: React.FC<JoinViewProps> = ({ initialPin = '', onJoinSuccess, onHostNewGame }) => {
  const [pin, setPin] = useState<string>(initialPin);
  const [nickname, setNickname] = useState<string>('');
  const [hasManuallyEditedAvatar, setHasManuallyEditedAvatar] = useState<boolean>(() => {
    return Boolean(localStorage.getItem('quizarena_avatar_config'));
  });
  const [avatarConfig, setAvatarConfig] = useState<AvatarConfig>(() => {
    try {
      const saved = localStorage.getItem('quizarena_avatar_config');
      if (saved) return JSON.parse(saved);
    } catch {}
    return getDeterministicAvatar('TurboOtter');
  });
  const [email, setEmail] = useState<string>(() => auth.currentUser?.email || '');
  const [emailConsent, setEmailConsent] = useState<boolean>(() => Boolean(auth.currentUser?.email));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showAccommodations, setShowAccommodations] = useState<boolean>(false);
  const [networkMetrics, setNetworkMetrics] = useState<NetworkMetrics>({
    latencyMs: 25,
    clockOffsetMs: 0,
    lastMeasured: 0,
  });

  const [accommodations, setAccommodations] = useState<PlayerAccommodations>({
    extraTimeMultiplier: 1,
    fewerOptions: false,
    muteSound: false,
    dyslexiaFont: false,
    largeText: false,
    readAloud: false,
  });

  useEffect(() => {
    // Proactively sign player in anonymously per security requirement (d)
    ensureAnonymousAuth();

    // Initial real latency & clock offset measurement
    measureServerTimeMetrics().then(setNetworkMetrics);

    const unsubAuth = auth.onAuthStateChanged(u => {
      if (u?.email) {
        setEmail(prev => prev || u.email || '');
        setEmailConsent(true);
      }
    });

    // Re-measure every 10 seconds per fairness requirement (a)
    const timer = setInterval(() => {
      measureServerTimeMetrics().then(setNetworkMetrics);
    }, 10000);

    // Check URL query parameters for ?pin=XXXXXX
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const queryPin = urlParams.get('pin');
      if (queryPin) {
        setPin(queryPin);
      }
    }

    return () => {
      clearInterval(timer);
      unsubAuth();
    };
  }, []);

  const [isPreChecking, setIsPreChecking] = useState<boolean>(false);
  const [preCheckFailedReason, setPreCheckFailedReason] = useState<string | null>(null);

  const handleJoin = async () => {
    sound.playClick();
    setErrorMessage(null);
    setPreCheckFailedReason(null);

    const cleanPin = pin.trim();
    if (!cleanPin || cleanPin.length < 4) {
      setErrorMessage('Please enter a valid game PIN (6 digits).');
      return;
    }

    // Pre-game Gate: 3-second environment check refusing entry if anything detected
    setIsPreChecking(true);
    await new Promise(r => setTimeout(r, 1200));
    const scan = scanEnvironmentForExtensions();
    setIsPreChecking(false);

    if (scan.detected) {
      sound.playWrong();
      setPreCheckFailedReason(
        scan.reason || 'Browser extensions or overlays detected. Please close all extensions or open a Chrome Guest window to join.'
      );
      return;
    }

    const { cleanName, wasCensored } = sanitizeNickname(nickname);
    if (wasCensored) {
      sound.playWrong();
    }

    let user = auth.currentUser;
    if (!user) {
      user = await ensureAnonymousAuth();
    }
    const playerId = user?.uid || `player_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    // Save chosen avatarConfig to localStorage
    try {
      localStorage.setItem('quizarena_avatar_config', JSON.stringify(avatarConfig));
    } catch {}

    const hasValidEmail = Boolean(email && email.trim() && email.includes('@'));
    const finalConsent = Boolean(emailConsent || hasValidEmail);

    const newPlayer: Player = {
      id: playerId,
      nickname: cleanName,
      avatar: JSON.stringify(avatarConfig),
      avatarConfig,
      email: hasValidEmail ? email.trim() : undefined,
      emailConsent: finalConsent,
      score: 0,
      streak: 0,
      maxStreak: 0,
      correctCount: 0,
      latencyMs: networkMetrics.latencyMs,
      clockOffsetMs: networkMetrics.clockOffsetMs,
      integrityScore: 100,
      powerUps: {
        fiftyFiftyUsed: false,
        doublePointsUsed: false,
        timeFreezeUsed: false,
      },
      accommodations,
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };

    onJoinSuccess(cleanPin, newPlayer);
  };

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6 space-y-6">
      {/* Join Card */}
      <div className="paper-card p-6 sm:p-8 space-y-5 shadow-[6px_6px_0px_var(--shadow)]">
        <div className="text-center space-y-1">
          <span className="sticker-badge sticker-badge-sunshine text-xs">
            Multiplayer Arena
          </span>
          <h1 className="font-['Bricolage_Grotesque'] text-3xl font-black text-[var(--text)]">
            Enter the Arena
          </h1>
          <p className="text-xs font-semibold text-[var(--text-muted)]">
            Join a live session or host your own classroom game.
          </p>
        </div>

        {/* PIN Input */}
        <div className="space-y-1">
          <label htmlFor="joinPinInput" className="text-xs font-black uppercase text-[var(--text)]">
            Game PIN
          </label>
          <input
            id="joinPinInput"
            type="text"
            maxLength={8}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="paper-input w-full text-center font-mono-code text-3xl font-black tracking-widest rounded-2xl border-3 border-[var(--border)] py-3 shadow-[3px_3px_0px_var(--shadow)] focus:outline-none"
          />
        </div>

        {/* Nickname Input */}
        <div className="space-y-1">
          <label htmlFor="joinNicknameInput" className="text-xs font-black uppercase text-[var(--text)]">
            Player Handle (Nickname)
          </label>
          <input
            id="joinNicknameInput"
            type="text"
            maxLength={20}
            value={nickname}
            onChange={e => {
              const val = e.target.value;
              setNickname(val);
              if (!hasManuallyEditedAvatar && val.trim()) {
                setAvatarConfig(getDeterministicAvatar(val.trim()));
              }
            }}
            placeholder="e.g. TurboOtter, CosmicFalcon..."
            className="paper-input w-full rounded-xl border-2 border-[var(--border)] px-3.5 py-2.5 font-bold text-sm shadow-[2px_2px_0px_var(--shadow)] focus:outline-none"
          />
        </div>

        {/* Step: Avatar Builder */}
        <div className="space-y-1.5">
          <label className="text-xs font-black uppercase text-[var(--text)] block">
            Sticker Avatar:
          </label>
          <AvatarBuilder
            config={avatarConfig}
            onChange={newConf => {
              setHasManuallyEditedAvatar(true);
              setAvatarConfig(newConf);
            }}
            nickname={nickname || 'TurboOtter'}
          />
        </div>

        {/* Optional Email & Consent for Instant Report Card */}
        <div className="p-3 bg-[var(--surface-2)] rounded-xl border-2 border-[var(--border)] text-[var(--text)] space-y-2">
          <label className="text-[11px] font-bold text-[var(--text)] block">
            Receive your verified result certificate &amp; review via email (optional):
          </label>
          <input
            type="email"
            value={email}
            onChange={e => {
              const val = e.target.value;
              setEmail(val);
              if (val.trim() && !emailConsent) {
                setEmailConsent(true);
              }
            }}
            placeholder="student@example.edu"
            className="paper-input w-full rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-bold"
          />
          <label className="flex items-center gap-2 cursor-pointer text-[10px] font-semibold text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={emailConsent}
              onChange={e => setEmailConsent(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            <span>I consent to receiving this game report. No marketing or spam.</span>
          </label>
        </div>

        {/* Accessibility Accommodations Trigger */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowAccommodations(!showAccommodations)}
            className="text-xs font-bold text-[var(--ok)] dark:text-[var(--accent-2)] hover:underline"
          >
            ⚙️ Accessibility &amp; Accommodations
          </button>
        </div>

        {showAccommodations && (
          <div className="p-3 bg-[var(--surface-2)] rounded-xl border-2 border-[var(--border)] space-y-2.5 text-xs font-bold text-[var(--text)] animate-fadeIn">
            <label className="flex items-center justify-between cursor-pointer">
              <span>Dyslexia-friendly Font</span>
              <input
                type="checkbox"
                checked={accommodations.dyslexiaFont}
                onChange={e => setAccommodations({ ...accommodations, dyslexiaFont: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span>Read Questions & Options Aloud (TTS)</span>
              <input
                type="checkbox"
                checked={accommodations.readAloud}
                onChange={e => setAccommodations({ ...accommodations, readAloud: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
            </label>
            {accommodations.readAloud && (
              <div className="flex items-center justify-between pl-4 text-[11px] text-[var(--text-muted)]">
                <label htmlFor="ttsSpeechSpeed">Speech Speed:</label>
                <select
                  id="ttsSpeechSpeed"
                  value={accommodations.speechRate || 1.0}
                  onChange={e => setAccommodations({ ...accommodations, speechRate: Number(e.target.value) })}
                  className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--text)]"
                >
                  <option value={0.8}>0.8x (Slower)</option>
                  <option value={1.0}>1.0x (Normal)</option>
                  <option value={1.25}>1.25x (Faster)</option>
                </select>
              </div>
            )}
            <label className="flex items-center justify-between cursor-pointer">
              <span>Larger Text Size</span>
              <input
                type="checkbox"
                checked={accommodations.largeText}
                onChange={e => setAccommodations({ ...accommodations, largeText: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
            </label>
          </div>
        )}

        {/* Accommodations active confirmation banner */}
        {(accommodations.dyslexiaFont || accommodations.readAloud || accommodations.largeText) && (
          <div className="p-2 rounded-lg bg-[var(--surface-2)] border border-[var(--ok)] text-[11px] font-bold text-[var(--ok)] dark:text-[var(--accent-2)] flex items-center gap-1.5">
            <span>♿ Active Accommodations:</span>
            <span className="font-semibold">
              {[
                accommodations.dyslexiaFont && 'Dyslexia Font',
                accommodations.readAloud && 'Read-Aloud',
                accommodations.largeText && 'Large Text',
              ].filter(Boolean).join(', ')}
            </span>
          </div>
        )}

        {preCheckFailedReason && (
          <div className="p-3 bg-red-50 dark:bg-red-950/50 border-2 border-red-500 rounded-xl space-y-2 text-xs font-semibold text-red-900 dark:text-red-200">
            <div className="flex items-center gap-1.5 font-black text-red-700 dark:text-red-300">
              <span>🛡️ Pre-game Environment Check</span>
            </div>
            <p>{preCheckFailedReason}</p>
            <div className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded text-[11px] font-bold text-[var(--text)]">
              💡 Checklist:
              <ul className="list-disc pl-4 mt-1 font-normal space-y-0.5">
                <li>Close extension sidebars and AI helpers</li>
                <li>Disable browser overlays modifying web pages</li>
                <li>Or open this URL in a clean <strong>Chrome Guest / Incognito window</strong></li>
              </ul>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="p-2.5 bg-red-100 dark:bg-red-950/60 border-2 border-red-600 rounded-xl text-xs font-bold text-red-900 dark:text-red-200 text-center">
            {errorMessage}
          </div>
        )}

        {/* Join Button */}
        <button
          onClick={handleJoin}
          disabled={isPreChecking}
          className="paper-btn paper-btn-primary w-full py-3.5 text-base font-black shadow-[4px_4px_0px_var(--shadow)] flex items-center justify-center gap-2"
        >
          {isPreChecking ? (
            <>
              <span className="animate-spin">⏳</span>
              <span>Scanning Environment (3s)...</span>
            </>
          ) : (
            <span>🚀 Join Arena Now</span>
          )}
        </button>

        {/* Or Host button */}
        <div className="text-center pt-2 border-t-2 border-[var(--border)]/20">
          <button
            onClick={() => {
              sound.playClick();
              onHostNewGame();
            }}
            className="text-xs font-bold text-[var(--ok)] dark:text-[var(--accent-2)] hover:underline"
          >
            Are you a Teacher or Host? <strong>Launch a Live Quiz ➔</strong>
          </button>
        </div>
      </div>
    </div>
  );
};
