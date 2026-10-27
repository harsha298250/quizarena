/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ScoreCalculationParams {
  basePoints: number; // e.g. 1000 standard, 2000 double
  isCorrect: boolean;
  timeLimitSeconds: number; // e.g. 20s
  rawResponseTimeMs: number; // recorded elapsed ms
  latencyMs: number; // measured round-trip / 2
  clockOffsetMs: number; // client to server offset
  currentStreak: number;
  scoringProfile: 'speed_weighted' | 'accuracy_only';
  doublePointsPowerUp?: boolean;
}

export interface ScoreCalculationResult {
  finalPoints: number;
  compensatedResponseTimeMs: number;
  timeBonus: number;
  streakBonus: number;
  newStreak: number;
}

/**
 * Calculates latency-compensated, fair score according to game settings
 */
export function calculateFairScore(params: ScoreCalculationParams): ScoreCalculationResult {
  const {
    basePoints,
    isCorrect,
    timeLimitSeconds,
    rawResponseTimeMs,
    latencyMs,
    currentStreak,
    scoringProfile,
    doublePointsPowerUp = false,
  } = params;

  if (!isCorrect || basePoints === 0) {
    return {
      finalPoints: 0,
      compensatedResponseTimeMs: Math.max(0, rawResponseTimeMs - latencyMs),
      timeBonus: 0,
      streakBonus: 0,
      newStreak: 0,
    };
  }

  // Latency compensation: subtract measured one-way latency from response time
  // Clamped between 150ms (human physiological minimum reaction time) and total time limit ms
  const totalLimitMs = timeLimitSeconds > 0 ? timeLimitSeconds * 1000 : 30000;
  const compensatedTimeMs = Math.max(150, Math.min(totalLimitMs, rawResponseTimeMs - latencyMs));

  const newStreak = currentStreak + 1;
  // Streak bonus: +50 per streak level up to +500 max
  const streakBonus = Math.min(500, (newStreak - 1) * 50);

  let calculatedPoints = basePoints;

  if (scoringProfile === 'speed_weighted' && timeLimitSeconds > 0) {
    // Time factor: from 1.0 (instant answer) down to 0.5 (at the last millisecond)
    const timeFractionRemaining = Math.max(0, (totalLimitMs - compensatedTimeMs) / totalLimitMs);
    const speedMultiplier = 0.5 + 0.5 * timeFractionRemaining;
    const timeBonus = Math.round(basePoints * speedMultiplier);
    calculatedPoints = timeBonus + streakBonus;
  } else {
    // Accuracy-only profile: flat base points + streak bonus
    calculatedPoints = basePoints + streakBonus;
  }

  if (doublePointsPowerUp) {
    calculatedPoints *= 2;
  }

  return {
    finalPoints: Math.round(calculatedPoints),
    compensatedResponseTimeMs: Math.round(compensatedTimeMs),
    timeBonus: scoringProfile === 'speed_weighted' ? Math.round(basePoints * 0.5 * Math.max(0, (totalLimitMs - compensatedTimeMs) / totalLimitMs)) : 0,
    streakBonus,
    newStreak,
  };
}

/**
 * Evaluates whether submitted answer matches correct answer(s)
 */
export function evaluateAnswer(
  type: string,
  selectedIndices: number[],
  correctIndices: number[],
  textAnswer?: string,
  acceptedTextAnswers?: string[]
): boolean {
  if (type === 'poll' || type === 'word_cloud' || type === 'info_slide') {
    return true; // polls/slides are always valid
  }

  if (type === 'type_answer') {
    if (!textAnswer || !acceptedTextAnswers || acceptedTextAnswers.length === 0) {
      return false;
    }
    const cleanSubmission = textAnswer.trim().toLowerCase();
    return acceptedTextAnswers.some(ans => ans.trim().toLowerCase() === cleanSubmission);
  }

  if (type === 'multi_select') {
    if (selectedIndices.length !== correctIndices.length) return false;
    const sortedSel = [...selectedIndices].sort();
    const sortedCor = [...correctIndices].sort();
    return sortedSel.every((val, idx) => val === sortedCor[idx]);
  }

  if (type === 'ordering') {
    // Indices must be in strictly increasing order (0, 1, 2, 3...)
    if (selectedIndices.length !== correctIndices.length) return false;
    return selectedIndices.every((val, idx) => val === idx);
  }

  // Single choice / true_false / image_based
  if (selectedIndices.length === 0) return false;
  return correctIndices.includes(selectedIndices[0]);
}
