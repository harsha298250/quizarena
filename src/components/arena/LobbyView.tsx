/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { GameSession, Player } from '../../types/quiz';
import { QRCodeSVG } from 'qrcode.react';
import { sound } from '../../lib/sound';
import { Avatar } from '../common/Avatar';

interface LobbyViewProps {
  game: GameSession;
  players: Player[];
  isHost: boolean;
  onStartGame: () => void;
  onKickPlayer?: (playerId: string) => void;
  onSimulatePlayers?: (count: number) => void;
  onUpdateSettings?: (settings: Partial<GameSession['settings']>) => void;
}

export const LobbyView: React.FC<LobbyViewProps> = ({
  game,
  players,
  isHost,
  onStartGame,
  onKickPlayer,
  onSimulatePlayers,
  onUpdateSettings,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isMuted, setIsMuted] = useState(sound.getMuted());

  const joinUrl = `${window.location.origin}/?pin=${game.pin}`;
  const maxCapacity = 300;
  const capacityPct = Math.min(100, Math.round((players.length / maxCapacity) * 100));

  const handleCopyLink = () => {
    sound.playClick();
    navigator.clipboard.writeText(joinUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleCopyPin = () => {
    sound.playClick();
    navigator.clipboard.writeText(game.pin);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleToggleSound = () => {
    const next = sound.toggleMute();
    setIsMuted(next);
    if (!next) sound.playClick();
  };

  const enableDevTools = import.meta.env.VITE_ENABLE_DEV_TOOLS === 'true';

  const handleSimulate = async (count: number) => {
    if (!onSimulatePlayers) return;
    sound.playClick();
    setIsSimulating(true);
    try {
      onSimulatePlayers(count);
    } finally {
      setTimeout(() => setIsSimulating(false), 800);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-6">
      {/* Top Paper Header: Game PIN, QR and Join link */}
      <div className="paper-card p-6 border-3 shadow-[6px_6px_0px_var(--shadow)]">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* PIN & Title */}
          <div className="text-center md:text-left space-y-3">
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
              <h1 className="font-['Bricolage_Grotesque'] text-xl sm:text-2xl font-black text-[var(--text)] tracking-tight">
                {game.quizTitle}
              </h1>
              {/* Sound / Music Controls in Lobby */}
              <button
                onClick={handleToggleSound}
                className="paper-btn paper-btn-sm text-xs px-2.5 py-0.5 rounded-lg flex items-center gap-1 shadow-[1.5px_1.5px_0px_var(--shadow)]"
                title={isMuted ? 'Unmute Sound FX' : 'Mute Sound FX'}
              >
                <span>{isMuted ? '🔇 Muted' : '🔊 Sound FX On'}</span>
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <span className="text-xs uppercase font-black tracking-widest text-[var(--text)]">
                JOIN AT <span className="underline decoration-[var(--accent)] decoration-4 font-black text-[var(--accent)]">QUIZARENA</span> WITH PIN:
              </span>
              <div className="flex items-center gap-2">
                <div
                  onClick={handleCopyPin}
                  className="font-mono-code text-5xl sm:text-6xl font-black tracking-widest bg-[var(--surface)] text-[var(--accent)] px-5 py-2 rounded-2xl border-3 border-[var(--border)] shadow-[4px_4px_0px_var(--shadow)] cursor-pointer hover:scale-105 active:scale-95 transition-transform select-all"
                  title="Click to copy PIN"
                >
                  {game.pin}
                </div>
                <button
                  onClick={handleCopyPin}
                  className="paper-btn paper-btn-secondary p-3 sm:p-3.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-[2px_2px_0px_var(--shadow)]"
                  title={copiedLink ? 'Copied PIN' : 'Copy PIN'}
                  aria-label={copiedLink ? 'Copied' : 'Copy PIN'}
                >
                  <span aria-hidden="true">{copiedLink ? '✓' : '📋'}</span>
                  <span className="hidden sm:inline">{copiedLink ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-xs font-bold text-[var(--text-muted)]">
              <span>{copiedLink ? '✓ Copied to clipboard!' : `Shareable URL: ${joinUrl}`}</span>
              <button
                onClick={handleCopyLink}
                className="underline hover:text-[var(--accent)] text-[11px]"
              >
                (Copy URL)
              </button>
            </div>
          </div>

          {/* QR Code and Actions */}
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-center gap-4">
            <div
              onClick={() => setShowQrModal(true)}
              className="p-3 bg-white rounded-2xl border-3 border-[var(--border)] shadow-[4px_4px_0px_var(--shadow)] cursor-pointer hover:rotate-2 transition-transform shrink-0"
              title="Click to enlarge QR code for projector"
            >
              <QRCodeSVG value={joinUrl} size={110} level="M" />
              <div className="text-[10px] font-black text-center mt-1 text-[var(--text-on-accent-2)]">SCAN TO JOIN</div>
            </div>

            {isHost && (
              <div className="space-y-2 w-full sm:w-auto text-center">
                <button
                  onClick={() => {
                    sound.playClick();
                    onStartGame();
                  }}
                  disabled={players.length === 0}
                  className="paper-btn paper-btn-primary px-6 sm:px-8 py-3.5 sm:py-4 text-lg sm:text-xl font-black shadow-[5px_5px_0px_var(--shadow)] disabled:opacity-50 w-full sm:w-auto"
                >
                  🚀 Start Game ({players.length})
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Capacity Indicator: N of 300 players */}
        <div className="mt-5 pt-4 border-t-2 border-[var(--border)]/15 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              <span>Capacity:</span>
              <strong className="text-[var(--text)] font-extrabold">{players.length} of {maxCapacity} players</strong>
            </span>
            <span className="font-mono-code font-bold">{capacityPct}% filled</span>
          </div>
          <div className="w-full h-2.5 bg-[var(--surface-2)] rounded-full border border-[var(--border)] overflow-hidden">
            <div
              className="h-full bg-[var(--ok)] transition-all duration-500 rounded-full"
              style={{ width: `${Math.min(100, Math.max(players.length > 0 ? 3 : 0, capacityPct))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Waiting for Host state when player is in lobby */}
      {!isHost && (
        <div className="space-y-3">
          <div className="paper-card p-6 sm:p-8 text-center space-y-4 border-3 bg-[var(--surface)] shadow-[4px_4px_0px_var(--shadow)] animate-pop-in">
            <div className="inline-block p-4 rounded-full bg-[var(--accent-2-bg)] text-3xl border-2 border-[var(--border)] animate-pulse-glow">
              ⏳
            </div>
            <div className="space-y-1.5">
              <h3 className="font-['Bricolage_Grotesque'] font-black text-2xl text-[var(--text)]">
                Waiting for Host to Launch
              </h3>
              <p className="text-sm font-semibold text-[var(--text-muted)] max-w-md mx-auto">
                Get ready! The host will start the quiz shortly. Keep this screen open and your sound on.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-xs font-bold text-[var(--text)]">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
              <span>Ready in Lobby • {players.length} contenders registered</span>
            </div>
          </div>

          {game.settings.secureMode !== false && (
            <div className="p-3 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex flex-wrap items-center justify-center gap-2 text-xs font-bold text-[var(--text)]">
              <span>🛡️ Secure Mode is active for this game.</span>
              <span className="text-[var(--text-muted)] font-normal">
                (Tab-switch tracking active • Assistive tools permitted • Flags reviewed by host)
              </span>
            </div>
          )}
        </div>
      )}

      {/* Secure Mode (Integrity Shield) Configuration for Host */}
      {isHost && (
        <div className="paper-card p-4 sm:p-5 border-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🛡️</span>
              <div>
                <h3 className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text)] leading-tight">
                  Secure Mode &amp; Integrity Guard
                </h3>
                <p className="text-xs font-semibold text-[var(--text-muted)]">
                  Tab-switch warnings, extension detection, and focus tracking.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="sticker-badge sticker-badge-ok text-xs font-black">
                ✓ Always Active (Strict Integrity)
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-[var(--border)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-bold text-[var(--text)]">
            <div className="flex items-center gap-2 p-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
              <span>📺 Mandatory Fullscreen</span>
            </div>

            <div className="flex items-center gap-2 p-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
              <span>🚫 Copy/Paste Locked</span>
            </div>

            <div className="flex items-center gap-2 p-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
              <span>⚡ Strike 3 Auto-Lock</span>
            </div>

            <div className="flex items-center gap-2 p-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
              <span>♿ Assistive Tools Allowed</span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-[11px] font-semibold text-[var(--text-muted)] flex items-start gap-2">
            <span className="text-sm shrink-0">♿</span>
            <span>
              <strong>Accessibility &amp; Human Review:</strong> Screen readers, dyslexia fonts, speech synthesis, and approved accommodations are strictly allowed. All flags are advisory and subject to host human discretion.
            </span>
          </div>
        </div>
      )}

      {/* Host Controls & Simulator Toolbar */}
      {isHost && (
        <div className="paper-card p-4 flex flex-wrap items-center justify-between gap-3">
          {enableDevTools ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase text-[var(--text)]">
                Host Dev Tool:
              </span>
              <button
                onClick={() => handleSimulate(25)}
                disabled={isSimulating}
                className="paper-btn paper-btn-sm paper-btn-secondary text-xs font-bold"
                title="Add 25 simulated test players"
              >
                + Simulate 25 Players
              </button>
              <button
                onClick={() => handleSimulate(100)}
                disabled={isSimulating}
                className="paper-btn paper-btn-sm text-xs font-bold"
                title="Add 100 simulated test players"
              >
                + Simulate 100
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-black uppercase text-[var(--text)]">
              <span>Host Console</span>
            </div>
          )}

          <div className="flex items-center gap-3 text-xs font-bold text-[var(--text-muted)]">
            <span>Mode: <strong className="text-[var(--ok)] dark:text-[var(--accent-2)]">{game.gameMode}</strong></span>
            <span>Questions: <strong className="text-[var(--text)]">{game.questions.length}</strong></span>
            <span>Fair Latency: <strong className="text-emerald-700 dark:text-emerald-400">Active ✓</strong></span>
          </div>
        </div>
      )}

      {/* Live Players Wall with Entrance Animation */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-['Bricolage_Grotesque'] font-black text-2xl text-[var(--text)]">
            Arena Contenders ({players.length})
          </h2>
          {players.length === 0 && (
            <span className="text-xs font-bold text-[var(--text-muted)] animate-pulse">
              Waiting for players to join with PIN {game.pin}...
            </span>
          )}
        </div>

        {players.length === 0 ? (
          <div className="paper-card p-12 text-center space-y-3">
            <div className="text-5xl animate-bounce">📱</div>
            <h3 className="font-bold text-lg text-[var(--text)]">The arena is quiet...</h3>
            <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
              Scan the QR code or visit this URL on your phone and enter PIN <strong>{game.pin}</strong>.{enableDevTools ? ' Or click "Simulate 25 Players" above to test immediately!' : ''}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {players.map((p, idx) => (
              <div
                key={p.id || idx}
                style={{ animationDelay: `${Math.min(idx * 35, 1200)}ms` }}
                className="paper-card p-3 flex flex-col items-center text-center relative group hover:-translate-y-1 transition-transform animate-pop-in"
              >
                <Avatar config={p.avatarConfig || p.avatar} seed={p.nickname} size={46} className="mb-1" />
                <span className="font-black text-sm text-[var(--text)] truncate max-w-full">
                  {p.nickname}
                </span>
                <span className="text-[10px] font-mono-code text-[var(--text-muted)] font-semibold">
                  {p.latencyMs}ms
                </span>

                {isHost && onKickPlayer && (
                  <button
                    onClick={() => {
                      sound.playClick();
                      onKickPlayer(p.id);
                    }}
                    className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full h-5 w-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border border-[var(--border)]"
                    title="Kick player"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Large QR Modal for Projector */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fadeIn">
          <div className="paper-modal p-8 max-w-md w-full text-center space-y-4">
            <h3 className="font-['Bricolage_Grotesque'] font-black text-2xl text-[var(--text)]">
              Join the Arena
            </h3>
            <div className="p-4 bg-white rounded-2xl border-3 border-[var(--border)] inline-block shadow-[4px_4px_0px_var(--shadow)]">
              <QRCodeSVG value={joinUrl} size={240} level="H" />
            </div>
            <div className="font-mono-code text-4xl font-black text-[var(--accent)]">
              PIN: {game.pin}
            </div>
            <button
              onClick={() => setShowQrModal(false)}
              className="paper-btn paper-btn-ok w-full py-2 text-sm font-bold"
            >
              Close Fullscreen QR
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
