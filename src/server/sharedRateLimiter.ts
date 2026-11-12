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
  private readonly maxEntries: number;

  constructor(maxEntries: number = 10000) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  /**
   * Removes expired entries to prevent unbounded memory growth.
   */
  public pruneExpired(now: number = Date.now()): number {
    let removed = 0;
    for (const [key, record] of this.map.entries()) {
      if (now >= record.resetAt) {
        this.map.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Returns current number of tracked rate-limit keys.
   */
  public size(): number {
    return this.map.size;
  }

  /**
   * Universal check method for sliding / fixed window rate limiting.
   * Bounds in-memory state by pruning expired keys and evicting the oldest key if still at capacity.
   */
  public check(
    key: string,
    maxRequests: number,
    windowMs: number,
    now: number = Date.now()
  ): RateLimitCheckResult {
    const record = this.map.get(key);

    if (!record || now >= record.resetAt) {
      if (!record && this.map.size >= this.maxEntries) {
        this.pruneExpired(now);
        while (this.map.size >= this.maxEntries) {
          const oldestKey = this.map.keys().next().value;
          if (oldestKey === undefined) break;
          this.map.delete(oldestKey);
        }
      }
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

/**
 * Extracts client IP using Express's `req.ip` (which respects `app.set('trust proxy', ...)`),
 * falling back to `req.socket.remoteAddress`. Never reads raw `X-Forwarded-For` directly.
 */
export function extractClientIp(req: {
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Sends a standardized HTTP 429 response with a `Retry-After` header (when supported by `res`).
 */
export function sendRateLimitResponse(
  res: { setHeader?: (name: string, value: string) => unknown; status: (code: number) => { json: (body: any) => unknown } },
  retryAfterSec: number | undefined,
  body: Record<string, any>
): void {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Retry-After', String(Math.max(1, retryAfterSec || 60)));
  }
  res.status(429).json(body);
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

export function checkAnonymousGenerateQuizIpRateLimit(ip: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 15 anonymous generations per 10 minutes per IP (prevents UID rotation while allowing shared NAT/school IPs)
  return sharedRateLimiter.check(`gen_anon_ip_${ip}`, 15, 10 * 60 * 1000, now);
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

export function checkHostEmailRateLimitDetailed(hostUid: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 5 mass-email requests per minute per host, returning retryAfterSec for Retry-After header
  return sharedRateLimiter.check(`host_email_${hostUid}`, 5, 60 * 1000, now);
}

export function checkOutboxEnqueueRateLimit(uid: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 10 outbox enqueue requests per minute per user (isolated from /api/send-results)
  return sharedRateLimiter.check(`outbox_enq_${uid}`, 10, 60 * 1000, now);
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

export function checkAccountDeletionRateLimit(
  uid: string,
  now: number = Date.now()
): RateLimitCheckResult {
  // Max 5 account deletion / retry requests per 10 minutes per user
  return sharedRateLimiter.check(`acct_del_${uid}`, 5, 10 * 60 * 1000, now);
}

export function checkGameSessionRateLimit(uid: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 20 game session create/join/recovery requests per minute per user
  return sharedRateLimiter.check(`game_sess_${uid}`, 20, 60 * 1000, now);
}

export function checkTournamentRateLimit(uid: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 20 tournament mutation requests per minute per user
  return sharedRateLimiter.check(`tourn_${uid}`, 20, 60 * 1000, now);
}

export function checkTournamentReadRateLimit(clientKey: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 60 tournament standings reads per minute per IP/user
  return sharedRateLimiter.check(`tourn_read_${clientKey}`, 60, 60 * 1000, now);
}

export function checkCertificateRateLimit(uid: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 20 certificate issue/revoke requests per minute per user
  return sharedRateLimiter.check(`cert_${uid}`, 20, 60 * 1000, now);
}

export function checkPublicVerifyRateLimit(ip: string, now: number = Date.now()): RateLimitCheckResult {
  // Max 60 public certificate verification lookups per minute per IP
  return sharedRateLimiter.check(`cert_verify_${ip}`, 60, 60 * 1000, now);
}

