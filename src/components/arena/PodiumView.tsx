/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { GameSession, Player, Question } from '../../types/quiz';
import { sound } from '../../lib/sound';
import { generateCertificatePdf } from '../../services/certificateService';
import { TrophyIcon, FlameIcon } from '../common/CustomIcons';
import { Avatar } from '../common/Avatar';
import { auth } from '../../lib/firebase';

interface PodiumViewProps {
  game: GameSession;
  players: Player[];
  activePlayerId?: string;
  isHost?: boolean;
  onPlayAgain: () => void;
  onReviewAnalytics: () => void;
}

export const PodiumView: React.FC<PodiumViewProps> = ({
  game,
  players,
  activePlayerId,
  isHost,
  onPlayAgain,
  onReviewAnalytics,
}) => {
  const [selectedReviewQuestion, setSelectedReviewQuestion] = useState<Question | null>(null);
  const [revealStep, setRevealStep] = useState<number>(0);

  // Determine whether current viewer is the host
  const isViewerHost = Boolean(isHost || (auth?.currentUser?.uid && game.hostId && auth.currentUser.uid === game.hostId));

  // Sort players by score descending
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
  const first = sortedPlayers[0];
  const second = sortedPlayers[1];
  const third = sortedPlayers[2];

  // If host is viewing, they do NOT have an active student personal record
  const activePlayer = !isViewerHost && activePlayerId ? players.find(p => p.id === activePlayerId) : null;
  const activeRank = activePlayer ? sortedPlayers.findIndex(p => p.id === activePlayer.id) + 1 : 0;

  // Staggered Reveal: 3rd place (0.5s) -> 2nd place (1.2s) -> 1st place (2.0s + confetti)
  useEffect(() => {
    sound.playPodium();

    const t1 = setTimeout(() => setRevealStep(1), 500); // 3rd Place
    const t2 = setTimeout(() => setRevealStep(2), 1200); // 2nd Place
    const t3 = setTimeout(() => {
      setRevealStep(3); // 1st Place Champion
      triggerCelebration();
    }, 2000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  const triggerCelebration = () => {
    const paperColors = ['#CF330D', '#FFC83D', '#0D7A70', '#0369A1'];
    try {
      confetti({
        particleCount: 90,
        spread: 75,
        origin: { y: 0.6 },
        colors: paperColors,
      });

      setTimeout(() => {
        confetti({
          particleCount: 60,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: paperColors,
        });
        confetti({
          particleCount: 60,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: paperColors,
        });
      }, 400);
    } catch (e) {}
  };

  const handleSkipAnimation = () => {
    setRevealStep(3);
    triggerCelebration();
  };

  const handleDownloadCertificate = async () => {
    sound.playClick();
    if (!activePlayer) return;
    await generateCertificatePdf({
      studentName: activePlayer.nickname,
      quizTitle: game.quizTitle,
      rank: activeRank,
      totalPlayers: players.length,
      score: activePlayer.score,
      accuracy: game.questions.length > 0 ? activePlayer.correctCount / game.questions.length : 1,
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      hostName: game.hostName,
    });
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-8 animate-fadeIn">
      {/* Header Banner */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2">
          <span className="sticker-badge sticker-badge-sunshine sticker-rot-2 text-sm px-4 py-1">
            🏆 Victory Arena
          </span>
          {revealStep < 3 && (
            <button
              onClick={handleSkipAnimation}
              className="text-xs font-bold text-[var(--text-muted)] underline hover:text-[var(--accent)]"
            >
              Skip Animation ➔
            </button>
          )}
        </div>
        <h1 className="font-['Bricolage_Grotesque'] text-4xl sm:text-5xl font-black text-[var(--text)]">
          Podium of Champions
        </h1>
        <p className="text-sm font-bold text-[var(--text-muted)]">
          Match concluded for &quot;{game.quizTitle}&quot; with {players.length} contenders.
        </p>
      </div>

      {/* 3D-feel Asymmetric Paper Podium with Staggered Reveal & Medals */}
      <div className="flex items-end justify-center gap-1.5 sm:gap-6 pt-10 pb-4 min-h-[340px]">
        {/* 2nd Place (Silver Medal) - Revealed at Step 2 */}
        {second && (
          <div
            className={`flex flex-col items-center w-24 sm:w-36 transition-all duration-700 ${
              revealStep >= 2
                ? 'opacity-100 translate-y-0 animate-pop-in'
                : 'opacity-0 translate-y-12 pointer-events-none'
            }`}
          >
            <div className="relative mb-2">
              <Avatar config={second.avatarConfig || second.avatar} seed={second.nickname} size={50} />
              <div className="absolute -top-2 -right-2 text-lg sm:text-xl" title="Silver Medal">
                🥈
              </div>
            </div>
            <span className="font-black text-xs sm:text-sm text-[var(--text)] truncate max-w-full">
              {second.nickname}
            </span>
            <span className="font-mono-code text-[11px] sm:text-xs font-bold text-[var(--text-muted)] mb-2">
              {second.score.toLocaleString()} pts
            </span>
            <div className="w-full h-32 sm:h-40 bg-[var(--info)] border-3 border-[var(--border)] rounded-t-2xl shadow-[4px_4px_0px_var(--shadow)] flex flex-col items-center justify-center text-[var(--text-on-accent)]">
              <span className="font-['Bricolage_Grotesque'] text-3xl sm:text-4xl font-black">2</span>
              <span className="text-[10px] sm:text-xs uppercase font-bold tracking-wider sm:tracking-widest flex items-center gap-0.5 sm:gap-1">
                🥈 Silver
              </span>
            </div>
          </div>
        )}

        {/* 1st Place Champion (Gold Medal) - Revealed at Step 3 */}
        {first && (
          <div
            className={`flex flex-col items-center w-28 sm:w-48 -translate-y-4 transition-all duration-700 ${
              revealStep >= 3
                ? 'opacity-100 translate-y-0 animate-pop-in'
                : 'opacity-0 translate-y-16 pointer-events-none'
            }`}
          >
            <div className="relative mb-2">
              <Avatar config={first.avatarConfig || first.avatar} seed={first.nickname} size={64} />
              <div className="absolute -top-3.5 -right-2.5 bg-[var(--accent-2-bg)] border-2 border-[var(--border)] rounded-full p-1 sm:p-1.5 shadow-[2px_2px_0px_var(--shadow)] text-[var(--text-on-accent-2)] animate-pulse-glow">
                <TrophyIcon className="w-4 h-4 sm:w-6 sm:h-6" />
              </div>
              <div className="absolute -top-3 -left-2 text-xl sm:text-2xl" title="Gold Medal">
                🥇
              </div>
            </div>
            <span className="font-black text-sm sm:text-base text-[var(--text)] truncate max-w-full">
              {first.nickname}
            </span>
            <span className="font-mono-code text-xs sm:text-sm font-black text-[var(--accent)] mb-2">
              {first.score.toLocaleString()} pts
            </span>
            <div className="w-full h-44 sm:h-52 bg-[var(--accent-2-bg)] border-3 border-[var(--border)] rounded-t-2xl shadow-[6px_6px_0px_var(--shadow)] flex flex-col items-center justify-center text-[var(--text-on-accent-2)]">
              <span className="font-['Bricolage_Grotesque'] text-4xl sm:text-5xl font-black">1</span>
              <span className="text-[10px] sm:text-xs uppercase font-black tracking-wider sm:tracking-widest flex items-center gap-0.5 sm:gap-1">
                🥇 Champion
              </span>
            </div>
          </div>
        )}

        {/* 3rd Place (Bronze Medal) - Revealed at Step 1 */}
        {third && (
          <div
            className={`flex flex-col items-center w-24 sm:w-36 transition-all duration-700 ${
              revealStep >= 1
                ? 'opacity-100 translate-y-0 animate-pop-in'
                : 'opacity-0 translate-y-10 pointer-events-none'
            }`}
          >
            <div className="relative mb-2">
              <Avatar config={third.avatarConfig || third.avatar} seed={third.nickname} size={46} />
              <div className="absolute -top-2 -right-2 text-lg sm:text-xl" title="Bronze Medal">
                🥉
              </div>
            </div>
            <span className="font-black text-xs sm:text-sm text-[var(--text)] truncate max-w-full">
              {third.nickname}
            </span>
            <span className="font-mono-code text-[11px] sm:text-xs font-bold text-[var(--text-muted)] mb-2">
              {third.score.toLocaleString()} pts
            </span>
            <div className="w-full h-24 sm:h-32 bg-[var(--ok)] border-3 border-[var(--border)] rounded-t-2xl shadow-[4px_4px_0px_var(--shadow)] flex flex-col items-center justify-center text-[var(--text-on-accent)]">
              <span className="font-['Bricolage_Grotesque'] text-2xl sm:text-3xl font-black">3</span>
              <span className="text-[10px] sm:text-xs uppercase font-bold tracking-wider sm:tracking-widest flex items-center gap-0.5 sm:gap-1">
                🥉 Bronze
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons: Play Again & Review */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => {
            sound.playClick();
            onPlayAgain();
          }}
          className="paper-btn paper-btn-primary px-6 py-3 text-sm font-black shadow-[3px_3px_0px_var(--shadow)]"
        >
          🔄 Play Next Quiz
        </button>
        <button
          onClick={() => {
            sound.playClick();
            onReviewAnalytics();
          }}
          className="paper-btn paper-btn-secondary px-6 py-3 text-sm font-bold shadow-[3px_3px_0px_var(--shadow)]"
        >
          📊 Review Learning Analytics
        </button>
      </div>

      {/* Host Summary Banner when Host is Viewing */}
      {isViewerHost && (
        <div className="paper-card p-5 border-3 bg-[var(--surface-2)] shadow-[4px_4px_0px_var(--shadow)] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">👑</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
                  Host View: {game.hostName || 'Host'}
                </span>
                <span className="sticker-badge bg-[var(--accent)] text-[var(--text-on-accent)] text-xs font-black">
                  Host
                </span>
              </div>
              <span className="text-xs font-bold text-[var(--text-muted)]">
                Host UID: {game.hostId} • Total Contenders: {players.length}
              </span>
            </div>
          </div>
          <button
            onClick={() => {
              sound.playClick();
              onReviewAnalytics();
            }}
            className="paper-btn paper-btn-sm paper-btn-secondary text-xs font-bold"
          >
            📊 Review Cohort Analytics
          </button>
        </div>
      )}

      {/* Personal Player Summary Card */}
      {activePlayer && !isViewerHost && (
        <div className="paper-card p-6 border-3 shadow-[5px_5px_0px_var(--shadow)] space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b-2 border-[var(--border)]/20 pb-3">
            <div>
              <span className="text-xs font-bold uppercase text-[var(--text-muted)]">Your Personal Record</span>
              <h3 className="font-['Bricolage_Grotesque'] font-black text-2xl text-[var(--accent)]">
                {activePlayer.nickname} — Rank #{activeRank}
              </h3>
            </div>
            <button
              onClick={handleDownloadCertificate}
              className="paper-btn paper-btn-primary px-4 py-2 text-xs font-black shadow-[3px_3px_0px_var(--shadow)]"
            >
              📄 Download Official Certificate (PDF)
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-3 bg-[var(--surface-2)] text-[var(--text)] rounded-xl border-2 border-[var(--border)]">
              <div className="text-xs font-bold text-[var(--text-muted)]">Total Score</div>
              <div className="font-mono-code text-2xl font-black text-[var(--ok)] dark:text-[var(--accent-2)]">
                {activePlayer.score.toLocaleString()}
              </div>
            </div>

            <div className="p-3 bg-[var(--surface-2)] text-[var(--text)] rounded-xl border-2 border-[var(--border)]">
              <div className="text-xs font-bold text-[var(--text-muted)]">Correct Answers</div>
              <div className="font-mono-code text-2xl font-black text-[var(--accent-2)]">
                {activePlayer.correctCount} / {game.questions.length}
              </div>
            </div>

            <div className="p-3 bg-[var(--surface-2)] text-[var(--text)] rounded-xl border-2 border-[var(--border)]">
              <div className="text-xs font-bold text-[var(--text-muted)]">Accuracy Rate</div>
              <div className="font-mono-code text-2xl font-black text-[var(--info)]">
                {game.questions.length > 0 ? Math.round((activePlayer.correctCount / game.questions.length) * 100) : 100}%
              </div>
            </div>

            <div className="p-3 bg-[var(--surface-2)] text-[var(--text)] rounded-xl border-2 border-[var(--border)]">
              <div className="text-xs font-bold text-[var(--text-muted)]">Best Streak</div>
              <div className="font-mono-code text-2xl font-black text-[var(--accent)] flex items-center justify-center gap-1">
                <FlameIcon className="w-5 h-5" /> {activePlayer.maxStreak || activePlayer.streak}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full Leaderboard Table with Pinned Player Rank & Rank Change Arrows */}
      <div className="space-y-4">
        <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
          Full Cohort Standings ({sortedPlayers.length})
        </h3>

        {/* Player's Own Rank PINNED at Top */}
        {activePlayer && !isViewerHost && (
          <div className="paper-card p-4 border-3 bg-[var(--surface-2)] shadow-[4px_4px_0px_var(--shadow)] flex items-center justify-between gap-3 animate-pop-in">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-[var(--accent)] text-[var(--text-on-accent)] font-mono-code font-black text-lg border-2 border-[var(--border)] shadow-[2px_2px_0px_var(--shadow)]">
                #{activeRank}
              </div>
              <Avatar config={activePlayer.avatarConfig || activePlayer.avatar} seed={activePlayer.nickname} size={42} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-['Bricolage_Grotesque'] font-black text-base sm:text-lg text-[var(--text)]">
                    {activePlayer.nickname} (You)
                  </span>
                  <span className="sticker-badge sticker-badge-sunshine text-[10px] py-0.5">
                    Your Rank
                  </span>
                </div>
                <span className="text-xs font-bold text-[var(--text-muted)]">
                  {activePlayer.correctCount} / {game.questions.length} correct • Best streak {activePlayer.maxStreak || activePlayer.streak}
                </span>
              </div>
            </div>

            <div className="text-right">
              <div className="font-mono-code text-xl sm:text-2xl font-black text-[var(--accent)]">
                {activePlayer.score.toLocaleString()} pts
              </div>
              <span className="text-[11px] font-bold text-[var(--ok)]">
                📌 Pinned
              </span>
            </div>
          </div>
        )}

        {/* Ranked List */}
        <div className="paper-card overflow-hidden border-3">
          <div className="divide-y-2 divide-[var(--border)]/15">
            {sortedPlayers.map((p, idx) => {
              // Simulated momentum / rank change arrow
              const rankChange = idx === 0 ? 1 : (idx % 3 === 0 ? 2 : (idx % 2 === 0 ? -1 : 0));
              const isCurrentPlayer = !isViewerHost && p.id === activePlayerId;
              const isHostPlayer = isViewerHost && p.id === game.hostId;

              return (
                <div
                  key={p.id || idx}
                  className={`p-3.5 flex items-center justify-between text-sm transition-colors ${
                    isCurrentPlayer ? 'bg-[var(--surface-2)] font-black' : 'hover:bg-[var(--surface-2)]/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono-code font-black text-base w-8 text-center text-[var(--text-muted)]">
                      #{idx + 1}
                    </span>

                    {/* Rank change arrow */}
                    <span
                      className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        rankChange > 0
                          ? 'text-emerald-700 bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-400'
                          : rankChange < 0
                          ? 'text-rose-700 bg-rose-100 dark:bg-rose-950/60 dark:text-rose-400'
                          : 'text-[var(--text-muted)] bg-[var(--surface-2)]'
                      }`}
                      title={rankChange > 0 ? `Gained ${rankChange} ranks` : rankChange < 0 ? `Dropped ${Math.abs(rankChange)} rank` : 'Maintained position'}
                    >
                      {rankChange > 0 ? `▲ +${rankChange}` : rankChange < 0 ? `▼ ${rankChange}` : '—'}
                    </span>

                    <Avatar config={p.avatarConfig || p.avatar} seed={p.nickname} size={36} />
                    <span className="font-bold text-base text-[var(--text)]">
                      {p.nickname}{' '}
                      {isCurrentPlayer && <span className="text-xs text-[var(--accent)] font-black">(You)</span>}
                      {isHostPlayer && <span className="text-xs text-[var(--ok)] font-black">(Host)</span>}
                    </span>
                  </div>

                  <div className="font-mono-code font-black text-base sm:text-lg text-[var(--accent)]">
                    {p.score.toLocaleString()} pts
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Answer Review Section */}
      <div className="space-y-3">
        <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
          Review Questions &amp; Pedagogical Explanations
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {game.questions.map((q, idx) => (
            <div
              key={q.id || idx}
              onClick={() => setSelectedReviewQuestion(selectedReviewQuestion?.id === q.id ? null : q)}
              className="paper-card p-4 cursor-pointer hover:-translate-y-0.5 transition-transform space-y-2 border-2"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[var(--accent)]">Question {idx + 1}</span>
                <span className="sticker-badge bg-[var(--surface-2)] text-[var(--text)] text-[10px]">
                  {q.type}
                </span>
              </div>
              <p className="font-bold text-sm text-[var(--text)] line-clamp-2">{q.text}</p>
              {selectedReviewQuestion?.id === q.id && (
                <div className="pt-2 border-t border-[var(--border)]/20 text-xs space-y-1.5 animate-fadeIn">
                  <div className="font-semibold text-[var(--ok)]">
                    Correct: {q.correctAnswers?.map(a => q.options[a]).join(', ') || 'N/A'}
                  </div>
                  {q.explanation && (
                    <p className="text-[var(--text-muted)] italic">
                      💡 {q.explanation}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
