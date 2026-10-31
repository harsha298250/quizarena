/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response } from 'express';

export const ALLOWED_INTEGRITY_EVENT_TYPES = [
  'tab_switch',
  'window_blur',
  'fullscreen_exit',
  'extension_injection',
  'suspicious_environment',
  'devtools_open',
  'multi_monitor',
  'copy_paste_attempt',
  'focus_loss',
] as const;

export type IntegrityEventType = (typeof ALLOWED_INTEGRITY_EVENT_TYPES)[number];

export const MAX_STRIKES_LIMIT = 6;

// In-memory deduplication: playerId_eventType -> timestamp
const lastEventMap = new Map<string, number>();

// In-memory rate limiter: playerId -> { count, windowStart } (2 per 1000ms window)
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

export function isAllowedIntegrityEventType(type: string): type is IntegrityEventType {
  return (ALLOWED_INTEGRITY_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Deduplicates events of the same type for a player within 500ms.
 * Returns true if the event is a duplicate and should be suppressed/deduped.
 */
export function isDuplicateIntegrityEvent(
  playerId: string,
  eventType: string,
  now: number = Date.now()
): boolean {
  const key = `${playerId}_${eventType}`;
  const lastTime = lastEventMap.get(key) || 0;
  if (now - lastTime < 500) {
    return true;
  }
  lastEventMap.set(key, now);
  return false;
}

/**
 * Rate limits player integrity events to at most 2 per second.
 */
export function checkPlayerIntegrityRateLimit(
  playerId: string,
  now: number = Date.now()
): { allowed: boolean; retryAfterSec?: number } {
  const entry = rateLimitMap.get(playerId);
  if (!entry || now - entry.windowStart >= 1000) {
    rateLimitMap.set(playerId, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (entry.count >= 2) {
    const retryAfterSec = Math.ceil((entry.windowStart + 1000 - now) / 1000);
    return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }

  entry.count++;
  return { allowed: true };
}

export function resetIntegrityRateLimits(playerId?: string): void {
  if (playerId) {
    rateLimitMap.delete(playerId);
    for (const key of lastEventMap.keys()) {
      if (key.startsWith(`${playerId}_`)) {
        lastEventMap.delete(key);
      }
    }
  } else {
    rateLimitMap.clear();
    lastEventMap.clear();
  }
}

/**
 * Express handler for POST /api/integrity-event
 */
export async function handleIntegrityEvent(
  req: Request,
  res: Response,
  adminAuth: any,
  adminDb: any
): Promise<void> {
  try {
    // 1. Verify Firebase ID Token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
      return;
    }

    const idToken = authHeader.split('Bearer ')[1].trim();
    let playerId = '';
    try {
      const decoded = await adminAuth.verifyIdToken(idToken);
      playerId = decoded.uid;
    } catch (authError) {
      res.status(401).json({ error: 'Unauthorized: Invalid or expired Firebase ID token' });
      return;
    }

    const { gameId, eventType, reason = '', questionIndex } = req.body || {};

    if (!gameId || typeof gameId !== 'string') {
      res.status(400).json({ error: 'Missing or invalid gameId parameter' });
      return;
    }

    if (!eventType || !isAllowedIntegrityEventType(eventType)) {
      res.status(400).json({
        error: `Invalid eventType '${eventType}'. Allowed types: ${ALLOWED_INTEGRITY_EVENT_TYPES.join(', ')}`,
      });
      return;
    }

    // 2. Rate-limit to 2 events per second per player
    const rateCheck = checkPlayerIntegrityRateLimit(playerId);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSec || 1));
      res.status(429).json({
        error: `Rate limit exceeded for integrity telemetry. Max 2 events per second per player.`,
        retryAfter: rateCheck.retryAfterSec,
      });
      return;
    }

    // 3. Dedupe rapid duplicates within 500ms
    const isDupe = isDuplicateIntegrityEvent(playerId, eventType);
    const playerDocRef = adminDb.doc(`games/${gameId}/players/${playerId}`);

    if (isDupe) {
      // Return authoritative current state without incrementing
      const existingSnap = await playerDocRef.get();
      if (!existingSnap.exists) {
        res.status(403).json({ error: 'Player does not belong to this game session' });
        return;
      }
      const existingData = existingSnap.data() || {};
      res.status(200).json({
        success: true,
        deduped: true,
        strikes: existingData.strikes || 0,
        status: existingData.status || 'active',
        isTerminated: Boolean(existingData.isTerminated || (existingData.strikes || 0) >= MAX_STRIKES_LIMIT),
        integrityScore: existingData.integrityScore ?? 100,
        lastEvent: existingData.lastEvent || eventType,
      });
      return;
    }

    // 4. Atomic Firestore Transaction to increment strikes & update player status
    const result = await adminDb.runTransaction(async (transaction: any) => {
      const playerSnap = await transaction.get(playerDocRef);
      if (!playerSnap.exists) {
        const err: any = new Error('Player does not belong to this game session');
        err.statusCode = 403;
        throw err;
      }

      const playerData = playerSnap.data() || {};
      const currentStrikes = typeof playerData.strikes === 'number' ? playerData.strikes : 0;

      // If player is already terminated, keep terminated state
      if (playerData.isTerminated || playerData.status === 'terminated_integrity' || currentStrikes >= MAX_STRIKES_LIMIT) {
        return {
          strikes: Math.max(currentStrikes, MAX_STRIKES_LIMIT),
          status: 'terminated_integrity',
          isTerminated: true,
          integrityScore: 0,
          alreadyTerminated: true,
        };
      }

      const nextStrikes = currentStrikes + 1;
      const willTerminate = nextStrikes >= MAX_STRIKES_LIMIT;
      const newStatus = willTerminate ? 'terminated_integrity' : (playerData.status || 'active');
      const newIntegrityScore = Math.max(0, 100 - nextStrikes * 16 - (willTerminate ? 100 : 0));
      const nowIso = new Date().toISOString();

      const updatePayload: Record<string, any> = {
        strikes: nextStrikes,
        status: newStatus,
        isTerminated: willTerminate,
        integrityScore: newIntegrityScore,
        lastEvent: eventType,
        lastEventReason: reason,
        lastEventTime: nowIso,
        updatedAt: nowIso,
      };

      if (willTerminate) {
        updatePayload.terminatedAt = nowIso;
      }

      transaction.update(playerDocRef, updatePayload);

      // Record flag in games/{gameId}/flags
      const flagRef = adminDb.collection(`games/${gameId}/flags`).doc();
      transaction.set(flagRef, {
        id: flagRef.id,
        playerId,
        playerNickname: playerData.nickname || 'Unknown Player',
        type: eventType,
        severity: willTerminate ? 'high' : nextStrikes >= 3 ? 'medium' : 'low',
        reason: reason || `Integrity strike ${nextStrikes} of ${MAX_STRIKES_LIMIT}`,
        timestamp: nowIso,
        questionIndex: typeof questionIndex === 'number' ? questionIndex : undefined,
      });

      return {
        strikes: nextStrikes,
        status: newStatus,
        isTerminated: willTerminate,
        integrityScore: newIntegrityScore,
        alreadyTerminated: false,
      };
    });

    res.status(200).json({
      success: true,
      strikes: result.strikes,
      status: result.status,
      isTerminated: result.isTerminated,
      integrityScore: result.integrityScore,
      lastEvent: eventType,
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message || 'Internal error recording integrity event' });
  }
}

/**
 * Express handler for POST /api/reinstate-player (Host only)
 */
export async function handleReinstatePlayer(
  req: Request,
  res: Response,
  adminAuth: any,
  adminDb: any
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
      return;
    }

    const idToken = authHeader.split('Bearer ')[1].trim();
    let hostUid = '';
    try {
      const decoded = await adminAuth.verifyIdToken(idToken);
      hostUid = decoded.uid;
    } catch (authError) {
      res.status(401).json({ error: 'Unauthorized: Invalid or expired Firebase ID token' });
      return;
    }

    const { gameId, playerId } = req.body || {};
    if (!gameId || !playerId) {
      res.status(400).json({ error: 'gameId and playerId are required' });
      return;
    }

    // Verify caller is the host of the game
    const gameDocRef = adminDb.doc(`games/${gameId}`);
    const gameDoc = await gameDocRef.get();
    if (!gameDoc.exists) {
      res.status(404).json({ error: 'Game session not found' });
      return;
    }

    const gameData = gameDoc.data() || {};
    if (gameData.hostId !== hostUid) {
      res.status(403).json({ error: 'Forbidden: Only the game host can reinstate players' });
      return;
    }

    // Update player doc
    const playerDocRef = adminDb.doc(`games/${gameId}/players/${playerId}`);
    const playerSnap = await playerDocRef.get();
    if (!playerSnap.exists) {
      res.status(404).json({ error: 'Player not found in this game' });
      return;
    }

    const nowIso = new Date().toISOString();
    await playerDocRef.update({
      strikes: 0,
      status: 'active',
      isTerminated: false,
      integrityScore: 100,
      reinstatedAt: nowIso,
      reinstatedBy: hostUid,
      updatedAt: nowIso,
    });

    res.status(200).json({
      success: true,
      message: `Player ${playerId} reinstated successfully by host`,
      strikes: 0,
      status: 'active',
      isTerminated: false,
      integrityScore: 100,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal error reinstating player' });
  }
}

