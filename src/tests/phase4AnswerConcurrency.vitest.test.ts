/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleAnswerSubmission,
  createHashBlock,
  isSameAnswerPayload,
} from '../server/answerSubmissionHandler.ts';
import { resetAnswerRateLimit } from '../server/sharedRateLimiter.ts';
import { verifyAuditChain, AuditBlock } from '../lib/integrity.ts';

function createMockBackend() {
  const store = new Map<string, any>();

  const adminAuth = {
    verifyIdToken: async (token: string) => {
      const match = token.match(/Bearer player_token_(\d+)/) || token.match(/player_token_(\d+)/);
      if (match) {
        const id = `player_${match[1].padStart(3, '0')}`;
        return {
          uid: id,
          email: `${id}@school.edu`,
          email_verified: true,
          firebase: { sign_in_provider: 'google.com' },
        };
      }
      throw new Error('Invalid Firebase ID token');
    },
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
        const cur = store.get(docPath) || {};
        const updated = { ...cur };
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'operand' in (v as any)) {
            updated[k] = (Number(cur[k]) || 0) + Number((v as any).operand);
          } else {
            updated[k] = v;
          }
        }
        store.set(docPath, updated);
      },
    }),
    collection: (colPath: string) => ({
      doc: () => {
        const id = `doc_${Date.now()}_${Math.random()}`;
        return {
          id,
          get: async () => ({ exists: false, data: () => null }),
          set: async (data: any) => store.set(`${colPath}/${id}`, data),
        };
      },
    }),
  };

  let txQueue: Promise<any> = Promise.resolve();
  adminDb.runTransaction = async (updateFunction: (tx: any) => Promise<any>) => {
    return new Promise((resolve, reject) => {
      txQueue = txQueue.then(async () => {
        try {
          const pendingUpdates: Array<() => void> = [];
          const tx = {
            get: async (docRef: any) => docRef.get(),
            set: (docRef: any, data: any) => {
              pendingUpdates.push(() => docRef.set(data));
            },
            update: (docRef: any, data: any) => {
              pendingUpdates.push(() => docRef.update(data));
            },
          };
          const result = await updateFunction(tx);
          for (const update of pendingUpdates) {
            update();
          }
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
  };
  adminDb._store = store;

  return { adminAuth, adminDb, store };
}

function mockReqRes(headers: Record<string, string> = {}, body: any = {}) {
  let statusCode = 200;
  let responseData: any = null;

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
    setHeader: () => res,
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
  };
}

describe('Phase 4B — Answer Concurrency and Synchronization Suite', () => {
  beforeEach(() => {
    resetAnswerRateLimit();
  });

  // =========================================================================
  // 1. MP-01: Shared Game Document Contention Elimination
  // =========================================================================
  describe('MP-01 — Per-Player Cryptographic Audit Chains & Shared Doc Contention Elimination', () => {
    it('[4B-01] multiple players submitting simultaneously write only to player/answer docs with ZERO shared gameDocRef updates', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const gameId = 'game_concurrency_test';
      const initialGameDoc = {
        id: gameId,
        status: 'question_active',
        currentQuestionIndex: 0,
        questionStartTime: Date.now() - 1000,
        timeLimit: 30,
        // Game doc does NOT have a lastAuditHash
      };
      store.set(`games/${gameId}`, initialGameDoc);
      store.set(`games/${gameId}/secrets/answerKey`, {
        answers: [{ questionIndex: 0, type: 'multiple_choice', correctAnswers: [1], options: ['A', 'B', 'C', 'D'] }],
      });

      // Seed 25 players
      const playerTokens: string[] = [];
      for (let i = 1; i <= 25; i++) {
        const pId = `player_${String(i).padStart(3, '0')}`;
        playerTokens.push(`player_token_${i}`);
        store.set(`games/${gameId}/players/${pId}`, {
          id: pId,
          nickname: `Player_${i}`,
          status: 'active',
          score: 0,
          streak: 0,
          correctCount: 0,
          lastAuditHash: '0000000000000000000000000000000000000000000000000000000000000000',
        });
      }

      // 25 players submit answers simultaneously in parallel Promise.all()
      const submissions = await Promise.all(
        playerTokens.map(async (tok, idx) => {
          const pId = `player_${String(idx + 1).padStart(3, '0')}`;
          const { req, res, getStatus, getData } = mockReqRes(
            { authorization: `Bearer ${tok}` },
            { gameId, questionIndex: 0, selectedIndices: [1] }
          );
          await handleAnswerSubmission(req, res, { adminAuth, adminDb });
          return { status: getStatus(), data: getData(), pId };
        })
      );

      // Verify all 25 submissions succeeded with 200 OK
      for (const sub of submissions) {
        expect(sub.status).toBe(200);
        expect(sub.data.success).toBe(true);
        expect(sub.data.submission.isCorrect).toBe(true);
        expect(sub.data.updatedPlayer.score).toBeGreaterThan(0);
      }

      // CRITICAL CHECK: Shared game document MUST NOT have been updated with lastAuditHash
      const finalGameDoc = store.get(`games/${gameId}`);
      expect(finalGameDoc.lastAuditHash).toBeUndefined();

      // Individual player documents MUST have their own independent lastAuditHash
      for (let i = 1; i <= 25; i++) {
        const pId = `player_${String(i).padStart(3, '0')}`;
        const pDoc = store.get(`games/${gameId}/players/${pId}`);
        expect(pDoc.lastAuditHash).toBeDefined();
        expect(pDoc.lastAuditHash).toMatch(/^[a-f0-9]{64}$/);
        expect(pDoc.score).toBeGreaterThan(0);

        // Answer document has prevHash and hash
        const ansDoc = store.get(`games/${gameId}/answers/ans_0_${pId}`);
        expect(ansDoc).toBeDefined();
        expect(ansDoc.prevHash).toBe('0000000000000000000000000000000000000000000000000000000000000000');
        expect(ansDoc.hash).toBe(pDoc.lastAuditHash);
      }
    });

    it('[4B-02] per-player audit chain verifies sequentially across multiple questions for individual player history', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const gameId = 'game_chain_test';
      const pId = 'player_001';
      store.set(`games/${gameId}/players/${pId}`, {
        id: pId,
        nickname: 'Alice',
        status: 'active',
        score: 0,
        streak: 0,
        correctCount: 0,
        lastAuditHash: '0000000000000000000000000000000000000000000000000000000000000000',
      });

      const auditBlocks: AuditBlock[] = [];

      // Answer 3 sequential questions (Q0, Q1, Q2)
      for (let q = 0; q < 3; q++) {
        store.set(`games/${gameId}`, {
          id: gameId,
          status: 'question_active',
          currentQuestionIndex: q,
          questionStartTime: Date.now() - 1000,
          timeLimit: 20,
        });
        store.set(`games/${gameId}/secrets/answerKey`, {
          answers: {
            [q]: { questionIndex: q, type: 'multiple_choice', correctAnswers: [0], options: ['A', 'B'] },
          },
        });

        const { req, res, getStatus, getData } = mockReqRes(
          { authorization: 'Bearer player_token_1' },
          { gameId, questionIndex: q, selectedIndices: [0] }
        );
        await handleAnswerSubmission(req, res, { adminAuth, adminDb });
        expect(getStatus()).toBe(200);

        const sub = getData().submission;
        auditBlocks.push({
          id: sub.id,
          index: q,
          playerId: pId,
          questionIndex: q,
          points: sub.pointsAwarded,
          timestamp: sub.serverTimestamp,
          prevHash: sub.prevHash,
          hash: sub.hash,
        });
      }

      // Chain continuity check
      expect(auditBlocks[0].prevHash).toBe('0000000000000000000000000000000000000000000000000000000000000000');
      expect(auditBlocks[1].prevHash).toBe(auditBlocks[0].hash);
      expect(auditBlocks[2].prevHash).toBe(auditBlocks[1].hash);

      // Verify chain with standard integrity verifier
      const verification = await verifyAuditChain(auditBlocks);
      expect(verification.isValid).toBe(true);
      expect(verification.brokenIndex).toBeNull();
    });

    it('[4B-03] detects tampering in per-player audit chain (altered points or forged prevHash)', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const gameId = 'game_tamper_test';
      const pId = 'player_001';
      store.set(`games/${gameId}`, {
        id: gameId,
        status: 'question_active',
        currentQuestionIndex: 0,
        questionStartTime: Date.now() - 1000,
        timeLimit: 20,
      });
      store.set(`games/${gameId}/secrets/answerKey`, {
        answers: { 0: { questionIndex: 0, type: 'multiple_choice', correctAnswers: [1], options: ['A', 'B'] } },
      });
      store.set(`games/${gameId}/players/${pId}`, { id: pId, status: 'active', score: 0 });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { gameId, questionIndex: 0, selectedIndices: [1] }
      );
      await handleAnswerSubmission(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(200);

      const sub = getData().submission;
      const validBlock: AuditBlock = {
        id: sub.id,
        index: 0,
        playerId: pId,
        questionIndex: 0,
        points: sub.pointsAwarded,
        timestamp: sub.serverTimestamp,
        prevHash: sub.prevHash,
        hash: sub.hash,
      };

      // Tampered block with inflated points
      const tamperedBlock: AuditBlock = {
        ...validBlock,
        points: validBlock.points + 5000, // inflated score
      };

      const result = await verifyAuditChain([tamperedBlock]);
      expect(result.isValid).toBe(false);
      expect(result.message).toContain('Tampered payload');
    });

    it('[4B-04] historical compatibility: gracefully uses gameData.lastAuditHash if playerData.lastAuditHash is missing', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const gameId = 'game_historical';
      const pId = 'player_001';
      const historicalHash = '1111111111111111111111111111111111111111111111111111111111111111';
      store.set(`games/${gameId}`, {
        id: gameId,
        status: 'question_active',
        currentQuestionIndex: 0,
        questionStartTime: Date.now() - 1000,
        timeLimit: 20,
        lastAuditHash: historicalHash, // legacy game document hash
      });
      store.set(`games/${gameId}/secrets/answerKey`, {
        answers: [{ questionIndex: 0, type: 'multiple_choice', correctAnswers: [0], options: ['A', 'B'] }],
      });
      store.set(`games/${gameId}/players/${pId}`, {
        id: pId,
        status: 'active',
        score: 0,
        // playerData.lastAuditHash is undefined
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { gameId, questionIndex: 0, selectedIndices: [0] }
      );
      await handleAnswerSubmission(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(200);

      // Bridges legacy hash smoothly as prevHash
      expect(getData().submission.prevHash).toBe(historicalHash);
      // Writes new hash to playerDocRef without touching gameDocRef
      expect(store.get(`games/${gameId}/players/${pId}`).lastAuditHash).toBe(getData().submission.hash);
      expect(store.get(`games/${gameId}`).lastAuditHash).toBe(historicalHash); // game doc untouched
    });
  });

  // =========================================================================
  // 2. MP-06: Idempotent Answer Submissions & Safe Duplicate Handling
  // =========================================================================
  describe('MP-06 — Idempotent Answer Submissions & Safe Duplicate Handling', () => {
    it('[4B-05] identical authenticated submission returns HTTP 200 with idempotentRepeat: true without re-awarding points', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const gameId = 'game_idemp_1';
      const pId = 'player_001';
      store.set(`games/${gameId}`, {
        id: gameId,
        status: 'question_active',
        currentQuestionIndex: 0,
        questionStartTime: Date.now() - 1000,
        timeLimit: 20,
      });
      store.set(`games/${gameId}/secrets/answerKey`, {
        answers: [{ questionIndex: 0, type: 'multiple_choice', correctAnswers: [1], options: ['A', 'B', 'C', 'D'] }],
      });
      store.set(`games/${gameId}/players/${pId}`, { id: pId, status: 'active', score: 0, streak: 0, correctCount: 0 });

      // First submission (normal)
      const call1 = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { gameId, questionIndex: 0, selectedIndices: [1] }
      );
      await handleAnswerSubmission(call1.req, call1.res, { adminAuth, adminDb });
      expect(call1.getStatus()).toBe(200);
      const pointsFirst = call1.getData().submission.pointsAwarded;
      expect(pointsFirst).toBeGreaterThan(0);
      expect(call1.getData().idempotentRepeat).toBeUndefined();

      const scoreAfterFirst = store.get(`games/${gameId}/players/${pId}`).score;
      expect(scoreAfterFirst).toBe(pointsFirst);

      // Second identical submission (simulating browser network retry)
      const call2 = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { gameId, questionIndex: 0, selectedIndices: [1] }
      );
      await handleAnswerSubmission(call2.req, call2.res, { adminAuth, adminDb });
      expect(call2.getStatus()).toBe(200);
      expect(call2.getData().success).toBe(true);
      expect(call2.getData().idempotentRepeat).toBe(true);
      expect(call2.getData().submission.id).toBe(call1.getData().submission.id);

      // CRITICAL CHECK: Score, streak, correctCount MUST NOT be awarded twice
      const scoreAfterRetry = store.get(`games/${gameId}/players/${pId}`).score;
      expect(scoreAfterRetry).toBe(scoreAfterFirst);
      expect(store.get(`games/${gameId}/players/${pId}`).correctCount).toBe(1);
      expect(store.get(`games/${gameId}/players/${pId}`).streak).toBe(1);
    });

    it('[4B-06] conflicting duplicate submission for same question is rejected with HTTP 409 Conflict', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const gameId = 'game_conflict_test';
      const pId = 'player_001';
      store.set(`games/${gameId}`, {
        id: gameId,
        status: 'question_active',
        currentQuestionIndex: 0,
        questionStartTime: Date.now() - 1000,
        timeLimit: 20,
      });
      store.set(`games/${gameId}/secrets/answerKey`, {
        answers: [{ questionIndex: 0, type: 'multiple_choice', correctAnswers: [1], options: ['A', 'B', 'C', 'D'] }],
      });
      store.set(`games/${gameId}/players/${pId}`, { id: pId, status: 'active', score: 0 });

      // First submission: option [1]
      const call1 = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { gameId, questionIndex: 0, selectedIndices: [1] }
      );
      await handleAnswerSubmission(call1.req, call1.res, { adminAuth, adminDb });
      expect(call1.getStatus()).toBe(200);

      // Second conflicting submission: attempting to change to option [2]
      const call2 = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { gameId, questionIndex: 0, selectedIndices: [2] }
      );
      await handleAnswerSubmission(call2.req, call2.res, { adminAuth, adminDb });
      expect(call2.getStatus()).toBe(409);
      expect(call2.getData().error).toContain('Duplicate answer: a different answer has already been submitted');

      // The recorded answer remains option [1]
      const savedAns = store.get(`games/${gameId}/answers/ans_0_${pId}`);
      expect(savedAns.selectedIndices).toEqual([1]);
    });

    it('[4B-07] canonical payload comparison accurately validates type_answer, ordering, and multi_select questions', () => {
      // 1. type_answer: whitespace and casing normalization
      expect(
        isSameAnswerPayload('type_answer', { textAnswer: 'Paris' }, undefined, '  paris  ')
      ).toBe(true);
      expect(
        isSameAnswerPayload('type_answer', { textAnswer: 'Paris' }, undefined, 'London')
      ).toBe(false);

      // 2. ordering: sequence order matters strictly
      expect(
        isSameAnswerPayload('ordering', { selectedIndices: [2, 0, 1] }, [2, 0, 1], undefined)
      ).toBe(true);
      expect(
        isSameAnswerPayload('ordering', { selectedIndices: [2, 0, 1] }, [0, 1, 2], undefined)
      ).toBe(false);

      // 3. multi_select: option set matters regardless of client array sort order
      expect(
        isSameAnswerPayload('multi_select', { selectedIndices: [1, 3] }, [3, 1], undefined)
      ).toBe(true);
      expect(
        isSameAnswerPayload('multi_select', { selectedIndices: [1, 3] }, [1, 2], undefined)
      ).toBe(false);
    });

    it('[4B-08] same-player concurrent duplicate requests result in exactly one score increment and idempotent response', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const gameId = 'game_same_player_concurrent';
      const pId = 'player_001';
      store.set(`games/${gameId}`, {
        id: gameId,
        status: 'question_active',
        currentQuestionIndex: 0,
        questionStartTime: Date.now() - 1000,
        timeLimit: 20,
      });
      store.set(`games/${gameId}/secrets/answerKey`, {
        answers: [{ questionIndex: 0, type: 'multiple_choice', correctAnswers: [0], options: ['A', 'B'] }],
      });
      store.set(`games/${gameId}/players/${pId}`, { id: pId, status: 'active', score: 0 });

      // Simulate rapid double-tap from client
      const callA = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { gameId, questionIndex: 0, selectedIndices: [0] }
      );
      const callB = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { gameId, questionIndex: 0, selectedIndices: [0] }
      );

      const [resA, resB] = await Promise.all([
        handleAnswerSubmission(callA.req, callA.res, { adminAuth, adminDb }),
        handleAnswerSubmission(callB.req, callB.res, { adminAuth, adminDb }),
      ]);

      expect([callA.getStatus(), callB.getStatus()]).toEqual([200, 200]);
      const dataA = callA.getData();
      const dataB = callB.getData();

      // One is primary, one is idempotent repeat
      const repeatCount = (dataA.idempotentRepeat ? 1 : 0) + (dataB.idempotentRepeat ? 1 : 0);
      expect(repeatCount).toBe(1);

      // Score is awarded exactly once
      const finalScore = store.get(`games/${gameId}/players/${pId}`).score;
      expect(finalScore).toBe(dataA.submission.pointsAwarded);
    });

    it('[4B-09] out-of-order question index mismatch is rejected without corrupting player audit chain', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const gameId = 'game_mismatch_test';
      const pId = 'player_001';
      const initialHash = '0000000000000000000000000000000000000000000000000000000000000000';
      store.set(`games/${gameId}`, {
        id: gameId,
        status: 'question_active',
        currentQuestionIndex: 0, // Server is at Q0
        questionStartTime: Date.now() - 1000,
        timeLimit: 20,
      });
      store.set(`games/${gameId}/secrets/answerKey`, {
        answers: [{ questionIndex: 0, type: 'multiple_choice', correctAnswers: [0], options: ['A', 'B'] }],
      });
      store.set(`games/${gameId}/players/${pId}`, { id: pId, status: 'active', score: 0, lastAuditHash: initialHash });

      // Player attempts to submit for Question 3
      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { gameId, questionIndex: 3, selectedIndices: [0] }
      );
      await handleAnswerSubmission(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(400);
      expect(getData().error).toContain('Question index mismatch');

      // Player document remains uncorrupted
      expect(store.get(`games/${gameId}/players/${pId}`).lastAuditHash).toBe(initialHash);
      expect(store.get(`games/${gameId}/players/${pId}`).score).toBe(0);
    });
  });
});
