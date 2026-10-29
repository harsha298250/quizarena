/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Quiz, Question } from '../../types/quiz';
import { sound } from '../../lib/sound';
import { ShapeTriangle, ShapeDiamond, ShapeCircle, ShapeSquare } from '../common/CustomIcons';

interface SoloPracticeProps {
  quizzes: Quiz[];
}

export const SoloPractice: React.FC<SoloPracticeProps> = ({ quizzes }) => {
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz>(quizzes[0]);
  const [inSession, setInSession] = useState<boolean>(false);
  const [deck, setDeck] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState<boolean>(false);
  const [isCorrect, setIsCorrect] = useState<boolean>(false);
  const [masteredCount, setMasteredCount] = useState<number>(0);
  const [retryQueue, setRetryQueue] = useState<Question[]>([]);

  const startPractice = () => {
    sound.playClick();
    setDeck([...selectedQuiz.questions]);
    setCurrentIndex(0);
    setSelectedOption(null);
    setIsAnswered(false);
    setMasteredCount(0);
    setRetryQueue([]);
    setInSession(true);
  };

  const handleSelectOption = (idx: number) => {
    if (isAnswered) return;
    const currentQ = deck[currentIndex];
    setSelectedOption(idx);
    setIsAnswered(true);

    const correct = currentQ.correctAnswers.includes(idx);
    setIsCorrect(correct);

    if (correct) {
      sound.playCorrect();
      setMasteredCount(prev => prev + 1);
    } else {
      sound.playWrong();
      // Spaced repetition: queue missed question to reappear in next round
      setRetryQueue(prev => [...prev, currentQ]);
    }
  };

  const handleNext = () => {
    sound.playClick();
    setSelectedOption(null);
    setIsAnswered(false);

    if (currentIndex + 1 < deck.length) {
      setCurrentIndex(prev => prev + 1);
    } else if (retryQueue.length > 0) {
      // Re-introduce missed questions in repetition round
      setDeck([...retryQueue]);
      setRetryQueue([]);
      setCurrentIndex(0);
    } else {
      // All mastered
      setInSession(false);
      sound.playPodium();
    }
  };

  const currentQ = deck[currentIndex];

  const optionButtons = [
    { bg: 'bg-[var(--accent)] text-[var(--text-on-accent)]', icon: <ShapeTriangle className="w-6 h-6 text-[var(--text-on-accent)]" fill="currentColor" /> },
    { bg: 'bg-[var(--accent-2-bg)] text-[#16120E]', icon: <ShapeDiamond className="w-6 h-6 text-[var(--text-on-accent-2)]" fill="currentColor" /> },
    { bg: 'bg-[var(--ok)] text-[var(--text-on-accent)]', icon: <ShapeCircle className="w-6 h-6 text-[var(--text-on-accent)]" fill="currentColor" /> },
    { bg: 'bg-[var(--info)] text-[var(--text-on-accent)]', icon: <ShapeSquare className="w-6 h-6 text-[var(--text-on-accent)]" fill="currentColor" /> },
  ];

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 space-y-6">
      {/* Header Banner */}
      <div className="paper-card p-6 border-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="sticker-badge sticker-badge-sunshine text-xs mb-1">
            Async Mastery
          </span>
          <h1 className="font-['Bricolage_Grotesque'] text-2xl sm:text-3xl font-black text-[var(--text)]">
            Solo Practice &amp; Spaced Repetition
          </h1>
          <p className="text-xs font-semibold text-[var(--text-muted)] mt-1">
            Missed questions automatically return into the deck until 100% concept mastery is attained.
          </p>
        </div>

        {!inSession && (
          <button
            onClick={startPractice}
            className="paper-btn paper-btn-primary px-6 py-3 font-black text-sm shadow-[4px_4px_0px_var(--shadow)]"
          >
            ▶ Start Practice Session
          </button>
        )}
      </div>

      {!inSession ? (
        <div className="paper-card p-6 space-y-4">
          <label className="text-xs font-bold uppercase text-[var(--text)]">
            Select Practice Deck:
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {quizzes.map(q => (
              <div
                key={q.id}
                onClick={() => {
                  sound.playClick();
                  setSelectedQuiz(q);
                }}
                className={`p-4 rounded-xl border-2 border-[var(--border)] cursor-pointer transition-all ${
                  selectedQuiz.id === q.id
                    ? 'bg-[var(--surface-2)] ring-3 ring-[var(--accent)] -translate-y-1'
                    : 'bg-[var(--surface)] text-[var(--text)]'
                }`}
              >
                <span className="font-black text-sm text-[var(--accent)] block">{q.title}</span>
                <span className="text-xs text-[var(--text-muted)] mt-1 block font-semibold">{q.questions.length} Mastery Cards</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="paper-card p-4 flex items-center justify-between text-xs font-bold text-[var(--text)]">
            <span>Card {currentIndex + 1} of {deck.length}</span>
            <span className="text-[var(--ok)] dark:text-[var(--accent-2)]">Mastered: {masteredCount}</span>
            <span className="text-[var(--accent)]">In Spaced Review: {retryQueue.length}</span>
          </div>

          {currentQ && (
            <div className="paper-card p-6 sm:p-8 border-3 space-y-6">
              <span className="sticker-badge sticker-badge-sunshine text-[10px]">
                {currentQ.topicTag} • {currentQ.courseOutcomeTag}
              </span>

              <h2 className="font-['Bricolage_Grotesque'] font-black text-xl sm:text-2xl text-[var(--text)]">
                {currentQ.text}
              </h2>

              {/* Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {currentQ.options.map((opt, idx) => {
                  const style = optionButtons[idx % 4];
                  const isSelected = selectedOption === idx;
                  const isCorrectAnswer = currentQ.correctAnswers.includes(idx);

                  return (
                    <button
                      key={idx}
                      onClick={() => handleSelectOption(idx)}
                      disabled={isAnswered}
                      className={`paper-btn p-4 rounded-xl flex items-center gap-3 text-left transition-all ${
                        isAnswered && isCorrectAnswer
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 border-emerald-700 text-emerald-900 dark:text-emerald-100 ring-2 ring-emerald-600'
                          : isAnswered && isSelected && !isCorrectAnswer
                          ? 'bg-red-100 dark:bg-red-950/60 border-red-700 text-red-900 dark:text-red-100'
                          : 'bg-[var(--surface)] text-[var(--text)]'
                      }`}
                    >
                      <div className={`p-1.5 rounded-lg border border-[var(--border)] ${style.bg} shrink-0`}>
                        {style.icon}
                      </div>
                      <span className="font-bold text-sm leading-snug">{opt}</span>
                    </button>
                  );
                })}
              </div>

              {/* Reveal explanation */}
              {isAnswered && (
                <div
                  className={`p-4 rounded-xl border-2 border-[var(--border)] space-y-2 animate-fadeIn ${
                    isCorrect ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100' : 'bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-100'
                  }`}
                >
                  <div className="font-black text-sm">
                    {isCorrect ? '✓ Spot on! Card Mastered.' : '⚠️ Misconception Detected. Card will return later in rotation.'}
                  </div>
                  <p className="text-xs">{currentQ.explanation}</p>
                  <button
                    onClick={handleNext}
                    className="paper-btn paper-btn-primary px-5 py-2 text-xs font-bold shadow-[2px_2px_0px_var(--shadow)]"
                  >
                    Next Card ➔
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
