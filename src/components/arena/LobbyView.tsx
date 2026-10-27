/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { GameSession, Player } from '../../types/quiz';
import { GameEngine } from '../../services/gameEngine';
import { sound } from '../../lib/sound';
import { AvatarBadge } from '../common/CustomIcons';

interface LobbyViewProps {
  game: GameSession;
  players: Player[];
  isHost: boolean;
  onStartGame: () => void;
  onKickPlayer?: (playerId: string) => void;
}

export const LobbyView: React.FC<LobbyViewProps> = ({
  game,
  players,
  isHost,
  onStartGame,
  onKickPlayer,
}) => {
  const [showQrModal, setShowQrModal] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const joinUrl = typeof window !== 'undefined'
    ? `${window.location.origin}?pin=${game.pin}`
    : `https://quizarena.app?pin=${game.pin}`;

  const handleCopyLink = () => {
    sound.playClick();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(joinUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  const handleSimulate = async (count: number) => {
    sound.playClick();
    setIsSimulating(true);
    await GameEngine.simulatePlayers(game.id, count);
    setIsSimulating(false);
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-6">
      {/* Top Paper Header: Game PIN, QR and Join link */}
      <div className="paper-card p-6 bg-[#FFF6E5] dark:bg-[#16120E] border-3 shadow-[6px_6px_0px_#16120E]">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* PIN & Title */}
          <div className="text-center md:text-left space-y-2">
            <span className="sticker-badge bg-[#FFC83D] text-[#16120E] sticker-rot-1">
              {game.quizTitle}
            </span>
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <span className="text-xs uppercase font-black tracking-widest text-[#16120E] dark:text-[#FFF6E5]">
                JOIN AT <span className="underline decoration-[#FF5A36] decoration-4 font-black">QUIZARENA</span> WITH PIN:
              </span>
              <div
                onClick={handleCopyLink}
                className="font-mono-code text-5xl sm:text-6xl font-black tracking-widest bg-white dark:bg-[#221c16] text-[#FF5A36] px-5 py-2 rounded-2xl border-3 border-[#16120E] shadow-[4px_4px_0px_#16120E] cursor-pointer hover:scale-105 active:scale-95 transition-transform"
                title="Click to copy join link"
              >
                {game.pin}
              </div>
            </div>
            <p className="text-xs font-bold text-gray-600 dark:text-gray-400">
              {copiedLink ? '✓ Join link copied to clipboard!' : `Shareable URL: ${joinUrl}`}
            </p>
          </div>

          {/* QR Code and Actions */}
          <div className="flex items-center gap-4">
            <div
              onClick={() => setShowQrModal(true)}
              className="p-3 bg-white rounded-2xl border-3 border-[#16120E] shadow-[4px_4px_0px_#16120E] cursor-pointer hover:rotate-2 transition-transform"
              title="Click to enlarge QR code for projector"
            >
              <QRCodeSVG value={joinUrl} size={110} level="M" />
              <div className="text-[10px] font-black text-center mt-1 text-[#16120E]">SCAN TO JOIN</div>
            </div>

            {isHost && (
              <div className="space-y-2">
                <button
                  onClick={() => {
                    sound.playClick();
                    onStartGame();
                  }}
                  disabled={players.length === 0}
                  className="paper-btn bg-[#FF5A36] text-white px-8 py-4 text-xl font-black shadow-[5px_5px_0px_#16120E] disabled:opacity-50"
                >
                  🚀 Start Game ({players.length})
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Host Controls & Simulator Toolbar */}
      {isHost && (
        <div className="paper-card p-4 bg-white dark:bg-[#221c16] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase text-[#16120E] dark:text-white">
              Host Dev Tool:
            </span>
            <button
              onClick={() => handleSimulate(25)}
              disabled={isSimulating}
              className="paper-btn paper-btn-sm bg-[#FFC83D] text-[#16120E] text-xs font-bold"
              title="Add 25 simulated test players"
            >
              + Simulate 25 Players
            </button>
            <button
              onClick={() => handleSimulate(100)}
              disabled={isSimulating}
              className="paper-btn paper-btn-sm bg-white dark:bg-[#16120E] dark:text-white text-xs font-bold"
              title="Add 100 simulated test players"
            >
              + Simulate 100
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs font-bold text-gray-700 dark:text-gray-300">
            <span>Mode: <strong className="text-[#14B8A6]">{game.gameMode}</strong></span>
            <span>Questions: <strong>{game.questions.length}</strong></span>
            <span>Fair Latency: <strong className="text-green-600">Active ✓</strong></span>
          </div>
        </div>
      )}

      {/* Live Players Wall */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-['Bricolage_Grotesque'] font-black text-2xl text-[#16120E] dark:text-[#FFF6E5]">
            Arena Contenders ({players.length})
          </h2>
          {players.length === 0 && (
            <span className="text-xs font-bold text-gray-500 animate-pulse">
              Waiting for players to join with PIN {game.pin}...
            </span>
          )}
        </div>

        {players.length === 0 ? (
          <div className="paper-card p-12 text-center bg-white dark:bg-[#221c16] space-y-3">
            <div className="text-5xl animate-bounce">📱</div>
            <h3 className="font-bold text-lg text-[#16120E] dark:text-white">The arena is quiet...</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 max-w-md mx-auto">
              Scan the QR code or visit this URL on your phone and enter PIN <strong>{game.pin}</strong>. Or click "Simulate 25 Players" above to test immediately!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {players.map((p, idx) => (
              <div
                key={p.id || idx}
                className="paper-card p-3 bg-white dark:bg-[#221c16] flex flex-col items-center text-center relative group hover:-translate-y-1 transition-transform"
              >
                <AvatarBadge avatarId={p.avatar} size={44} className="mb-1" />
                <span className="font-black text-sm text-[#16120E] dark:text-white truncate max-w-full">
                  {p.nickname}
                </span>
                <span className="text-[10px] font-mono-code text-gray-500">
                  {p.latencyMs}ms
                </span>

                {isHost && onKickPlayer && (
                  <button
                    onClick={() => {
                      sound.playClick();
                      onKickPlayer(p.id);
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full h-5 w-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border border-[#16120E]"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="paper-card p-8 bg-[#FFF6E5] max-w-md w-full text-center space-y-4">
            <h3 className="font-['Bricolage_Grotesque'] font-black text-2xl text-[#16120E]">
              Join the Arena
            </h3>
            <div className="p-4 bg-white rounded-2xl border-3 border-[#16120E] inline-block shadow-[4px_4px_0px_#16120E]">
              <QRCodeSVG value={joinUrl} size={240} level="H" />
            </div>
            <div className="font-mono-code text-4xl font-black text-[#FF5A36]">
              PIN: {game.pin}
            </div>
            <button
              onClick={() => setShowQrModal(false)}
              className="paper-btn w-full bg-[#14B8A6] text-white py-2 text-sm font-bold"
            >
              Close Fullscreen QR
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
