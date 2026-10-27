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
      // Spaced repetition: queue missed question to reappear 2 questions later
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
    { bg: 'bg-[#FF5A36]', icon: <ShapeTriangle className="w-6 h-6 text-white" fill="#FFFFFF" /> },
    { bg: 'bg-[#FFC83D]', icon: <ShapeDiamond className="w-6 h-6 text-[#16120E]" fill="#16120E" /> },
    { bg: 'bg-[#14B8A6]', icon: <ShapeCircle className="w-6 h-6 text-white" fill="#FFFFFF" /> },
    { bg: 'bg-[#4DA3FF]', icon: <ShapeSquare className="w-6 h-6 text-white" fill="#FFFFFF" /> },
  ];

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 space-y-6">
      {/* Header Banner */}
      <div className="paper-card p-6 bg-[#FFF6E5] dark:bg-[#16120E] border-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="sticker-badge bg-[#FFC83D] text-[#16120E] text-xs mb-1">
            Async Mastery
          </span>
          <h1 className="font-['Bricolage_Grotesque'] text-2xl sm:text-3xl font-black text-[#16120E] dark:text-white">
            Solo Practice & Spaced Repetition
          </h1>
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mt-1">
            Missed questions automatically return into the deck until 100% concept mastery is attained.
          </p>
        </div>

        {!inSession && (
          <button
            onClick={startPractice}
            className="paper-btn bg-[#FF5A36] text-white px-6 py-3 font-black text-sm shadow-[4px_4px_0px_#16120E]"
          >
            ▶ Start Practice Session
          </button>
        )}
      </div>

      {!inSession ? (
        <div className="paper-card p-6 bg-white dark:bg-[#221c16] space-y-4">
          <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">
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
                className={`p-4 rounded-xl border-2 border-[#16120E] cursor-pointer transition-all ${
                  selectedQuiz.id === q.id
                    ? 'bg-[#FFFAEE] ring-3 ring-[#FF5A36] -translate-y-1'
                    : 'bg-white dark:bg-[#16120E]'
                }`}
              >
                <span className="font-black text-sm text-[#FF5A36] block">{q.title}</span>
                <span className="text-xs text-gray-500 mt-1 block">{q.questions.length} Mastery Cards</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="paper-card p-4 bg-white dark:bg-[#221c16] flex items-center justify-between text-xs font-bold">
            <span>Card {currentIndex + 1} of {deck.length}</span>
            <span className="text-[#14B8A6]">Mastered: {masteredCount}</span>
            <span className="text-[#FF5A36]">In Spaced Review: {retryQueue.length}</span>
          </div>

          {currentQ && (
            <div className="paper-card p-6 sm:p-8 bg-white dark:bg-[#221c16] border-3 space-y-6">
              <span className="sticker-badge bg-[#FFC83D] text-[#16120E] text-[10px]">
                {currentQ.topicTag} • {currentQ.courseOutcomeTag}
              </span>

              <h2 className="font-['Bricolage_Grotesque'] font-black text-xl sm:text-2xl text-[#16120E] dark:text-white">
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
                          ? 'bg-green-100 border-green-700 text-green-900 ring-2 ring-green-600'
                          : isAnswered && isSelected && !isCorrectAnswer
                          ? 'bg-red-100 border-red-700 text-red-900'
                          : 'bg-white dark:bg-[#16120E] text-[#16120E] dark:text-white'
                      }`}
                    >
                      <div className={`p-1.5 rounded-lg border border-[#16120E] ${style.bg} shrink-0`}>
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
                  className={`p-4 rounded-xl border-2 border-[#16120E] space-y-2 animate-fadeIn ${
                    isCorrect ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'
                  }`}
                >
                  <div className="font-black text-sm">
                    {isCorrect ? '✓ Spot on! Card Mastered.' : '⚠️ Misconception Detected. Card will return later in rotation.'}
                  </div>
                  <p className="text-xs">{currentQ.explanation}</p>
                  <button
                    onClick={handleNext}
                    className="paper-btn bg-[#FF5A36] text-white px-5 py-2 text-xs font-bold shadow-[2px_2px_0px_#16120E]"
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
