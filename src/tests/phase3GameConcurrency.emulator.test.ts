/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Phase 3B SEC-02 — Real Firestore Emulator Integration Tests for Concurrent Game Creation & PIN Allocation
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp, type App as AdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { handleCreateGame } from '../server/gameSessionHandler.ts';
import { handleFinalizeMatch } from '../server/tournamentHandler.ts';
import { handleAnswerSubmission } from '../server/answerSubmissionHandler.ts';

const DEMO_PROJECT_ID = 'demo-quizarena-test';

function createMockReqRes(opts: {
  headers?: Record<string, string>;
  body?: any;
}) {
  let statusCode = 200;
  let responseData: any = null;
  const req: any = {
    headers: opts.headers || {},
    body: opts.body || {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      responseData = data;
      return res;
    },
    setHeader() {
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

describe('Phase 3B SEC-02 — Real Firestore Emulator Concurrency Suite', () => {
  let adminApp: AdminApp;
  let adminDb: AdminFirestore;
  let rulesEnv: RulesTestEnvironment;

  const sampleQuiz = {
    id: 'quiz_concurrency_test',
    title: 'Concurrency Test Quiz',
    gameMode: 'classic',
    questions: [
      {
        id: 'q1',
        question: 'Is Firestore transaction atomic?',
        options: ['Yes', 'No'],
        correctAnswers: [0],
        timeLimit: 15,
      },
    ],
  };

  beforeAll(async () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

    adminApp = initializeAdminApp({ projectId: DEMO_PROJECT_ID }, 'phase3b-concurrency-admin');
    adminDb = getAdminFirestore(adminApp);

    rulesEnv = await initializeTestEnvironment({
      projectId: DEMO_PROJECT_ID,
      firestore: {
        rules: fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    if (rulesEnv) await rulesEnv.cleanup();
    if (adminApp) await deleteAdminApp(adminApp);
  });

  beforeEach(async () => {
    await rulesEnv.clearFirestore();
  });

  it('1. simultaneous game creation with contention: detects collision, triggers fresh PIN, and avoids overwrite', async () => {
    const hostA = 'host_concurrent_A';
    const hostB = 'host_concurrent_B';

    // Seed active user profiles so assertAccountActive passes
    await adminDb.collection('users').doc(hostA).set({
      uid: hostA,
      email: 'hostA@school.edu',
      status: 'active',
    });
    await adminDb.collection('users').doc(hostB).set({
      uid: hostB,
      email: 'hostB@school.edu',
      status: 'active',
    });

    const adminAuth: any = {
      verifyIdToken: async (token: string) => {
        if (token === 'token_host_a') {
          return { uid: hostA, email: 'hostA@school.edu', email_verified: true, firebase: { sign_in_provider: 'password' } };
        }
        if (token === 'token_host_b') {
          return { uid: hostB, email: 'hostB@school.edu', email_verified: true, firebase: { sign_in_provider: 'password' } };
        }
        throw new Error('Invalid token');
      },
    };

    const contestedPin = '222333';
    const fallbackPinA = '333111';
    const fallbackPinB = '444555';

    let attemptA = 0;
    const genPinA = () => {
      attemptA++;
      if (attemptA === 1) return contestedPin;
      return fallbackPinA;
    };

    let attemptB = 0;
    const genPinB = () => {
      attemptB++;
      if (attemptB === 1) return contestedPin;
      return fallbackPinB;
    };

    const reqResA = createMockReqRes({
      headers: { authorization: 'Bearer token_host_a' },
      body: { quiz: sampleQuiz, hostName: 'Teacher A' },
    });
    const reqResB = createMockReqRes({
      headers: { authorization: 'Bearer token_host_b' },
      body: { quiz: sampleQuiz, hostName: 'Teacher B' },
    });

    // Execute both game creation transactions concurrently against the live Firestore Emulator
    await Promise.all([
      handleCreateGame(reqResA.req, reqResA.res, { adminAuth, adminDb, generatePin: genPinA }),
      handleCreateGame(reqResB.req, reqResB.res, { adminAuth, adminDb, generatePin: genPinB }),
    ]);

    expect(reqResA.getStatus()).toBe(201);
    expect(reqResB.getStatus()).toBe(201);

    const gameDataA = reqResA.getData().game;
    const gameDataB = reqResB.getData().game;

    // Both sessions succeeded with distinct PINs without collision or overwrite
    expect(gameDataA.pin).not.toBe(gameDataB.pin);
    const allocatedPins = new Set([gameDataA.pin, gameDataB.pin]);
    expect(allocatedPins.has(contestedPin)).toBe(true);

    // Read directly from authoritative Firestore Emulator
    const snapA = await adminDb.doc(`games/${gameDataA.id}`).get();
    const snapB = await adminDb.doc(`games/${gameDataB.id}`).get();

    expect(snapA.exists).toBe(true);
    expect(snapB.exists).toBe(true);

    // Documents were committed with correct host ownership without mutual overwrite
    expect(snapA.data()?.hostId).toBe(hostA);
    expect(snapB.data()?.hostId).toBe(hostB);

    // Both answer keys were created in secrets subcollection
    const secretsSnapA = await adminDb.doc(`games/${gameDataA.id}/secrets/answerKey`).get();
    const secretsSnapB = await adminDb.doc(`games/${gameDataB.id}/secrets/answerKey`).get();

    expect(secretsSnapA.exists).toBe(true);
    expect(secretsSnapB.exists).toBe(true);
    expect(secretsSnapA.data()?.hostId).toBe(hostA);
    expect(secretsSnapB.data()?.hostId).toBe(hostB);
  });

  it('2. historical game records remain completely untouched when collisions occur', async () => {
    const historicalHost = 'historical_teacher_999';
    const historicalPin = '777888';
    const historicalGameId = `game_${historicalPin}`;

    // Pre-seed an existing completed game in Firestore emulator
    await adminDb.doc(`games/${historicalGameId}`).set({
      id: historicalGameId,
      pin: historicalPin,
      hostId: historicalHost,
      status: 'finished',
      quizTitle: 'Archived 2025 Midterm',
      createdAt: '2025-05-01T10:00:00.000Z',
      finalLeaderboard: [{ playerId: 'student_1', score: 950 }],
    });
    await adminDb.doc(`games/${historicalGameId}/secrets/answerKey`).set({
      answers: { 0: { correctAnswers: [0] } },
      hostId: historicalHost,
    });

    const newHost = 'new_teacher_101';
    await adminDb.collection('users').doc(newHost).set({
      uid: newHost,
      email: 'new_teacher@school.edu',
      status: 'active',
    });

    const adminAuth: any = {
      verifyIdToken: async () => ({
        uid: newHost,
        email: 'new_teacher@school.edu',
        email_verified: true,
        firebase: { sign_in_provider: 'password' },
      }),
    };

    let attempt = 0;
    const genPinWithCollision = () => {
      attempt++;
      if (attempt === 1) return historicalPin; // Collides with historical record
      return '999000'; // Fresh non-colliding PIN
    };

    const reqRes = createMockReqRes({
      headers: { authorization: 'Bearer token_new' },
      body: { quiz: sampleQuiz, hostName: 'New Host' },
    });

    await handleCreateGame(reqRes.req, reqRes.res, { adminAuth, adminDb, generatePin: genPinWithCollision });

    expect(reqRes.getStatus()).toBe(201);
    expect(reqRes.getData().game.pin).toBe('999000');

    // Verify historical document in Firestore Emulator is 100% UNMODIFIED
    const histSnap = await adminDb.doc(`games/${historicalGameId}`).get();
    const histData = histSnap.data()!;
    expect(histData.hostId).toBe(historicalHost);
    expect(histData.status).toBe('finished');
    expect(histData.quizTitle).toBe('Archived 2025 Midterm');
    expect(histData.finalLeaderboard).toEqual([{ playerId: 'student_1', score: 950 }]);

    // Verify new game was created cleanly under new PIN
    const newSnap = await adminDb.doc('games/game_999000').get();
    expect(newSnap.exists).toBe(true);
    expect(newSnap.data()?.hostId).toBe(newHost);
  });

  it('3. game document and answerKey secrets document are committed atomically', async () => {
    const hostUid = 'atomic_host_1';
    await adminDb.collection('users').doc(hostUid).set({
      uid: hostUid,
      email: 'atomic@school.edu',
      status: 'active',
    });

    const adminAuth: any = {
      verifyIdToken: async () => ({
        uid: hostUid,
        email: 'atomic@school.edu',
        email_verified: true,
        firebase: { sign_in_provider: 'password' },
      }),
    };

    const fixedPin = '555123';
    const reqRes = createMockReqRes({
      headers: { authorization: 'Bearer tok' },
      body: { quiz: sampleQuiz, hostName: 'Atomic Host' },
    });

    await handleCreateGame(reqRes.req, reqRes.res, {
      adminAuth,
      adminDb,
      generatePin: () => fixedPin,
    });

    expect(reqRes.getStatus()).toBe(201);

    const gameSnap = await adminDb.doc(`games/game_${fixedPin}`).get();
    const secretsSnap = await adminDb.doc(`games/game_${fixedPin}/secrets/answerKey`).get();

    expect(gameSnap.exists).toBe(true);
    expect(secretsSnap.exists).toBe(true);
    expect(gameSnap.data()?.id).toBe(`game_${fixedPin}`);
    expect(secretsSnap.data()?.hostId).toBe(hostUid);
    expect(secretsSnap.data()?.answers[0].correctAnswers).toEqual([0]);
  });

  it('4. failed transaction leaves zero partial documents in Firestore', async () => {
    const hostUid = 'aborted_host_1';
    await adminDb.collection('users').doc(hostUid).set({
      uid: hostUid,
      email: 'aborted@school.edu',
      status: 'active',
    });

    const adminAuth: any = {
      verifyIdToken: async () => ({
        uid: hostUid,
        email: 'aborted@school.edu',
        email_verified: true,
        firebase: { sign_in_provider: 'password' },
      }),
    };

    const targetPin = '666999';

    // Intercept runTransaction to simulate an unrecoverable failure right before commit
    const originalRunTransaction = adminDb.runTransaction.bind(adminDb);
    const failingDb = Object.create(adminDb);
    failingDb.runTransaction = async (updateFunction: any) => {
      await originalRunTransaction(async (tx: any) => {
        // Run reads and stage writes
        await updateFunction(tx);
        // Throw an unhandled error inside transaction to force complete rollback
        throw new Error('SIMULATED_TRANSACTION_FAILURE_BEFORE_COMMIT');
      });
    };

    const reqRes = createMockReqRes({
      headers: { authorization: 'Bearer tok' },
      body: { quiz: sampleQuiz },
    });

    await handleCreateGame(reqRes.req, reqRes.res, {
      adminAuth,
      adminDb: failingDb,
      generatePin: () => targetPin,
    });

    expect(reqRes.getStatus()).toBe(500);

    // Verify in live Firestore emulator that neither document was created
    const gameSnap = await adminDb.doc(`games/game_${targetPin}`).get();
    const secretsSnap = await adminDb.doc(`games/game_${targetPin}/secrets/answerKey`).get();

    expect(gameSnap.exists).toBe(false);
    expect(secretsSnap.exists).toBe(false);
  });

  it('5. SEC-06 authoritative match finalization: rejects forged scores and authoritatively commits verified results in real Firestore emulator transaction', async () => {
    const hostUid = 'host_emu_teacher_1';
    const player1Uid = 'player_emu_alice';
    const player2Uid = 'player_emu_bob';
    const tourneyId = 'tourney_emu_sec06';
    const matchId = 'match_round1_emu';
    const gameId = 'game_emu_linked_final';

    await adminDb.collection('users').doc(hostUid).set({
      uid: hostUid,
      email: 'host@emu.edu',
      status: 'active',
    });

    // Seed linked finished game
    await adminDb.doc(`games/${gameId}`).set({
      id: gameId,
      hostId: hostUid,
      status: 'finished',
    });
    // Authoritative scores in subcollection: Alice=3200, Bob=1400
    await adminDb.doc(`games/${gameId}/players/${player1Uid}`).set({
      id: player1Uid,
      nickname: 'Alice',
      score: 3200,
    });
    await adminDb.doc(`games/${gameId}/players/${player2Uid}`).set({
      id: player2Uid,
      nickname: 'Bob',
      score: 1400,
    });

    // Seed tournament in emulator
    const match = {
      id: matchId,
      roundIndex: 0,
      matchIndex: 0,
      player1Id: player1Uid,
      player2Id: player2Uid,
      player1Nickname: 'Alice',
      player2Nickname: 'Bob',
      gameId,
      status: 'scheduled',
    };
    await adminDb.doc(`tournaments/${tourneyId}`).set({
      id: tourneyId,
      hostId: hostUid,
      title: 'SEC-06 Emulator Championship',
      status: 'active',
      rounds: [
        {
          roundIndex: 0,
          name: 'Round 1',
          status: 'active',
          matches: [match],
        },
      ],
    });

    const adminAuth: any = {
      verifyIdToken: async () => ({
        uid: hostUid,
        email: 'host@emu.edu',
        email_verified: true,
        firebase: { sign_in_provider: 'password' },
      }),
    };

    // Client attempts to submit forged winner and inverted scores
    const reqRes = createMockReqRes({
      headers: { authorization: 'Bearer tok_host' },
      body: {
        tournamentId: tourneyId,
        matchId,
        winnerId: player2Uid, // forged!
        score1: 0,            // forged!
        score2: 999999,       // forged!
      },
    });

    await handleFinalizeMatch(reqRes.req, reqRes.res, { adminAuth, adminDb });
    expect(reqRes.getStatus()).toBe(200);

    // Read authoritative match document from Firestore emulator
    const matchSnap = await adminDb.doc(`tournaments/${tourneyId}/matches/${matchId}`).get();
    expect(matchSnap.exists).toBe(true);
    const matchData = matchSnap.data();

    // Server derived authoritative scores from player documents and declared Alice (player1) winner
    expect(matchData?.score1).toBe(3200);
    expect(matchData?.score2).toBe(1400);
    expect(matchData?.winnerId).toBe(player1Uid);
    expect(matchData?.status).toBe('completed');
  });

  it('6. MP-01 & MP-06: 50 simultaneous player answer submissions on real Firestore Emulator: 100% succeed with 0 contention aborts, zero shared game doc writes, and idempotent duplicate handling', async () => {
    const gameId = 'game_emu_50';
    const now = Date.now();

    // 1. Seed game in emulator
    await adminDb.doc(`games/${gameId}`).set({
      id: gameId,
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTime: now - 1000,
      timeLimit: 30,
      hostId: 'host_emu_50',
    });

    // 2. Seed answer key
    await adminDb.doc(`games/${gameId}/secrets/answerKey`).set({
      answers: [{ questionIndex: 0, type: 'multiple_choice', correctAnswers: [1], options: ['A', 'B', 'C', 'D'] }],
    });

    // 3. Seed 50 players in Firestore emulator
    const playerTokens: string[] = [];
    const batch = adminDb.batch();
    for (let i = 1; i <= 50; i++) {
      const pId = `emu_player_${String(i).padStart(3, '0')}`;
      playerTokens.push(`tok_${pId}`);
      const pRef = adminDb.doc(`games/${gameId}/players/${pId}`);
      batch.set(pRef, {
        id: pId,
        nickname: `EmuPlayer_${i}`,
        status: 'active',
        score: 0,
        streak: 0,
        correctCount: 0,
        lastAuditHash: '0000000000000000000000000000000000000000000000000000000000000000',
      });
    }
    await batch.commit();

    const emuAuth: any = {
      verifyIdToken: async (tok: string) => {
        const clean = tok.replace('Bearer ', '').trim();
        const pId = clean.replace('tok_', '');
        return {
          uid: pId,
          email: `${pId}@emu.edu`,
          email_verified: true,
          firebase: { sign_in_provider: 'google.com' },
        };
      },
    };

    // 4. Fire 50 simultaneous answer submissions in parallel against real Firestore Emulator
    const submissions = await Promise.all(
      playerTokens.map(async (tok, idx) => {
        const pId = `emu_player_${String(idx + 1).padStart(3, '0')}`;
        const reqRes = createMockReqRes({
          headers: { authorization: `Bearer ${tok}` },
          body: { gameId, questionIndex: 0, selectedIndices: [1] },
        });
        await handleAnswerSubmission(reqRes.req, reqRes.res, { adminAuth: emuAuth, adminDb });
        return { status: reqRes.getStatus(), data: reqRes.getData(), pId };
      })
    );

    // 5. Verify 100% of the 50 submissions succeeded with 200 OK
    for (const sub of submissions) {
      expect(sub.status).toBe(200);
      expect(sub.data.success).toBe(true);
      expect(sub.data.submission.isCorrect).toBe(true);
      expect(sub.data.updatedPlayer.score).toBeGreaterThan(0);
    }

    // 6. MP-01 invariant: Shared game document MUST NOT have a lastAuditHash write
    const gameSnap = await adminDb.doc(`games/${gameId}`).get();
    expect(gameSnap.data()?.lastAuditHash).toBeUndefined();

    // 7. Verify all 50 player documents have their own independent per-player audit hash and incremented score
    for (let i = 1; i <= 50; i++) {
      const pId = `emu_player_${String(i).padStart(3, '0')}`;
      const pSnap = await adminDb.doc(`games/${gameId}/players/${pId}`).get();
      const pData = pSnap.data();
      expect(pData?.lastAuditHash).toBeDefined();
      expect(pData?.lastAuditHash).toMatch(/^[a-f0-9]{64}$/);
      expect(pData?.score).toBeGreaterThan(0);
      expect(pData?.correctCount).toBe(1);
    }

    // 8. MP-06: Identical duplicate submission for player 1 returns 200 OK with idempotentRepeat: true
    const retryReqRes = createMockReqRes({
      headers: { authorization: 'Bearer tok_emu_player_001' },
      body: { gameId, questionIndex: 0, selectedIndices: [1] },
    });
    await handleAnswerSubmission(retryReqRes.req, retryReqRes.res, { adminAuth: emuAuth, adminDb });
    expect(retryReqRes.getStatus()).toBe(200);
    expect(retryReqRes.getData().idempotentRepeat).toBe(true);

    // Score must be awarded exactly once
    const p1Snap = await adminDb.doc(`games/${gameId}/players/emu_player_001`).get();
    expect(p1Snap.data()?.score).toBe(submissions[0].data.updatedPlayer.score);
    expect(p1Snap.data()?.correctCount).toBe(1);

    // 9. MP-06: Conflicting duplicate submission for player 2 returns HTTP 409 Conflict
    const conflictReqRes = createMockReqRes({
      headers: { authorization: 'Bearer tok_emu_player_002' },
      body: { gameId, questionIndex: 0, selectedIndices: [2] }, // conflicting answer
    });
    await handleAnswerSubmission(conflictReqRes.req, conflictReqRes.res, { adminAuth: emuAuth, adminDb });
    expect(conflictReqRes.getStatus()).toBe(409);
    expect(conflictReqRes.getData().error).toContain('Duplicate answer: a different answer has already been submitted');
  });
});

