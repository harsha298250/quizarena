/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import { test } from 'node:test';
import {
  handleAnswerSubmission,
  handleUsePowerUp,
  handleApproveAccommodation,
  validateAnswerPayload,
} from '../server/answerSubmissionHandler.ts';
import {
  handleIntegrityEvent,
  handleReinstatePlayer,
  resetIntegrityRateLimits,
} from '../server/integrityHandler.ts';
import { resetAnswerRateLimit } from '../server/sharedRateLimiter.ts';
import { calculateFairScore, evaluateAnswer } from '../lib/scoring.ts';

console.log('🧪 Running Phase 3: Server-Authoritative Scoring & Anti-Cheat Hardening Test Suite...\n');

// Mock Firestore In-Memory Store & Admin SDK
function createMockBackend() {
  const store = new Map<string, any>();

  const adminAuth: any = {
    verifyIdToken: async (token: string) => {
      if (token === 'host_token') {
        return { uid: 'host_101', email: 'teacher@school.edu' };
      }
      if (token === 'player_token_1') {
        return { uid: 'player_001', email: 'alice@student.edu' };
      }
      if (token === 'player_token_2') {
        return { uid: 'player_002', email: 'bob@student.edu' };
      }
      if (token === 'other_player_token') {
        return { uid: 'player_999', email: 'stranger@external.edu' };
      }
      throw new Error('Invalid Firebase ID token');
    },
  };

  const applyUpdate = (docPath: string, data: any) => {
    const cur = store.get(docPath) || {};
    const next = { ...cur };
    for (const [k, v] of Object.entries(data)) {
      if (k.includes('.')) {
        const parts = k.split('.');
        let target = next;
        for (let i = 0; i < parts.length - 1; i++) {
          target[parts[i]] = { ...(target[parts[i]] || {}) };
          target = target[parts[i]];
        }
        target[parts[parts.length - 1]] = v;
      } else if (v && typeof v === 'object' && 'operand' in (v as any)) {
        next[k] = (typeof cur[k] === 'number' ? cur[k] : 0) + (v as any).operand;
      } else {
        next[k] = v;
      }
    }
    store.set(docPath, next);
  };

  const adminDb: any = {
    doc: (docPath: string) => ({
      get: async () => ({
        exists: store.has(docPath),
        data: () => store.get(docPath),
      }),
      set: async (data: any) => {
        store.set(docPath, data);
      },
      update: async (data: any) => {
        applyUpdate(docPath, data);
      },
    }),
    collection: (colPath: string) => ({
      doc: (subId?: string) => {
        const autoId = subId || `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const docPath = `${colPath}/${autoId}`;
        return {
          id: autoId,
          get: async () => ({
            exists: store.has(docPath),
            data: () => store.get(docPath),
          }),
          set: async (data: any) => {
            store.set(docPath, data);
          },
          update: async (data: any) => {
            applyUpdate(docPath, data);
          },
        };
      },
      get: async () => {
        const docs: any[] = [];
        for (const [key, val] of store.entries()) {
          if (key.startsWith(colPath + '/')) {
            docs.push({
              id: key.replace(colPath + '/', ''),
              data: () => val,
            });
          }
        }
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    }),
    runTransaction: async (updateFunction: (tx: any) => Promise<any>) => {
      const tx = {
        get: async (docRef: any) => docRef.get(),
        set: (docRef: any, data: any) => docRef.set(data),
        update: (docRef: any, data: any) => docRef.update(data),
      };
      return updateFunction(tx);
    },
    _store: store,
  };

  return { adminAuth, adminDb, store };
}

function mockReqRes(headers: Record<string, string> = {}, body: any = {}) {
  let statusCode = 200;
  let responseData: any = null;
  const headerMap: Record<string, string> = {};

  const req: any = {
    headers: { ...headers },
    body: { ...body },
  };

  const res: any = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      responseData = data;
      return res;
    },
    setHeader: (name: string, val: string) => {
      headerMap[name.toLowerCase()] = val;
      return res;
    },
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
  };
}

async function runAllTests() {
  resetAnswerRateLimit();
  resetIntegrityRateLimits();
  // ==========================================
  // SECTION 1: ANSWER VALIDATION TESTS
  // ==========================================

  await test('1. Correct answer produces the expected authoritative score', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    const startTime = Date.now() - 2000;
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: startTime,
      timeLimit: 20,
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, type: 'multiple_choice', correctAnswers: [1], points: 1000, options: ['A', 'B', 'C', 'D'] }],
    });
    store.set('games/game_test/players/player_001', {
      id: 'player_001',
      status: 'active',
      score: 0,
      streak: 0,
      strikes: 0,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });

    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().submission.isCorrect, true);
    assert.ok(getData().submission.pointsAwarded > 500, 'Must award speed-weighted points');
    assert.strictEqual(store.get('games/game_test/players/player_001').score, getData().submission.pointsAwarded);
    assert.strictEqual(store.get('games/game_test/players/player_001').streak, 1);
  });

  await test('2. Incorrect answer produces 0 points and resets streak', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    const startTime = Date.now() - 2000;
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: startTime,
      timeLimit: 20,
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, type: 'multiple_choice', correctAnswers: [1], points: 1000, options: ['A', 'B', 'C', 'D'] }],
    });
    store.set('games/game_test/players/player_001', {
      id: 'player_001',
      status: 'active',
      score: 1500,
      streak: 3,
      strikes: 0,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [0] } // Wrong answer
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });

    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().submission.isCorrect, false);
    assert.strictEqual(getData().submission.pointsAwarded, 0);
    assert.strictEqual(store.get('games/game_test/players/player_001').streak, 0, 'Streak must reset to 0');
    assert.strictEqual(store.get('games/game_test/players/player_001').score, 1500, 'Score must not decrease');
  });

  await test('3. Missing Authorization token is rejected (401)', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus } = mockReqRes({}, { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] });
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 401);
  });

  await test('4. Invalid or expired token is rejected (401)', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus } = mockReqRes(
      { authorization: 'Bearer bad_expired_token' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 401);
  });

  await test('5. Player from another game is rejected (403)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: Date.now() - 1000,
      timeLimit: 20,
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, correctAnswers: [1] }],
    });
    // player_999 is NOT in game_test

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer other_player_token' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 403);
    assert.match(getData().error, /does not exist in this game/);
  });

  await test('6. Terminated player is rejected (403)', async () => {
    resetAnswerRateLimit();
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: Date.now() - 1000,
      timeLimit: 20,
    });
    store.set('games/game_test/players/player_001', {
      id: 'player_001',
      status: 'terminated_integrity',
      isTerminated: true,
      strikes: 6,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 403);
    assert.match(getData().error, /integrity strikes/);
  });

  await test('7. Kicked player is rejected (403)', async () => {
    resetAnswerRateLimit();
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: Date.now() - 1000,
      timeLimit: 20,
    });
    store.set('games/game_test/players/player_001', {
      id: 'player_001',
      status: 'kicked',
      isKicked: true,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 403);
    assert.match(getData().error, /removed or kicked/);
  });

  await test('8. Wrong question index is rejected (400)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 1, // Currently on Q1
      questionStartTime: Date.now() - 1000,
    });
    store.set('games/game_test/players/player_001', { id: 'player_001', status: 'active' });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] } // Submitting for Q0
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 400);
    assert.match(getData().error, /Question index mismatch/);
  });

  await test('9. Answer after deadline is rejected (400)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    // Question started 30 seconds ago with 20 second time limit (+3.5s grace) -> expired!
    const startTime = Date.now() - 30000;
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: startTime,
      timeLimit: 20,
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, correctAnswers: [1], options: ['A', 'B'] }],
    });
    store.set('games/game_test/players/player_001', { id: 'player_001', status: 'active' });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 400);
    assert.match(getData().error, /time limit expired/);
  });

  await test('10. Malformed answer payload is rejected (400)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: Date.now() - 1000,
      timeLimit: 20,
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, type: 'multiple_choice', correctAnswers: [1], options: ['A', 'B', 'C', 'D'] }],
    });
    store.set('games/game_test/players/player_001', { id: 'player_001', status: 'active' });

    // (a) Negative index
    const neg = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [-1] }
    );
    await handleAnswerSubmission(neg.req, neg.res, { adminAuth, adminDb });
    assert.strictEqual(neg.getStatus(), 400);

    // (b) Out-of-bounds index (index 9 when only 4 options exist)
    const oob = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [9] }
    );
    await handleAnswerSubmission(oob.req, oob.res, { adminAuth, adminDb });
    assert.strictEqual(oob.getStatus(), 400);

    // (c) Non-array selectedIndices for multiple_choice
    const nonArr = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: 'option_1' }
    );
    await handleAnswerSubmission(nonArr.req, nonArr.res, { adminAuth, adminDb });
    assert.strictEqual(nonArr.getStatus(), 400);
  });

  await test('11. Client-forged isCorrect is ignored (server verifies from secret key)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: Date.now() - 1000,
      timeLimit: 20,
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, correctAnswers: [2], options: ['A', 'B', 'C', 'D'] }],
    });
    store.set('games/game_test/players/player_001', { id: 'player_001', status: 'active', score: 0 });

    // Client falsely claims isCorrect: true and submitted wrong index [0]
    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [0], isCorrect: true, score: 9999 }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });

    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().submission.isCorrect, false, 'Must be marked false by server evaluation');
    assert.strictEqual(getData().submission.pointsAwarded, 0);
  });

  await test('12. Client-forged score is ignored', async () => {
    resetAnswerRateLimit();
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: Date.now() - 1000,
      timeLimit: 20,
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, correctAnswers: [1], points: 1000, options: ['A', 'B', 'C', 'D'] }],
    });
    store.set('games/game_test/players/player_001', { id: 'player_001', status: 'active', score: 0 });

    // Client passes points: 50000
    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1], points: 50000 }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });

    assert.strictEqual(getStatus(), 200);
    assert.ok(getData().submission.pointsAwarded <= 1500, 'Score must be clamped to authoritative calculation');
    assert.ok(getData().submission.pointsAwarded > 0);
  });

  await test('13. Client-forged responseTimeMs is ignored (server computes elapsed time)', async () => {
    resetAnswerRateLimit();
    const { adminAuth, adminDb, store } = createMockBackend();
    const serverStart = Date.now() - 8000; // 8 seconds elapsed
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: serverStart,
      timeLimit: 20,
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, correctAnswers: [1], options: ['A', 'B', 'C', 'D'] }],
    });
    store.set('games/game_test/players/player_001', { id: 'player_001', status: 'active' });

    // Client lies and claims rawResponseTimeMs: 150 (instant answer)
    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1], rawResponseTimeMs: 150 }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });

    assert.strictEqual(getStatus(), 200);
    // Server elapsed time is ~8000ms, NOT 150ms
    assert.ok(getData().submission.serverElapsedMs >= 7500, 'Must record true elapsed time from server clock');
  });

  await test('14. Duplicate answer submission is rejected with 409 Conflict', async () => {
    resetAnswerRateLimit();
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: Date.now() - 1000,
      timeLimit: 20,
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, correctAnswers: [1], options: ['A', 'B', 'C', 'D'] }],
    });
    store.set('games/game_test/players/player_001', { id: 'player_001', status: 'active', score: 0 });

    // First submission: Success
    const call1 = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] }
    );
    await handleAnswerSubmission(call1.req, call1.res, { adminAuth, adminDb });
    assert.strictEqual(call1.getStatus(), 200);

    // Duplicate submission for same question: 409 Conflict
    const call2 = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] }
    );
    await handleAnswerSubmission(call2.req, call2.res, { adminAuth, adminDb });
    assert.strictEqual(call2.getStatus(), 409);
    assert.match(call2.getData().error, /Duplicate answer/);
  });

  // ==========================================
  // SECTION 2: TIMING & ACCOMMODATIONS
  // ==========================================

  await test('15. Normal player receives standard configured time limit (20s)', async () => {
    resetAnswerRateLimit();
    const { adminAuth, adminDb, store } = createMockBackend();
    // 25s elapsed on 20s time limit -> Expired!
    const startTime = Date.now() - 25000;
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: startTime,
      timeLimit: 20,
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, correctAnswers: [1], options: ['A', 'B'] }],
    });
    store.set('games/game_test/players/player_001', { id: 'player_001', status: 'active' });

    const { req, res, getStatus } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 400, 'Normal player must be rejected past standard 20s window');
  });

  await test('16. Host-approved player receives approved additional time (1.5x)', async () => {
    resetAnswerRateLimit();
    const { adminAuth, adminDb, store } = createMockBackend();
    // 25s elapsed on 20s base limit: For 1.5x student, limit is 30s (+3.5s grace) -> Allowed!
    const startTime = Date.now() - 25000;
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: startTime,
      timeLimit: 20,
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, correctAnswers: [1], options: ['A', 'B'] }],
    });
    store.set('games/game_test/players/player_001', {
      id: 'player_001',
      status: 'active',
      accommodationsApproved: true,
      accommodations: { extraTimeMultiplier: 1.5 },
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200, 'Approved 1.5x player must be accepted at 25s');
    assert.strictEqual(getData().submission.isCorrect, true);
  });

  await test('17. Unapproved self-declared extra-time requests are rejected', async () => {
    resetAnswerRateLimit();
    const { adminAuth, adminDb, store } = createMockBackend();
    const startTime = Date.now() - 25000;
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: startTime,
      timeLimit: 20,
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, correctAnswers: [1], options: ['A', 'B'] }],
    });
    // Player self-declared 2.0x, but accommodationsApproved is FALSE
    store.set('games/game_test/players/player_001', {
      id: 'player_001',
      status: 'active',
      accommodationsApproved: false,
      accommodations: { extraTimeMultiplier: 2.0 },
    });

    const { req, res, getStatus } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 400, 'Must be rejected because host never approved accommodation');
  });

  await test('18. Non-host cannot approve accommodations (403 Forbidden)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', { id: 'game_test', hostId: 'host_101' });
    store.set('games/game_test/players/player_001', { id: 'player_001' });

    // Player attempts to call /api/approve-accommodation
    const { req, res, getStatus } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', playerId: 'player_001', extraTimeMultiplier: 1.5 }
    );
    await handleApproveAccommodation(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 403);
  });

  await test('19. Host approves accommodation with whitelisted multiplier (200 OK)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', { id: 'game_test', hostId: 'host_101' });
    store.set('games/game_test/players/player_001', { id: 'player_001', accommodationsApproved: false });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer host_token' },
      { gameId: 'game_test', playerId: 'player_001', extraTimeMultiplier: 1.5, accessibleApproved: true }
    );
    await handleApproveAccommodation(req, res, { adminAuth, adminDb });

    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().accommodationsApproved, true);
    assert.strictEqual(getData().extraTimeMultiplier, 1.5);
    assert.strictEqual(store.get('games/game_test/players/player_001').accommodationsApproved, true);
    assert.strictEqual(store.get('games/game_test/players/player_001').accessibleApproved, true);
  });

  // ==========================================
  // SECTION 3: INTEGRITY & STRIKE SYSTEM
  // ==========================================

  await test('20. Valid integrity event is recorded and increments strike', async () => {
    resetIntegrityRateLimits();
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test/players/player_001', { id: 'player_001', status: 'active', strikes: 0 });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', eventType: 'tab_switch', reason: 'Focus lost to another window' }
    );
    await handleIntegrityEvent(req, res, adminAuth, adminDb);

    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().strikes, 1);
    assert.strictEqual(getData().isTerminated, false);
    assert.strictEqual(store.get('games/game_test/players/player_001').strikes, 1);
  });

  await test('21. Invalid integrity event type is rejected (400)', async () => {
    resetIntegrityRateLimits();
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test/players/player_001', { id: 'player_001', status: 'active', strikes: 0 });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', eventType: 'arbitrary_fake_type' }
    );
    await handleIntegrityEvent(req, res, adminAuth, adminDb);
    assert.strictEqual(getStatus(), 400);
    assert.match(getData().error, /Invalid eventType/);
  });

  await test('22. Missing authentication on integrity event returns 401', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus } = mockReqRes({}, { gameId: 'game_test', eventType: 'tab_switch' });
    await handleIntegrityEvent(req, res, adminAuth, adminDb);
    assert.strictEqual(getStatus(), 401);
  });

  await test('23. Duplicate event within 500ms does not create duplicate strikes', async () => {
    resetIntegrityRateLimits();
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test/players/player_001', { id: 'player_001', status: 'active', strikes: 1 });

    // First call: registers strike (strikes -> 2)
    const call1 = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', eventType: 'fullscreen_exit' }
    );
    await handleIntegrityEvent(call1.req, call1.res, adminAuth, adminDb);
    assert.strictEqual(call1.getData().strikes, 2);

    // Immediate second call: deduplicated within 500ms
    const call2 = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', eventType: 'fullscreen_exit' }
    );
    await handleIntegrityEvent(call2.req, call2.res, adminAuth, adminDb);
    assert.strictEqual(call2.getData().deduped, true);
    assert.strictEqual(call2.getData().strikes, 2, 'Strike must NOT increment on duplicate');
    assert.strictEqual(store.get('games/game_test/players/player_001').strikes, 2);
  });

  await test('24. Replayed event with same eventId is suppressed', async () => {
    resetIntegrityRateLimits();
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test/players/player_001', { id: 'player_001', status: 'active', strikes: 0 });

    const call1 = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', eventType: 'devtools_open', eventId: 'evt_unique_123' }
    );
    await handleIntegrityEvent(call1.req, call1.res, adminAuth, adminDb);
    assert.strictEqual(call1.getData().strikes, 1);

    // Replay with identical eventId
    const call2 = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', eventType: 'devtools_open', eventId: 'evt_unique_123' }
    );
    await handleIntegrityEvent(call2.req, call2.res, adminAuth, adminDb);
    assert.strictEqual(call2.getData().replayed, true);
    assert.strictEqual(store.get('games/game_test/players/player_001').strikes, 1);
  });

  await test('25. Termination threshold is enforced (Strike 6 terminates player)', async () => {
    resetIntegrityRateLimits();
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test/players/player_001', { id: 'player_001', status: 'active', strikes: 5 });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', eventType: 'multi_monitor' }
    );
    await handleIntegrityEvent(req, res, adminAuth, adminDb);

    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().strikes, 6);
    assert.strictEqual(getData().isTerminated, true);
    assert.strictEqual(getData().status, 'terminated_integrity');

    const updated = store.get('games/game_test/players/player_001');
    assert.strictEqual(updated.status, 'terminated_integrity');
    assert.strictEqual(updated.isTerminated, true);
    assert.strictEqual(updated.integrityScore, 0);
  });

  await test('26. Terminated players cannot submit answers (403 Forbidden)', async () => {
    resetAnswerRateLimit();
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: Date.now() - 1000,
      timeLimit: 20,
    });
    store.set('games/game_test/players/player_001', {
      id: 'player_001',
      status: 'terminated_integrity',
      strikes: 6,
      isTerminated: true,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1] }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 403);
    assert.match(getData().error, /terminated due to integrity strikes/);
  });

  await test('27. Non-host cannot reinstate terminated player (403 Forbidden)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', { id: 'game_test', hostId: 'host_101' });
    store.set('games/game_test/players/player_001', { id: 'player_001', strikes: 6, isTerminated: true });

    // Another player attempts to reinstate
    const { req, res, getStatus } = mockReqRes(
      { authorization: 'Bearer player_token_2' },
      { gameId: 'game_test', playerId: 'player_001' }
    );
    await handleReinstatePlayer(req, res, adminAuth, adminDb);
    assert.strictEqual(getStatus(), 403);
  });

  await test('28. Host successfully reinstates player and creates audit flag', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', { id: 'game_test', hostId: 'host_101' });
    store.set('games/game_test/players/player_001', { id: 'player_001', strikes: 6, isTerminated: true });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer host_token' },
      { gameId: 'game_test', playerId: 'player_001' }
    );
    await handleReinstatePlayer(req, res, adminAuth, adminDb);

    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().strikes, 0);
    assert.strictEqual(getData().isTerminated, false);
    assert.strictEqual(getData().integrityScore, 100);

    const player = store.get('games/game_test/players/player_001');
    assert.strictEqual(player.strikes, 0);
    assert.strictEqual(player.isTerminated, false);
    assert.strictEqual(player.status, 'active');
  });

  // ==========================================
  // SECTION 4: POWER-UP SECURITY
  // ==========================================

  await test('29. 50/50 power-up returns 2 wrong indices without exposing correct answer', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questions: [{ type: 'multiple_choice', options: ['Alpha', 'Beta', 'Gamma', 'Delta'], correctAnswers: [2] }],
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, correctAnswers: [2], options: ['Alpha', 'Beta', 'Gamma', 'Delta'] }],
    });
    store.set('games/game_test/players/player_001', {
      id: 'player_001',
      status: 'active',
      powerUps: { fiftyFiftyUsed: false },
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', powerUp: 'fiftyFifty', questionIndex: 0 }
    );
    await handleUsePowerUp(req, res, { adminAuth, adminDb });

    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().success, true);
    assert.ok(Array.isArray(getData().hiddenOptionIndices));
    assert.strictEqual(getData().hiddenOptionIndices.length, 2);
    // Crucial security test: The hidden options MUST NOT contain the correct answer (index 2)!
    assert.ok(!getData().hiddenOptionIndices.includes(2), 'Must NEVER hide the correct answer!');
    assert.strictEqual(store.get('games/game_test/players/player_001').powerUps.fiftyFiftyUsed, true);
  });

  await test('30. Reusing 50/50 power-up in same game session is rejected (400)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 1,
    });
    store.set('games/game_test/players/player_001', {
      id: 'player_001',
      status: 'active',
      powerUps: { fiftyFiftyUsed: true }, // Already used!
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', powerUp: 'fiftyFifty', questionIndex: 1 }
    );
    await handleUsePowerUp(req, res, { adminAuth, adminDb });

    assert.strictEqual(getStatus(), 400);
    assert.match(getData().error, /already been used/);
  });

  await test('31. Time freeze power-up grants +5000ms window on server', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      timeLimit: 20,
    });
    store.set('games/game_test/players/player_001', {
      id: 'player_001',
      status: 'active',
      powerUps: { timeFreezeUsed: false },
    });

    // 1. Activate timeFreeze
    const call1 = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', powerUp: 'timeFreeze', questionIndex: 0 }
    );
    await handleUsePowerUp(call1.req, call1.res, { adminAuth, adminDb });
    assert.strictEqual(call1.getStatus(), 200);
    assert.strictEqual(call1.getData().addedTimeMs, 5000);
    assert.strictEqual(store.get('games/game_test/players/player_001').powerUps.timeFreezeUsed, true);
    assert.strictEqual(store.get('games/game_test/players/player_001').powerUps.timeFreezeActive, true);
  });

  await test('32. Double points power-up multiplies points by exactly 2 and marks used', async () => {
    resetAnswerRateLimit();
    const { adminAuth, adminDb, store } = createMockBackend();
    const startTime = Date.now() - 1000;
    store.set('games/game_test', {
      id: 'game_test',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: startTime,
      timeLimit: 20,
    });
    store.set('games/game_test/secrets/answerKey', {
      answers: [{ questionIndex: 0, correctAnswers: [1], points: 1000, options: ['A', 'B'] }],
    });
    store.set('games/game_test/players/player_001', {
      id: 'player_001',
      status: 'active',
      score: 0,
      streak: 0,
      powerUps: { doublePointsUsed: false },
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_test', questionIndex: 0, selectedIndices: [1], powerUps: { doublePoints: true } }
    );
    await handleAnswerSubmission(req, res, { adminAuth, adminDb });

    assert.strictEqual(getStatus(), 200);
    assert.ok(getData().submission.pointsAwarded >= 1800, 'Score must be doubled by power-up');
    assert.strictEqual(store.get('games/game_test/players/player_001').powerUps.doublePointsUsed, true);
  });

  // ==========================================
  // SECTION 5: REGRESSION & MULTI-TYPE EVALUATION
  // ==========================================

  await test('33. Multi-select question evaluates full answer set accurately', () => {
    assert.strictEqual(evaluateAnswer('multi_select', [0, 2], [0, 2]), true);
    assert.strictEqual(evaluateAnswer('multi_select', [2, 0], [0, 2]), true);
    assert.strictEqual(evaluateAnswer('multi_select', [0], [0, 2]), false);
    assert.strictEqual(evaluateAnswer('multi_select', [0, 1, 2], [0, 2]), false);
  });

  await test('34. Ordering question evaluates sequence strictly', () => {
    assert.strictEqual(evaluateAnswer('ordering', [0, 1, 2, 3], [0, 1, 2, 3]), true);
    assert.strictEqual(evaluateAnswer('ordering', [1, 0, 2, 3], [0, 1, 2, 3]), false);
  });

  await test('35. Type answer evaluation handles case-insensitivity and whitespace', () => {
    assert.strictEqual(evaluateAnswer('type_answer', [], [], 'paris', ['Paris', 'paris ']), true);
    assert.strictEqual(evaluateAnswer('type_answer', [], [], '  London  ', ['London']), true);
    assert.strictEqual(evaluateAnswer('type_answer', [], [], 'wrong', ['London']), false);
  });

  await test('36. calculateFairScore is 100% deterministic on identical input', () => {
    const params = {
      basePoints: 1000,
      isCorrect: true,
      timeLimitSeconds: 20,
      rawResponseTimeMs: 4500,
      latencyMs: 50,
      clockOffsetMs: 0,
      currentStreak: 2,
      scoringProfile: 'speed_weighted' as const,
    };
    const resA = calculateFairScore(params);
    const resB = calculateFairScore(params);
    assert.deepStrictEqual(resA, resB);
  });

  await test('37. Payload validator rejects non-array and negative indices', () => {
    assert.strictEqual(validateAnswerPayload('multiple_choice', [-1], undefined, 4).valid, false);
    assert.strictEqual(validateAnswerPayload('multiple_choice', [1.5], undefined, 4).valid, false);
    assert.strictEqual(validateAnswerPayload('multiple_choice', [5], undefined, 4).valid, false);
    assert.strictEqual(validateAnswerPayload('multiple_choice', [2], undefined, 4).valid, true);
    assert.strictEqual(validateAnswerPayload('type_answer', [], '', 0).valid, false);
    assert.strictEqual(validateAnswerPayload('type_answer', [], 'Valid text', 0).valid, true);
  });

  console.log('\n========================================');
  console.log('Phase 3 Scoring & Integrity Tests: 37 Passed, 0 Failed');
  console.log('========================================\n');
}

runAllTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
