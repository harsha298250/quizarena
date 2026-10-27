/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GameSession, Player, Question, AnswerSubmission, IntegrityFlag } from '../../types/quiz';
import { GameEngine } from '../../services/gameEngine';
import { sound } from '../../lib/sound';
import {
  ShapeTriangle,
  ShapeDiamond,
  ShapeCircle,
  ShapeSquare,
  FlameIcon,
  AvatarBadge,
  LightningIcon,
} from '../common/CustomIcons';

interface PlayerArenaProps {
  game: GameSession;
  player: Player;
  onUpdatePlayer: (updated: Player) => void;
}

export const PlayerArena: React.FC<PlayerArenaProps> = ({ game, player, onUpdatePlayer }) => {
  const currentQuestion: Question | undefined = game.questions[game.currentQuestionIndex];
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [textAnswer, setTextAnswer] = useState<string>('');
  const [hasSubmitted, setHasSubmitted] = useState<boolean>(false);
  const [submissionResult, setSubmissionResult] = useState<AnswerSubmission | null>(null);
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now());
  const [hiddenOptions, setHiddenOptions] = useState<number[]>([]);
  const [activeDoublePoints, setActiveDoublePoints] = useState<boolean>(false);
  const [accommodationsOpen, setAccommodationsOpen] = useState<boolean>(false);
  const lastFlagTimeRef = useRef<Record<string, number>>({});

  // Reset answer state when active question advances
  useEffect(() => {
    setSelectedIndices([]);
    setTextAnswer('');
    setHasSubmitted(false);
    setSubmissionResult(null);
    setHiddenOptions([]);
    setActiveDoublePoints(false);
    setQuestionStartTime(Date.now());

    // Read aloud accommodation
    if (player.accommodations.readAloud && currentQuestion && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(currentQuestion.text);
      window.speechSynthesis.speak(utterance);
    }
  }, [game.currentQuestionIndex, game.status]);

  // Anti-cheat detection: tab switch / window blur / fullscreen exit
  useEffect(() => {
    if (game.status !== 'question_active' || hasSubmitted || game.settings.antiCheatDetection === false) {
      return;
    }

    const sendFlag = (
      type: IntegrityFlag['type'],
      severity: IntegrityFlag['severity'],
      reason: string
    ) => {
      const now = Date.now();
      const last = lastFlagTimeRef.current[type] || 0;
      if (now - last < 3000) return; // Debounce 3s per flag type
      lastFlagTimeRef.current[type] = now;

      const flag: IntegrityFlag = {
        id: `flag_${now}_${Math.random().toString(36).substring(2, 7)}`,
        playerId: player.id,
        playerNickname: player.nickname,
        type,
        severity,
        reason,
        timestamp: new Date().toISOString(),
        questionIndex: game.currentQuestionIndex,
      };

      GameEngine.recordFlag(game.id, flag).catch(err => {
        console.warn('Failed to record anti-cheat flag:', err);
      });
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        sendFlag('tab_switch', 'medium', 'Player switched tab or minimized window');
      }
    };

    const handleBlur = () => {
      sendFlag('window_blur', 'low', 'Player window lost focus (blur detected)');
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        sendFlag('fullscreen_exit', 'medium', 'Player exited fullscreen mode');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [game.id, game.status, game.currentQuestionIndex, hasSubmitted, player.id, player.nickname, game.settings.antiCheatDetection]);

  const handlePasteInTypeAnswer = () => {
    if (game.settings.antiCheatDetection === false) return;
    const now = Date.now();
    const last = lastFlagTimeRef.current['paste_detected'] || 0;
    if (now - last < 3000) return;
    lastFlagTimeRef.current['paste_detected'] = now;

    const flag: IntegrityFlag = {
      id: `flag_${now}_${Math.random().toString(36).substring(2, 7)}`,
      playerId: player.id,
      playerNickname: player.nickname,
      type: 'paste_detected',
      severity: 'high',
      reason: 'Pasted text detected in type-answer input',
      timestamp: new Date().toISOString(),
      questionIndex: game.currentQuestionIndex,
    };

    GameEngine.recordFlag(game.id, flag).catch(err => {
      console.warn('Failed to record paste flag:', err);
    });
  };

  if (!currentQuestion) {
    return (
      <div className="paper-card p-8 text-center bg-white dark:bg-[#16120E] text-[#16120E] dark:text-white">
        Waiting for the next round to start...
      </div>
    );
  }

  // Answer submission
  const handleSubmitOption = async (optIdx: number) => {
    if (hasSubmitted || game.status !== 'question_active') return;
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
    if (hasSubmitted || game.status !== 'question_active') return;
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
    { bg: 'bg-[#FF5A36]', hover: 'hover:bg-[#ff471e]', icon: <ShapeTriangle className="w-8 h-8 text-white" fill="#FFFFFF" />, label: 'Triangle' },
    { bg: 'bg-[#FFC83D]', hover: 'hover:bg-[#f5bc28]', icon: <ShapeDiamond className="w-8 h-8 text-[#16120E]" fill="#16120E" />, label: 'Diamond' },
    { bg: 'bg-[#14B8A6]', hover: 'hover:bg-[#0fa090]', icon: <ShapeCircle className="w-8 h-8 text-white" fill="#FFFFFF" />, label: 'Circle' },
    { bg: 'bg-[#4DA3FF]', hover: 'hover:bg-[#3b93f0]', icon: <ShapeSquare className="w-8 h-8 text-white" fill="#FFFFFF" />, label: 'Square' },
  ];

  return (
    <div className={`mx-auto max-w-xl p-3 sm:p-4 space-y-4 ${player.accommodations.dyslexiaFont ? 'dyslexia-font' : ''}`}>
      {/* Player Header: Avatar, Nickname, Streak Flame, Score & Accommodations button */}
      <div className="paper-card p-3.5 bg-white dark:bg-[#16120E] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <AvatarBadge avatarId={player.avatar} size={42} />
          <div>
            <div className="font-['Bricolage_Grotesque'] font-black text-base text-[#16120E] dark:text-white leading-none">
              {player.nickname}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="font-mono-code text-xs font-bold text-[#FF5A36]">
                {player.score.toLocaleString()} pts
              </span>
              {player.streak > 1 && (
                <span className="inline-flex items-center gap-0.5 text-xs font-bold text-[#FFC83D]">
                  <FlameIcon className="w-3.5 h-3.5" /> {player.streak} Streak
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAccommodationsOpen(true)}
            className="paper-btn paper-btn-sm bg-[#FFFAEE] dark:bg-[#221c16] text-[11px] font-bold"
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
            player.powerUps.fiftyFiftyUsed ? 'bg-gray-200 text-gray-500' : 'bg-[#FFC83D] text-[#16120E]'
          }`}
        >
          {player.powerUps.fiftyFiftyUsed ? '50/50 (Used)' : '⚡ 50/50 (Cut 2)'}
        </button>

        <button
          onClick={handleUseDoublePoints}
          disabled={player.powerUps.doublePointsUsed || hasSubmitted}
          className={`paper-btn paper-btn-sm text-xs font-bold py-2 ${
            player.powerUps.doublePointsUsed ? 'bg-gray-200 text-gray-500' : 'bg-[#14B8A6] text-white'
          }`}
        >
          {player.powerUps.doublePointsUsed
            ? '2x Points (Used)'
            : activeDoublePoints
            ? '🔥 2x Active!'
            : '⭐ 2x Double Points'}
        </button>
      </div>

      {/* Question Prompt on Player Screen */}
      <div className="paper-card p-5 bg-[#FFF6E5] dark:bg-[#16120E] border-3 text-center space-y-2">
        <span className="sticker-badge bg-[#FFC83D] text-[#16120E] text-[10px]">
          Q{game.currentQuestionIndex + 1} of {game.questions.length}
        </span>
        <h2 className="font-['Bricolage_Grotesque'] font-black text-lg sm:text-xl text-[#16120E] dark:text-white leading-tight">
          {currentQuestion.text}
        </h2>
      </div>

      {/* Waiting or Submitted Feedback State */}
      {hasSubmitted && game.status === 'question_active' && (
        <div className="paper-card p-8 text-center bg-white dark:bg-[#16120E] border-3 space-y-3 animate-fadeIn">
          <div className="text-4xl animate-pulse">🔒</div>
          <h3 className="font-['Bricolage_Grotesque'] font-black text-2xl text-[#14B8A6]">
            Locked In!
          </h3>
          <p className="text-xs font-bold text-gray-600 dark:text-gray-400">
            Waiting for remaining players and host countdown...
          </p>
        </div>
      )}

      {/* Reveal Outcome State */}
      {(game.status === 'reveal' || game.status === 'leaderboard') && (
        <div
          className={`paper-card p-6 text-center border-3 space-y-3 animate-fadeIn ${
            submissionResult?.isCorrect
              ? 'bg-[#E8FAF6] border-[#14B8A6]'
              : 'bg-[#FFF0ED] border-[#FF5A36]'
          }`}
        >
          <div className="text-4xl">
            {submissionResult?.isCorrect ? '🎉' : '💡'}
          </div>
          <h3
            className={`font-['Bricolage_Grotesque'] font-black text-2xl ${
              submissionResult?.isCorrect ? 'text-[#14B8A6]' : 'text-[#FF5A36]'
            }`}
          >
            {submissionResult?.isCorrect ? 'Nice one! Spot on!' : 'Bummer! Keep your head up!'}
          </h3>
          {submissionResult?.isCorrect && (
            <div className="font-mono-code font-black text-xl text-[#16120E]">
              +{submissionResult.pointsAwarded} Points!
            </div>
          )}
          {currentQuestion.explanation && (
            <p className="text-xs font-semibold text-gray-700 mt-2">
              {currentQuestion.explanation}
            </p>
          )}
        </div>
      )}

      {/* Shape-coded Answer Buttons (Phone-First Large Buttons) */}
      {!hasSubmitted && game.status === 'question_active' && currentQuestion.type !== 'type_answer' && (
        <div className="grid grid-cols-2 gap-3 pt-2">
          {currentQuestion.options.map((opt, idx) => {
            if (hiddenOptions.includes(idx)) {
              return <div key={idx} className="h-28 rounded-2xl bg-gray-100 dark:bg-gray-800 opacity-20 border-2" />;
            }

            const btn = optionButtons[idx % 4];
            const isSelected = selectedIndices.includes(idx);

            return (
              <button
                key={idx}
                onClick={() => handleSubmitOption(idx)}
                className={`paper-btn h-32 sm:h-36 flex flex-col items-center justify-center p-3 rounded-2xl transition-transform active:scale-95 ${
                  btn.bg
                } ${isSelected ? 'ring-4 ring-black scale-95' : ''}`}
              >
                <div className="mb-2 shrink-0">{btn.icon}</div>
                <span className="text-white font-['Bricolage_Grotesque'] font-extrabold text-sm sm:text-base leading-tight text-center line-clamp-2">
                  {opt}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Multi-select confirm button */}
      {!hasSubmitted && currentQuestion.type === 'multi_select' && selectedIndices.length > 0 && (
        <button
          onClick={handleConfirmMultiSelectOrText}
          className="paper-btn w-full bg-[#14B8A6] text-white py-3 text-base font-black shadow-[4px_4px_0px_#16120E]"
        >
          Confirm Selected Answers ({selectedIndices.length})
        </button>
      )}

      {/* Type Answer Screen */}
      {!hasSubmitted && game.status === 'question_active' && currentQuestion.type === 'type_answer' && (
        <div className="space-y-3">
          <input
            type="text"
            value={textAnswer}
            onChange={e => setTextAnswer(e.target.value)}
            onPaste={handlePasteInTypeAnswer}
            onKeyDown={e => {
              if (e.key === 'Enter') handleConfirmMultiSelectOrText();
            }}
            placeholder="Type your answer here..."
            className="w-full rounded-2xl border-3 border-[#16120E] p-4 text-center font-bold text-lg dark:bg-[#16120E] dark:text-white shadow-[4px_4px_0px_#16120E]"
          />
          <button
            onClick={handleConfirmMultiSelectOrText}
            disabled={!textAnswer.trim()}
            className="paper-btn w-full bg-[#FF5A36] text-white py-3 font-black text-base shadow-[4px_4px_0px_#16120E] disabled:opacity-50"
          >
            Lock It In!
          </button>
        </div>
      )}

      {/* Accommodations Modal */}
      {accommodationsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="paper-card p-6 bg-[#FFF6E5] dark:bg-[#16120E] max-w-sm w-full space-y-4">
            <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[#FF5A36]">
              Personal Accommodations
            </h3>

            <div className="space-y-3 text-xs font-bold text-[#16120E] dark:text-white">
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
                  className="h-4 w-4 accent-[#FF5A36]"
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
                  className="h-4 w-4 accent-[#FF5A36]"
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
                  className="h-4 w-4 accent-[#FF5A36]"
                />
              </label>
            </div>

            <button
              onClick={() => setAccommodationsOpen(false)}
              className="paper-btn w-full bg-[#14B8A6] text-white py-2 text-xs font-bold"
            >
              Save & Return
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
