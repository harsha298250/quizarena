/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect } from 'react';

interface WatermarkedQuestionCanvasProps {
  questionText: string;
  options: string[];
  playerNickname: string;
  playerId: string;
  questionIndex: number;
  totalQuestions: number;
  selectedIndices: number[];
  hasSubmitted: boolean;
  isLocked: boolean;
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
  isLocked,
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

    // 1. Clear background
    ctx.fillStyle = '#FFFDF8'; // Soft paper page background
    ctx.fillRect(0, 0, width, height);

    // If no question text or ended, canvas stays cleared
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

    // 2. Draw Diagonal Security Watermark across the entire canvas
    ctx.save();
    ctx.rotate((-25 * Math.PI) / 180);
    ctx.font = '700 13px "Space Mono", monospace';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.07)';
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

    // 4. Render Question Prompt (Word Wrapped) with dyslexia/large text accommodation
    ctx.fillStyle = '#16120E';
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
      const isSelected = selectedIndices.includes(idx);

      // Card Background (exact bounds, inside border)
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 12);
      ctx.clip(); // Ensure all fills/highlights stay strictly within bounds

      ctx.fillStyle = isSelected ? '#F5F3FF' : '#FFFFFF';
      ctx.fillRect(bx, by, boxW, boxH);

      // Selected subtle inner wash
      if (isSelected) {
        ctx.fillStyle = 'rgba(124, 58, 237, 0.08)';
        ctx.fillRect(bx, by, boxW, boxH);
      }

      ctx.restore();

      // Card Border
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 12);
      ctx.strokeStyle = isSelected ? '#7C3AED' : '#16120E';
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.stroke();

      // Shape icon & label
      ctx.fillStyle = shape.color;
      ctx.font = '900 15px sans-serif';
      ctx.fillText(`${shape.symbol} ${shape.label}`, bx + 14, by + 26);

      // Selected Checkmark & "Locked in" badge DRAWN INSIDE CARD without clipping
      if (isSelected) {
        ctx.save();
        ctx.fillStyle = '#7C3AED';
        ctx.font = '900 12px "Space Mono", monospace';
        const lockText = '✓ Locked in';
        const metrics = ctx.measureText(lockText);
        // Draw cleanly in top-right corner inside card
        ctx.fillText(lockText, bx + boxW - metrics.width - 14, by + 25);
        ctx.restore();
      }

      // Option text wrapped inside card with dyslexia/largeText inside canvas
      ctx.fillStyle = '#16120E';
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
          if (oy > by + boxH - 12) break; // prevent overflowing box
        } else {
          oLine = testOLine;
        }
      }
      if (oy <= by + boxH - 8) {
        ctx.fillText(oLine, bx + 14, oy);
      }
    });

    // Cleanup: clear canvas when component unmounts or question changes
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
            const isSelected = selectedIndices.includes(idx);
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectOption(idx)}
                disabled={hasSubmitted || isLocked}
                aria-label={`${shape.label}: ${opt}`}
                className={`paper-btn p-4 rounded-xl text-left border-3 flex items-start gap-3 transition-all ${
                  isSelected ? 'ring-4 ring-[var(--accent)] bg-[var(--surface-2)]' : 'bg-[var(--surface)]'
                }`}
              >
                <span className="text-xl" style={{ color: shape.color }}>
                  {shape.symbol}
                </span>
                <div className="flex-1">
                  <span className="text-xs font-black uppercase text-[var(--text-muted)] block">
                    {shape.label}
                  </span>
                  <span className="font-bold text-sm text-[var(--text)]">{opt}</span>
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
    <div className="relative w-full rounded-2xl overflow-hidden border-3 border-[var(--border)] shadow-[4px_4px_0px_var(--shadow)] bg-[#FFFDF8]">
      {/* 1. HTML5 Canvas rendering question & options with security watermark (Zero DOM Text) */}
      <canvas ref={canvasRef} className="block w-full pointer-events-none select-none" />

      {/* 2. Transparent interactive click hitbox grid matching the canvas option bounds exactly */}
      <div className={`absolute inset-x-0 bottom-0 top-[35%] grid ${gridLayoutClass} gap-2 p-3 sm:p-5`}>
        {options.map((_, idx) => {
          if (hiddenOptions.includes(idx)) {
            return <div key={idx} className="pointer-events-none" />;
          }
          const shape = SHAPES[idx % 4];
          const isSelected = selectedIndices.includes(idx);

          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectOption(idx)}
              disabled={hasSubmitted || isLocked}
              aria-label={shape.label}
              className={`w-full h-full rounded-xl transition-all cursor-pointer border-2 border-transparent ${
                isSelected
                  ? 'bg-purple-600/5'
                  : 'hover:bg-black/5 active:bg-black/10'
              } disabled:cursor-not-allowed`}
            >
              {/* Screen reader only label - generic only without prompt text */}
              <span className="sr-only">{shape.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
