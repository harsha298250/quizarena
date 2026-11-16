/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Phase 3C SEC-08 — Time Nonce Memory Protection & Lifecycle Manager
 */

import crypto from 'node:crypto';

export interface PendingLatencyNonce {
  uid: string;
  issuedAt: number;
}

export const NONCE_LIFESPAN_MS = 30000; // 30 seconds
export const MAX_PENDING_NONCES_PER_USER = 5;
export const MAX_GLOBAL_PENDING_NONCES = 10000;
export const CLEANUP_INTERVAL_MS = 30000; // 30 seconds

// Primary in-memory store for latency nonces
const pendingLatencyNonces = new Map<string, PendingLatencyNonce>();

// Secondary index tracking nonces per user for O(1) user bounds
const userNoncesMap = new Map<string, Set<string>>();

/**
 * Issues a cryptographically random latency nonce for an authenticated user.
 * Enforces per-user maximum bounds and global capacity limits to prevent unbounded memory growth.
 */
export function issueLatencyNonce(uid: string, now: number = Date.now()): string {
  if (!uid || typeof uid !== 'string') {
    throw new Error('Valid user UID is required to issue latency nonce');
  }

  // 1. Enforce per-user bounds: prune oldest nonce if user exceeds threshold
  let userNonces = userNoncesMap.get(uid);
  if (!userNonces) {
    userNonces = new Set<string>();
    userNoncesMap.set(uid, userNonces);
  }

  while (userNonces.size >= MAX_PENDING_NONCES_PER_USER) {
    // Evict oldest nonce for this user
    const oldestNonce = userNonces.values().next().value;
    if (oldestNonce) {
      userNonces.delete(oldestNonce);
      pendingLatencyNonces.delete(oldestNonce);
    } else {
      break;
    }
  }

  // 2. Enforce global capacity bounds: evict oldest entry if at or above maximum
  if (pendingLatencyNonces.size >= MAX_GLOBAL_PENDING_NONCES) {
    const oldestGlobalNonce = pendingLatencyNonces.keys().next().value;
    if (oldestGlobalNonce) {
      const data = pendingLatencyNonces.get(oldestGlobalNonce);
      if (data) {
        const uSet = userNoncesMap.get(data.uid);
        if (uSet) {
          uSet.delete(oldestGlobalNonce);
          if (uSet.size === 0) userNoncesMap.delete(data.uid);
        }
      }
      pendingLatencyNonces.delete(oldestGlobalNonce);
    }
  }

  // 3. Generate cryptographically strong random nonce
  const randomSuffix = crypto.randomBytes(16).toString('hex');
  const newNonce = `${now}_${randomSuffix}`;

  pendingLatencyNonces.set(newNonce, {
    uid,
    issuedAt: now,
  });
  userNonces.add(newNonce);

  return newNonce;
}

/**
 * Validates and atomically consumes a nonce. Single-use.
 * Returns valid status and issued timestamp, or error reason.
 */
export function validateAndConsumeNonce(
  nonce: string,
  uid: string,
  now: number = Date.now()
): { valid: boolean; issuedAt?: number; error?: string } {
  if (!nonce || typeof nonce !== 'string') {
    return { valid: false, error: 'Missing or invalid nonce parameter' };
  }
  if (!uid || typeof uid !== 'string') {
    return { valid: false, error: 'Missing or invalid user UID' };
  }

  const pending = pendingLatencyNonces.get(nonce);
  if (!pending) {
    return { valid: false, error: 'Nonce not found or already consumed' };
  }

  // Always delete upon lookup (single-use invariant)
  pendingLatencyNonces.delete(nonce);
  const userNonces = userNoncesMap.get(pending.uid);
  if (userNonces) {
    userNonces.delete(nonce);
    if (userNonces.size === 0) {
      userNoncesMap.delete(pending.uid);
    }
  }

  // Verify UID ownership
  if (pending.uid !== uid) {
    return { valid: false, error: 'Forbidden: Nonce belongs to another user' };
  }

  // Verify expiry (30 seconds)
  const ageMs = now - pending.issuedAt;
  if (ageMs > NONCE_LIFESPAN_MS || ageMs < 0) {
    return { valid: false, error: 'Nonce expired' };
  }

  return { valid: true, issuedAt: pending.issuedAt };
}

/**
 * Sweeps and purges all expired nonces.
 * Returns count of pruned entries.
 */
export function cleanupExpiredNonces(now: number = Date.now()): number {
  let prunedCount = 0;
  for (const [nonce, data] of pendingLatencyNonces.entries()) {
    if (now - data.issuedAt > NONCE_LIFESPAN_MS || now < data.issuedAt) {
      pendingLatencyNonces.delete(nonce);
      const userNonces = userNoncesMap.get(data.uid);
      if (userNonces) {
        userNonces.delete(nonce);
        if (userNonces.size === 0) {
          userNoncesMap.delete(data.uid);
        }
      }
      prunedCount++;
    }
  }
  return prunedCount;
}

/**
 * Returns current count of pending nonces globally.
 */
export function getPendingNonceCount(): number {
  return pendingLatencyNonces.size;
}

/**
 * Returns count of pending nonces for a specific user.
 */
export function getUserPendingNonceCount(uid: string): number {
  return userNoncesMap.get(uid)?.size || 0;
}

/**
 * Clears all pending nonces. Used for test teardown.
 */
export function clearAllNonces(): void {
  pendingLatencyNonces.clear();
  userNoncesMap.clear();
}

// Background cleanup routine running every 30 seconds
const timer = setInterval(() => {
  cleanupExpiredNonces();
}, CLEANUP_INTERVAL_MS);

// Allow Node.js event loop to exit naturally in tests or scripts
if (typeof timer?.unref === 'function') {
  timer.unref();
}

