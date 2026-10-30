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

    // 4. Render Question Prompt (Word Wrapped)
    ctx.fillStyle = '#16120E';
    ctx.font = '800 20px "Bricolage Grotesque", sans-serif';

    const words = questionText.split(' ');
    let line = '';
    let y = 72;
    const maxWidth = width - 56;
    const lineHeight = 28;

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line, 28, y);
        line = words[n] + ' ';
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, 28, y);

    // 5. Draw 4 Options in 2x2 Grid onto Canvas
    const gridCols = 2;
    const boxW = (width - 70) / 2;
    const boxH = 125;
    const startY = Math.max(160, y + 36);

    options.forEach((optText, idx) => {
      if (hiddenOptions.includes(idx)) return;

      const col = idx % gridCols;
      const row = Math.floor(idx / gridCols);
      const bx = 28 + col * (boxW + 14);
      const by = startY + row * (boxH + 14);
      const shape = SHAPES[idx % 4];
      const isSelected = selectedIndices.includes(idx);

      // Card Background
      ctx.fillStyle = isSelected ? '#F3E8FF' : '#FFFFFF';
      ctx.strokeStyle = isSelected ? '#8B5CF6' : '#16120E';
      ctx.lineWidth = isSelected ? 3 : 2;

      // Rounded rectangle
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 12);
      ctx.fill();
      ctx.stroke();

      // Shape icon & label
      ctx.fillStyle = shape.color;
      ctx.font = '900 16px sans-serif';
      ctx.fillText(`${shape.symbol} ${shape.label}`, bx + 14, by + 26);

      // Option text wrapped inside card
      ctx.fillStyle = '#16120E';
      ctx.font = '700 14px "DM Sans", sans-serif';
      const optWords = optText.split(' ');
      let oLine = '';
      let oy = by + 52;
      const oMaxWidth = boxW - 28;
      const oLineHeight = 20;

      for (let m = 0; m < optWords.length; m++) {
        const testOLine = oLine + optWords[m] + ' ';
        const metrics = ctx.measureText(testOLine);
        if (metrics.width > oMaxWidth && m > 0) {
          ctx.fillText(oLine, bx + 14, oy);
          oLine = optWords[m] + ' ';
          oy += oLineHeight;
          if (oy > by + boxH - 12) break; // prevent overflowing box
        } else {
          oLine = testOLine;
        }
      }
      if (oy <= by + boxH - 8) {
        ctx.fillText(oLine, bx + 14, oy);
      }

      // Selected Checkmark
      if (isSelected) {
        ctx.fillStyle = '#8B5CF6';
        ctx.font = '900 14px sans-serif';
        ctx.fillText('✓ LOCKED IN', bx + boxW - 100, by + 26);
      }
    });
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
  return (
    <div className="relative w-full rounded-2xl overflow-hidden border-3 border-[var(--border)] shadow-[4px_4px_0px_var(--shadow)] bg-[#FFFDF8]">
      {/* 1. HTML5 Canvas rendering question & options with security watermark */}
      <canvas ref={canvasRef} className="block w-full pointer-events-none select-none" />

      {/* 2. Transparent interactive click hitbox grid overlaid onto the 4 quadrants */}
      <div className="absolute inset-x-0 bottom-0 top-[35%] grid grid-cols-2 gap-2 p-3 sm:p-5">
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
              aria-label={`${shape.label} (${shape.name})`}
              title={shape.label}
              className={`w-full h-full rounded-xl transition-all cursor-pointer border-2 border-transparent ${
                isSelected
                  ? 'bg-purple-500/10 ring-2 ring-purple-600'
                  : 'hover:bg-black/5 active:bg-black/10'
              } disabled:cursor-not-allowed`}
            >
              {/* Screen reader only label (No visible prompt text in DOM) */}
              <span className="sr-only">{shape.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
