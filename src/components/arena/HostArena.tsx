/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { GameSession, Player, AnswerSubmission, Question, IntegrityFlag } from '../../types/quiz';
import { GameEngine } from '../../services/gameEngine';
import { sound } from '../../lib/sound';
import { ShapeTriangle, ShapeDiamond, ShapeCircle, ShapeSquare, ShieldIcon } from '../common/CustomIcons';

interface HostArenaProps {
  game: GameSession;
  players: Player[];
  onFinishGame: () => void;
}

export const HostArena: React.FC<HostArenaProps> = ({ game, players, onFinishGame }) => {
  const currentQuestion: Question | undefined = game.questions[game.currentQuestionIndex];
  const [timeLeft, setTimeLeft] = useState<number>(game.timeLimit || 20);
  const [answers, setAnswers] = useState<AnswerSubmission[]>([]);
  const [flags, setFlags] = useState<IntegrityFlag[]>([]);
  const [showIntegrityModal, setShowIntegrityModal] = useState<boolean>(false);

  // Subscribe to live submitted answers for active question
  useEffect(() => {
    const unsub = GameEngine.subscribeToAnswers(game.id, game.currentQuestionIndex, setAnswers);
    return () => unsub();
  }, [game.id, game.currentQuestionIndex]);

  // Subscribe to live anti-cheat flags
  useEffect(() => {
    const unsub = GameEngine.subscribeToFlags(game.id, setFlags);
    return () => unsub();
  }, [game.id]);

  // Timer countdown
  useEffect(() => {
    if (game.status !== 'question_active' || game.isPaused) return;

    setTimeLeft(game.timeLimit || 20);
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          handleReveal();
          return 0;
        }
        if (prev <= 5) {
          sound.playTick(true); // Urgent tick
        } else {
          sound.playTick(false);
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [game.status, game.currentQuestionIndex, game.isPaused]);

  // Host keyboard shortcuts (Space=Next, R=Reveal, P=Pause)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'KeyR' && game.status === 'question_active') {
        e.preventDefault();
        handleReveal();
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (game.status === 'reveal' || game.status === 'leaderboard') {
          handleNextQuestion();
        }
      } else if (e.code === 'KeyP') {
        e.preventDefault();
        handleTogglePause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [game.status, game.currentQuestionIndex, game.isPaused]);

  const handleReveal = () => {
    sound.playCorrect();
    GameEngine.updateGameStatus(game, 'reveal');
  };

  const handleShowLeaderboard = () => {
    sound.playClick();
    GameEngine.updateGameStatus(game, 'leaderboard');
  };

  const handleNextQuestion = () => {
    sound.playClick();
    const nextIdx = game.currentQuestionIndex + 1;
    if (nextIdx >= game.questions.length) {
      GameEngine.updateGameStatus(game, 'finished');
      onFinishGame();
    } else {
      GameEngine.updateGameStatus(game, 'question_active', nextIdx);
    }
  };

  const handleTogglePause = () => {
    sound.playClick();
    const isPaused = !game.isPaused;
    GameEngine.updateGameStatus(
      { ...game, isPaused },
      game.status
    );
  };

  if (!currentQuestion) {
    return <div>No active question.</div>;
  }

  // Calculate live distribution of answers
  const optionCounts = currentQuestion.options.map((_, idx) => {
    return answers.filter(a => a.selectedIndices.includes(idx)).length;
  });

  const totalAnswered = answers.length;
  const answerPercentage = players.length > 0 ? Math.round((totalAnswered / players.length) * 100) : 0;

  // Shapes & color palette for options
  const optionStyles = [
    { bg: 'bg-[#FF5A36]', shape: <ShapeTriangle className="w-8 h-8 text-white" fill="#FFFFFF" /> },
    { bg: 'bg-[#FFC83D]', shape: <ShapeDiamond className="w-8 h-8 text-[#16120E]" fill="#16120E" /> },
    { bg: 'bg-[#14B8A6]', shape: <ShapeCircle className="w-8 h-8 text-white" fill="#FFFFFF" /> },
    { bg: 'bg-[#4DA3FF]', shape: <ShapeSquare className="w-8 h-8 text-white" fill="#FFFFFF" /> },
  ];

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      {/* Top Projector Bar: Question Index, Countdown Clock, Live Answer Count, Shortcuts hint */}
      <div className="paper-card p-4 bg-[#FFF6E5] dark:bg-[#16120E] border-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="font-['Bricolage_Grotesque'] font-black text-2xl text-[#FF5A36]">
            Q {game.currentQuestionIndex + 1} / {game.questions.length}
          </span>
          <span className="sticker-badge bg-[#FFC83D] text-[#16120E] text-xs">
            {currentQuestion.topicTag || 'Arena Question'}
          </span>
          <span className="sticker-badge bg-[#14B8A6] text-white text-xs">
            {currentQuestion.courseOutcomeTag}
          </span>
        </div>

        {/* Big Countdown Timer */}
        <div className="flex items-center gap-3">
          <div
            className={`font-mono-code text-4xl sm:text-5xl font-black px-6 py-1.5 rounded-2xl border-3 border-[#16120E] shadow-[4px_4px_0px_#16120E] ${
              timeLeft <= 5 ? 'bg-[#FF5A36] text-white animate-pulse' : 'bg-white dark:bg-[#221c16] text-[#16120E] dark:text-white'
            }`}
          >
            {timeLeft}s
          </div>
        </div>

        {/* Live Answer Progress */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs font-bold uppercase text-gray-600 dark:text-gray-400">Answers Locked</div>
            <div className="font-mono-code text-xl font-black text-[#14B8A6]">
              {totalAnswered} / {players.length} ({answerPercentage}%)
            </div>
          </div>

          {/* Host Action Buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleTogglePause}
              className="paper-btn paper-btn-sm bg-white dark:bg-[#221c16] dark:text-white text-xs"
              title="Shortcut: P"
            >
              {game.isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>

            {game.status === 'question_active' && (
              <button
                onClick={handleReveal}
                className="paper-btn paper-btn-sm bg-[#FFC83D] text-[#16120E] text-xs font-bold"
                title="Shortcut: R"
              >
                👁️ Reveal Answer
              </button>
            )}

            {game.status === 'reveal' && (
              <button
                onClick={handleShowLeaderboard}
                className="paper-btn paper-btn-sm bg-[#14B8A6] text-white text-xs font-bold"
              >
                📊 Show Leaderboard
              </button>
            )}

            {(game.status === 'reveal' || game.status === 'leaderboard') && (
              <button
                onClick={handleNextQuestion}
                className="paper-btn paper-btn-sm bg-[#FF5A36] text-white text-xs font-bold"
                title="Shortcut: Space"
              >
                {game.currentQuestionIndex + 1 === game.questions.length ? '🏁 Final Podium' : 'Next Question ➔'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Question Display Screen (Projector Landscape) */}
      <div className="paper-card p-8 sm:p-12 bg-white dark:bg-[#221c16] text-center space-y-6">
        <h1 className="font-['Bricolage_Grotesque'] text-2xl sm:text-4xl lg:text-5xl font-black text-[#16120E] dark:text-white leading-tight">
          {currentQuestion.text}
        </h1>

        {/* Optional Image */}
        {currentQuestion.imageUrl && (
          <div className="flex justify-center">
            <img
              src={currentQuestion.imageUrl}
              alt="Question illustration"
              className="max-h-64 rounded-xl border-3 border-[#16120E] shadow-[4px_4px_0px_#16120E]"
            />
          </div>
        )}
      </div>

      {/* Answer Cards Grid with Live Distribution Bars */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {currentQuestion.options.map((opt, idx) => {
          const style = optionStyles[idx % 4];
          const isCorrect = currentQuestion.correctAnswers?.includes(idx) ?? false;
          const count = optionCounts[idx] || 0;
          const pct = totalAnswered > 0 ? Math.round((count / totalAnswered) * 100) : 0;
          const isRevealed = game.status === 'reveal' || game.status === 'leaderboard';

          return (
            <div
              key={idx}
              className={`paper-card p-5 relative overflow-hidden border-3 shadow-[4px_4px_0px_#16120E] transition-all ${
                isRevealed && isCorrect
                  ? 'ring-4 ring-green-500 scale-[1.02]'
                  : isRevealed && !isCorrect
                  ? 'opacity-40 grayscale-[50%]'
                  : ''
              } bg-white dark:bg-[#221c16]`}
            >
              {/* Distribution Bar (revealed or live) */}
              {isRevealed && (
                <div
                  className="absolute bottom-0 left-0 top-0 bg-[#FFFAEE] dark:bg-[#332a21] -z-10 transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              )}

              <div className="flex items-center gap-4">
                <div className={`p-2.5 rounded-xl border-2 border-[#16120E] ${style.bg} shrink-0`}>
                  {style.shape}
                </div>
                <div className="flex-1 text-left">
                  <span className="font-['Bricolage_Grotesque'] font-bold text-lg sm:text-xl text-[#16120E] dark:text-white block">
                    {opt}
                  </span>
                </div>

                {isRevealed && (
                  <div className="text-right shrink-0">
                    <span className="font-mono-code font-black text-xl text-[#16120E] dark:text-white">
                      {count}
                    </span>
                    <span className="text-xs font-bold text-gray-500 block">({pct}%)</span>
                    {isCorrect && (
                      <span className="sticker-badge bg-[#14B8A6] text-white text-[10px] mt-1">
                        ✓ Correct
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Explanation Banner when Revealed */}
      {(game.status === 'reveal' || game.status === 'leaderboard') && currentQuestion.explanation && (
        <div className="paper-card p-5 bg-[#FFFAEE] dark:bg-[#16120E] border-3 border-[#16120E] space-y-1 animate-fadeIn">
          <span className="sticker-badge bg-[#14B8A6] text-white text-xs mb-1">Pedagogical Key</span>
          <p className="text-sm font-semibold text-[#16120E] dark:text-gray-200">
            {currentQuestion.explanation}
          </p>
        </div>
      )}

      {/* Projector Footbar: Live Leaderboard Peek & Keyboard Shortcut Guide */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-gray-600 dark:text-gray-400">
        <div>
          Keyboard shortcuts: <kbd className="px-1.5 py-0.5 bg-gray-200 rounded border">Space</kbd> Next | <kbd className="px-1.5 py-0.5 bg-gray-200 rounded border">R</kbd> Reveal | <kbd className="px-1.5 py-0.5 bg-gray-200 rounded border">P</kbd> Pause
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowIntegrityModal(true)}
            className="flex items-center gap-1.5 text-[#14B8A6] hover:underline"
          >
            <ShieldIcon className="w-4 h-4" /> Integrity & Flags Panel
            {flags.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-[#FF5A36] text-white animate-pulse">
                {flags.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Integrity Audit & Flags Modal */}
      {showIntegrityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="paper-card p-6 bg-white dark:bg-[#221c16] max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[#16120E] dark:text-white">
                  Integrity & Advisory Flags
                </h3>
                <span className="text-[11px] font-semibold text-gray-500 block">
                  Advisory only — No automatic penalties applied
                </span>
              </div>
              <button
                onClick={() => setShowIntegrityModal(false)}
                className="paper-btn paper-btn-sm bg-gray-200 text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs font-semibold">
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl space-y-1">
                <div><strong>Fair Scoring:</strong> Real RTT latency subtracted per answer</div>
                <div><strong>Current Round Submissions:</strong> {answers.length} verified submissions</div>
                <div><strong>Audit Chain:</strong> SHA-256 block chain active</div>
              </div>

              {/* Live Flags Feed */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-700 dark:text-gray-300">
                    Live Flags ({flags.length})
                  </span>
                  {flags.length > 0 && (
                    <span className="text-[10px] text-gray-400">Latest first</span>
                  )}
                </div>

                {flags.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-center text-gray-500 text-xs">
                    ✓ No integrity flags recorded. All players active in the arena.
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                    {flags.map(flag => {
                      const badgeClass =
                        flag.severity === 'high'
                          ? 'bg-[#FF5A36] text-white'
                          : flag.severity === 'medium'
                          ? 'bg-[#FFC83D] text-[#16120E]'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200';

                      return (
                        <div
                          key={flag.id}
                          className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1512] flex items-center justify-between gap-2"
                        >
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[#16120E] dark:text-white truncate">
                                {flag.playerNickname}
                              </span>
                              {flag.questionIndex !== undefined && (
                                <span className="text-[10px] font-mono px-1 bg-gray-100 dark:bg-gray-800 rounded text-gray-600 dark:text-gray-400">
                                  Q{flag.questionIndex + 1}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-gray-600 dark:text-gray-400 truncate">
                              {flag.reason}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${badgeClass}`}>
                              {flag.severity}
                            </span>
                            <span className="block text-[10px] font-mono text-gray-400 mt-0.5">
                              {new Date(flag.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => setShowIntegrityModal(false)}
              className="paper-btn w-full bg-[#14B8A6] text-white py-2 font-bold text-xs"
            >
              Close Panel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
