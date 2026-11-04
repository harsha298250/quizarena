/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { GameSession, Player, AnswerSubmission, Question, IntegrityFlag } from '../../types/quiz';
import { GameEngine } from '../../services/gameEngine';
import { sound } from '../../lib/sound';
import { ShapeTriangle, ShapeDiamond, ShapeCircle, ShapeSquare, ShieldIcon } from '../common/CustomIcons';
import { TimerRing } from '../common/TimerRing';
import { Avatar } from '../common/Avatar';

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
  const [selectedPlayerForInspect, setSelectedPlayerForInspect] = useState<Player | null>(null);
  const [autoAdvanceCountdown, setAutoAdvanceCountdown] = useState<number | null>(null);

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

  // Automatic progression: countdown during reveal state
  useEffect(() => {
    if (game.settings?.progressionMode !== 'automatic') {
      setAutoAdvanceCountdown(null);
      return;
    }

    if (game.status === 'reveal' && !game.isPaused) {
      setAutoAdvanceCountdown(5);
      const timer = setInterval(() => {
        setAutoAdvanceCountdown(prev => {
          if (prev === null || prev <= 1) {
            clearInterval(timer);
            handleNextQuestion();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    } else if (game.status !== 'reveal') {
      setAutoAdvanceCountdown(null);
    }
  }, [game.status, game.isPaused, game.settings?.progressionMode, game.currentQuestionIndex]);

  // Early reveal in automatic mode if all active players have submitted
  useEffect(() => {
    if (game.settings?.progressionMode === 'automatic' && game.status === 'question_active' && !game.isPaused) {
      if (players.length > 0 && answers.length >= players.length) {
        handleReveal();
      }
    }
  }, [answers.length, players.length, game.status, game.isPaused, game.settings?.progressionMode]);

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
    GameEngine.updateGameStatus(game, 'reveal').catch(err => {
      console.warn('Failed to reveal answers:', err);
    });
  };

  const handleShowLeaderboard = () => {
    sound.playClick();
    GameEngine.updateGameStatus(game, 'leaderboard').catch(err => {
      console.warn('Failed to show leaderboard:', err);
    });
  };

  const handleNextQuestion = () => {
    sound.playClick();
    const nextIdx = game.currentQuestionIndex + 1;
    if (nextIdx >= game.questions.length) {
      GameEngine.endGame(game.id).then(() => {
        onFinishGame();
      }).catch(err => {
        console.warn('Failed to end game:', err);
        onFinishGame();
      });
    } else {
      GameEngine.updateGameStatus(game, 'question_active', nextIdx).catch(err => {
        console.warn('Failed to advance question:', err);
      });
    }
  };

  const handleTogglePause = () => {
    sound.playClick();
    if (game.isPaused) {
      GameEngine.resumeGame(game.id).catch(err => {
        console.warn('Failed to resume game:', err);
      });
    } else {
      GameEngine.pauseGame(game.id).catch(err => {
        console.warn('Failed to pause game:', err);
      });
    }
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
    { bg: 'bg-[var(--accent)] text-[var(--text-on-accent)]', shape: <ShapeTriangle className="w-8 h-8 text-[var(--text-on-accent)]" fill="currentColor" /> },
    { bg: 'bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)]', shape: <ShapeDiamond className="w-8 h-8 text-[var(--text-on-accent-2)]" fill="currentColor" /> },
    { bg: 'bg-[var(--ok)] text-[var(--text-on-accent)]', shape: <ShapeCircle className="w-8 h-8 text-[var(--text-on-accent)]" fill="currentColor" /> },
    { bg: 'bg-[var(--info)] text-[var(--text-on-accent)]', shape: <ShapeSquare className="w-8 h-8 text-[var(--text-on-accent)]" fill="currentColor" /> },
  ];

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-4">
      {/* Clear Progress */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs font-bold text-[var(--text-muted)]">
          <span>Question <strong>{game.currentQuestionIndex + 1} of {game.questions.length}</strong></span>
          <span>{Math.round(((game.currentQuestionIndex + 1) / game.questions.length) * 100)}% Complete</span>
        </div>
        <div className="w-full bg-[var(--surface-2)] h-2 rounded-full border border-[var(--border)] overflow-hidden">
          <div
            className="bg-[var(--accent)] h-full transition-all duration-300"
            style={{ width: `${((game.currentQuestionIndex + 1) / game.questions.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Top Projector Bar: Question Index, Countdown Clock, Live Answer Count, Shortcuts hint */}
      <div className="paper-card p-4 bg-[var(--bg-page)] border-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="font-['Bricolage_Grotesque'] font-black text-2xl text-[var(--accent)]">
            Q {game.currentQuestionIndex + 1} / {game.questions.length}
          </span>
          <span className="sticker-badge bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)] text-xs">
            {currentQuestion.topicTag || 'Arena Question'}
          </span>
          <span className="sticker-badge bg-[var(--ok)] text-[var(--text-on-accent)] text-xs">
            {currentQuestion.courseOutcomeTag}
          </span>
        </div>

        {/* Big Countdown Timer Ring */}
        <div className="flex items-center gap-3">
          <TimerRing
            timeLeft={timeLeft}
            totalTime={currentQuestion.timeLimit || 20}
            size={84}
            strokeWidth={8}
          />
        </div>

        {/* Live Answer Progress */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs font-bold uppercase text-[var(--text-muted)]">Answers Locked</div>
            <div className="font-mono-code text-xl font-black text-[var(--ok)]">
              {totalAnswered} / {players.length} ({answerPercentage}%)
            </div>
          </div>

          {/* Host Action Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {autoAdvanceCountdown !== null && (
              <span className="sticker-badge bg-[var(--ok)] text-white text-xs font-black animate-pulse">
                ⏱️ Advancing in {autoAdvanceCountdown}s
              </span>
            )}

            <button
              onClick={handleTogglePause}
              className="paper-btn paper-btn-sm paper-btn-secondary text-xs"
              title="Shortcut: P"
            >
              {game.isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>

            {game.status === 'question_active' && (
              <button
                onClick={handleReveal}
                className="paper-btn paper-btn-sm bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)] text-xs font-bold"
                title="Shortcut: R"
              >
                👁️ Reveal Answer
              </button>
            )}

            {game.status === 'reveal' && (
              <button
                onClick={handleShowLeaderboard}
                className="paper-btn paper-btn-sm paper-btn-ok text-xs font-bold"
              >
                📊 Show Leaderboard
              </button>
            )}

            {(game.status === 'reveal' || game.status === 'leaderboard') && (
              <button
                onClick={handleNextQuestion}
                className="paper-btn paper-btn-sm paper-btn-primary text-xs font-bold"
                title="Shortcut: Space"
              >
                {game.currentQuestionIndex + 1 === game.questions.length ? '🏁 Final Podium' : 'Next Question ➔'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Question Display Screen (Projector Landscape) */}
      <div className="paper-card p-6 sm:p-8 md:p-12 bg-[var(--surface)] text-center space-y-6 min-w-0 overflow-hidden">
        <h1 className="font-['Bricolage_Grotesque'] text-xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-[var(--text)] leading-tight break-words">
          {currentQuestion.text}
        </h1>

        {/* Optional Image */}
        {currentQuestion.imageUrl && (
          <div className="flex justify-center">
            <img
              src={currentQuestion.imageUrl}
              alt="Question illustration"
              className="max-h-64 rounded-xl border-3 border-[var(--border)] shadow-[4px_4px_0px_var(--shadow)]"
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
              className={`paper-card p-5 relative overflow-hidden border-3 shadow-[4px_4px_0px_var(--shadow)] transition-all ${
                isRevealed && isCorrect
                  ? 'ring-4 ring-green-500 scale-[1.02]'
                  : isRevealed && !isCorrect
                  ? 'opacity-40 grayscale-[50%]'
                  : ''
              } bg-[var(--surface)]`}
            >
              {/* Distribution Bar (revealed or live) */}
              {isRevealed && (
                <div
                  className="absolute bottom-0 left-0 top-0 bg-[var(--surface-2)] -z-10 transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              )}

              <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                <div className={`p-2.5 rounded-xl border-2 border-[var(--border)] ${style.bg} shrink-0`}>
                  {style.shape}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <span className="font-['Bricolage_Grotesque'] font-bold text-base sm:text-xl text-[var(--text)] block break-words">
                    {opt}
                  </span>
                </div>

                {isRevealed && (
                  <div className="text-right shrink-0">
                    <span className="font-mono-code font-black text-xl text-[var(--text)]">
                      {count}
                    </span>
                    <span className="text-xs font-bold text-[var(--text-muted)] block">({pct}%)</span>
                    {isCorrect && (
                      <span className="sticker-badge bg-[var(--ok)] text-[var(--text-on-accent)] text-[10px] mt-1">
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
        <div className="paper-card p-5 bg-[var(--surface-2)] border-3 border-[var(--border)] space-y-1 animate-fadeIn">
          <span className="sticker-badge bg-[var(--ok)] text-white text-xs mb-1">Pedagogical Key</span>
          <p className="text-sm font-semibold text-[var(--text)]">
            {currentQuestion.explanation}
          </p>
        </div>
      )}

      {/* Contenders Quick Bar: Click any participant to inspect detailed responses & telemetry */}
      {players.length > 0 && (
        <div className="paper-card p-3 bg-[var(--surface)] border-2 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-[var(--text-muted)]">
            <span>Contenders ({players.length}) — Click any player to inspect answers &amp; strikes:</span>
            <span>{answers.length} / {players.length} answered</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 max-h-28 overflow-y-auto">
            {players.map(p => {
              const hasAnsweredCurrent = answers.some(a => a.playerId === p.id);
              const strikeCount = p.strikes || 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPlayerForInspect(p)}
                  className={`paper-btn paper-btn-sm text-xs flex items-center gap-1.5 py-1 px-2.5 transition-all ${
                    hasAnsweredCurrent ? 'border-[var(--ok)] ring-1 ring-[var(--ok)]' : ''
                  }`}
                  title={`Inspect participant ${p.nickname}`}
                >
                  <Avatar config={p.avatarConfig || p.avatar} seed={p.nickname} size={20} />
                  <span className="font-bold">{p.nickname}</span>
                  <span className="text-[10px] font-mono-code opacity-80">{p.score}pts</span>
                  {strikeCount > 0 && <span className="text-red-500 font-black text-[10px]">⚠️{strikeCount}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Projector Footbar: Live Leaderboard Peek & Keyboard Shortcut Guide */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-[var(--text-muted)]">
        <div>
          Keyboard shortcuts: <kbd className="px-1.5 py-0.5 bg-[var(--surface-2)] text-[var(--text)] rounded border border-[var(--border)]">Space</kbd> Next | <kbd className="px-1.5 py-0.5 bg-[var(--surface-2)] text-[var(--text)] rounded border border-[var(--border)]">R</kbd> Reveal | <kbd className="px-1.5 py-0.5 bg-[var(--surface-2)] text-[var(--text)] rounded border border-[var(--border)]">P</kbd> Pause
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowIntegrityModal(true)}
            className="flex items-center gap-1.5 text-[var(--ok)] dark:text-[var(--accent-2)] hover:underline font-bold"
          >
            <ShieldIcon className="w-4 h-4" /> Integrity &amp; Flags Panel
            {flags.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-[var(--accent)] text-[var(--text-on-accent)] animate-pulse">
                {flags.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Integrity Audit & Flags Modal */}
      {showIntegrityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 animate-fadeIn">
          <div className="paper-modal p-6 max-w-2xl w-full space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">🛡️</span>
                <div>
                  <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)] leading-tight">
                    Arena Integrity &amp; Advisory Audit
                  </h3>
                  <span className="text-[11px] font-semibold text-[var(--text-muted)] block">
                    Advisory telemetry for host review • Human discretion supersedes automated checks
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowIntegrityModal(false)}
                className="paper-btn paper-btn-sm paper-btn-secondary text-xs"
              >
                ✕
              </button>
            </div>

            {/* Accessibility Disclaimer */}
            <div className="p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] text-xs font-semibold text-[var(--text)] flex items-start gap-2 shrink-0">
              <span className="text-sm shrink-0">♿</span>
              <div className="space-y-0.5">
                <span className="font-black text-[var(--text)]">Accessibility Guarantee:</span>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  Screen readers, dyslexia fonts, speech synthesis, and assistive accommodations are strictly allowed. Assistive tools may trigger natural focus or blur changes; all flags must be evaluated in human context.
                </p>
              </div>
            </div>

            <div className="space-y-4 overflow-y-auto pr-1 flex-1">
              {/* Contender Strike Summary Grid */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-['Bricolage_Grotesque'] font-black text-sm text-[var(--text)]">
                    Contender Strike Status ({players.length})
                  </span>
                  <span className="text-[11px] font-bold text-[var(--text-muted)]">
                    Strikes 1-5: Warnings/Locks • Strike 6: Automatic Termination
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {players.map(p => {
                    const playerFlags = flags.filter(f => f.playerId === p.id);
                    const strikeCount = typeof p.strikes === 'number' ? p.strikes : 0;
                    const isTerminated = Boolean(p.isTerminated || p.status === 'terminated_integrity' || strikeCount >= 6);

                    let badgeColor = 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700';
                    let strikeLabel = '0 Strikes (Clean)';
                    if (isTerminated) {
                      badgeColor = 'bg-red-200 dark:bg-red-900/60 text-red-900 dark:text-red-100 border-red-500';
                      strikeLabel = '💥 Terminated - Integrity';
                    } else if (strikeCount === 1) {
                      badgeColor = 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700';
                      strikeLabel = '⚠️ 1 Strike (Warned)';
                    } else if (strikeCount === 2) {
                      badgeColor = 'bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 border-orange-300 dark:border-orange-700';
                      strikeLabel = '⚡ 2 Strikes (Penalty)';
                    } else if (strikeCount === 3) {
                      badgeColor = 'bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700';
                      strikeLabel = '🔒 3 Strikes (Locked)';
                    } else if (strikeCount === 4) {
                      badgeColor = 'bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border-red-400 dark:border-red-600';
                      strikeLabel = '🚨 4 Strikes (Warning)';
                    } else if (strikeCount === 5) {
                      badgeColor = 'bg-red-200 dark:bg-red-950/50 text-red-900 dark:text-red-200 border-red-500 dark:border-red-600';
                      strikeLabel = '🛑 5 Strikes (Final Warning)';
                    }

                    const hasAccommodations = Boolean(
                      p.accommodations?.readAloud ||
                      p.accommodations?.dyslexiaFont ||
                      p.accommodations?.largeText
                    );
                    const integrityScore = p.integrityScore !== undefined
                      ? p.integrityScore
                      : Math.max(0, 100 - strikeCount * 16 - (isTerminated ? 100 : 0));

                    return (
                      <div
                        key={p.id}
                        className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar config={p.avatarConfig || p.avatar} seed={p.nickname} size={30} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-xs text-[var(--text)] truncate max-w-[140px] sm:max-w-none">
                                {p.nickname}
                              </span>
                              {p.accessibleApproved ? (
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-400">
                                  ♿ Screen Reader Approved
                                </span>
                              ) : hasAccommodations ? (
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-300">
                                  ♿ Canvas Accommodations
                                </span>
                              ) : null}
                            </div>
                            <span className="font-mono-code text-[10px] text-[var(--text-muted)] block truncate">
                              {p.score.toLocaleString()} pts • {playerFlags.length} flags • Integrity {integrityScore}%
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap shrink-0 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={async () => {
                              await GameEngine.updatePlayerAccessibleApproval(game.id, p.id, !p.accessibleApproved);
                            }}
                            className={`paper-btn paper-btn-sm text-[10px] px-1.5 py-0.5 font-bold rounded shadow-none border ${
                              p.accessibleApproved
                                ? 'bg-amber-100 text-amber-800 border-amber-300'
                                : 'bg-[var(--surface)] text-[var(--text-muted)]'
                            }`}
                            title={p.accessibleApproved ? "Revoke DOM text mode" : "Approve screen reader DOM text fallback"}
                          >
                            {p.accessibleApproved ? '♿ Revoke Screen Reader' : '♿ Approve Screen Reader'}
                          </button>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${badgeColor}`}>
                            {strikeLabel}
                          </span>
                          {(isTerminated || strikeCount > 0) && (
                            <button
                              type="button"
                              onClick={async () => {
                                await GameEngine.reinstatePlayer(game.id, p.id);
                              }}
                              className="paper-btn paper-btn-sm text-[10px] px-2 py-0.5 bg-emerald-600 text-white font-bold rounded hover:bg-emerald-700 shadow-none border"
                              title="Reinstate player's session and reset strikes"
                            >
                              Reinstate
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Live Flags Audit Feed */}
              <div className="space-y-2">
                <div className="p-2.5 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] text-[10.5px] font-medium text-[var(--text-muted)] space-y-1">
                  <span className="font-bold text-[var(--text)] block">ℹ️ Browser Security Transparency:</span>
                  <span>While QuizArena detects active DOM modifications, extension overlays, DevTools, and window blur, web browsers technically cannot detect every external extension or OS-level screen-sharing app.</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-['Bricolage_Grotesque'] font-black text-sm text-[var(--text)]">
                    Live Telemetry Feed ({flags.length})
                  </span>
                  {flags.length > 0 && (
                    <span className="text-[10px] font-bold text-[var(--text-muted)]">Latest first</span>
                  )}
                </div>

                {flags.length === 0 ? (
                  <div className="p-4 rounded-xl border-2 border-dashed border-[var(--border)] text-center text-[var(--text-muted)] text-xs font-bold">
                    ✓ No flags recorded. All contenders actively focused on the arena.
                  </div>
                ) : (
                  <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                    {flags.map(flag => {
                      const badgeClass =
                        flag.severity === 'high'
                          ? 'bg-[var(--accent)] text-[var(--text-on-accent)]'
                          : flag.severity === 'medium'
                          ? 'bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)]';

                      return (
                        <div
                          key={flag.id}
                          className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-2"
                        >
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-[var(--text)] truncate">
                                {flag.playerNickname}
                              </span>
                              {flag.questionIndex !== undefined && (
                                <span className="text-[10px] font-mono-code font-bold px-1.5 py-0.2 rounded bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)]">
                                  Q{flag.questionIndex + 1}
                                </span>
                              )}
                              <span className="text-[10px] font-mono-code text-[var(--text-muted)]">
                                [{flag.type}]
                              </span>
                            </div>
                            <div className="text-[11px] text-[var(--text-muted)] truncate">
                              {flag.reason}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${badgeClass}`}>
                              {flag.severity}
                            </span>
                            <span className="block text-[10px] font-mono-code text-[var(--text-muted)] mt-0.5">
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

            <div className="shrink-0 pt-2 border-t border-[var(--border)]">
              <button
                onClick={() => setShowIntegrityModal(false)}
                className="paper-btn paper-btn-ok w-full py-2 font-black text-xs shadow-[2px_2px_0px_var(--shadow)]"
              >
                Close Integrity Panel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Host Participant Inspection Modal */}
      {selectedPlayerForInspect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 animate-fadeIn">
          <div className="paper-modal p-6 max-w-2xl w-full space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between shrink-0 border-b-2 border-[var(--border)] pb-3">
              <div className="flex items-center gap-3">
                <Avatar
                  config={selectedPlayerForInspect.avatarConfig || selectedPlayerForInspect.avatar}
                  seed={selectedPlayerForInspect.nickname}
                  size={46}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
                      {selectedPlayerForInspect.nickname}
                    </h3>
                    <span className="sticker-badge bg-[var(--surface-2)] text-[var(--text)] text-[10px]">
                      UID: {selectedPlayerForInspect.id.slice(0, 8)}...
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-[var(--text-muted)]">
                    Score: {selectedPlayerForInspect.score.toLocaleString()} pts • Streak: {selectedPlayerForInspect.streak || 0} • Status: {selectedPlayerForInspect.status || 'active'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedPlayerForInspect(null)}
                className="paper-btn paper-btn-sm paper-btn-secondary text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto pr-1 flex-1">
              {/* Telemetry & Strike Actions */}
              <div className="p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
                <div>
                  <span className="text-[var(--text-muted)] block">Authoritative Strikes:</span>
                  <span className="text-[var(--text)]">
                    {selectedPlayerForInspect.strikes || 0} Strikes • Integrity Score {selectedPlayerForInspect.integrityScore ?? 100}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {(selectedPlayerForInspect.isTerminated || (selectedPlayerForInspect.strikes || 0) > 0) && (
                    <button
                      type="button"
                      onClick={async () => {
                        await GameEngine.reinstatePlayer(game.id, selectedPlayerForInspect.id);
                        setSelectedPlayerForInspect({
                          ...selectedPlayerForInspect,
                          strikes: 0,
                          isTerminated: false,
                          status: 'active',
                        });
                      }}
                      className="paper-btn paper-btn-sm bg-emerald-600 text-white text-xs font-bold shadow-none"
                    >
                      ✓ Reinstate Player
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      await GameEngine.updatePlayerAccessibleApproval(
                        game.id,
                        selectedPlayerForInspect.id,
                        !selectedPlayerForInspect.accessibleApproved
                      );
                      setSelectedPlayerForInspect({
                        ...selectedPlayerForInspect,
                        accessibleApproved: !selectedPlayerForInspect.accessibleApproved,
                      });
                    }}
                    className="paper-btn paper-btn-sm text-xs font-bold shadow-none"
                  >
                    {selectedPlayerForInspect.accessibleApproved ? '♿ Revoke Screen Reader' : '♿ Approve Screen Reader'}
                  </button>
                </div>
              </div>

              {/* Question-by-Question Response Audit */}
              <div className="space-y-2">
                <h4 className="font-['Bricolage_Grotesque'] font-black text-sm text-[var(--text)]">
                  Question Response Breakdown
                </h4>
                <div className="space-y-2">
                  {game.questions.map((q, qIdx) => {
                    const isClosed = qIdx < game.currentQuestionIndex || (qIdx === game.currentQuestionIndex && (game.status === 'reveal' || game.status === 'leaderboard'));
                    const isCurrent = qIdx === game.currentQuestionIndex;
                    const sub = answers.find(a => a.playerId === selectedPlayerForInspect.id && a.questionIndex === qIdx);

                    return (
                      <div
                        key={q.id || qIdx}
                        className={`p-3 rounded-xl border-2 ${
                          isCurrent
                            ? 'border-[var(--accent)] bg-[var(--surface-2)]'
                            : 'border-[var(--border)] bg-[var(--surface)]'
                        } text-xs space-y-1`}
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-[var(--text)] font-black truncate max-w-[70%]">
                            Q{qIdx + 1}: {q.text}
                          </span>
                          {isClosed ? (
                            sub?.isCorrect ? (
                              <span className="text-emerald-600 font-black">✓ Correct (+{sub.pointsAwarded || 0})</span>
                            ) : sub ? (
                              <span className="text-red-500 font-black">✕ Incorrect (0 pts)</span>
                            ) : (
                              <span className="text-[var(--text-muted)] font-bold">No Answer Submitted</span>
                            )
                          ) : (
                            <span className="text-amber-500 font-bold">{sub ? 'Answer Locked In' : 'Waiting for Submission'}</span>
                          )}
                        </div>

                        {sub && (
                          <div className="text-[11px] text-[var(--text-muted)] flex flex-wrap items-center gap-3 font-semibold">
                            <span>Selected: {sub.selectedIndices?.map(i => `Option ${i + 1}`).join(', ') || sub.textAnswer || '—'}</span>
                            {sub.responseTimeMs !== undefined && <span>Response Time: {sub.responseTimeMs}ms</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="shrink-0 pt-2 border-t border-[var(--border)]">
              <button
                onClick={() => setSelectedPlayerForInspect(null)}
                className="paper-btn paper-btn-secondary w-full py-2 font-bold text-xs"
              >
                Close Inspection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
