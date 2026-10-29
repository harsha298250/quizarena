/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const MAX_ALLOWED_LATENCY_MS = 300;

/**
 * Clamps client-reported latency to [0, MAX_ALLOWED_LATENCY_MS].
 * Prevents players from forging high latencies to artificially inflate speed-weighted scores.
 */
export function clampLatency(latencyMs: unknown, maxAllowed: number = MAX_ALLOWED_LATENCY_MS): number {
  const num = typeof latencyMs === 'number' ? latencyMs : Number(latencyMs);
  if (isNaN(num) || num < 0) {
    return 50; // Default conservative latency
  }
  return Math.min(num, maxAllowed);
}

/**
 * In-memory sliding-window rate limiter
 */
export interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private map = new Map<string, RateLimitRecord>();

  public check(
    clientKey: string,
    maxRequests: number,
    windowMs: number,
    now: number = Date.now()
  ): { allowed: boolean; retryAfterSec?: number } {
    const record = this.map.get(clientKey);

    if (!record || now > record.resetAt) {
      this.map.set(clientKey, { count: 1, resetAt: now + windowMs });
      return { allowed: true };
    }

    if (record.count >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      return { allowed: false, retryAfterSec };
    }

    record.count += 1;
    return { allowed: true };
  }

  public reset(clientKey?: string) {
    if (clientKey) {
      this.map.delete(clientKey);
    } else {
      this.map.clear();
    }
  }
}

export const globalRateLimiter = new RateLimiter();

/**
 * Extracts and normalizes server-set question start time into epoch milliseconds.
 * Supports Firestore Timestamps (.toMillis(), ._seconds), numbers, and ISO strings.
 */
export function extractQuestionStartTimeMs(questionStartTime: unknown): number {
  if (!questionStartTime) return 0;

  // Firestore Timestamp with toMillis()
  if (typeof (questionStartTime as any).toMillis === 'function') {
    return (questionStartTime as any).toMillis();
  }

  // Firestore internal format {_seconds, _nanoseconds}
  if (typeof (questionStartTime as any)._seconds === 'number') {
    return (questionStartTime as any)._seconds * 1000;
  }

  // Plain millisecond number
  if (typeof questionStartTime === 'number') {
    return questionStartTime;
  }

  // ISO string
  if (typeof questionStartTime === 'string') {
    const parsed = new Date(questionStartTime).getTime();
    return isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

/**
 * Validates player eligibility to answer:
 * Player document must exist and player must not be kicked/removed.
 */
export function validatePlayerEligibility(
  playerDocExists: boolean,
  playerData: any
): { eligible: boolean; error?: string; statusCode: number } {
  if (!playerDocExists || !playerData) {
    return {
      eligible: false,
      error: 'Player does not exist in this game session. Please join the lobby first.',
      statusCode: 403,
    };
  }

  if (playerData.isKicked === true || playerData.status === 'kicked') {
    return {
      eligible: false,
      error: 'Player has been removed or kicked from this game session.',
      statusCode: 403,
    };
  }

  return { eligible: true, statusCode: 200 };
}

/**
 * Validates and tracks single-use power-ups per player on the server.
 */
export function validateAndTrackPowerUp(
  playerData: any,
  powerUpName: 'doublePoints' | 'fiftyFifty' | 'timeFreeze' | undefined
): { allowed: boolean; error?: string; willUse: boolean } {
  if (!powerUpName) {
    return { allowed: true, willUse: false };
  }

  const alreadyUsed = Boolean(
    playerData?.powerUps?.[`${powerUpName}Used`] ||
    playerData?.usedPowerUps?.[powerUpName]
  );

  if (alreadyUsed) {
    return {
      allowed: false,
      error: `Power-up "${powerUpName}" has already been used in this game session. Each power-up can only be used once.`,
      willUse: false,
    };
  }

  return { allowed: true, willUse: true };
}

/**
 * Server-side Detection for implausibly fast responses or uniform timing patterns.
 */
export interface TimingAnomalyResult {
  isAnomaly: boolean;
  type?: 'suspicious_timing' | 'uniform_timing';
  reason?: string;
  severity?: 'medium' | 'high';
}

export class TimingAnomalyDetector {
  private playerTimingHistory = new Map<string, number[]>();

  public recordAndCheck(
    playerId: string,
    responseTimeMs: number
  ): TimingAnomalyResult {
    // 1. Implausibly fast response check: < 300ms is sub-human cognitive reaction + reading speed
    if (responseTimeMs < 300 && responseTimeMs >= 0) {
      return {
        isAnomaly: true,
        type: 'suspicious_timing',
        reason: `Implausibly fast response time (${responseTimeMs}ms) detected. Sub-human cognitive threshold is 300ms.`,
        severity: 'high',
      };
    }

    // 2. Uniform timing check across questions (e.g. automated bot script)
    let history = this.playerTimingHistory.get(playerId);
    if (!history) {
      history = [];
      this.playerTimingHistory.set(playerId, history);
    }
    history.push(responseTimeMs);
    if (history.length > 6) {
      history.shift();
    }

    if (history.length >= 3) {
      const avg = history.reduce((sum, v) => sum + v, 0) / history.length;
      const variance = history.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / history.length;
      const stdDev = Math.sqrt(variance);

      // Bot script or macro with tight uniform timing (< 25ms standard deviation)
      if (stdDev < 25) {
        return {
          isAnomaly: true,
          type: 'uniform_timing',
          reason: `Implausibly uniform response timing across ${history.length} questions (std dev ${stdDev.toFixed(1)}ms).`,
          severity: 'medium',
        };
      }
    }

    return { isAnomaly: false };
  }

  public reset(playerId?: string) {
    if (playerId) {
      this.playerTimingHistory.delete(playerId);
    } else {
      this.playerTimingHistory.clear();
    }
  }
}

export const globalTimingAnomalyDetector = new TimingAnomalyDetector();
