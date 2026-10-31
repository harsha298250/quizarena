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
import { extractQuestionStartTimeMs } from '../../server/scoringHardening';
import { WatermarkedQuestionCanvas } from './WatermarkedQuestionCanvas';

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

  // Read-Aloud (TTS) state
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [speechRate, setSpeechRate] = useState<number>(1.0);

  // Time tracking & Local Countdown Ring
  const baseTime = currentQuestion?.timeLimit || game.timeLimit || 20;
  const extraTimeMultiplier = Number(player.accommodations?.extraTimeMultiplier) || 1;
  const totalTimeLimit = Math.round(baseTime * extraTimeMultiplier);
  const [playerTimeLeft, setPlayerTimeLeft] = useState<number>(totalTimeLimit);
  const [questionStartTime, setQuestionStartTime] = useState<number>(() => {
    return extractQuestionStartTimeMs(game.questionStartTime) || Date.now();
  });

  // Advanced Integrity Guard (Always-On Strict Integrity)
  const {
    strikes,
    isTerminated,
    warningModal,
    dismissWarningModal,
    isQuestionLocked,
    blockedByExtension,
    extensionReason,
    reScanClean,
    requireFullscreen,
    isFullscreen,
    fullscreenPaused,
    requestFullscreen,
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

  // Helper to calculate exactly 2 wrong options to hide for fewerOptions
  const getFewerOptionsToHide = (q: any) => {
    if (!q || q.type !== 'multiple_choice' || !q.options || q.options.length <= 2) return [];
    const correctIdx = q.correctAnswers?.[0] !== undefined ? q.correctAnswers[0] : 0;
    const wrongOptions = q.options
      .map((_: any, idx: number) => idx)
      .filter((idx: number) => idx !== correctIdx);
    return wrongOptions.slice(0, 2);
  };

  // Stop TTS speech
  const stopSpeech = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setIsPaused(false);
  };

  // Read-Aloud TTS with letter, shape, and color matching active language
  const startReadAloud = (customRate?: number) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !currentQuestion) return;
    window.speechSynthesis.cancel();

    const rate = customRate || speechRate;
    const lang = (game.settings as any)?.language || 'en';

    let script = '';
    if (lang === 'ta') {
      script = `கேள்வி: ${currentQuestion.text}. `;
      if (currentQuestion.options && currentQuestion.type !== 'type_answer') {
        const labels = [
          'விருப்பம் A, சிவப்பு முக்கோணம்',
          'விருப்பம் B, மஞ்சள் வைரம்',
          'விருப்பம் C, பச்சை வட்டம்',
          'விருப்பம் D, நீல சதுரம்',
        ];
        currentQuestion.options.forEach((opt: string, i: number) => {
          if (!hiddenOptions.includes(i)) {
            script += `${labels[i % 4]}: ${opt}. `;
          }
        });
      }
    } else if (lang === 'hi') {
      script = `प्रश्न: ${currentQuestion.text}. `;
      if (currentQuestion.options && currentQuestion.type !== 'type_answer') {
        const labels = [
          'विकल्प A, लाल त्रिभुज',
          'विकल्प B, पीला हीरा',
          'विकल्प C, हरा वृत्त',
          'विकल्प D, नीला वर्ग',
        ];
        currentQuestion.options.forEach((opt: string, i: number) => {
          if (!hiddenOptions.includes(i)) {
            script += `${labels[i % 4]}: ${opt}. `;
          }
        });
      }
    } else {
      script = `Question: ${currentQuestion.text}. `;
      if (currentQuestion.options && currentQuestion.type !== 'type_answer') {
        const labels = [
          'Option A, red triangle',
          'Option B, yellow diamond',
          'Option C, teal circle',
          'Option D, blue square',
        ];
        currentQuestion.options.forEach((opt: string, i: number) => {
          if (!hiddenOptions.includes(i)) {
            script += `${labels[i % 4]}: ${opt}. `;
          }
        });
      }
    }

    const utterance = new SpeechSynthesisUtterance(script);
    utterance.rate = rate;

    const voices = window.speechSynthesis.getVoices();
    const matchedVoice = voices.find(v => v.lang.startsWith(lang)) || voices.find(v => v.lang.startsWith('en'));
    if (matchedVoice) utterance.voice = matchedVoice;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsPaused(false);
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  const handleTogglePauseSpeech = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    } else {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  };

  // Continuous countdown timer computed from server question start time until round ends
  useEffect(() => {
    if (game.status !== 'question_active') {
      stopSpeech();
      return;
    }

    const startMs = extractQuestionStartTimeMs(game.questionStartTime) || questionStartTime;
    const updateCountdown = () => {
      const elapsedSec = Math.floor((Date.now() - startMs) / 1000);
      const remaining = Math.max(0, totalTimeLimit - elapsedSec);
      setPlayerTimeLeft(remaining);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 500);
    return () => clearInterval(interval);
  }, [game.status, game.currentQuestionIndex, game.questionStartTime, questionStartTime, totalTimeLimit]);

  // Reset state when new question begins
  useEffect(() => {
    setSelectedIndices([]);
    setTextAnswer('');
    setHasSubmitted(false);
    setSubmissionResult(null);
    setActiveDoublePoints(false);
    setQuestionStartTime(extractQuestionStartTimeMs(game.questionStartTime) || Date.now());

    // Fewer options accommodation
    if (player.accommodations.fewerOptions && currentQuestion) {
      setHiddenOptions(getFewerOptionsToHide(currentQuestion));
    } else {
      setHiddenOptions([]);
    }

    // Read-aloud TTS if enabled (auto-read once per question at configured speed)
    if (player.accommodations.readAloud && currentQuestion?.text) {
      startReadAloud(player.accommodations.speechRate || speechRate);
    } else {
      stopSpeech();
    }

    return () => {
      stopSpeech();
    };
  }, [game.currentQuestionIndex, player.accommodations.readAloud, player.accommodations.fewerOptions]);

  if (isTerminated) {
    return (
      <div className="mx-auto max-w-xl p-4 sm:p-6 space-y-6 animate-fadeIn">
        <div className="paper-card p-8 border-3 border-red-500 bg-red-50 dark:bg-red-950/40 text-center space-y-4">
          <div className="text-5xl">🚨</div>
          <h1 className="font-['Bricolage_Grotesque'] text-2xl font-black text-red-600 dark:text-red-400">
            Quiz Terminated - Integrity Shield
          </h1>
          <p className="text-sm font-semibold text-[var(--text)] leading-relaxed">
            Six focus or window loss violations were recorded on your session. Your quiz has been ended automatically in accordance with exam integrity guidelines.
          </p>
          <div className="p-3 bg-[var(--surface)] rounded-xl border border-[var(--border)] text-xs font-mono font-bold text-[var(--text)]">
            Score Preserved: {player.score.toLocaleString()} pts • Strikes: 6/6
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Your score earned so far has been preserved on the server. All integrity logs are reviewed by the host. Your instructor can reinstate your session if this was triggered in error.
          </p>
        </div>
      </div>
    );
  }

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
    stopSpeech();
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
    stopSpeech();
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
    <div className={`mx-auto max-w-xl p-3 sm:p-4 space-y-4 ${player.accommodations.dyslexiaFont ? 'dyslexia-font' : ''} ${player.accommodations.largeText ? 'text-base sm:text-lg' : ''}`}>
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
      </div>

      {/* Confirmation of Active Accommodations */}
      {(player.accommodations.dyslexiaFont || player.accommodations.readAloud || player.accommodations.fewerOptions || player.accommodations.largeText || (player.accommodations.extraTimeMultiplier && player.accommodations.extraTimeMultiplier > 1)) && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-[var(--surface-2)] border-2 border-[var(--border)] rounded-full text-[11px] font-bold text-[var(--text)]">
          <span className="text-[var(--ok)] dark:text-[var(--accent-2)]">♿ Active:</span>
          <span className="truncate">
            {[
              player.accommodations.dyslexiaFont && 'Dyslexia Font',
              player.accommodations.readAloud && 'Read-Aloud',
              player.accommodations.fewerOptions && 'Fewer Options',
              player.accommodations.largeText && 'Large Text',
              player.accommodations.extraTimeMultiplier > 1 && `${player.accommodations.extraTimeMultiplier}x Time`,
            ].filter(Boolean).join(' • ')}
          </span>
        </div>
      )}

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

      {/* Fullscreen Paused Overlay */}
      {fullscreenPaused && game.status === 'question_active' && !hasSubmitted && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 animate-fadeIn">
          <div className="paper-card p-8 max-w-md w-full text-center space-y-4 border-3 border-[var(--accent)]">
            <div className="text-4xl animate-pulse">📺</div>
            <h2 className="text-2xl font-black font-['Bricolage_Grotesque'] text-[var(--accent)]">
              Fullscreen Mode Required
            </h2>
            <p className="text-xs font-bold text-[var(--text-muted)]">
              Assessment countdown is visibly paused on your screen. (Server time continues running). Please return to fullscreen mode immediately to continue answering.
            </p>
            <button
              onClick={requestFullscreen}
              className="paper-btn paper-btn-primary w-full py-3 text-sm font-black shadow-[4px_4px_0px_var(--shadow)]"
            >
              🖥️ Return to Fullscreen
            </button>
          </div>
        </div>
      )}

      {/* Question Prompt and Timer Ring Header */}
      <div className="flex items-center justify-between w-full px-1">
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

      {/* Anti-Scraping Canvas (or Accessible Mode Fallback) */}
      {game.status === 'question_active' && currentQuestion.type !== 'type_answer' ? (
        <div className="space-y-3">
          <WatermarkedQuestionCanvas
            questionText={currentQuestion.text}
            options={currentQuestion.options}
            playerNickname={player.nickname}
            playerId={player.id}
            questionIndex={game.currentQuestionIndex}
            totalQuestions={game.questions.length}
            selectedIndices={selectedIndices}
            hasSubmitted={hasSubmitted}
            isLocked={isQuestionLocked}
            hiddenOptions={hiddenOptions}
            isAccessibleMode={Boolean(player.accessibleApproved)}
            dyslexiaFont={Boolean(player.accommodations?.dyslexiaFont)}
            largeText={Boolean(player.accommodations?.largeText)}
            onSelectOption={handleSubmitOption}
          />
        </div>
      ) : game.status !== 'question_active' ? (
        <div className="paper-card p-5 border-3 text-center space-y-2">
          <h1 className="font-['Bricolage_Grotesque'] font-black text-lg sm:text-xl text-[var(--text)]">
            {currentQuestion.text}
          </h1>
        </div>
      ) : null}

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

      {/* Waiting or Submitted Feedback State: Countdown continues */}
      {hasSubmitted && game.status === 'question_active' && (
        <div className="paper-card p-5 text-center border-3 border-[var(--ok)] space-y-2 bg-emerald-50/50 dark:bg-emerald-950/30 animate-fadeIn">
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl animate-pulse">🔒</span>
            <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--ok)] dark:text-[var(--accent-2)]">
              Answer locked - waiting for others
            </h3>
          </div>
          <p className="text-xs font-bold text-[var(--text-muted)]">
            Your answer is securely locked. Timer countdown continues until question ends.
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

      {/* Integrity Guard Escalation Modal (Strikes 1, 2, 3, Fullscreen, Extension Warning) */}
      <IntegrityModal
        modalState={warningModal}
        onDismiss={dismissWarningModal}
        blockedByExtension={blockedByExtension}
        extensionReason={extensionReason}
        onReScanClean={reScanClean}
        requireFullscreen={requireFullscreen}
        isFullscreen={isFullscreen}
        onRequestFullscreen={requestFullscreen}
      />
    </div>
  );
};
