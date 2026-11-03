/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Unified Shared Rate Limiter for all Server Endpoints
 */

export interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSec?: number;
  remaining?: number;
}

export class SharedRateLimiter {
  private map = new Map<string, RateLimitRecord>();

  /**
   * Universal check method for sliding / fixed window rate limiting.
   */
  public check(
    key: string,
    maxRequests: number,
    windowMs: number,
    now: number = Date.now()
  ): RateLimitCheckResult {
    const record = this.map.get(key);

    if (!record || now >= record.resetAt) {
      this.map.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: maxRequests - 1 };
    }

    if (record.count >= maxRequests) {
      const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
      return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec), remaining: 0 };
    }

    record.count++;
    return { allowed: true, remaining: maxRequests - record.count };
  }

  public reset(key?: string): void {
    if (key) {
      this.map.delete(key);
    } else {
      this.map.clear();
    }
  }
}

export const sharedRateLimiter = new SharedRateLimiter();

// Shared endpoint-specific rate limit checkers
export function checkWarmupRateLimit(clientKey: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 10 warmups per minute per client
  return sharedRateLimiter.check(`warmup_${clientKey}`, 10, 60 * 1000, now);
}

export function checkGenerateQuizRateLimit(uid: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 10 generations per minute per authenticated teacher
  return sharedRateLimiter.check(`gen_${uid}`, 10, 60 * 1000, now);
}

export function checkAnonymousGenerateQuizRateLimit(uid: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 5 generations per 10 minutes per anonymous/guest user
  return sharedRateLimiter.check(`gen_anon_${uid}`, 5, 10 * 60 * 1000, now);
}

export function checkValidateRateLimit(uid: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 30 single-question validations per minute per teacher
  return sharedRateLimiter.check(`val_${uid}`, 30, 60 * 1000, now);
}

export function checkBatchValidateRateLimit(uid: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 10 batch validations per minute per teacher
  return sharedRateLimiter.check(`batch_val_${uid}`, 10, 60 * 1000, now);
}

export function checkAnswerRateLimit(playerId: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 10 answers per 10-second window per player
  return sharedRateLimiter.check(`ans_${playerId}`, 10, 10 * 1000, now);
}

export function resetAnswerRateLimit(playerId?: string): void {
  if (playerId) {
    sharedRateLimiter.reset(`ans_${playerId}`);
  } else {
    sharedRateLimiter.reset();
  }
}

export function checkIntegrityRateLimit(playerId: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 2 integrity telemetry events per second per player
  return sharedRateLimiter.check(`integ_${playerId}`, 2, 1000, now);
}

export function checkHostEmailRateLimit(hostUid: string, now: number = Date.now()): boolean {
  // Max 5 mass-email requests per minute per host
  const res = sharedRateLimiter.check(`host_email_${hostUid}`, 5, 60 * 1000, now);
  return res.allowed;
}

export function resetHostEmailRateLimit(hostUid?: string): void {
  if (hostUid) {
    sharedRateLimiter.reset(`host_email_${hostUid}`);
  } else {
    sharedRateLimiter.reset();
  }
}

export function checkTestEmailRateLimit(
  hostUid: string,
  now: number = Date.now()
): { allowed: boolean; retryAfterSec?: number } {
  // Max 3 test email dispatches per hour (3,600,000ms) per host
  const res = sharedRateLimiter.check(`test_email_${hostUid}`, 3, 3600 * 1000, now);
  return { allowed: res.allowed, retryAfterSec: res.retryAfterSec };
}

export function resetTestEmailRateLimit(hostUid?: string): void {
  if (hostUid) {
    sharedRateLimiter.reset(`test_email_${hostUid}`);
  } else {
    sharedRateLimiter.reset();
  }
}

