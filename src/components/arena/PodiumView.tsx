/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { GameSession, Player, Question } from '../../types/quiz';
import { sound } from '../../lib/sound';
import { generateCertificatePdf } from '../../services/certificateService';
import { AvatarBadge, TrophyIcon, FlameIcon } from '../common/CustomIcons';

interface PodiumViewProps {
  game: GameSession;
  players: Player[];
  activePlayerId?: string;
  onPlayAgain: () => void;
  onReviewAnalytics: () => void;
}

export const PodiumView: React.FC<PodiumViewProps> = ({
  game,
  players,
  activePlayerId,
  onPlayAgain,
  onReviewAnalytics,
}) => {
  const [selectedReviewQuestion, setSelectedReviewQuestion] = useState<Question | null>(null);

  // Sort players by score descending
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
  const first = sortedPlayers[0];
  const second = sortedPlayers[1];
  const third = sortedPlayers[2];

  const activePlayer = players.find(p => p.id === activePlayerId) || sortedPlayers[0];
  const activeRank = sortedPlayers.findIndex(p => p.id === activePlayer?.id) + 1;

  // Trigger Playful Paper palette confetti on mount
  useEffect(() => {
    sound.playPodium();

    // Palette: tomato #FF5A36, sunshine #FFC83D, teal #14B8A6, sky #4DA3FF
    const paperColors = ['#FF5A36', '#FFC83D', '#14B8A6', '#4DA3FF'];

    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: paperColors,
      });

      setTimeout(() => {
        confetti({
          particleCount: 50,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: paperColors,
        });
        confetti({
          particleCount: 50,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: paperColors,
        });
      }, 400);
    } catch (e) {}
  }, []);

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
        <span className="sticker-badge bg-[#FFC83D] text-[#16120E] sticker-rot-2 text-sm px-4 py-1">
          🏆 Victory Arena
        </span>
        <h1 className="font-['Bricolage_Grotesque'] text-4xl sm:text-5xl font-black text-[#16120E] dark:text-white">
          Podium of Champions
        </h1>
        <p className="text-sm font-bold text-gray-600 dark:text-gray-400">
          Match concluded for "{game.quizTitle}" with {players.length} contenders.
        </p>
      </div>

      {/* 3D-feel Asymmetric Paper Podium */}
      <div className="flex items-end justify-center gap-3 sm:gap-6 pt-10 pb-4">
        {/* 2nd Place */}
        {second && (
          <div className="flex flex-col items-center w-28 sm:w-36 animate-slideUp">
            <AvatarBadge avatarId={second.avatar} size={56} className="mb-2" />
            <span className="font-black text-sm text-[#16120E] dark:text-white truncate max-w-full">
              {second.nickname}
            </span>
            <span className="font-mono-code text-xs font-bold text-gray-500 mb-2">
              {second.score.toLocaleString()} pts
            </span>
            <div className="w-full h-32 sm:h-40 bg-[#4DA3FF] border-3 border-[#16120E] rounded-t-2xl shadow-[4px_4px_0px_#16120E] flex flex-col items-center justify-center text-white">
              <span className="font-['Bricolage_Grotesque'] text-4xl font-black">2</span>
              <span className="text-xs uppercase font-bold tracking-widest">Silver</span>
            </div>
          </div>
        )}

        {/* 1st Place (Champion) */}
        {first && (
          <div className="flex flex-col items-center w-36 sm:w-48 -translate-y-4 animate-bounce">
            <div className="relative mb-2">
              <AvatarBadge avatarId={first.avatar} size={72} />
              <div className="absolute -top-3 -right-2 bg-[#FFC83D] border-2 border-[#16120E] rounded-full p-1 shadow-[2px_2px_0px_#16120E]">
                <TrophyIcon className="w-5 h-5" />
              </div>
            </div>
            <span className="font-black text-base text-[#16120E] dark:text-white truncate max-w-full">
              {first.nickname}
            </span>
            <span className="font-mono-code text-sm font-black text-[#FF5A36] mb-2">
              {first.score.toLocaleString()} pts
            </span>
            <div className="w-full h-44 sm:h-52 bg-[#FFC83D] border-3 border-[#16120E] rounded-t-2xl shadow-[6px_6px_0px_#16120E] flex flex-col items-center justify-center text-[#16120E]">
              <span className="font-['Bricolage_Grotesque'] text-5xl font-black">1</span>
              <span className="text-xs uppercase font-black tracking-widest">Gold Master</span>
            </div>
          </div>
        )}

        {/* 3rd Place */}
        {third && (
          <div className="flex flex-col items-center w-28 sm:w-36 animate-slideUp">
            <AvatarBadge avatarId={third.avatar} size={52} className="mb-2" />
            <span className="font-black text-sm text-[#16120E] dark:text-white truncate max-w-full">
              {third.nickname}
            </span>
            <span className="font-mono-code text-xs font-bold text-gray-500 mb-2">
              {third.score.toLocaleString()} pts
            </span>
            <div className="w-full h-24 sm:h-32 bg-[#14B8A6] border-3 border-[#16120E] rounded-t-2xl shadow-[4px_4px_0px_#16120E] flex flex-col items-center justify-center text-white">
              <span className="font-['Bricolage_Grotesque'] text-3xl font-black">3</span>
              <span className="text-xs uppercase font-bold tracking-widest">Bronze</span>
            </div>
          </div>
        )}
      </div>

      {/* Personal Player Summary Card */}
      {activePlayer && (
        <div className="paper-card p-6 bg-[#FFFAEE] dark:bg-[#221c16] border-3 shadow-[5px_5px_0px_#16120E] space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b-2 border-gray-200 pb-3">
            <div>
              <span className="text-xs font-bold uppercase text-gray-500">Your Personal Record</span>
              <h3 className="font-['Bricolage_Grotesque'] font-black text-2xl text-[#FF5A36]">
                {activePlayer.nickname} — Rank #{activeRank}
              </h3>
            </div>
            <button
              onClick={handleDownloadCertificate}
              className="paper-btn bg-[#FF5A36] text-white px-4 py-2 text-xs font-black shadow-[3px_3px_0px_#16120E]"
            >
              📄 Download Official Certificate (PDF)
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-3 bg-white dark:bg-[#16120E] rounded-xl border-2 border-[#16120E]">
              <div className="text-xs font-bold text-gray-500">Total Score</div>
              <div className="font-mono-code text-2xl font-black text-[#14B8A6]">
                {activePlayer.score.toLocaleString()}
              </div>
            </div>

            <div className="p-3 bg-white dark:bg-[#16120E] rounded-xl border-2 border-[#16120E]">
              <div className="text-xs font-bold text-gray-500">Correct Answers</div>
              <div className="font-mono-code text-2xl font-black text-[#FFC83D]">
                {activePlayer.correctCount} / {game.questions.length}
              </div>
            </div>

            <div className="p-3 bg-white dark:bg-[#16120E] rounded-xl border-2 border-[#16120E]">
              <div className="text-xs font-bold text-gray-500">Accuracy Rate</div>
              <div className="font-mono-code text-2xl font-black text-[#4DA3FF]">
                {game.questions.length > 0 ? Math.round((activePlayer.correctCount / game.questions.length) * 100) : 100}%
              </div>
            </div>

            <div className="p-3 bg-white dark:bg-[#16120E] rounded-xl border-2 border-[#16120E]">
              <div className="text-xs font-bold text-gray-500">Best Streak</div>
              <div className="font-mono-code text-2xl font-black text-[#FF5A36] flex items-center justify-center gap-1">
                <FlameIcon className="w-5 h-5" /> {activePlayer.maxStreak || activePlayer.streak}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full Leaderboard Table */}
      <div className="space-y-3">
        <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[#16120E] dark:text-white">
          Full Cohort Standings
        </h3>
        <div className="paper-card overflow-hidden bg-white dark:bg-[#221c16] border-3">
          <div className="divide-y-2 divide-[#16120E]">
            {sortedPlayers.map((p, idx) => (
              <div
                key={p.id || idx}
                className={`p-3.5 flex items-center justify-between text-sm ${
                  p.id === activePlayerId ? 'bg-[#FFFAEE] dark:bg-[#2e261f] font-black' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono-code font-black text-base w-8 text-center text-gray-500">
                    #{idx + 1}
                  </span>
                  <AvatarBadge avatarId={p.avatar} size={36} />
                  <span className="font-bold text-base text-[#16120E] dark:text-white">
                    {p.nickname}
                  </span>
                </div>

                <div className="font-mono-code font-black text-base text-[#FF5A36]">
                  {p.score.toLocaleString()} pts
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Answer Review Section */}
      <div className="space-y-3">
        <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[#16120E] dark:text-white">
          Review Questions & Pedagogical Explanations
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {game.questions.map((q, idx) => (
            <div
              key={q.id || idx}
              onClick={() => {
                sound.playClick();
                setSelectedReviewQuestion(q);
              }}
              className="paper-card p-4 bg-white dark:bg-[#221c16] cursor-pointer hover:-translate-y-0.5 transition-transform"
            >
              <div className="flex items-center justify-between text-xs font-bold mb-1">
                <span className="text-[#FF5A36]">Question #{idx + 1}</span>
                <span className="sticker-badge bg-[#FFF6E5] text-[10px] py-0">{q.courseOutcomeTag}</span>
              </div>
              <p className="text-xs font-bold line-clamp-2 text-[#16120E] dark:text-gray-300">
                {q.text}
              </p>
              <p className="text-[11px] text-gray-500 mt-2 line-clamp-1 italic">
                Key: {q.explanation}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex flex-wrap items-center justify-center gap-4 pt-4 border-t-2 border-[#16120E]">
        <button
          onClick={() => {
            sound.playClick();
            onPlayAgain();
          }}
          className="paper-btn bg-[#FF5A36] text-white px-6 py-3 font-black text-base shadow-[4px_4px_0px_#16120E]"
        >
          🔄 Play Again / New Arena
        </button>
        <button
          onClick={() => {
            sound.playClick();
            onReviewAnalytics();
          }}
          className="paper-btn bg-[#14B8A6] text-white px-6 py-3 font-black text-base shadow-[4px_4px_0px_#16120E]"
        >
          📊 Deep Dive Analytics & COs
        </button>
      </div>

      {/* Single Question Detail Modal */}
      {selectedReviewQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="paper-card p-6 bg-white dark:bg-[#221c16] max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between">
              <span className="sticker-badge bg-[#FFC83D] text-xs">
                {selectedReviewQuestion.topicTag} • {selectedReviewQuestion.courseOutcomeTag}
              </span>
              <button
                onClick={() => setSelectedReviewQuestion(null)}
                className="paper-btn paper-btn-sm bg-gray-200 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <h3 className="font-bold text-lg text-[#16120E] dark:text-white">
              {selectedReviewQuestion.text}
            </h3>

            <div className="space-y-1.5">
              {selectedReviewQuestion.options.map((opt, i) => {
                const isCorrect = selectedReviewQuestion.correctAnswers?.includes(i) ?? false;
                return (
                  <div
                    key={i}
                    className={`p-2 rounded-lg border-2 border-[#16120E] text-xs font-semibold ${
                      isCorrect ? 'bg-[#FFFAEE] text-[#14B8A6] font-bold' : 'bg-gray-50 dark:bg-[#16120E]'
                    }`}
                  >
                    {isCorrect ? '✓ ' : '• '} {opt}
                  </div>
                );
              })}
            </div>

            <div className="p-3 bg-[#FFF6E5] dark:bg-[#16120E] rounded-xl border border-[#16120E] text-xs">
              <strong>Pedagogical Explanation:</strong> {selectedReviewQuestion.explanation}
            </div>

            <button
              onClick={() => setSelectedReviewQuestion(null)}
              className="paper-btn w-full bg-[#14B8A6] text-white py-2 text-xs font-bold"
            >
              Close Review
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
