/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect } from 'react';
import { getAnswerOptionState, AnswerOptionVisualState } from '../../lib/answerUiState';

interface WatermarkedQuestionCanvasProps {
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
  isAccessibleMode = false,
  dyslexiaFont = false,
  largeText = false,
  onSelectOption,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Render on Canvas when not in accessible mode
  useEffect(() => {
    if (isAccessibleMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Retina display scaling
    const dpr = window.devicePixelRatio || 2;
    const width = 800;
    const height = 480;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';

    ctx.scale(dpr, dpr);

    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const canvasBg = isDark ? '#1C1917' : '#FFFDF8';
    const promptColor = isDark ? '#F5F5F4' : '#16120E';
    const cardBg = isDark ? '#292524' : '#FFFFFF';
    const cardBorder = isDark ? '#44403C' : '#16120E';
    const textColor = isDark ? '#F5F5F4' : '#16120E';
    const watermarkColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.07)';

    // 1. Clear background
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, width, height);

    if (!questionText) {
      return;
    }

    // Dynamic typography inside canvas based on accommodations
    const headingFont = dyslexiaFont
      ? '"OpenDyslexic", "Comic Sans MS", sans-serif'
      : '"Bricolage Grotesque", sans-serif';
    const bodyFont = dyslexiaFont
      ? '"OpenDyslexic", "Comic Sans MS", sans-serif'
      : '"DM Sans", sans-serif';
    const promptSize = largeText ? 23 : 20;
    const optionSize = largeText ? 16 : 14;
    const promptLineHeight = largeText ? 32 : 28;
    const optionLineHeight = largeText ? 22 : 20;

    // 2. Draw Security Watermark across the entire canvas
    ctx.save();
    ctx.rotate((-25 * Math.PI) / 180);
    ctx.font = '700 13px "Space Mono", monospace';
    ctx.fillStyle = watermarkColor;
    const watermarkText = `${playerNickname} • ${playerId.slice(0, 8)} • QUIZARENA INTEGRITY SHIELD`;

    for (let x = -width; x < width * 2; x += 220) {
      for (let y = -height; y < height * 2; y += 45) {
        ctx.fillText(watermarkText, x, y);
      }
    }
    ctx.restore();

    // 3. Question Index Badge
    ctx.fillStyle = '#FF5A36';
    ctx.font = '900 12px "Space Mono", monospace';
    ctx.fillText(`QUESTION ${questionIndex + 1} OF ${totalQuestions}`, 28, 40);

    // 4. Render Question Prompt (Word Wrapped)
    ctx.fillStyle = promptColor;
    ctx.font = `800 ${promptSize}px ${headingFont}`;

    const words = questionText.split(' ');
    let line = '';
    let y = 72;
    const maxWidth = width - 56;

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line, 28, y);
        line = words[n] + ' ';
        y += promptLineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, 28, y);

    // 5. Draw 2, 3 or 4 Options in Responsive Grid onto Canvas
    const numOptions = options.length;
    const gridCols = numOptions <= 2 ? 1 : 2;
    const boxW = numOptions <= 2 ? (width - 56) : (width - 70) / 2;
    const boxH = numOptions <= 2 ? 95 : 125;
    const startY = Math.max(160, y + 36);

    options.forEach((optText, idx) => {
      if (hiddenOptions.includes(idx)) return;

      const col = idx % gridCols;
      const row = Math.floor(idx / gridCols);
      const bx = 28 + col * (boxW + 14);
      const by = startY + row * (boxH + 14);
      const shape = SHAPES[idx % 4];

      const optionState: AnswerOptionVisualState = getAnswerOptionState({
        optionIndex: idx,
        selectedIndices,
        isRevealed,
        correctAnswers,
        hasSubmitted,
        isSubmitting,
        isLocked,
        isExpired,
      });

      // Card Background (exact bounds, inside border)
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 12);
      ctx.clip();

      if (optionState === 'CORRECT') {
        ctx.fillStyle = isDark ? '#064E3B' : '#DCFCE7';
        ctx.fillRect(bx, by, boxW, boxH);
      } else if (optionState === 'INCORRECT') {
        ctx.fillStyle = isDark ? '#4C0519' : '#FFE4E6';
        ctx.fillRect(bx, by, boxW, boxH);
      } else if (optionState === 'SELECTED' || optionState === 'SUBMITTED') {
        ctx.fillStyle = isDark ? '#3B1F6E' : '#F5F3FF';
        ctx.fillRect(bx, by, boxW, boxH);
        ctx.fillStyle = 'rgba(124, 58, 237, 0.12)';
        ctx.fillRect(bx, by, boxW, boxH);
      } else if (optionState === 'SUBMITTING') {
        ctx.fillStyle = isDark ? '#1E3A8A' : '#EFF6FF';
        ctx.fillRect(bx, by, boxW, boxH);
      } else if (optionState === 'EXPIRED') {
        ctx.fillStyle = isDark ? '#1F1D1A' : '#F5F4F0';
        ctx.fillRect(bx, by, boxW, boxH);
      } else {
        ctx.fillStyle = cardBg;
        ctx.fillRect(bx, by, boxW, boxH);
      }

      ctx.restore();

      // Card Border & Status Highlighting
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 12);

      let strokeColor = cardBorder;
      let strokeWidth = 2;
      let badgeText: string | null = null;
      let badgeColor = '#A855F7';

      if (optionState === 'CORRECT') {
        strokeColor = '#10B981';
        strokeWidth = 3;
        badgeText = '✓ Correct Answer';
        badgeColor = '#10B981';
      } else if (optionState === 'INCORRECT') {
        strokeColor = '#EF4444';
        strokeWidth = 3;
        badgeText = '✕ Your Answer';
        badgeColor = '#EF4444';
      } else if (optionState === 'SUBMITTED') {
        strokeColor = '#A855F7';
        strokeWidth = 3;
        badgeText = '🔒 Locked In';
        badgeColor = '#A855F7';
      } else if (optionState === 'SUBMITTING') {
        strokeColor = '#3B82F6';
        strokeWidth = 2.5;
        badgeText = '⏳ Submitting...';
        badgeColor = '#3B82F6';
      } else if (optionState === 'SELECTED') {
        strokeColor = '#A855F7';
        strokeWidth = 3;
        badgeText = '✓ Selected';
        badgeColor = '#A855F7';
      } else if (optionState === 'EXPIRED') {
        strokeColor = isDark ? '#3A3835' : '#D1D0CA';
        strokeWidth = 1.5;
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();

      // Shape icon & label
      ctx.fillStyle = optionState === 'EXPIRED' ? '#888888' : shape.color;
      ctx.font = '900 15px sans-serif';
      ctx.fillText(`${shape.symbol} ${shape.label}`, bx + 14, by + 26);

      // State badge in top-right corner inside card
      if (badgeText) {
        ctx.save();
        ctx.fillStyle = badgeColor;
        ctx.font = '900 12px "Space Mono", monospace';
        const metrics = ctx.measureText(badgeText);
        ctx.fillText(badgeText, bx + boxW - metrics.width - 14, by + 25);
        ctx.restore();
      }

      // Option text wrapped inside card
      ctx.fillStyle = optionState === 'EXPIRED' ? (isDark ? '#78716C' : '#A8A29E') : textColor;
      ctx.font = `700 ${optionSize}px ${bodyFont}`;
      const optWords = optText.split(' ');
      let oLine = '';
      let oy = by + 52;
      const oMaxWidth = boxW - 28;

      for (let m = 0; m < optWords.length; m++) {
        const testOLine = oLine + optWords[m] + ' ';
        const metrics = ctx.measureText(testOLine);
        if (metrics.width > oMaxWidth && m > 0) {
          ctx.fillText(oLine, bx + 14, oy);
          oLine = optWords[m] + ' ';
          oy += optionLineHeight;
          if (oy > by + boxH - 12) break;
        } else {
          oLine = testOLine;
        }
      }
      if (oy <= by + boxH - 8) {
        ctx.fillText(oLine, bx + 14, oy);
      }
    });

    return () => {
      ctx.clearRect(0, 0, width, height);
    };
  }, [
    questionText,
    options,
    playerNickname,
    playerId,
    questionIndex,
    totalQuestions,
    selectedIndices,
    hasSubmitted,
    isSubmitting,
    isLocked,
    isExpired,
    isRevealed,
    correctAnswers,
    hiddenOptions,
    isAccessibleMode,
    dyslexiaFont,
    largeText,
  ]);

  // Fallback Accessible DOM Mode for screen readers & dyslexia accommodations
  if (isAccessibleMode) {
    return (
      <div className="space-y-4">
        <div className="paper-card p-5 border-3 bg-[var(--surface)] text-center space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-[var(--ok)]">
            <span>♿ Accessible Screen-Reader Mode Active</span>
            <span>Q{questionIndex + 1} / {totalQuestions}</span>
          </div>
          <h1 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
            {questionText}
          </h1>
        </div>

        <div className={`grid ${options.length <= 2 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'} gap-3`}>
          {options.map((opt, idx) => {
            if (hiddenOptions.includes(idx)) return null;
            const shape = SHAPES[idx % 4];
            const optionState = getAnswerOptionState({
              optionIndex: idx,
              selectedIndices,
              isRevealed,
              correctAnswers,
              hasSubmitted,
              isSubmitting,
              isLocked,
              isExpired,
            });

            const isInteractive = !isRevealed && !hasSubmitted && !isLocked && !isExpired && !isSubmitting;

            let cardStyle = 'bg-[var(--surface)] border-[var(--border)]';
            let badgeText: string | null = null;
            let badgeClass = '';

            if (optionState === 'CORRECT') {
              cardStyle = 'ring-4 ring-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-600';
              badgeText = '✓ Correct Answer';
              badgeClass = 'bg-emerald-600 text-white';
            } else if (optionState === 'INCORRECT') {
              cardStyle = 'ring-4 ring-rose-500 bg-rose-50 dark:bg-rose-950/40 border-rose-600';
              badgeText = '✕ Your Answer';
              badgeClass = 'bg-rose-600 text-white';
            } else if (optionState === 'SUBMITTED') {
              cardStyle = 'ring-4 ring-purple-500 bg-purple-50 dark:bg-purple-950/40 border-purple-600';
              badgeText = '🔒 Locked In';
              badgeClass = 'bg-purple-600 text-white';
            } else if (optionState === 'SUBMITTING') {
              cardStyle = 'ring-3 ring-blue-500 bg-blue-50 dark:bg-blue-950/30 border-blue-600';
              badgeText = '⏳ Submitting...';
              badgeClass = 'bg-blue-600 text-white';
            } else if (optionState === 'SELECTED') {
              cardStyle = 'ring-4 ring-[var(--accent)] bg-[var(--surface-2)] border-[var(--accent)]';
              badgeText = '✓ Selected';
              badgeClass = 'bg-[var(--accent)] text-white';
            } else if (optionState === 'EXPIRED') {
              cardStyle = 'opacity-50 bg-[var(--surface)] border-[var(--border)]';
            }

            return (
              <button
                key={idx}
                type="button"
                onClick={() => isInteractive && onSelectOption(idx)}
                disabled={!isInteractive}
                aria-label={`${shape.label}: ${opt}${badgeText ? ` (${badgeText})` : ''}`}
                className={`paper-btn p-4 rounded-xl text-left border-3 flex items-start gap-3 transition-all ${
                  isInteractive ? 'cursor-pointer hover:scale-[1.01]' : 'cursor-default'
                } ${cardStyle}`}
              >
                <span className="text-xl shrink-0" style={{ color: shape.color }}>
                  {shape.symbol}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-black uppercase text-[var(--text-muted)] block">
                      {shape.label}
                    </span>
                    {badgeText && (
                      <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${badgeClass}`}>
                        {badgeText}
                      </span>
                    )}
                  </div>
                  <span className="font-bold text-sm text-[var(--text)] block break-words">{opt}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Anti-Scraping Canvas Mode with Transparent Hitbox Buttons
  const numOptions = options.length;
  const gridLayoutClass = numOptions <= 2 ? 'grid-cols-1' : 'grid-cols-2';

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border-3 border-[var(--border)] shadow-[4px_4px_0px_var(--shadow)] bg-[var(--bg-page)]">
      {/* 1. HTML5 Canvas rendering question & options with security watermark (Zero DOM Text) */}
      <canvas ref={canvasRef} className="block w-full pointer-events-none select-none" />

      {/* 2. Transparent interactive click hitbox grid matching the canvas option bounds */}
      <div className={`absolute inset-x-0 bottom-0 top-[35%] grid ${gridLayoutClass} gap-2 p-3 sm:p-5`}>
        {options.map((_, idx) => {
          if (hiddenOptions.includes(idx)) {
            return <div key={idx} className="pointer-events-none" />;
          }
          const shape = SHAPES[idx % 4];
          const isInteractive = !isRevealed && !hasSubmitted && !isLocked && !isExpired && !isSubmitting;
          const isSelected = selectedIndices.includes(idx);

          return (
            <button
              key={idx}
              type="button"
              onClick={() => isInteractive && onSelectOption(idx)}
              disabled={!isInteractive}
              aria-label={`${shape.label}${isSelected ? ' (Selected)' : ''}${isRevealed ? (correctAnswers.includes(idx) ? ' (Correct)' : ' (Incorrect)') : ''}`}
              className={`w-full h-full rounded-xl transition-all focus:outline-none focus:ring-4 focus:ring-[var(--accent)] ${
                isInteractive
                  ? 'cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.99]'
                  : 'cursor-default'
              } ${
                isSelected && !isRevealed
                  ? 'border-2 border-[var(--accent)]/50'
                  : 'border-2 border-transparent'
              }`}
            >
              <span className="sr-only">{shape.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
