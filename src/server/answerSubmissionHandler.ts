/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { calculateFairScore, evaluateAnswer } from '../lib/scoring.ts';
import {
  clampLatency,
  extractQuestionStartTimeMs,
  validatePlayerEligibility,
  validateAndTrackPowerUp,
  globalTimingAnomalyDetector,
  serverMeasuredLatencyMap,
} from './scoringHardening.ts';
import { checkAnswerRateLimit } from './sharedRateLimiter.ts';

/**
 * Creates SHA-256 hash block for tamper-evident answer audit chains.
 */
export async function createHashBlock(
  prevHash: string,
  index: number,
  playerId: string,
  questionIndex: number,
  pointsAwarded: number,
  timestamp: number
): Promise<{ hash: string }> {
  const crypto = await import('node:crypto');
  const payload = `${prevHash}|${index}|${playerId}|${questionIndex}|${pointsAwarded}|${timestamp}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  return { hash };
}

export interface AnswerSubmissionOptions {
  adminAuth: any;
  adminDb: any;
}

/**
 * Validates submitted answer payload structure against question type.
 * Rejects malformed payloads, out-of-bounds indices, and invalid types.
 */
export function validateAnswerPayload(
  type: string,
  selectedIndices: unknown,
  textAnswer: unknown,
  numOptions: number
): { valid: boolean; error?: string } {
  if (type === 'poll' || type === 'word_cloud' || type === 'info_slide') {
    return { valid: true };
  }

  if (type === 'type_answer') {
    if (typeof textAnswer !== 'string' || textAnswer.trim().length === 0) {
      return { valid: false, error: 'textAnswer must be a non-empty string for type_answer questions' };
    }
    if (textAnswer.length > 200) {
      return { valid: false, error: 'textAnswer cannot exceed 200 characters' };
    }
    return { valid: true };
  }

  // Multiple choice, multi-select, ordering, true-false
  if (!Array.isArray(selectedIndices)) {
    return { valid: false, error: 'selectedIndices must be an array of option indices' };
  }

  if (selectedIndices.length === 0) {
    return { valid: false, error: 'At least one option must be selected' };
  }

  for (const idx of selectedIndices) {
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || (numOptions > 0 && idx >= numOptions)) {
      return {
        valid: false,
        error: `Invalid option index ${idx}: must be an integer between 0 and ${numOptions > 0 ? numOptions - 1 : 'max'}`,
      };
    }
  }

  if (type === 'multiple_choice' || type === 'true_false') {
    if (selectedIndices.length !== 1) {
      return { valid: false, error: `Exactly one option must be selected for ${type} questions` };
    }
  }

  if (type === 'multi_select') {
    const unique = new Set(selectedIndices);
    if (unique.size !== selectedIndices.length) {
      return { valid: false, error: 'Duplicate option indices are not allowed in multi_select' };
    }
  }

  return { valid: true };
}

/**
 * Handles POST /api/answer
 * Authoritative, server-controlled scoring and answer recording in Firestore.
 */
export async function handleAnswerSubmission(
  req: Request,
  res: Response,
  options: AnswerSubmissionOptions
): Promise<void> {
  const { adminAuth, adminDb } = options;

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
      const decodedToken = await adminAuth.verifyIdToken(idToken);
      playerId = decodedToken.uid;
    } catch {
      res.status(401).json({ error: 'Unauthorized: Invalid or expired Firebase ID token' });
      return;
    }

    // 2. Rate limiting per player UID
    const rateCheck = checkAnswerRateLimit(playerId);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSec));
      res.status(429).json({
        error: `Rate limit exceeded. Please wait ${rateCheck.retryAfterSec} seconds before submitting another answer.`,
      });
      return;
    }

    const {
      gameId,
      questionIndex,
      selectedIndices = [],
      textAnswer,
      powerUps,
    } = req.body || {};

    if (!gameId || typeof gameId !== 'string' || questionIndex === undefined || typeof questionIndex !== 'number') {
      res.status(400).json({ error: 'gameId and questionIndex are required parameters' });
      return;
    }

    // 3. Fetch Game Session Document
    const gameDocRef = adminDb.doc(`games/${gameId}`);
    const gameDoc = await gameDocRef.get();
    if (!gameDoc.exists) {
      res.status(404).json({ error: 'Game session not found' });
      return;
    }

    const gameData = gameDoc.data() || {};

    // 4. Verify player existence and eligibility in game
    const playerDocRef = adminDb.doc(`games/${gameId}/players/${playerId}`);
    const initialPlayerDoc = await playerDocRef.get();
    const eligibilityCheck = validatePlayerEligibility(initialPlayerDoc.exists, initialPlayerDoc.data());
    if (!eligibilityCheck.eligible) {
      res.status(eligibilityCheck.statusCode).json({ error: eligibilityCheck.error });
      return;
    }

    // 5. Validate game state and active question index
    if (gameData.status !== 'question_active') {
      res.status(400).json({ error: `Question is not active for answers (current game status: ${gameData.status})` });
      return;
    }

    if (gameData.currentQuestionIndex !== questionIndex) {
      res.status(400).json({
        error: `Question index mismatch: expected ${gameData.currentQuestionIndex}, got ${questionIndex}`,
      });
      return;
    }

    // 6. Fetch secret answer key from host-only subcollection games/{id}/secrets/answerKey
    const secretDocRef = adminDb.doc(`games/${gameId}/secrets/answerKey`);
    const secretDoc = await secretDocRef.get();

    let secretQuestion: any = null;
    if (secretDoc.exists) {
      const secretData = secretDoc.data() || {};
      const answersList = secretData.answers || [];
      secretQuestion = answersList.find((a: any) => a.questionIndex === questionIndex);
    }
    if (!secretQuestion && gameData.questions?.[questionIndex]) {
      secretQuestion = gameData.questions[questionIndex];
    }
    if (!secretQuestion) {
      res.status(500).json({ error: 'Answer key not found for this question on server' });
      return;
    }

    const questionType = secretQuestion.type || 'multiple_choice';
    const numOptions = Array.isArray(secretQuestion.options) ? secretQuestion.options.length : 0;

    // 6. Validate submitted payload structure against question type
    const payloadValidation = validateAnswerPayload(questionType, selectedIndices, textAnswer, numOptions);
    if (!payloadValidation.valid) {
      res.status(400).json({ error: payloadValidation.error });
      return;
    }

    // 7. Authoritative question timing
    const now = Date.now();
    const questionStartMs =
      extractQuestionStartTimeMs(gameData.questionStartTime) ||
      (typeof gameData.questionStartTimeMs === 'number' ? gameData.questionStartTimeMs : 0);

    if (questionStartMs <= 0) {
      res.status(400).json({ error: 'Question start time not established by server' });
      return;
    }

    const baseDurationSec = secretQuestion.timeLimit || gameData.timeLimit || 20;

    // Compute correctness on server
    const isCorrect = evaluateAnswer(
      questionType,
      selectedIndices,
      secretQuestion.correctAnswers || [],
      textAnswer,
      secretQuestion.acceptedTextAnswers || []
    );

    const answerId = `ans_${questionIndex}_${playerId}`;
    const answerDocRef = adminDb.doc(`games/${gameId}/answers/${answerId}`);

    // 8. Atomic Firestore Transaction for duplicate prevention, eligibility, power-up usage, and scoring
    const txResult = await adminDb.runTransaction(async (transaction: any) => {
      // (a) Verify player document and eligibility
      const playerDoc = await transaction.get(playerDocRef);
      const playerEligibility = validatePlayerEligibility(playerDoc.exists, playerDoc.data());
      if (!playerEligibility.eligible) {
        const err: any = new Error(playerEligibility.error);
        err.statusCode = playerEligibility.statusCode;
        throw err;
      }

      const playerData = playerDoc.data() || {};

      // (b) Verify accommodation approval and calculate allowed deadline
      // Only host-approved accommodations are respected. Self-declared values are ignored.
      const hasApprovedAccommodation = Boolean(playerData.accommodationsApproved || playerData.accessibleApproved);
      const rawMultiplier = Number(playerData.accommodations?.extraTimeMultiplier);
      const approvedMultiplier = hasApprovedAccommodation && rawMultiplier >= 1 && rawMultiplier <= 2
        ? rawMultiplier
        : 1.0;

      // Check if time freeze power-up is active for this player
      const timeFreezeActive = Boolean(playerData.powerUps?.timeFreezeActive);
      const timeFreezeBonusMs = timeFreezeActive ? 5000 : 0;

      // Allowed deadline: base time * multiplier + freeze bonus + 3500ms network transit grace
      const allowedWindowMs = Math.round(baseDurationSec * approvedMultiplier * 1000) + timeFreezeBonusMs + 3500;
      const serverElapsedMs = Math.max(0, now - questionStartMs);

      if (serverElapsedMs > allowedWindowMs) {
        const err: any = new Error('Answer submitted too late: question time limit expired');
        err.statusCode = 400;
        throw err;
      }

      // (c) Reject duplicate answers
      const existingAnswerDoc = await transaction.get(answerDocRef);
      if (existingAnswerDoc.exists) {
        const err: any = new Error('Duplicate answer: already submitted for this question');
        err.statusCode = 409;
        throw err;
      }

      // (d) Validate and track power-ups (single-use per match)
      const requestedDoublePoints = Boolean(powerUps?.doublePoints || powerUps?.doublePointsUsed);
      const powerUpCheck = validateAndTrackPowerUp(
        playerData,
        requestedDoublePoints ? 'doublePoints' : undefined
      );
      if (!powerUpCheck.allowed) {
        const err: any = new Error(powerUpCheck.error);
        err.statusCode = 400;
        throw err;
      }
      const willUseDoublePoints = powerUpCheck.willUse;

      // (e) Latency compensation (server-measured or clamped [0, 300ms])
      const measuredPing = serverMeasuredLatencyMap?.get ? serverMeasuredLatencyMap.get(playerId) : undefined;
      const clampedLatency = clampLatency(measuredPing !== undefined ? measuredPing : playerData.latencyMs);

      const currentStreak = playerData.streak || 0;
      const currentScore = playerData.score || 0;
      const maxStreak = playerData.maxStreak || 0;
      const correctCount = playerData.correctCount || 0;

      // (f) Deterministic score calculation
      const scoreResult = calculateFairScore({
        basePoints: secretQuestion.points || 1000,
        isCorrect,
        timeLimitSeconds: Math.round(baseDurationSec * approvedMultiplier),
        rawResponseTimeMs: serverElapsedMs,
        latencyMs: clampedLatency,
        clockOffsetMs: 0,
        currentStreak,
        scoringProfile: gameData.settings?.scoringProfile || 'speed_weighted',
        doublePointsPowerUp: willUseDoublePoints,
      });

      // (g) Tamper-evident Audit Block
      let serverPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';
      if (gameData.lastAuditHash) {
        serverPrevHash = gameData.lastAuditHash;
      }

      const auditBlock = await createHashBlock(
        serverPrevHash,
        questionIndex,
        playerId,
        questionIndex,
        scoreResult.finalPoints,
        now
      );

      const submissionData = {
        id: answerId,
        gameId,
        playerId,
        playerNickname: playerData.nickname || 'Player',
        questionIndex,
        selectedIndices,
        textAnswer: textAnswer || null,
        isCorrect,
        pointsAwarded: scoreResult.finalPoints,
        responseTimeMs: scoreResult.compensatedResponseTimeMs,
        serverElapsedMs,
        serverTimestamp: now,
        serverSubmittedAt: FieldValue.serverTimestamp(),
        prevHash: serverPrevHash,
        hash: auditBlock.hash,
        powerUpsUsed: {
          doublePoints: willUseDoublePoints,
        },
      };

      // Write answer record & update latest audit hash on game doc
      transaction.set(answerDocRef, submissionData);
      transaction.update(gameDocRef, { lastAuditHash: auditBlock.hash });

      // (h) Timing anomaly telemetry
      const timingAnomaly = globalTimingAnomalyDetector.recordAndCheck(playerId, serverElapsedMs);
      if (timingAnomaly.isAnomaly) {
        const flagRef = adminDb.collection(`games/${gameId}/flags`).doc();
        transaction.set(flagRef, {
          id: flagRef.id,
          playerId,
          playerNickname: playerData.nickname || 'Player',
          type: timingAnomaly.type,
          severity: timingAnomaly.severity || 'medium',
          reason: timingAnomaly.reason,
          timestamp: new Date().toISOString(),
          questionIndex,
        });
      }

      // (i) Update player document with new score, streaks, and consumed power-ups
      const newStreak = scoreResult.newStreak;
      const newScore = currentScore + scoreResult.finalPoints;
      const newMaxStreak = Math.max(maxStreak, newStreak);
      const newCorrectCount = isCorrect ? correctCount + 1 : correctCount;

      const playerUpdates: Record<string, any> = {
        score: FieldValue.increment(scoreResult.finalPoints),
        streak: newStreak,
        maxStreak: newMaxStreak,
        correctCount: isCorrect ? FieldValue.increment(1) : correctCount,
        lastSeen: FieldValue.serverTimestamp(),
      };

      if (willUseDoublePoints) {
        playerUpdates['powerUps.doublePointsUsed'] = true;
        playerUpdates['usedPowerUps.doublePoints'] = true;
      }

      // Consume active time freeze flag for this question
      if (timeFreezeActive) {
        playerUpdates['powerUps.timeFreezeActive'] = false;
      }

      transaction.update(playerDocRef, playerUpdates);

      return {
        submissionData,
        updatedPlayer: {
          id: playerId,
          score: newScore,
          streak: newStreak,
          maxStreak: newMaxStreak,
          correctCount: newCorrectCount,
          powerUps: {
            ...(playerData.powerUps || {}),
            doublePointsUsed: Boolean(playerData.powerUps?.doublePointsUsed || willUseDoublePoints),
            timeFreezeActive: false,
          },
        },
      };
    });

    res.status(200).json({
      success: true,
      submission: {
        ...txResult.submissionData,
        serverSubmittedAt: now,
      },
      updatedPlayer: txResult.updatedPlayer,
    });
  } catch (error: any) {
    if (error.statusCode) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('Error processing answer submission:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error processing answer' });
  }
}

/**
 * Handles POST /api/use-powerup
 * Validates availability, applies single-use power-up effects on the trusted backend.
 */
export async function handleUsePowerUp(
  req: Request,
  res: Response,
  options: AnswerSubmissionOptions
): Promise<void> {
  const { adminAuth, adminDb } = options;

  try {
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
    } catch {
      res.status(401).json({ error: 'Unauthorized: Invalid or expired Firebase ID token' });
      return;
    }

    const { gameId, powerUp, questionIndex } = req.body || {};
    if (!gameId || !powerUp || questionIndex === undefined) {
      res.status(400).json({ error: 'gameId, powerUp, and questionIndex are required' });
      return;
    }

    if (powerUp === 'fiftyFifty' || powerUp === 'doublePoints') {
      res.status(400).json({ error: `Power-up '${powerUp}' is permanently deprecated and disabled.` });
      return;
    }

    if (powerUp !== 'timeFreeze') {
      res.status(400).json({ error: `Invalid power-up '${powerUp}'. Only 'timeFreeze' is supported.` });
      return;
    }

    const gameDocRef = adminDb.doc(`games/${gameId}`);
    const gameSnap = await gameDocRef.get();
    if (!gameSnap.exists) {
      res.status(404).json({ error: 'Game session not found' });
      return;
    }

    const gameData = gameSnap.data() || {};
    if (gameData.status !== 'question_active' || gameData.currentQuestionIndex !== questionIndex) {
      res.status(400).json({ error: 'Power-ups can only be activated for the currently active question' });
      return;
    }

    const playerDocRef = adminDb.doc(`games/${gameId}/players/${playerId}`);

    const result = await adminDb.runTransaction(async (transaction: any) => {
      const playerSnap = await transaction.get(playerDocRef);
      const eligibility = validatePlayerEligibility(playerSnap.exists, playerSnap.data());
      if (!eligibility.eligible) {
        const err: any = new Error(eligibility.error);
        err.statusCode = eligibility.statusCode;
        throw err;
      }

      const playerData = playerSnap.data() || {};
      const powerUpCheck = validateAndTrackPowerUp(playerData, powerUp);
      if (!powerUpCheck.allowed) {
        const err: any = new Error(powerUpCheck.error);
        err.statusCode = 400;
        throw err;
      }

      const updates: Record<string, any> = {
        [`powerUps.${powerUp}Used`]: true,
        [`usedPowerUps.${powerUp}`]: true,
      };

      let powerUpPayload: any = {};

      if (powerUp === 'fiftyFifty') {
        // Look up secret correct answers to eliminate exactly 2 WRONG options
        const secretDocRef = adminDb.doc(`games/${gameId}/secrets/answerKey`);
        const secretSnap = await transaction.get(secretDocRef);
        let secretQuestion: any = null;
        if (secretSnap.exists) {
          const secretData = secretSnap.data() || {};
          const answersList = secretData.answers || [];
          secretQuestion = answersList.find((a: any) => a.questionIndex === questionIndex);
        }
        if (!secretQuestion && gameData.questions?.[questionIndex]) {
          secretQuestion = gameData.questions[questionIndex];
        }

        const correctIndices: number[] = secretQuestion?.correctAnswers || [0];
        const totalOptions = Array.isArray(secretQuestion?.options) ? secretQuestion.options.length : 4;
        const allIndices = Array.from({ length: totalOptions }, (_, i) => i);
        const wrongIndices = allIndices.filter(i => !correctIndices.includes(i));

        // Deterministically select up to 2 wrong options to hide
        const hiddenOptionIndices = wrongIndices.slice(0, 2);
        powerUpPayload = { hiddenOptionIndices };
      } else if (powerUp === 'timeFreeze') {
        updates['powerUps.timeFreezeActive'] = true;
        powerUpPayload = { addedTimeMs: 5000 };
      }

      transaction.update(playerDocRef, updates);

      return {
        powerUp,
        ...powerUpPayload,
      };
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message || 'Internal error activating power-up' });
  }
}

/**
 * Handles POST /api/approve-accommodation
 * Host-only endpoint to securely approve extra time and accessible DOM mode.
 */
export async function handleApproveAccommodation(
  req: Request,
  res: Response,
  options: AnswerSubmissionOptions
): Promise<void> {
  const { adminAuth, adminDb } = options;

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
    } catch {
      res.status(401).json({ error: 'Unauthorized: Invalid or expired Firebase ID token' });
      return;
    }

    const { gameId, playerId, extraTimeMultiplier, accessibleApproved } = req.body || {};
    if (!gameId || !playerId) {
      res.status(400).json({ error: 'gameId and playerId are required' });
      return;
    }

    // Verify caller is host of the game
    const gameDocRef = adminDb.doc(`games/${gameId}`);
    const gameDoc = await gameDocRef.get();
    if (!gameDoc.exists) {
      res.status(404).json({ error: 'Game session not found' });
      return;
    }

    const gameData = gameDoc.data() || {};
    if (gameData.hostId !== hostUid) {
      res.status(403).json({ error: 'Forbidden: Only the game host can approve accommodations' });
      return;
    }

    // Validate extraTimeMultiplier whitelist: 1, 1.25, 1.5, 2
    let validatedMultiplier = 1.0;
    if (extraTimeMultiplier !== undefined) {
      const num = Number(extraTimeMultiplier);
      const allowed = [1, 1.25, 1.5, 2];
      if (!allowed.includes(num)) {
        res.status(400).json({ error: `Invalid extraTimeMultiplier ${extraTimeMultiplier}. Allowed: 1, 1.25, 1.5, 2` });
        return;
      }
      validatedMultiplier = num;
    }

    const playerDocRef = adminDb.doc(`games/${gameId}/players/${playerId}`);
    const playerSnap = await playerDocRef.get();
    if (!playerSnap.exists) {
      res.status(404).json({ error: 'Player not found in this game session' });
      return;
    }

    const nowIso = new Date().toISOString();
    const isApproved = validatedMultiplier > 1 || Boolean(accessibleApproved);

    const updatePayload: Record<string, any> = {
      accommodationsApproved: isApproved,
      'accommodations.extraTimeMultiplier': validatedMultiplier,
      accessibleApproved: Boolean(accessibleApproved),
      accommodationsApprovedBy: hostUid,
      accommodationsUpdatedAt: nowIso,
      updatedAt: nowIso,
    };

    await playerDocRef.update(updatePayload);

    // Record audit flag in games/{gameId}/flags
    const flagRef = adminDb.collection(`games/${gameId}/flags`).doc();
    await flagRef.set({
      id: flagRef.id,
      playerId,
      playerNickname: playerSnap.data()?.nickname || 'Player',
      type: 'accommodation_approved',
      severity: 'low',
      reason: `Host approved accommodations: ${validatedMultiplier}x time, accessible DOM mode: ${Boolean(accessibleApproved)}`,
      timestamp: nowIso,
      approvedBy: hostUid,
    });

    res.status(200).json({
      success: true,
      playerId,
      accommodationsApproved: isApproved,
      extraTimeMultiplier: validatedMultiplier,
      accessibleApproved: Boolean(accessibleApproved),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal error approving accommodation' });
  }
}
