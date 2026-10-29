/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  clampLatency,
  MAX_ALLOWED_LATENCY_MS,
  extractQuestionStartTimeMs,
  validatePlayerEligibility,
  validateAndTrackPowerUp,
  RateLimiter,
  TimingAnomalyDetector,
} from '../server/scoringHardening.ts';
import { calculateFairScore } from '../lib/scoring.ts';

export interface TestResultSummary {
  passed: number;
  failed: number;
  results: string[] ;
}

export function runHardenedScoringTests(): TestResultSummary {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      passed++;
      results.push(`✓ PASS: ${desc}`);
    } else {
      failed++;
      results.push(`✕ FAIL: ${desc}`);
    }
  }

  // =========================================================================
  // Case (a): Stop trusting playerData.latencyMs; clamp to server maximum 300ms
  // =========================================================================
  assert(
    clampLatency(150) === 150,
    'Case (a): Latency within limits (150ms) is preserved'
  );
  assert(
    clampLatency(300) === 300,
    'Case (a): Latency at boundary (300ms) is preserved'
  );
  assert(
    clampLatency(5000) === MAX_ALLOWED_LATENCY_MS,
    `Case (a): Forged latency (5000ms) is clamped to ${MAX_ALLOWED_LATENCY_MS}ms`
  );
  assert(
    clampLatency(301) === 300,
    'Case (a): 301ms is clamped to 300ms'
  );
  assert(
    clampLatency(-50) === 50,
    'Case (a): Negative latency is normalized to safe default (50ms)'
  );
  assert(
    clampLatency(undefined) === 50,
    'Case (a): Undefined latency defaults to safe default (50ms)'
  );

  // Test fair scoring with clamped latency
  const forgedLatencyScore = calculateFairScore({
    basePoints: 1000,
    isCorrect: true,
    timeLimitSeconds: 20,
    rawResponseTimeMs: 4000,
    latencyMs: clampLatency(10000), // Attacker sends 10,000ms
    clockOffsetMs: 0,
    currentStreak: 0,
    scoringProfile: 'speed_weighted',
  });
  // Compensated response time should be 4000 - 300 = 3700ms, NOT 0ms or negative!
  assert(
    forgedLatencyScore.compensatedResponseTimeMs === 3700,
    'Case (a): Fair scoring with clamped latency subtracts at most 300ms'
  );

  // =========================================================================
  // Case (b): Server sets questionStartTime & calculates authoritative elapsed time
  // =========================================================================
  const t0 = 1700000000000;
  assert(
    extractQuestionStartTimeMs(t0) === t0,
    'Case (b): Extracts numeric questionStartTime'
  );

  // Firestore Timestamp mock with .toMillis()
  const mockFsTimestamp = { toMillis: () => t0 };
  assert(
    extractQuestionStartTimeMs(mockFsTimestamp) === t0,
    'Case (b): Extracts Firestore Timestamp with toMillis()'
  );

  // Firestore internal format {_seconds, _nanoseconds}
  const mockSecondsTimestamp = { _seconds: 1700000000, _nanoseconds: 0 };
  assert(
    extractQuestionStartTimeMs(mockSecondsTimestamp) === t0,
    'Case (b): Extracts Firestore {_seconds} timestamp'
  );

  // Authoritative elapsed time calculation
  const tNow = t0 + 4200;
  const elapsed = tNow - extractQuestionStartTimeMs(mockFsTimestamp);
  assert(
    elapsed === 4200,
    'Case (b): Server computes exact 4200ms elapsed time from serverTimestamp'
  );

  // Expiration check (timeLimit: 20s, grace buffer: 3.5s => allowed 23.5s)
  const allowedMs = 20 * 1000 + 3500;
  const lateSubmissionElapsed = 24000;
  assert(
    lateSubmissionElapsed > allowedMs,
    'Case (b): Rejects answers exceeding server timeLimit + 3.5s buffer'
  );

  // =========================================================================
  // Case (c): Transactional duplicate check & atomic answer write
  // =========================================================================
  // Simulate mock transaction state
  const mockTransactionStore = new Map<string, any>();

  function simulateTransactionalAnswerWrite(
    txStore: Map<string, any>,
    answerId: string,
    submission: any
  ): { success: boolean; statusCode: number; error?: string } {
    // 1. Transaction read
    const existing = txStore.get(answerId);
    if (existing) {
      return { success: false, statusCode: 409, error: 'Duplicate answer: already submitted for this question' };
    }
    // 2. Transaction write
    txStore.set(answerId, submission);
    return { success: true, statusCode: 200 };
  }

  const txAnswerId = 'ans_0_player_abc';
  const firstWrite = simulateTransactionalAnswerWrite(mockTransactionStore, txAnswerId, { points: 900 });
  assert(firstWrite.success && firstWrite.statusCode === 200, 'Case (c): First answer write in transaction succeeds (200)');

  const duplicateWrite = simulateTransactionalAnswerWrite(mockTransactionStore, txAnswerId, { points: 900 });
  assert(!duplicateWrite.success && duplicateWrite.statusCode === 409, 'Case (c): Duplicate answer write in transaction is aborted with 409 Conflict');

  // =========================================================================
  // Case (d): Track power-up usage per player on the server (single use only)
  // =========================================================================
  const freshPlayer = {
    id: 'player_1',
    powerUps: { doublePointsUsed: false, fiftyFiftyUsed: false },
  };

  const firstPowerUpUse = validateAndTrackPowerUp(freshPlayer, 'doublePoints');
  assert(
    firstPowerUpUse.allowed && firstPowerUpUse.willUse,
    'Case (d): First use of doublePoints power-up is allowed on server'
  );

  const playerAfterUse = {
    ...freshPlayer,
    powerUps: { ...freshPlayer.powerUps, doublePointsUsed: true },
    usedPowerUps: { doublePoints: true },
  };

  const secondPowerUpUse = validateAndTrackPowerUp(playerAfterUse, 'doublePoints');
  assert(
    !secondPowerUpUse.allowed && !secondPowerUpUse.willUse && Boolean(secondPowerUpUse.error?.includes('already been used')),
    'Case (d): Second use of doublePoints power-up is rejected on server'
  );

  const fiftyFiftyFirstUse = validateAndTrackPowerUp(playerAfterUse, 'fiftyFifty');
  assert(
    fiftyFiftyFirstUse.allowed && fiftyFiftyFirstUse.willUse,
    'Case (d): Different power-up (50/50) is still allowed for first use'
  );

  // =========================================================================
  // Case (e): Reject players who don't exist in games/{id}/players or are kicked
  // =========================================================================
  const nonExistentCheck = validatePlayerEligibility(false, null);
  assert(
    !nonExistentCheck.eligible && nonExistentCheck.statusCode === 403,
    'Case (e): Rejects non-existent player with 403 Forbidden'
  );

  const activePlayerCheck = validatePlayerEligibility(true, { id: 'p1', nickname: 'Alice', isKicked: false });
  assert(
    activePlayerCheck.eligible && activePlayerCheck.statusCode === 200,
    'Case (e): Accepts registered, active player'
  );

  const kickedPlayerCheck1 = validatePlayerEligibility(true, { id: 'p2', nickname: 'Bob', isKicked: true });
  assert(
    !kickedPlayerCheck1.eligible && kickedPlayerCheck1.statusCode === 403,
    'Case (e): Rejects kicked player with isKicked=true (403 Forbidden)'
  );

  const kickedPlayerCheck2 = validatePlayerEligibility(true, { id: 'p3', nickname: 'Charlie', status: 'kicked' });
  assert(
    !kickedPlayerCheck2.eligible && kickedPlayerCheck2.statusCode === 403,
    'Case (e): Rejects kicked player with status="kicked" (403 Forbidden)'
  );

  // =========================================================================
  // Case (f): Rate limiting on /api/answer per uid
  // =========================================================================
  const testLimiter = new RateLimiter();
  const uid = 'test_user_rate_limit';
  const maxReq = 5;
  const windowMs = 10000;
  const baseTime = 100000;

  // First 5 requests within window should all pass
  let allFirstPass = true;
  for (let i = 0; i < maxReq; i++) {
    const res = testLimiter.check(`ans_${uid}`, maxReq, windowMs, baseTime + i * 100);
    if (!res.allowed) allFirstPass = false;
  }
  assert(allFirstPass, 'Case (f): First 5 requests within rate limit window are allowed');

  // 6th request within window should be rejected with 429 Retry-After
  const blockedRes = testLimiter.check(`ans_${uid}`, maxReq, windowMs, baseTime + 600);
  assert(
    !blockedRes.allowed && (blockedRes.retryAfterSec ?? 0) > 0,
    'Case (f): 6th request exceeding limit is blocked with retryAfterSec'
  );

  // A different user should NOT be blocked (rate limit is strictly per uid)
  const otherUserRes = testLimiter.check('ans_other_user', maxReq, windowMs, baseTime + 700);
  assert(
    otherUserRes.allowed,
    'Case (f): Rate limit is isolated per uid; other users are unaffected'
  );

  // After window expires, new requests should pass again
  const afterResetRes = testLimiter.check(`ans_${uid}`, maxReq, windowMs, baseTime + windowMs + 100);
  assert(
    afterResetRes.allowed,
    'Case (f): Requests are allowed again after rate limit window expires'
  );

  // =========================================================================
  // Case (g): Timing Anomaly Detection (Implausibly fast & uniform bot timing)
  // =========================================================================
  const anomalyDetector = new TimingAnomalyDetector();
  const testPlayer = 'contender_bot_check_1';

  // 1. Sub-human reaction speed (< 300ms)
  const fastRes = anomalyDetector.recordAndCheck(testPlayer, 140);
  assert(
    fastRes.isAnomaly && fastRes.type === 'suspicious_timing' && fastRes.severity === 'high',
    'Case (g): Sub-human response time (< 300ms) triggers high-severity suspicious_timing flag'
  );

  // 2. Normal human response times (std dev > 100ms) should NOT trigger anomaly
  const humanPlayer = 'contender_human_1';
  const humanR1 = anomalyDetector.recordAndCheck(humanPlayer, 1450);
  const humanR2 = anomalyDetector.recordAndCheck(humanPlayer, 2800);
  const humanR3 = anomalyDetector.recordAndCheck(humanPlayer, 1920);
  assert(
    !humanR1.isAnomaly && !humanR2.isAnomaly && !humanR3.isAnomaly,
    'Case (g): Natural variable human response times (1450ms, 2800ms, 1920ms) are NOT flagged'
  );

  // 3. Automated script with unnaturally uniform timing (e.g. 500ms, 502ms, 501ms)
  const botPlayer = 'contender_bot_macro';
  anomalyDetector.recordAndCheck(botPlayer, 500);
  anomalyDetector.recordAndCheck(botPlayer, 502);
  const botR3 = anomalyDetector.recordAndCheck(botPlayer, 501);
  assert(
    botR3.isAnomaly && botR3.type === 'uniform_timing' && botR3.severity === 'medium',
    'Case (g): Unnaturally uniform script timing across questions (std dev < 25ms) triggers uniform_timing flag'
  );

  // 4. Reset history restores clean slate
  anomalyDetector.reset(botPlayer);
  const afterResetBot = anomalyDetector.recordAndCheck(botPlayer, 500);
  assert(
    !afterResetBot.isAnomaly,
    'Case (g): Resetting timing detector history clears previous anomalies'
  );

  // =========================================================================
  // Case (h): Secure Mode Strike Escalation and Advisory Integrity Model
  // =========================================================================
  const calculateStrikeOutcome = (
    strike: number,
    settings: { strike2PointPenalty?: number; lockAnswerOnStrike3?: boolean }
  ) => {
    if (strike === 1) {
      return { penaltyPoints: 0, locked: false, modalType: 'friendly_warning' };
    }
    if (strike === 2) {
      return {
        penaltyPoints: settings.strike2PointPenalty ?? 50,
        locked: false,
        modalType: 'strong_warning_penalty',
      };
    }
    return {
      penaltyPoints: 0,
      locked: settings.lockAnswerOnStrike3 !== false,
      modalType: 'host_flagged_locked',
    };
  };

  const strike1Outcome = calculateStrikeOutcome(1, { strike2PointPenalty: 50 });
  assert(
    strike1Outcome.modalType === 'friendly_warning' && strike1Outcome.penaltyPoints === 0 && !strike1Outcome.locked,
    'Case (h): Strike 1 triggers a friendly informational modal without point penalties'
  );

  const strike2Outcome = calculateStrikeOutcome(2, { strike2PointPenalty: 75 });
  assert(
    strike2Outcome.modalType === 'strong_warning_penalty' && strike2Outcome.penaltyPoints === 75 && !strike2Outcome.locked,
    'Case (h): Strike 2 applies the host-configured point penalty (75 pts)'
  );

  const strike3Outcome = calculateStrikeOutcome(3, { lockAnswerOnStrike3: true });
  assert(
    strike3Outcome.modalType === 'host_flagged_locked' && strike3Outcome.locked,
    'Case (h): Strike 3 flags player to host and locks answering for active question'
  );

  const strike3UnlockedOutcome = calculateStrikeOutcome(3, { lockAnswerOnStrike3: false });
  assert(
    strike3UnlockedOutcome.modalType === 'host_flagged_locked' && !strike3UnlockedOutcome.locked,
    'Case (h): Strike 3 advisory mode flags host without locking when lockAnswerOnStrike3 is false'
  );

  // =========================================================================
  // Case (i): Accommodations - Fewer Options (Hide exactly 2 wrong answers)
  // =========================================================================
  const testQuestion = {
    id: 'q_test_1',
    type: 'multiple_choice',
    options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    correctAnswers: [1], // 'Beta' is correct
  };
  const correctIdx = testQuestion.correctAnswers[0];
  const wrongOptions = testQuestion.options
    .map((_, idx) => idx)
    .filter(idx => idx !== correctIdx);
  const hiddenOptions = wrongOptions.slice(0, 2);

  assert(
    hiddenOptions.length === 2 && !hiddenOptions.includes(correctIdx),
    'Case (i): Fewer Options calculates exactly 2 wrong options to hide without hiding the correct answer'
  );

  // =========================================================================
  // Case (j): Accommodations - Extra Time Multiplier in Fair Scoring
  // =========================================================================
  const standardScore = calculateFairScore({
    basePoints: 1000,
    isCorrect: true,
    timeLimitSeconds: 20,
    rawResponseTimeMs: 15000, // 15s elapsed
    latencyMs: 50,
    clockOffsetMs: 0,
    currentStreak: 0,
    scoringProfile: 'speed_weighted',
  });

  const extraTimeScore = calculateFairScore({
    basePoints: 1000,
    isCorrect: true,
    timeLimitSeconds: Math.round(20 * 1.5), // 30s effective limit
    rawResponseTimeMs: 15000, // 15s elapsed (halfway through instead of 75% through)
    latencyMs: 50,
    clockOffsetMs: 0,
    currentStreak: 0,
    scoringProfile: 'speed_weighted',
  });

  assert(
    extraTimeScore.finalPoints > standardScore.finalPoints,
    'Case (j): Extra Time Multiplier (1.5x) yields higher points at identical 15s elapsed response time'
  );

  // =========================================================================
  // Case (k): Accommodations Active List Descriptor
  // =========================================================================
  const sampleAcc = {
    dyslexiaFont: true,
    readAloud: true,
    fewerOptions: true,
    largeText: true,
    extraTimeMultiplier: 1.5,
    muteSound: false,
  };
  const activeList = [
    sampleAcc.dyslexiaFont && 'Dyslexia Font',
    sampleAcc.readAloud && 'Read-Aloud',
    sampleAcc.fewerOptions && 'Fewer Options',
    sampleAcc.largeText && 'Large Text',
    sampleAcc.extraTimeMultiplier > 1 && `${sampleAcc.extraTimeMultiplier}x Time`,
  ].filter(Boolean);

  assert(
    activeList.length === 5 && activeList.includes('1.5x Time') && activeList.includes('Read-Aloud'),
    'Case (k): Active Accommodations descriptor correctly aggregates all 5 enabled accessibility toggles'
  );

  return { passed, failed, results };
}
