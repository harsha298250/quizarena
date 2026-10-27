/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Player, PlayerAccommodations } from '../../types/quiz';
import { sanitizeNickname, AVATAR_OPTIONS } from '../../lib/profanity';
import { sound } from '../../lib/sound';
import { AvatarBadge } from '../common/CustomIcons';
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
  const [selectedAvatar, setSelectedAvatar] = useState<string>('fox');
  const [email, setEmail] = useState<string>('');
  const [emailConsent, setEmailConsent] = useState<boolean>(false);
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

    return () => clearInterval(timer);
  }, []);

  const handleJoin = async () => {
    sound.playClick();
    setErrorMessage(null);

    const cleanPin = pin.trim();
    if (!cleanPin || cleanPin.length < 4) {
      setErrorMessage('Please enter a valid game PIN (6 digits).');
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
    const newPlayer: Player = {
      id: playerId,
      nickname: cleanName,
      avatar: selectedAvatar,
      email: emailConsent ? email : undefined,
      emailConsent,
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
    <div className="mx-auto max-w-md p-4 sm:p-6 space-y-6">
      {/* Join Card */}
      <div className="paper-card p-6 sm:p-8 bg-white dark:bg-[#221c16] space-y-5 shadow-[6px_6px_0px_#16120E]">
        <div className="text-center space-y-1">
          <span className="sticker-badge bg-[#FFC83D] text-[#16120E] text-xs">
            Multiplayer Arena
          </span>
          <h1 className="font-['Bricolage_Grotesque'] text-3xl font-black text-[#16120E] dark:text-white">
            Enter the Arena
          </h1>
          <p className="text-xs font-semibold text-gray-500">
            Join a live session or host your own classroom game.
          </p>
        </div>

        {/* PIN Input */}
        <div className="space-y-1">
          <label className="text-xs font-black uppercase text-[#16120E] dark:text-white">
            Game PIN
          </label>
          <input
            type="text"
            maxLength={8}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="w-full text-center font-mono-code text-3xl font-black tracking-widest rounded-2xl border-3 border-[#16120E] py-3 dark:bg-[#16120E] dark:text-white shadow-[3px_3px_0px_#16120E] focus:outline-none"
          />
        </div>

        {/* Nickname Input */}
        <div className="space-y-1">
          <label className="text-xs font-black uppercase text-[#16120E] dark:text-white">
            Player Handle (Nickname)
          </label>
          <input
            type="text"
            maxLength={20}
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            placeholder="e.g. TurboOtter, CosmicFalcon..."
            className="w-full rounded-xl border-2 border-[#16120E] px-3.5 py-2.5 font-bold text-sm dark:bg-[#16120E] dark:text-white shadow-[2px_2px_0px_#16120E] focus:outline-none"
          />
        </div>

        {/* Sticker Avatar Picker */}
        <div className="space-y-2">
          <label className="text-xs font-black uppercase text-[#16120E] dark:text-white block">
            Choose Your Avatar Sticker:
          </label>
          <div className="grid grid-cols-4 gap-2.5">
            {AVATAR_OPTIONS.map(av => {
              const isSelected = selectedAvatar === av.id;
              return (
                <button
                  key={av.id}
                  type="button"
                  onClick={() => {
                    sound.playClick();
                    setSelectedAvatar(av.id);
                  }}
                  className={`p-2 rounded-xl border-2 border-[#16120E] flex flex-col items-center justify-center transition-all ${
                    isSelected ? 'bg-[#FFC83D] shadow-[3px_3px_0px_#16120E] -translate-y-1' : 'bg-gray-50 dark:bg-[#16120E] hover:bg-[#FFF6E5]'
                  }`}
                >
                  <AvatarBadge avatarId={av.id} size={36} />
                </button>
              );
            })}
          </div>
        </div>

        {/* Optional Email & Consent for Instant Report Card */}
        <div className="p-3 bg-[#FFF6E5] dark:bg-[#16120E] rounded-xl border-2 border-[#16120E] space-y-2">
          <label className="text-[11px] font-bold text-[#16120E] dark:text-gray-300 block">
            Receive your verified result certificate & review via email (optional):
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="student@example.edu"
            className="w-full rounded-lg border border-[#16120E] px-2.5 py-1.5 text-xs font-bold dark:bg-[#221c16] dark:text-white"
          />
          <label className="flex items-center gap-2 cursor-pointer text-[10px] font-semibold text-gray-700 dark:text-gray-400">
            <input
              type="checkbox"
              checked={emailConsent}
              onChange={e => setEmailConsent(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#FF5A36]"
            />
            <span>I consent to receiving this game report. No marketing or spam.</span>
          </label>
        </div>

        {/* Accessibility Accommodations Trigger */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowAccommodations(!showAccommodations)}
            className="text-xs font-bold text-[#14B8A6] hover:underline"
          >
            ⚙️ Accessibility & Accommodations
          </button>
        </div>

        {showAccommodations && (
          <div className="p-3 bg-[#FFFAEE] dark:bg-[#16120E] rounded-xl border-2 border-[#16120E] space-y-2 text-xs font-bold animate-fadeIn">
            <label className="flex items-center justify-between">
              <span>Dyslexia-friendly Font</span>
              <input
                type="checkbox"
                checked={accommodations.dyslexiaFont}
                onChange={e => setAccommodations({ ...accommodations, dyslexiaFont: e.target.checked })}
                className="accent-[#FF5A36]"
              />
            </label>
            <label className="flex items-center justify-between">
              <span>Read Questions Aloud (TTS)</span>
              <input
                type="checkbox"
                checked={accommodations.readAloud}
                onChange={e => setAccommodations({ ...accommodations, readAloud: e.target.checked })}
                className="accent-[#FF5A36]"
              />
            </label>
            <label className="flex items-center justify-between">
              <span>Fewer Answer Options (Hide 2 wrong)</span>
              <input
                type="checkbox"
                checked={accommodations.fewerOptions}
                onChange={e => setAccommodations({ ...accommodations, fewerOptions: e.target.checked })}
                className="accent-[#FF5A36]"
              />
            </label>
          </div>
        )}

        {errorMessage && (
          <div className="p-2.5 bg-red-100 border-2 border-red-500 rounded-xl text-xs font-bold text-red-800 text-center">
            {errorMessage}
          </div>
        )}

        {/* Join Button */}
        <button
          onClick={handleJoin}
          className="paper-btn w-full bg-[#FF5A36] text-white py-3.5 text-base font-black shadow-[4px_4px_0px_#16120E]"
        >
          🚀 Join Arena Now
        </button>

        {/* Or Host button */}
        <div className="text-center pt-2 border-t-2 border-gray-200">
          <button
            onClick={() => {
              sound.playClick();
              onHostNewGame();
            }}
            className="text-xs font-bold text-[#14B8A6] hover:underline"
          >
            Are you a Teacher or Host? <strong>Launch a Live Quiz ➔</strong>
          </button>
        </div>
      </div>
    </div>
  );
};
