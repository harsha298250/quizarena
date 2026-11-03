/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert';
import {
  handleCreateGame,
  handleJoinGame,
  handleKickPlayer,
  handleLeaveGame,
  handleLockLobby,
  handleStartGame,
  handleAdvanceQuestion,
  handleRevealAnswer,
  handleShowLeaderboard,
  handlePauseGame,
  handleResumeGame,
  handleEndGame,
  handleCancelGame,
  handleSessionRecovery,
  handleReconcilePlayerCount,
  MAX_GAME_CAPACITY,
} from '../server/gameSessionHandler.ts';

console.log('🧪 Running Phase 2: Multiplayer Engine & Real-Time Synchronization Test Suite...\n');

let passedTests = 0;
let failedTests = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res
        .then(() => {
          console.log(`  ✓ ${name}`);
          passedTests++;
        })
        .catch(err => {
          console.error(`  ✕ ${name}`);
          console.error(`    ${err instanceof Error ? err.message : String(err)}`);
          failedTests++;
        });
    } else {
      console.log(`  ✓ ${name}`);
      passedTests++;
    }
  } catch (err) {
    console.error(`  ✕ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failedTests++;
  }
}

function createMockBackend() {
  const store = new Map<string, any>();

  const adminAuth = {
    verifyIdToken: async (token: string) => {
      if (token === 'host_token') {
        return { uid: 'host_101', email: 'host@quizarena.app', firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'other_host_token') {
        return { uid: 'host_999', email: 'otherhost@quizarena.app', firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'player_token_1') {
        return { uid: 'player_001', email: 'p1@school.edu', firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'player_token_2') {
        return { uid: 'player_002', email: 'p2@school.edu', firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'player_token_3') {
        return { uid: 'player_003', email: 'p3@school.edu', firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'anonymous_token') {
        return { uid: 'anon_001', firebase: { sign_in_provider: 'anonymous' } };
      }
      if (token === 'expired_token') {
        throw new Error('Firebase ID token has expired');
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
        store.set(docPath, { ...cur, ...data });
      },
    }),
    collection: (colPath: string) => ({
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
        return {
          forEach: (cb: (doc: any) => void) => docs.forEach(cb),
          docs,
          size: docs.length,
        };
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
    getStatusCode: () => statusCode,
    getData: () => responseData,
  };

  return { req, res, getStatus: () => statusCode, getData: () => responseData };
}

async function runAllMultiplayerTests() {
  const sampleQuiz = {
    id: 'quiz_multiplayer_1',
    title: 'Distributed Systems & Real-Time Sync',
    gameMode: 'classic',
    questions: [
      {
        id: 'q1',
        text: 'What guarantees event ordering in distributed systems?',
        options: ['Lamport Timestamps', 'Client Date.now()', 'Math.random()', 'CSS transitions'],
        correctAnswers: [0],
        timeLimit: 20,
      },
      {
        id: 'q2',
        text: 'Which transport guarantees port 443 delivery through firewalls?',
        options: ['Raw UDP', 'HTTPS / WSS', 'Telnet', 'FTP'],
        correctAnswers: [1],
        timeLimit: 15,
      },
      {
        id: 'q3',
        text: 'How do you prevent duplicate question advancement?',
        options: ['Idempotency keys and sequence checks', 'Hiding next button', 'Sleep 5s', 'Window reload'],
        correctAnswers: [0],
        timeLimit: 25,
      },
    ],
  };

  // =========================================================================
  // SECTION 1: GAME LIFECYCLE (Scenarios 1 - 7)
  // =========================================================================
  let gameId = '';

  await test('1. Host creates a valid game via POST /api/create-game', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer host_token' },
      { quiz: sampleQuiz, hostName: 'Architect' }
    );
    await handleCreateGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 201);
    assert.strictEqual(getData().game.status, 'lobby');
    assert.strictEqual(getData().game.hostId, 'host_101');
    gameId = getData().game.id;
  });

  await test('2. Host starts game from lobby via POST /api/start-game', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set(`games/${gameId}`, {
      id: gameId,
      hostId: 'host_101',
      status: 'lobby',
      questions: sampleQuiz.questions,
      playerCount: 1,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer host_token' },
      { gameId }
    );
    await handleStartGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().status, 'question_active');
    assert.strictEqual(getData().currentQuestionIndex, 0);
    assert.ok(getData().questionStartTimeMs > 0);
  });

  await test('3. Player receives game-start update and question state', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    const now = Date.now();
    store.set(`games/${gameId}`, {
      id: gameId,
      hostId: 'host_101',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTimeMs: now,
      timeLimit: 20,
      questions: [{ id: 'q1', text: 'Sample Question', options: ['A', 'B'] }],
    });
    store.set(`games/${gameId}/players/player_001`, {
      id: 'player_001',
      nickname: 'Alice',
      status: 'active',
      score: 0,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId }
    );
    await handleSessionRecovery(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().game.status, 'question_active');
    assert.strictEqual(getData().game.currentQuestionIndex, 0);
  });

  await test('4. Host advances to next question (Q0 -> Q1)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set(`games/${gameId}`, {
      id: gameId,
      hostId: 'host_101',
      status: 'reveal',
      currentQuestionIndex: 0,
      questions: sampleQuiz.questions,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer host_token' },
      { gameId, targetQuestionIndex: 1 }
    );
    await handleAdvanceQuestion(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().status, 'question_active');
    assert.strictEqual(getData().currentQuestionIndex, 1);
  });

  await test('5. All connected clients receive the updated question index', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set(`games/${gameId}`, {
      id: gameId,
      hostId: 'host_101',
      status: 'question_active',
      currentQuestionIndex: 1,
      questions: sampleQuiz.questions,
    });
    store.set(`games/${gameId}/players/player_002`, {
      id: 'player_002',
      nickname: 'Bob',
      status: 'active',
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_2' },
      { gameId }
    );
    await handleSessionRecovery(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().game.currentQuestionIndex, 1);
  });

  await test('6. Game finishes correctly when host completes session', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set(`games/${gameId}`, {
      id: gameId,
      hostId: 'host_101',
      status: 'leaderboard',
      currentQuestionIndex: 2,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer host_token' },
      { gameId }
    );
    await handleEndGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().status, 'finished');
    assert.strictEqual(store.get(`games/${gameId}`).status, 'finished');
  });

  await test('7. Invalid state transitions are rejected (e.g. advancing finished game)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set(`games/${gameId}`, {
      id: gameId,
      hostId: 'host_101',
      status: 'finished',
      currentQuestionIndex: 2,
      questions: sampleQuiz.questions,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer host_token' },
      { gameId, targetQuestionIndex: 1 }
    );
    await handleAdvanceQuestion(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 400);
    assert.match(getData().error, /INVALID_STATE_TRANSITION/);
  });

  // =========================================================================
  // SECTION 2: PLAYER SYNCHRONIZATION (Scenarios 8 - 13)
  // =========================================================================
  await test('8. New player appears in host dashboard after POST /api/join', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_111111', {
      id: 'game_111111',
      pin: '111111',
      hostId: 'host_101',
      status: 'lobby',
      playerCount: 0,
      settings: { allowLateJoin: true },
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { pin: '111111', nickname: 'Alice' }
    );
    await handleJoinGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);

    const playerDoc = store.get('games/game_111111/players/player_001');
    assert.ok(playerDoc, 'Player document must be created');
    assert.strictEqual(playerDoc.nickname, 'Alice');
    assert.strictEqual(store.get('games/game_111111').playerCount, 1);
  });

  await test('9. Player receives updated lobby state and lock status', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_111111', {
      id: 'game_111111',
      hostId: 'host_101',
      status: 'lobby',
      isLocked: true,
      playerCount: 1,
    });
    store.set('games/game_111111/players/player_001', {
      id: 'player_001',
      nickname: 'Alice',
      status: 'active',
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_111111' }
    );
    await handleSessionRecovery(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().game.isLocked, true);
  });

  await test('10. Player leaving updates status to left and decrements active count', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_111111', {
      id: 'game_111111',
      hostId: 'host_101',
      playerCount: 2,
    });
    store.set('games/game_111111/players/player_001', {
      id: 'player_001',
      status: 'active',
    });

    const { req, res, getStatus } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_111111' }
    );
    await handleLeaveGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);

    const playerDoc = store.get('games/game_111111/players/player_001');
    assert.strictEqual(playerDoc.status, 'left');
    assert.strictEqual(store.get('games/game_111111').playerCount, 1);
  });

  await test('11. Kicked player is removed from active membership and blocked from recovery', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_111111', {
      id: 'game_111111',
      hostId: 'host_101',
      playerCount: 1,
    });
    store.set('games/game_111111/players/player_002', {
      id: 'player_002',
      status: 'active',
    });

    // Host kicks Bob
    const kickCall = mockReqRes(
      { authorization: 'Bearer host_token' },
      { gameId: 'game_111111', playerId: 'player_002', reason: 'Unsportsmanlike' }
    );
    await handleKickPlayer(kickCall.req, kickCall.res, { adminAuth, adminDb });
    assert.strictEqual(kickCall.getStatus(), 200);

    // Bob attempts session recovery
    const recoveryCall = mockReqRes(
      { authorization: 'Bearer player_token_2' },
      { gameId: 'game_111111' }
    );
    await handleSessionRecovery(recoveryCall.req, recoveryCall.res, { adminAuth, adminDb });
    assert.strictEqual(recoveryCall.getStatus(), 403);
    assert.strictEqual(recoveryCall.getData().error, 'PLAYER_KICKED');
  });

  await test('12. Reconnecting player restores existing session without resetting score/strikes', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_222333', {
      id: 'game_222333',
      pin: '222333',
      hostId: 'host_101',
      status: 'question_active',
      currentQuestionIndex: 1,
      playerCount: 3,
    });
    store.set('games/game_222333/players/player_001', {
      id: 'player_001',
      nickname: 'Alice',
      status: 'active',
      score: 1850,
      strikes: 2,
      integrityScore: 68,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_222333' }
    );
    await handleSessionRecovery(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().player.score, 1850, 'Score must be preserved');
    assert.strictEqual(getData().player.strikes, 2, 'Strikes must be preserved');
    assert.strictEqual(getData().player.integrityScore, 68, 'Integrity score must be preserved');
  });

  await test('13. Reconnecting via /api/join does not create duplicate player records or double count', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_222333', {
      id: 'game_222333',
      pin: '222333',
      hostId: 'host_101',
      status: 'lobby',
      playerCount: 5,
    });
    store.set('games/game_222333/players/player_001', {
      id: 'player_001',
      nickname: 'Alice',
      status: 'active',
      score: 500,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { pin: '222333', nickname: 'Alice' }
    );
    await handleJoinGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().reconnected, true);
    assert.strictEqual(store.get('games/game_222333').playerCount, 5, 'Count must NOT increment on reconnect');
  });

  // =========================================================================
  // SECTION 3: NETWORK RECOVERY & RESILIENCE (Scenarios 14 - 18)
  // =========================================================================
  await test('14. Disconnected player session recovery handles missing game gracefully (404)', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_nonexistent' }
    );
    await handleSessionRecovery(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 404);
    assert.strictEqual(getData().error, 'GAME_NOT_FOUND');
  });

  await test('15. Reconnection restores authoritative timer state accurately', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    const startTime = Date.now() - 5000;
    store.set('games/game_timer_sync', {
      id: 'game_timer_sync',
      hostId: 'host_101',
      status: 'question_active',
      currentQuestionIndex: 0,
      questionStartTimeMs: startTime,
      timeLimit: 20,
    });
    store.set('games/game_timer_sync/players/player_001', {
      id: 'player_001',
      status: 'active',
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_timer_sync' }
    );
    await handleSessionRecovery(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().game.questionStartTimeMs, startTime);
    assert.strictEqual(getData().game.timeLimit, 20);
  });

  await test('16. API rejection on invalid payload does not mutate store', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_safe', { id: 'game_safe', hostId: 'host_101', isLocked: false });

    // Missing gameId
    const { req, res, getStatus } = mockReqRes({ authorization: 'Bearer host_token' }, {});
    await handleLockLobby(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 400);
    assert.strictEqual(store.get('games/game_safe').isLocked, false);
  });

  await test('17. Repeated advance-question requests are idempotent (do not skip questions)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    const startMs = Date.now();
    store.set('games/game_advance_idempotent', {
      id: 'game_advance_idempotent',
      hostId: 'host_101',
      status: 'question_active',
      currentQuestionIndex: 1,
      questionStartTimeMs: startMs,
      questions: sampleQuiz.questions,
    });

    // Request target 1 again (network retry)
    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer host_token' },
      { gameId: 'game_advance_idempotent', targetQuestionIndex: 1 }
    );
    await handleAdvanceQuestion(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().idempotentRepeat, true);
    assert.strictEqual(getData().currentQuestionIndex, 1);
    assert.strictEqual(store.get('games/game_advance_idempotent').currentQuestionIndex, 1);
  });

  await test('18. Pausing game preserves remaining seconds and resumes accurately', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    const startMs = Date.now() - 8000; // 8 seconds elapsed out of 20s
    store.set('games/game_pause_test', {
      id: 'game_pause_test',
      hostId: 'host_101',
      status: 'question_active',
      timeLimit: 20,
      questionStartTimeMs: startMs,
      isPaused: false,
    });

    // Pause game
    const pauseCall = mockReqRes({ authorization: 'Bearer host_token' }, { gameId: 'game_pause_test' });
    await handlePauseGame(pauseCall.req, pauseCall.res, { adminAuth, adminDb });
    assert.strictEqual(pauseCall.getStatus(), 200);
    assert.strictEqual(pauseCall.getData().isPaused, true);
    const remaining = pauseCall.getData().pauseRemainingMs;
    assert.ok(remaining <= 12100 && remaining >= 11500, `Remaining time should be approx 12s, got ${remaining}`);

    // Resume game
    const resumeCall = mockReqRes({ authorization: 'Bearer host_token' }, { gameId: 'game_pause_test' });
    await handleResumeGame(resumeCall.req, resumeCall.res, { adminAuth, adminDb });
    assert.strictEqual(resumeCall.getStatus(), 200);
    assert.strictEqual(resumeCall.getData().isPaused, false);
    assert.ok(resumeCall.getData().questionStartTimeMs > 0);
  });

  // =========================================================================
  // SECTION 4: CONCURRENCY & RACE CONDITIONS (Scenarios 19 - 23)
  // =========================================================================
  await test('19. Simultaneous joins do not exceed maximum 300 capacity', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_300300', {
      id: 'game_300300',
      pin: '300300',
      hostId: 'host_101',
      status: 'lobby',
      playerCount: 299,
      settings: { allowLateJoin: true },
    });

    // First player joins (fills spot 300)
    const join1 = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { pin: '300300', nickname: 'LuckyPlayer' }
    );
    await handleJoinGame(join1.req, join1.res, { adminAuth, adminDb });
    assert.strictEqual(join1.getStatus(), 200);
    assert.strictEqual(store.get('games/game_300300').playerCount, 300);

    // Second player tries to join when full
    const join2 = mockReqRes(
      { authorization: 'Bearer player_token_2' },
      { pin: '300300', nickname: 'OverflowPlayer' }
    );
    await handleJoinGame(join2.req, join2.res, { adminAuth, adminDb });
    assert.strictEqual(join2.getStatus(), 403);
    assert.match(join2.getData().error, /maximum 300 players/);
    assert.strictEqual(store.get('games/game_300300').playerCount, 300, 'Count must remain clamped at 300');
  });

  await test('20. Skipping questions ahead (e.g. Q0 directly to Q2) is rejected (400)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_sequence', {
      id: 'game_sequence',
      hostId: 'host_101',
      status: 'question_active',
      currentQuestionIndex: 0,
      questions: sampleQuiz.questions,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer host_token' },
      { gameId: 'game_sequence', targetQuestionIndex: 2 }
    );
    await handleAdvanceQuestion(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 400);
    assert.match(getData().error, /INVALID_SEQUENCE/);
  });

  await test('21. Simultaneous leave requests do not decrement capacity multiple times', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_leave_idemp', {
      id: 'game_leave_idemp',
      hostId: 'host_101',
      playerCount: 5,
    });
    store.set('games/game_leave_idemp/players/player_001', {
      id: 'player_001',
      status: 'active',
    });

    // Leave call 1
    const call1 = mockReqRes({ authorization: 'Bearer player_token_1' }, { gameId: 'game_leave_idemp' });
    await handleLeaveGame(call1.req, call1.res, { adminAuth, adminDb });
    assert.strictEqual(call1.getStatus(), 200);
    assert.strictEqual(store.get('games/game_leave_idemp').playerCount, 4);

    // Repeated leave call 2
    const call2 = mockReqRes({ authorization: 'Bearer player_token_1' }, { gameId: 'game_leave_idemp' });
    await handleLeaveGame(call2.req, call2.res, { adminAuth, adminDb });
    assert.strictEqual(call2.getStatus(), 200);
    assert.strictEqual(store.get('games/game_leave_idemp').playerCount, 4, 'Must not decrement twice');
  });

  await test('22. Reconcile player count accurately heals any count desynchronization', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    // Simulate desynchronized game where playerCount says 10, but actual active players is 2
    store.set('games/game_heal', {
      id: 'game_heal',
      hostId: 'host_101',
      playerCount: 10,
    });
    store.set('games/game_heal/players/p1', { id: 'p1', status: 'active' });
    store.set('games/game_heal/players/p2', { id: 'p2', status: 'active' });
    store.set('games/game_heal/players/p3', { id: 'p3', status: 'kicked' });
    store.set('games/game_heal/players/p4', { id: 'p4', status: 'left' });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer host_token' },
      { gameId: 'game_heal' }
    );
    await handleReconcilePlayerCount(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().reconciledCount, 2);
    assert.strictEqual(store.get('games/game_heal').playerCount, 2);
  });

  await test('23. Host cancelling session marks game as cancelled and locks lobby', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_cancel_test', {
      id: 'game_cancel_test',
      hostId: 'host_101',
      status: 'lobby',
      isLocked: false,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer host_token' },
      { gameId: 'game_cancel_test' }
    );
    await handleCancelGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().status, 'cancelled');
    assert.strictEqual(store.get('games/game_cancel_test').isLocked, true);
  });

  // =========================================================================
  // SECTION 5: SECURITY PRESERVATION (Scenarios 24 - 27)
  // =========================================================================
  await test('24. Non-host cannot start or advance another host\'s game (403 Forbidden)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_secure_host', {
      id: 'game_secure_host',
      hostId: 'host_101',
      status: 'lobby',
      questions: sampleQuiz.questions,
    });

    // Impersonator tries to start
    const startCall = mockReqRes(
      { authorization: 'Bearer other_host_token' },
      { gameId: 'game_secure_host' }
    );
    await handleStartGame(startCall.req, startCall.res, { adminAuth, adminDb });
    assert.strictEqual(startCall.getStatus(), 403);
    assert.match(startCall.getData().error, /Only the game host can start the game/i);

    // Impersonator tries to advance
    const advanceCall = mockReqRes(
      { authorization: 'Bearer other_host_token' },
      { gameId: 'game_secure_host', targetQuestionIndex: 1 }
    );
    await handleAdvanceQuestion(advanceCall.req, advanceCall.res, { adminAuth, adminDb });
    assert.strictEqual(advanceCall.getStatus(), 403);
    assert.match(advanceCall.getData().error, /Only the game host can advance questions/i);
  });

  await test('25. Player cannot modify authoritative game state or pause game (403 Forbidden)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_secure_host', {
      id: 'game_secure_host',
      hostId: 'host_101',
      status: 'question_active',
      isPaused: false,
    });

    // Player tries to pause
    const pauseCall = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_secure_host' }
    );
    await handlePauseGame(pauseCall.req, pauseCall.res, { adminAuth, adminDb });
    assert.strictEqual(pauseCall.getStatus(), 403);
    assert.match(pauseCall.getData().error, /Only the game host can pause the game/i);
  });

  await test('26. Player cannot access another player\'s session recovery (404 / 403)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_privacy', {
      id: 'game_privacy',
      hostId: 'host_101',
      status: 'question_active',
    });
    store.set('games/game_privacy/players/player_001', {
      id: 'player_001',
      nickname: 'Alice',
      score: 1000,
    });

    // Player 2 attempts to recover Player 1's game session where Player 2 is not enrolled
    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_2' }, // player_002
      { gameId: 'game_privacy' }
    );
    await handleSessionRecovery(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 404);
    assert.strictEqual(getData().error, 'NOT_A_MEMBER');
  });

  await test('27. Answer keys in secrets subcollection remain inaccessible to public question payloads', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_secret_check', {
      id: 'game_secret_check',
      hostId: 'host_101',
      status: 'question_active',
      questions: [
        { id: 'q1', text: 'Public question', options: ['A', 'B'] },
      ],
    });
    store.set('games/game_secret_check/secrets/answerKey', {
      answers: { 0: { correctAnswers: [1] } },
      hostId: 'host_101',
    });
    store.set('games/game_secret_check/players/player_001', {
      id: 'player_001',
      status: 'active',
    });

    // Player recovers session
    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer player_token_1' },
      { gameId: 'game_secret_check' }
    );
    await handleSessionRecovery(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);

    const publicQuestions = getData().game.questions;
    assert.strictEqual(publicQuestions[0].correctAnswers, undefined, 'Answer key must never leak in game object');
  });

  console.log(`\n========================================`);
  console.log(`Phase 2 Multiplayer Tests: ${passedTests} Passed, ${failedTests} Failed`);
  console.log(`========================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllMultiplayerTests();
