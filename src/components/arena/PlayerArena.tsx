/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GameSession, Player, IntegrityFlag } from '../../types/quiz';
import { sound } from '../../lib/sound';
import { GameEngine } from '../../services/gameEngine';
import { AvatarBadge, ShapeTriangle, ShapeDiamond, ShapeCircle, ShapeSquare, FlameIcon } from '../common/CustomIcons';
import { TimerRing } from '../common/TimerRing';
import { Avatar } from '../common/Avatar';
import { useIntegrityGuard } from '../../hooks/useIntegrityGuard';
import { IntegrityModal } from '../common/IntegrityModal';

interface PlayerArenaProps {
  game: GameSession;
  player: Player;
  onUpdatePlayer: (updated: Player) => void;
}

export const PlayerArena: React.FC<PlayerArenaProps> = ({ game, player, onUpdatePlayer }) => {
  const currentQuestion = game.questions[game.currentQuestionIndex];
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [textAnswer, setTextAnswer] = useState<string>('');
  const [hasSubmitted, setHasSubmitted] = useState<boolean>(false);
  const [submissionResult, setSubmissionResult] = useState<{ isCorrect: boolean; pointsAwarded: number } | null>(null);
  const [activeDoublePoints, setActiveDoublePoints] = useState<boolean>(false);
  const [hiddenOptions, setHiddenOptions] = useState<number[]>([]);
  const [accommodationsOpen, setAccommodationsOpen] = useState<boolean>(false);

  // Time tracking & Local Countdown Ring
  const baseTime = currentQuestion?.timeLimit || game.timeLimit || 20;
  const totalTimeLimit = Math.round(baseTime * (player.accommodations.extraTimeMultiplier || 1));
  const [playerTimeLeft, setPlayerTimeLeft] = useState<number>(totalTimeLimit);
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now());

  // Advanced Integrity Guard (Secure Mode)
  const {
    strikes,
    warningModal,
    dismissWarningModal,
    isQuestionLocked,
    blockedByExtension,
    extensionReason,
    isFullscreen,
    requestFullscreen,
    requireFullscreen,
    handlePasteAttempt,
  } = useIntegrityGuard({
    game,
    player,
    currentQuestionIndex: game.currentQuestionIndex,
    hasSubmitted,
    onApplyPenalty: (penaltyPoints) => {
      onUpdatePlayer({
        ...player,
        score: Math.max(0, player.score - penaltyPoints),
        strikes: (player.strikes || 0) + 1,
      });
    },
  });

  // Countdown timer for player ring
  useEffect(() => {
    setPlayerTimeLeft(totalTimeLimit);
  }, [game.currentQuestionIndex, totalTimeLimit]);

  useEffect(() => {
    if (game.status !== 'question_active' || hasSubmitted || playerTimeLeft <= 0) return;
    const interval = setInterval(() => {
      setPlayerTimeLeft(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [game.status, hasSubmitted, playerTimeLeft]);

  // Reset state when new question begins
  useEffect(() => {
    setSelectedIndices([]);
    setTextAnswer('');
    setHasSubmitted(false);
    setSubmissionResult(null);
    setActiveDoublePoints(false);
    setHiddenOptions([]);
    setQuestionStartTime(Date.now());

    // Dyslexia mode speech synthesis (TTS) if enabled in accommodations
    if (player.accommodations.readAloud && currentQuestion?.text && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(currentQuestion.text);
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    }
  }, [game.currentQuestionIndex, player.accommodations.readAloud]);

  if (!currentQuestion) {
    return (
      <div className="paper-card p-8 text-center text-[var(--text)]">
        Waiting for the next round to start...
      </div>
    );
  }

  // Answer submission
  const handleSubmitOption = async (optIdx: number) => {
    if (hasSubmitted || isQuestionLocked || game.status !== 'question_active') return;
    sound.playClick();

    if (currentQuestion.type === 'multi_select') {
      const exists = selectedIndices.includes(optIdx);
      const updated = exists ? selectedIndices.filter(i => i !== optIdx) : [...selectedIndices, optIdx];
      setSelectedIndices(updated);
      return;
    }

    // Single choice lock in
    const rawTimeMs = Date.now() - questionStartTime;
    setHasSubmitted(true);
    setSelectedIndices([optIdx]);

    const result = await GameEngine.submitAnswer(
      game.id,
      player,
      game.currentQuestionIndex,
      [optIdx],
      undefined,
      currentQuestion,
      game.settings,
      rawTimeMs,
      undefined,
      { doublePoints: activeDoublePoints }
    );

    setSubmissionResult(result);
    if (result.isCorrect) sound.playCorrect();
    else sound.playWrong();
  };

  const handleConfirmMultiSelectOrText = async () => {
    if (hasSubmitted || isQuestionLocked || game.status !== 'question_active') return;
    sound.playClick();
    const rawTimeMs = Date.now() - questionStartTime;
    setHasSubmitted(true);

    const result = await GameEngine.submitAnswer(
      game.id,
      player,
      game.currentQuestionIndex,
      selectedIndices,
      textAnswer,
      currentQuestion,
      game.settings,
      rawTimeMs,
      undefined,
      { doublePoints: activeDoublePoints }
    );

    setSubmissionResult(result);
    if (result.isCorrect) sound.playCorrect();
    else sound.playWrong();
  };

  // Power-Up: 50/50 (eliminate 2 incorrect options)
  const handleUse5050 = () => {
    if (player.powerUps.fiftyFiftyUsed || hasSubmitted) return;
    sound.playPowerUp();
    const correctIdx = currentQuestion.correctAnswers?.[0];
    const wrongOptions = currentQuestion.options
      .map((_, idx) => idx)
      .filter(idx => (correctIdx !== undefined ? idx !== correctIdx : idx >= 2));
    const toHide = wrongOptions.slice(0, 2);
    setHiddenOptions(toHide);

    const updated: Player = {
      ...player,
      powerUps: { ...player.powerUps, fiftyFiftyUsed: true },
    };
    onUpdatePlayer(updated);
  };

  // Power-Up: Double Points
  const handleUseDoublePoints = () => {
    if (player.powerUps.doublePointsUsed || hasSubmitted) return;
    sound.playPowerUp();
    setActiveDoublePoints(true);
    const updated: Player = {
      ...player,
      powerUps: { ...player.powerUps, doublePointsUsed: true },
    };
    onUpdatePlayer(updated);
  };

  const optionButtons = [
    { bg: 'bg-[var(--accent)] text-[var(--text-on-accent)]', icon: <ShapeTriangle className="w-8 h-8 text-[var(--text-on-accent)]" fill="currentColor" />, label: 'Triangle' },
    { bg: 'bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)]', icon: <ShapeDiamond className="w-8 h-8 text-[var(--text-on-accent-2)]" fill="currentColor" />, label: 'Diamond' },
    { bg: 'bg-[var(--ok)] text-[var(--text-on-accent)]', icon: <ShapeCircle className="w-8 h-8 text-[var(--text-on-accent)]" fill="currentColor" />, label: 'Circle' },
    { bg: 'bg-[var(--info)] text-[var(--text-on-accent)]', icon: <ShapeSquare className="w-8 h-8 text-[var(--text-on-accent)]" fill="currentColor" />, label: 'Square' },
  ];

  return (
    <div className={`mx-auto max-w-xl p-3 sm:p-4 space-y-4 ${player.accommodations.dyslexiaFont ? 'dyslexia-font' : ''}`}>
      {/* Player Header: Avatar, Nickname, Streak Flame, Score & Accommodations button */}
      <div className="paper-card p-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Avatar config={player.avatarConfig || player.avatar} seed={player.nickname} size={44} />
          <div>
            <div className="font-['Bricolage_Grotesque'] font-black text-base text-[var(--text)] leading-none">
              {player.nickname}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="font-mono-code text-xs font-bold text-[var(--accent)]">
                {player.score.toLocaleString()} pts
              </span>
              {player.streak > 1 && (
                <span className="inline-flex items-center gap-1 text-xs font-black px-2 py-0.5 rounded-full bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)] border border-[var(--border)] shadow-[1px_1px_0px_var(--shadow)] animate-pulse-glow">
                  <FlameIcon className="w-3.5 h-3.5 text-orange-600 fill-current" /> {player.streak} Streak
                </span>
              )}
              {strikes > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                  ⚠️ {strikes} Strike{strikes > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAccommodationsOpen(true)}
            className="paper-btn paper-btn-sm text-[11px] font-bold"
            title="Accessibility Accommodations"
          >
            ♿ Options
          </button>
        </div>
      </div>

      {/* Power-Ups Bar (Once per match) */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleUse5050}
          disabled={player.powerUps.fiftyFiftyUsed || hasSubmitted}
          className={`paper-btn paper-btn-sm text-xs font-bold py-2 ${
            player.powerUps.fiftyFiftyUsed ? 'opacity-50 cursor-not-allowed' : 'paper-btn-secondary'
          }`}
        >
          {player.powerUps.fiftyFiftyUsed ? '50/50 (Used)' : '⚡ 50/50 (Cut 2)'}
        </button>

        <button
          onClick={handleUseDoublePoints}
          disabled={player.powerUps.doublePointsUsed || hasSubmitted}
          className={`paper-btn paper-btn-sm text-xs font-bold py-2 ${
            player.powerUps.doublePointsUsed
              ? 'opacity-50 cursor-not-allowed'
              : activeDoublePoints
              ? 'bg-[var(--accent)] text-[var(--text-on-accent)]'
              : 'paper-btn-ok'
          }`}
        >
          {player.powerUps.doublePointsUsed
            ? '2x Points (Used)'
            : activeDoublePoints
            ? '🔥 2x Active!'
            : '⭐ 2x Double Points'}
        </button>
      </div>

      {/* Clear Question Progress */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] font-bold text-[var(--text-muted)]">
          <span>Question <strong>{game.currentQuestionIndex + 1} of {game.questions.length}</strong></span>
          <span>{Math.round(((game.currentQuestionIndex + 1) / game.questions.length) * 100)}%</span>
        </div>
        <div className="w-full bg-[var(--surface-2)] h-1.5 rounded-full border border-[var(--border)] overflow-hidden">
          <div
            className="bg-[var(--accent)] h-full transition-all duration-300"
            style={{ width: `${((game.currentQuestionIndex + 1) / game.questions.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Question Prompt and Timer Ring */}
      <div
        className={`paper-card p-4 sm:p-5 border-3 flex flex-col items-center text-center space-y-3 ${
          game.settings.preventCopyPaste !== false ? 'select-none' : ''
        }`}
        onContextMenu={e => {
          if (game.settings.preventCopyPaste !== false) {
            e.preventDefault();
          }
        }}
        onCopy={e => {
          if (game.settings.preventCopyPaste !== false) {
            handlePasteAttempt(e);
          }
        }}
      >
        <div className="flex items-center justify-between w-full">
          <span className="sticker-badge sticker-badge-sunshine text-[11px] font-bold">
            Q{game.currentQuestionIndex + 1} / {game.questions.length}
          </span>
          <TimerRing
            timeLeft={playerTimeLeft}
            totalTime={totalTimeLimit}
            size={56}
            strokeWidth={5}
          />
        </div>
        <h1 className="font-['Bricolage_Grotesque'] font-black text-lg sm:text-xl text-[var(--text)] leading-snug">
          {currentQuestion.text}
        </h1>
      </div>

      {/* Question Locked Banner if Strike 3 locked the round */}
      {isQuestionLocked && !hasSubmitted && game.status === 'question_active' && (
        <div className="paper-card p-6 text-center border-3 border-[var(--accent)] space-y-2 bg-red-50 dark:bg-red-950/40 animate-fadeIn">
          <div className="text-3xl">⚠️</div>
          <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--accent)]">
            Question Locked
          </h3>
          <p className="text-xs font-semibold text-[var(--text-muted)]">
            Answering has been locked for this question due to repeated tab switching or focus loss. The host has been notified.
          </p>
          <div className="text-[11px] font-bold text-[var(--text-muted)]">
            ♿ Human Review: Flags are reviewed by your host. Normal play resumes next question.
          </div>
        </div>
      )}

      {/* Waiting or Submitted Feedback State */}
      {hasSubmitted && game.status === 'question_active' && (
        <div className="paper-card p-8 text-center border-3 space-y-3 animate-fadeIn">
          <div className="text-4xl animate-pulse">🔒</div>
          <h3 className="font-['Bricolage_Grotesque'] font-black text-2xl text-[var(--ok)] dark:text-[var(--accent-2)]">
            Locked In!
          </h3>
          <p className="text-xs font-bold text-[var(--text-muted)]">
            Waiting for remaining players and host countdown...
          </p>
        </div>
      )}

      {/* Reveal Outcome State with Instant Animations */}
      {(game.status === 'reveal' || game.status === 'leaderboard') && (
        <div
          className={`paper-card p-6 text-center border-3 space-y-3 shadow-[5px_5px_0px_var(--shadow)] ${
            submissionResult?.isCorrect
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-[var(--ok)] animate-pop-in'
              : 'bg-red-50 dark:bg-red-950/40 border-[var(--accent)] animate-shake'
          }`}
        >
          <div className="text-4xl animate-bounce">
            {submissionResult?.isCorrect ? '🎉' : '💡'}
          </div>
          <h3
            className={`font-['Bricolage_Grotesque'] font-black text-2xl ${
              submissionResult?.isCorrect ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-800 dark:text-red-300'
            }`}
          >
            {submissionResult?.isCorrect ? 'Nice one! Spot on!' : 'Bummer! Keep your head up!'}
          </h3>
          {submissionResult?.isCorrect && (
            <div className="font-mono-code font-black text-xl text-[var(--ok)] dark:text-[var(--accent-2)]">
              +{submissionResult.pointsAwarded} Points!
            </div>
          )}
          {currentQuestion.explanation && (
            <p className="text-xs font-semibold text-[var(--text-muted)] mt-2">
              {currentQuestion.explanation}
            </p>
          )}
        </div>
      )}

      {/* Shape-coded Answer Buttons with Tactile Press Feedback */}
      {!hasSubmitted && !isQuestionLocked && game.status === 'question_active' && currentQuestion.type !== 'type_answer' && (
        <div className="grid grid-cols-2 gap-3 pt-2">
          {currentQuestion.options.map((opt, idx) => {
            if (hiddenOptions.includes(idx)) {
              return <div key={idx} className="h-32 sm:h-36 rounded-2xl bg-[var(--surface-2)] opacity-20 border-2 border-[var(--border)]" />;
            }

            const btn = optionButtons[idx % 4];
            const isSelected = selectedIndices.includes(idx);

            return (
              <button
                key={idx}
                onClick={() => handleSubmitOption(idx)}
                disabled={isQuestionLocked}
                className={`paper-btn h-32 sm:h-36 flex flex-col items-center justify-center p-3 rounded-2xl shadow-[4px_4px_0px_var(--shadow)] hover:-translate-y-0.5 active:translate-y-1 active:shadow-none transition-all select-none ${
                  btn.bg
                } ${isSelected ? 'ring-4 ring-[var(--border)] scale-95' : ''}`}
              >
                <div className="mb-1.5 sm:mb-2 shrink-0">{btn.icon}</div>
                <span className="font-['Bricolage_Grotesque'] font-extrabold text-xs sm:text-base leading-tight text-center line-clamp-3 break-words px-1">
                  {opt}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Multi-select confirm button */}
      {!hasSubmitted && !isQuestionLocked && currentQuestion.type === 'multi_select' && selectedIndices.length > 0 && (
        <button
          onClick={handleConfirmMultiSelectOrText}
          className="paper-btn paper-btn-ok w-full py-3 text-base font-black shadow-[4px_4px_0px_var(--shadow)]"
        >
          Confirm Selected Answers ({selectedIndices.length})
        </button>
      )}

      {/* Type Answer Screen */}
      {!hasSubmitted && !isQuestionLocked && game.status === 'question_active' && currentQuestion.type === 'type_answer' && (
        <div className="space-y-3">
          <input
            type="text"
            value={textAnswer}
            onChange={e => setTextAnswer(e.target.value)}
            onPaste={handlePasteAttempt}
            disabled={isQuestionLocked}
            onKeyDown={e => {
              if (e.key === 'Enter') handleConfirmMultiSelectOrText();
            }}
            placeholder="Type your answer here..."
            className="paper-input w-full rounded-2xl border-3 border-[var(--border)] p-4 text-center font-bold text-lg shadow-[4px_4px_0px_var(--shadow)]"
          />
          <button
            onClick={handleConfirmMultiSelectOrText}
            disabled={!textAnswer.trim() || isQuestionLocked}
            className="paper-btn paper-btn-primary w-full py-3 font-black text-base shadow-[4px_4px_0px_var(--shadow)] disabled:opacity-50"
          >
            Lock It In!
          </button>
        </div>
      )}

      {/* Accommodations Modal */}
      {accommodationsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="paper-modal p-6 max-w-sm w-full space-y-4">
            <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--accent)]">
              Personal Accommodations
            </h3>

            <div className="space-y-3 text-xs font-bold text-[var(--text)]">
              <label className="flex items-center justify-between cursor-pointer">
                <span>Dyslexia-friendly Font</span>
                <input
                  type="checkbox"
                  checked={player.accommodations.dyslexiaFont}
                  onChange={e => {
                    sound.playClick();
                    onUpdatePlayer({
                      ...player,
                      accommodations: { ...player.accommodations, dyslexiaFont: e.target.checked },
                    });
                  }}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <span>Read Questions Aloud (Speech)</span>
                <input
                  type="checkbox"
                  checked={player.accommodations.readAloud}
                  onChange={e => {
                    sound.playClick();
                    onUpdatePlayer({
                      ...player,
                      accommodations: { ...player.accommodations, readAloud: e.target.checked },
                    });
                  }}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <span>Fewer Answer Options (Hide Distractor)</span>
                <input
                  type="checkbox"
                  checked={player.accommodations.fewerOptions}
                  onChange={e => {
                    sound.playClick();
                    onUpdatePlayer({
                      ...player,
                      accommodations: { ...player.accommodations, fewerOptions: e.target.checked },
                    });
                  }}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
              </label>
            </div>

            <button
              onClick={() => setAccommodationsOpen(false)}
              className="paper-btn paper-btn-ok w-full py-2 text-xs font-bold"
            >
              Save &amp; Return
            </button>
          </div>
        </div>
      )}

      {/* Integrity Guard Escalation Modal (Strikes 1, 2, 3, Fullscreen, Extension Warning) */}
      <IntegrityModal
        modalState={warningModal}
        onDismiss={dismissWarningModal}
        blockedByExtension={blockedByExtension}
        extensionReason={extensionReason}
        requireFullscreen={requireFullscreen}
        isFullscreen={isFullscreen}
        onRequestFullscreen={requestFullscreen}
      />
    </div>
  );
};
