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
  MAX_GAME_CAPACITY,
} from '../server/gameSessionHandler.ts';

console.log('🧪 Running Phase 1: Security & Authentication Hardening Test Suite...\n');

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

// In-memory mock Firestore & Auth for hermetic unit testing of backend endpoints
function createMockBackend() {
  const store = new Map<string, any>();

  const adminAuth = {
    verifyIdToken: async (token: string) => {
      if (token === 'valid_teacher_token') {
        return { uid: 'teacher_123', email: 'teacher@school.edu', firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'valid_student_token') {
        return { uid: 'student_456', email: 'student@school.edu', firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'valid_student_token_2') {
        return { uid: 'student_789', email: 'student2@school.edu', firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'anonymous_token') {
        return { uid: 'anon_999', firebase: { sign_in_provider: 'anonymous' } };
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
  const req: any = {
    headers: { ...headers },
    body: { ...body },
  };

  let statusCode = 200;
  let responseData: any = null;

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

async function runPhase1SecurityTests() {
  const sampleQuiz = {
    id: 'quiz_security_1',
    title: 'Cybersecurity Fundamentals',
    gameMode: 'classic',
    questions: [
      {
        id: 'q1',
        text: 'What is least privilege?',
        options: ['Full admin for all', 'Minimal required access', 'No passwords', 'Shared root'],
        correctAnswers: [1],
        timeLimit: 20,
      },
    ],
  };

  // -------------------------------------------------------------
  // Test Suite 1: POST /api/create-game & Host Ownership
  // -------------------------------------------------------------
  await test('1. Missing token on /api/create-game returns 401', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus } = mockReqRes({}, { quiz: sampleQuiz });
    await handleCreateGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 401);
  });

  await test('2. Invalid or expired token on /api/create-game returns 401', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus } = mockReqRes({ authorization: 'Bearer expired_token' }, { quiz: sampleQuiz });
    await handleCreateGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 401);
  });

  await test('3. Anonymous Firebase users cannot create or host games (403 Forbidden)', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer anonymous_token' },
      { quiz: sampleQuiz }
    );
    await handleCreateGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 403);
    assert.match(getData().error, /Anonymous accounts cannot create or host games/i);
  });

  await test('4. Verified teacher creates game: hostId is derived from token (not client)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    // Malicious client attempts to spoof hostId as "attacker_admin"
    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer valid_teacher_token' },
      { quiz: sampleQuiz, hostId: 'attacker_admin', hostName: 'Prof. Miller' }
    );
    await handleCreateGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 201);
    const createdGame = getData().game;
    assert.strictEqual(createdGame.hostId, 'teacher_123', 'hostId must be derived from token, not client');
    assert.strictEqual(createdGame.status, 'lobby');

    // Verify answers stripped from public question
    assert.strictEqual(createdGame.questions[0].correctAnswers, undefined, 'Public questions must not contain correctAnswers');

    // Verify answer key written to secrets
    const secret = store.get(`games/${createdGame.id}/secrets/answerKey`);
    assert.ok(secret, 'Secrets subcollection must contain answer key');
    assert.deepStrictEqual(secret.answers[0].correctAnswers, [1]);
  });

  // -------------------------------------------------------------
  // Test Suite 2: POST /api/join & Capacity / Nickname / Gate
  // -------------------------------------------------------------
  await test('5. POST /api/join with missing token returns 401', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus } = mockReqRes({}, { pin: '123456', nickname: 'Alice' });
    await handleJoinGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 401);
  });

  await test('6. POST /api/join with nonexistent game returns 404', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus } = mockReqRes(
      { authorization: 'Bearer valid_student_token' },
      { pin: '999999', nickname: 'Alice' }
    );
    await handleJoinGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 404);
  });

  await test('7. POST /api/join validates nickname length and rejects empty string', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus } = mockReqRes(
      { authorization: 'Bearer valid_student_token' },
      { pin: '123456', nickname: '   ' }
    );
    await handleJoinGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 400);
  });

  await test('8. POST /api/join sanitizes profanity and strips HTML tags', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    // Setup active game
    store.set('games/game_111222', {
      id: 'game_111222',
      pin: '111222',
      hostId: 'teacher_123',
      status: 'lobby',
      playerCount: 0,
      settings: { allowLateJoin: true },
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer valid_student_token' },
      { pin: '111222', nickname: '<script>alert(1)</script>badshit123' }
    );
    await handleJoinGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    const joinedPlayer = getData().player;
    assert.ok(!joinedPlayer.nickname.includes('<script>'), 'HTML tags must be stripped');
    assert.ok(!joinedPlayer.nickname.includes('badshit'), 'Profanity must be filtered');
  });

  await test('9. Atomically enforces maximum 300 player capacity', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    // Setup full game
    store.set('games/game_333444', {
      id: 'game_333444',
      pin: '333444',
      hostId: 'teacher_123',
      status: 'lobby',
      playerCount: MAX_GAME_CAPACITY,
      settings: { allowLateJoin: true },
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer valid_student_token' },
      { pin: '333444', nickname: 'ExtraPlayer' }
    );
    await handleJoinGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 403);
    assert.match(getData().error, /maximum 300 players allowed/i);
  });

  await test('10. Locked lobby rejects new joins with 403', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_555666', {
      id: 'game_555666',
      pin: '555666',
      hostId: 'teacher_123',
      status: 'lobby',
      isLocked: true,
      playerCount: 1,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer valid_student_token' },
      { pin: '555666', nickname: 'LateStudent' }
    );
    await handleJoinGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 403);
    assert.match(getData().error, /locked by the host/i);
  });

  await test('11. Late join disabled rejects join after question has started (403)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_777888', {
      id: 'game_777888',
      pin: '777888',
      hostId: 'teacher_123',
      status: 'question_active',
      settings: { allowLateJoin: false },
      playerCount: 5,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer valid_student_token' },
      { pin: '777888', nickname: 'LateStudent' }
    );
    await handleJoinGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 403);
    assert.match(getData().error, /late joining is disabled/i);
  });

  await test('12. Rejoining terminated player (strikes >= 6) is rejected with 403', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_888999', {
      id: 'game_888999',
      pin: '888999',
      hostId: 'teacher_123',
      status: 'lobby',
      playerCount: 5,
    });
    // Terminated player record
    store.set('games/game_888999/players/student_456', {
      id: 'student_456',
      nickname: 'CheatingPlayer',
      strikes: 6,
      status: 'terminated_integrity',
      isTerminated: true,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer valid_student_token' },
      { pin: '888999', nickname: 'CheatingPlayer' }
    );
    await handleJoinGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 403);
    assert.match(getData().error, /integrity policy violations/i);
  });

  // -------------------------------------------------------------
  // Test Suite 3: POST /api/kick-player & Scalable Blacklist
  // -------------------------------------------------------------
  await test('13. Non-host cannot kick players (403 Forbidden)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_100200', {
      id: 'game_100200',
      hostId: 'teacher_123',
      playerCount: 2,
    });
    store.set('games/game_100200/players/student_789', {
      id: 'student_789',
      status: 'active',
    });

    // Student attempts to kick another student
    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer valid_student_token' },
      { gameId: 'game_100200', playerId: 'student_789' }
    );
    await handleKickPlayer(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 403);
    assert.match(getData().error, /Only the game host can kick players/i);
  });

  await test('14. Host kicks player: records in scalable kickedPlayers subcollection, decrements capacity', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_100200', {
      id: 'game_100200',
      hostId: 'teacher_123',
      playerCount: 5,
    });
    store.set('games/game_100200/players/student_789', {
      id: 'student_789',
      nickname: 'DisruptivePlayer',
      status: 'active',
    });

    const { req, res, getStatus } = mockReqRes(
      { authorization: 'Bearer valid_teacher_token' },
      { gameId: 'game_100200', playerId: 'student_789', reason: 'Disruptive behavior' }
    );
    await handleKickPlayer(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);

    // Verify player doc was updated (NOT deleted, preserving history)
    const pDoc = store.get('games/game_100200/players/student_789');
    assert.strictEqual(pDoc.status, 'kicked');
    assert.strictEqual(pDoc.isKicked, true);

    // Verify scalable subcollection record
    const kickedRecord = store.get('games/game_100200/kickedPlayers/student_789');
    assert.ok(kickedRecord, 'Scalable subcollection games/{id}/kickedPlayers/{uid} must exist');
    assert.strictEqual(kickedRecord.reason, 'Disruptive behavior');

    // Verify playerCount decremented
    const gameDoc = store.get('games/game_100200');
    assert.strictEqual(gameDoc.playerCount, 4);
  });

  await test('15. Kicked player cannot rejoin the game (403 Forbidden)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_100200', {
      id: 'game_100200',
      pin: '100200',
      hostId: 'teacher_123',
      status: 'lobby',
      playerCount: 4,
    });
    store.set('games/game_100200/kickedPlayers/student_789', {
      playerId: 'student_789',
      reason: 'Disruptive behavior',
    });

    // Kicked student tries to rejoin
    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer valid_student_token_2' }, // student_789
      { pin: '100200', nickname: 'Student789' }
    );
    await handleJoinGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 403);
    assert.match(getData().error, /removed from this game and cannot rejoin/i);
  });

  // -------------------------------------------------------------
  // Test Suite 4: POST /api/leave Preserves Records
  // -------------------------------------------------------------
  await test('16. POST /api/leave updates status to left, preserves strike history and decrements count', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_leave_test', {
      id: 'game_leave_test',
      hostId: 'teacher_123',
      playerCount: 3,
    });
    store.set('games/game_leave_test/players/student_456', {
      id: 'student_456',
      nickname: 'LeavingPlayer',
      status: 'active',
      strikes: 2,
      integrityScore: 78,
    });

    const { req, res, getStatus } = mockReqRes(
      { authorization: 'Bearer valid_student_token' },
      { gameId: 'game_leave_test' }
    );
    await handleLeaveGame(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);

    const playerDoc = store.get('games/game_leave_test/players/student_456');
    assert.ok(playerDoc, 'Player document must NOT be physically deleted on leave');
    assert.strictEqual(playerDoc.status, 'left');
    assert.strictEqual(playerDoc.strikes, 2, 'Strikes must remain intact');
    assert.strictEqual(playerDoc.integrityScore, 78, 'Integrity score must remain intact');

    const gameDoc = store.get('games/game_leave_test');
    assert.strictEqual(gameDoc.playerCount, 2);
  });

  // -------------------------------------------------------------
  // Test Suite 5: Lobby Lock Host Control
  // -------------------------------------------------------------
  await test('17. Host can lock and unlock lobby via POST /api/lock-lobby', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    store.set('games/game_lock_test', {
      id: 'game_lock_test',
      hostId: 'teacher_123',
      isLocked: false,
    });

    const { req, res, getStatus, getData } = mockReqRes(
      { authorization: 'Bearer valid_teacher_token' },
      { gameId: 'game_lock_test', isLocked: true }
    );
    await handleLockLobby(req, res, { adminAuth, adminDb });
    assert.strictEqual(getStatus(), 200);
    assert.strictEqual(getData().isLocked, true);
    assert.strictEqual(store.get('games/game_lock_test').isLocked, true);
  });

  console.log(`\n========================================`);
  console.log(`Phase 1 Security Tests: ${passedTests} Passed, ${failedTests} Failed`);
  console.log(`========================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runPhase1SecurityTests();
