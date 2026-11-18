/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect } from 'react';
import { getAnswerOptionState, AnswerOptionVisualState } from '../../lib/answerUiState';

export interface WatermarkedQuestionCanvasProps {
  questionText: string;
  options: string[];
  playerNickname: string;
  playerId: string;
  questionIndex: number;
  totalQuestions: number;
  selectedIndices: number[];
  hasSubmitted: boolean;
  isSubmitting?: boolean;
  isLocked: boolean;
  isExpired?: boolean;
  isRevealed?: boolean;
  correctAnswers?: number[];
  hiddenOptions?: number[];
  submissionResult?: { isCorrect: boolean; pointsAwarded: number } | null;
  isAccessibleMode?: boolean;
  dyslexiaFont?: boolean;
  largeText?: boolean;
  onSelectOption: (idx: number) => void;
}

const SHAPES = [
  { symbol: '▲', label: 'Option A', color: '#EF4444', name: 'Triangle' },
  { symbol: '◆', label: 'Option B', color: '#3B82F6', name: 'Diamond' },
  { symbol: '●', label: 'Option C', color: '#EAB308', name: 'Circle' },
  { symbol: '■', label: 'Option D', color: '#10B981', name: 'Square' },
];

export const WatermarkedQuestionCanvas: React.FC<WatermarkedQuestionCanvasProps> = ({
  questionText,
  options,
  playerNickname,
  playerId,
  questionIndex,
  totalQuestions,
  selectedIndices,
  hasSubmitted,
  isSubmitting = false,
  isLocked,
  isExpired = false,
  isRevealed = false,
  correctAnswers = [],
  hiddenOptions = [],
  submissionResult = null,
  isAccessibleMode = false,
  dyslexiaFont = false,
  largeText = false,
  onSelectOption,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Render Question Prompt on Watermarked Canvas (Anti-Scraping & Integrity Shield)
  useEffect(() => {
    if (isAccessibleMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 2;
    const width = 800;

    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const canvasBg = isDark ? '#1C1917' : '#FFFDF8';
    const promptColor = isDark ? '#F5F5F4' : '#16120E';
    const watermarkColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.06)';

    const headingFont = dyslexiaFont
      ? '"OpenDyslexic", "Comic Sans MS", sans-serif'
      : '"Bricolage Grotesque", sans-serif';
    const promptSize = largeText ? 24 : 20;
    const promptLineHeight = largeText ? 34 : 28;

    ctx.font = `800 ${promptSize}px ${headingFont}`;
    const words = (questionText || '').split(' ');
    let currentLine = '';
    const lines: string[] = [];
    const maxWidth = width - 56;

    for (let n = 0; n < words.length; n++) {
      const testLine = currentLine + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        lines.push(currentLine);
        currentLine = words[n] + ' ';
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);

    const calculatedHeight = Math.max(150, 64 + lines.length * promptLineHeight + 20);

    canvas.width = width * dpr;
    canvas.height = calculatedHeight * dpr;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';

    ctx.scale(dpr, dpr);

    // 1. Fill background
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, width, calculatedHeight);

    // 2. Draw Anti-Scraping Security Watermark
    ctx.save();
    ctx.rotate((-20 * Math.PI) / 180);
    ctx.font = '700 13px "Space Mono", monospace';
    ctx.fillStyle = watermarkColor;
    const watermarkText = `${playerNickname} • ${playerId.slice(0, 8)} • QUIZARENA INTEGRITY SHIELD`;

    for (let x = -width; x < width * 2; x += 220) {
      for (let y = -calculatedHeight * 2; y < calculatedHeight * 2; y += 45) {
        ctx.fillText(watermarkText, x, y);
      }
    }
    ctx.restore();

    // 3. Question Index Badge
    ctx.fillStyle = '#FF5A36';
    ctx.font = '900 12px "Space Mono", monospace';
    ctx.fillText(`QUESTION ${questionIndex + 1} OF ${totalQuestions}`, 28, 36);

    // 4. Render Prompt Lines
    ctx.fillStyle = promptColor;
    ctx.font = `800 ${promptSize}px ${headingFont}`;
    let textY = 68;
    for (const l of lines) {
      ctx.fillText(l.trim(), 28, textY);
      textY += promptLineHeight;
    }

    return () => {
      ctx.clearRect(0, 0, width, calculatedHeight);
    };
  }, [
    questionText,
    playerNickname,
    playerId,
    questionIndex,
    totalQuestions,
    isAccessibleMode,
    dyslexiaFont,
    largeText,
  ]);

  // Unified Responsive Option Rendering Helper
  const renderOptionButtons = () => {
    const isSingleColumn = options.length <= 2;
    const gridColsClass = isSingleColumn ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2';

    return (
      <div className={`grid ${gridColsClass} gap-3 w-full`}>
        {options.map((opt, idx) => {
          if (hiddenOptions.includes(idx)) return null;

          const shape = SHAPES[idx % 4];
          const isSelected = selectedIndices.includes(idx);
          const optionState: AnswerOptionVisualState = getAnswerOptionState({
            optionIndex: idx,
            selectedIndices,
            isRevealed,
            correctAnswers,
            hasSubmitted,
            isSubmitting,
            isLocked,
            isExpired,
            isServerConfirmedCorrect: submissionResult?.isCorrect,
          });

          const isInteractive = !isRevealed && !hasSubmitted && !isLocked && !isExpired && !isSubmitting;

          let cardStyle = 'bg-[var(--surface)] border-[var(--border)] text-[var(--text)]';
          let badgeText: string | null = null;
          let badgeClass = '';

          if (optionState === 'CORRECT') {
            cardStyle = 'ring-4 ring-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-600 text-emerald-950 dark:text-emerald-100 shadow-[3px_3px_0px_#059669]';
            badgeText = isSelected ? '✓ Your Answer (Correct)' : '✓ Correct Answer';
            badgeClass = 'bg-emerald-600 text-white';
          } else if (optionState === 'INCORRECT') {
            cardStyle = 'ring-4 ring-rose-500 bg-rose-50 dark:bg-rose-950/40 border-rose-600 text-rose-950 dark:text-rose-100 shadow-[3px_3px_0px_#E11D48]';
            badgeText = '✕ Your Answer';
            badgeClass = 'bg-rose-600 text-white';
          } else if (optionState === 'SUBMITTED') {
            cardStyle = 'ring-4 ring-purple-500 bg-purple-50 dark:bg-purple-950/40 border-purple-600 text-purple-950 dark:text-purple-100 shadow-[3px_3px_0px_#9333EA]';
            badgeText = '🔒 Locked In';
            badgeClass = 'bg-purple-600 text-white';
          } else if (optionState === 'SUBMITTING') {
            cardStyle = 'ring-3 ring-blue-500 bg-blue-50 dark:bg-blue-950/30 border-blue-600 text-blue-950 dark:text-blue-100 shadow-[3px_3px_0px_#2563EB]';
            badgeText = '⏳ Submitting...';
            badgeClass = 'bg-blue-600 text-white';
          } else if (optionState === 'SELECTED') {
            cardStyle = 'ring-4 ring-[var(--accent)] bg-[var(--surface-2)] border-[var(--accent)] text-[var(--text)] shadow-[4px_4px_0px_var(--shadow)]';
            badgeText = '✓ Selected';
            badgeClass = 'bg-[var(--accent)] text-white';
          } else if (optionState === 'EXPIRED') {
            cardStyle = 'opacity-40 bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] cursor-not-allowed';
          }

          return (
            <button
              key={idx}
              type="button"
              onClick={() => isInteractive && onSelectOption(idx)}
              disabled={!isInteractive}
              aria-label={`${shape.label}: ${opt}${badgeText ? ` (${badgeText})` : ''}`}
              className={`paper-btn p-4 rounded-xl text-left border-3 flex items-start gap-3 transition-all min-h-[72px] sm:min-h-[84px] ${
                isInteractive
                  ? 'cursor-pointer hover:scale-[1.01] hover:shadow-[5px_5px_0px_var(--shadow)] active:scale-[0.99]'
                  : 'cursor-default'
              } ${cardStyle}`}
            >
              <span
                className="text-xl sm:text-2xl shrink-0 select-none mt-0.5"
                style={{ color: optionState === 'EXPIRED' ? 'var(--text-muted)' : shape.color }}
              >
                {shape.symbol}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                  <span className="text-xs font-black uppercase text-[var(--text-muted)] tracking-wider">
                    {shape.label}
                  </span>
                  {badgeText && (
                    <span className={`text-[11px] font-black uppercase px-2 py-0.5 rounded-md font-mono-code ${badgeClass}`}>
                      {badgeText}
                    </span>
                  )}
                </div>
                <span
                  className={`font-bold text-sm sm:text-base block break-words leading-snug ${
                    dyslexiaFont ? 'dyslexia-font' : ''
                  } ${largeText ? 'text-lg sm:text-xl' : ''}`}
                >
                  {opt}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  // Fallback Accessible DOM Mode for screen readers & dyslexia accommodations
  if (isAccessibleMode) {
    return (
      <div className="space-y-4 w-full">
        <div className="paper-card p-5 border-3 bg-[var(--surface)] text-center space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-[var(--ok)]">
            <span>♿ Accessible Screen-Reader Mode Active</span>
            <span>Q{questionIndex + 1} / {totalQuestions}</span>
          </div>
          <h1 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
            {questionText}
          </h1>
        </div>

        {renderOptionButtons()}
      </div>
    );
  }

  // Standard Anti-Scraping Mode (Watermarked Question Canvas + Unified DOM Options)
  return (
    <div className="space-y-4 w-full">
      {/* 1. HTML5 Canvas rendering question prompt with security watermark */}
      <div className="relative w-full rounded-2xl overflow-hidden border-3 border-[var(--border)] shadow-[4px_4px_0px_var(--shadow)] bg-[var(--bg-page)]">
        <canvas ref={canvasRef} className="block w-full pointer-events-none select-none" />
      </div>

      {/* 2. Unified Responsive Answer Options Grid */}
      {renderOptionButtons()}
    </div>
  );
};
