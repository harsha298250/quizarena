/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleCreateTournament,
  handleRegisterTournament,
  handleCancelRegistration,
  handleStartRound,
  handleFinalizeMatch,
  handleGetTournamentStandings,
  inMemoryTournaments,
  inMemoryRegistrations,
} from '../server/tournamentHandler.ts';
import {
  handleIssueCertificate,
} from '../server/notificationHandler.ts';
import {
  certificateStore,
  verificationIdIndex,
  idempotencyIndex,
} from '../server/certificateEngine.ts';
import { sharedRateLimiter } from '../server/sharedRateLimiter.ts';

function createStatefulFirestoreMock() {
  const rootCols = new Map<string, Map<string, any>>();
  const subCols = new Map<string, Map<string, any>>();
  let txLock = Promise.resolve();

  const getColMap = (path: string, isRoot = true) => {
    const store = isRoot ? rootCols : subCols;
    if (!store.has(path)) store.set(path, new Map());
    return store.get(path)!;
  };

  const makeDocRef = (colPath: string, docId: string, isRoot: boolean) => {
    const map = getColMap(colPath, isRoot);
    const fullPath = `${colPath}/${docId}`;
    return {
      colPath,
      docId,
      isRoot,
      get: async () => ({
        exists: map.has(docId),
        id: docId,
        data: () => (map.has(docId) ? structuredClone(map.get(docId)) : undefined),
      }),
      set: async (data: any, opts?: { merge?: boolean }) => {
        const prev = opts?.merge ? map.get(docId) || {} : {};
        map.set(docId, opts?.merge ? { ...prev, ...structuredClone(data) } : structuredClone(data));
      },
      collection: (subName: string) => makeColRef(`${fullPath}/${subName}`, false),
    };
  };

  const makeColRef = (colPath: string, isRoot: boolean) => {
    const map = getColMap(colPath, isRoot);
    return {
      doc: (docId: string) => makeDocRef(colPath, docId, isRoot),
      get: async () => ({
        empty: map.size === 0,
        size: map.size,
        docs: Array.from(map.entries()).map(([id, data]) => ({
          id,
          data: () => structuredClone(data),
        })),
      }),
      where: (field: string, _op: string, value: any) => ({
        limit: (n: number) => ({
          get: async () => {
            const docs = Array.from(map.entries())
              .filter(([, d]) => d?.[field] === value)
              .slice(0, n)
              .map(([id, data]) => ({ id, data: () => structuredClone(data) }));
            return { empty: docs.length === 0, size: docs.length, docs };
          },
        }),
        get: async () => {
          const docs = Array.from(map.entries())
            .filter(([, d]) => d?.[field] === value)
            .map(([id, data]) => ({ id, data: () => structuredClone(data) }));
          return { empty: docs.length === 0, size: docs.length, docs };
        },
      }),
    };
  };

  const db: any = {
    collection: (name: string) => makeColRef(name, true),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const run = async () => {
        const writes: Array<{ ref: any; data: any; merge?: boolean }> = [];
        const tx = {
          get: async (target: any) => target.get(),
          set: (ref: any, data: any, opts?: { merge?: boolean }) => {
            writes.push({ ref, data, merge: opts?.merge });
          },
        };
        const res = await fn(tx);
        for (const w of writes) {
          await w.ref.set(w.data, { merge: w.merge });
        }
        return res;
      };
      const next = txLock.then(run, run);
      txLock = next.catch(() => {});
      return next;
    },
    _rootCols: rootCols,
    _subCols: subCols,
  };

  return db;
}

function createMockReqRes(options: { body?: any; params?: any; headers?: any } = {}) {
  const req: any = {
    body: options.body || {},
    params: options.params || {},
    headers: options.headers || {},
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
  };
  const adminAuth: any = {
    verifyIdToken: async (token: string) => {
      if (token === 'host_token') return { uid: 'host_1', name: 'Prof. Turing', email_verified: true, firebase: { sign_in_provider: 'password' } };
      if (token === 'p1_token') return { uid: 'p1', name: 'Alice', firebase: { sign_in_provider: 'google.com' } };
      if (token === 'p2_token') return { uid: 'p2', name: 'Bob', firebase: { sign_in_provider: 'google.com' } };
      if (token === 'p3_token') return { uid: 'p3', name: 'Charlie', firebase: { sign_in_provider: 'google.com' } };
      if (token === 'p4_token') return { uid: 'p4', name: 'Diana', firebase: { sign_in_provider: 'google.com' } };
      if (token === 'admin_token') return { uid: 'admin_1', admin: true, email_verified: true, firebase: { sign_in_provider: 'password' } };
      if (token === 'anon_token') return { uid: 'anon_1', firebase: { sign_in_provider: 'anonymous' } };
      throw new Error('Invalid token');
    },
  };
  return { req, res, getStatus: () => statusCode, getData: () => responseData, adminAuth };
}

describe('Phase 3 — Persistent Tournament Management Suite', () => {
  beforeEach(() => {
    sharedRateLimiter.reset();
    inMemoryTournaments.clear();
    inMemoryRegistrations.clear();
    certificateStore.clear();
    verificationIdIndex.clear();
    idempotencyIndex.clear();
  });

  it('[P3-01] tournament creation, registration, bracket progression, results, and standings survive restarts', async () => {
    const db = createStatefulFirestoreMock();
    const deadline = new Date(Date.now() + 86400000).toISOString();

    // 1. Create tournament in Firestore
    const createCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: {
        title: 'Persistent Algo Cup',
        description: 'Firestore-backed tournament',
        maxParticipants: 4,
        minParticipants: 2,
        registrationDeadline: deadline,
        quizzes: ['quiz_1'],
      },
    });
    await handleCreateTournament(createCtx.req, createCtx.res, { adminAuth: createCtx.adminAuth, adminDb: db });
    expect(createCtx.getStatus()).toBe(201);
    const tId = createCtx.getData().tournament.id;

    // In-memory Maps remain completely untouched
    expect(inMemoryTournaments.size).toBe(0);
    expect(inMemoryRegistrations.size).toBe(0);

    // 2. Register p1 and p2
    for (const [token, nickname] of [
      ['p1_token', 'Alice'],
      ['p2_token', 'Bob'],
    ]) {
      const regCtx = createMockReqRes({
        headers: { authorization: `Bearer ${token}` },
        body: { tournamentId: tId, nickname },
      });
      await handleRegisterTournament(regCtx.req, regCtx.res, { adminAuth: regCtx.adminAuth, adminDb: db });
      expect(regCtx.getStatus()).toBe(200);
    }

    // 3. Start Round 1 (generates bracket in Firestore)
    const startCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: tId },
    });
    await handleStartRound(startCtx.req, startCtx.res, { adminAuth: startCtx.adminAuth, adminDb: db });
    expect(startCtx.getStatus()).toBe(200);
    const matchId = startCtx.getData().round.matches[0].id;

    // 4. Finalize match
    const finCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: tId, matchId, winnerId: 'p1', score1: 1800, score2: 1200 },
    });
    await handleFinalizeMatch(finCtx.req, finCtx.res, { adminAuth: finCtx.adminAuth, adminDb: db });
    expect(finCtx.getStatus()).toBe(200);

    // 5. Complete tournament
    const completeCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: tId },
    });
    await handleStartRound(completeCtx.req, completeCtx.res, { adminAuth: completeCtx.adminAuth, adminDb: db });
    expect(completeCtx.getStatus()).toBe(200);
    expect(completeCtx.getData().tournament.status).toBe('completed');
    expect(completeCtx.getData().tournament.championId).toBe('p1');

    // 6. Reconstruct standings from Firestore (simulating fresh process)
    const standingsCtx = createMockReqRes({ params: { id: tId } });
    await handleGetTournamentStandings(standingsCtx.req, standingsCtx.res, {
      adminAuth: standingsCtx.adminAuth,
      adminDb: db,
    });
    expect(standingsCtx.getStatus()).toBe(200);
    const standings = standingsCtx.getData().standings;
    expect(standings).toHaveLength(2);
    expect(standings[0].participantId).toBe('p1');
    expect(standings[0].rank).toBe(1);
    expect(standings[1].participantId).toBe('p2');
    expect(standings[1].rank).toBe(2);
  });

  it('[P3-02] registration enforces auth, anti-spoofing, duplicate rejection, and concurrent capacity', async () => {
    const db = createStatefulFirestoreMock();
    const createCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: {
        title: 'Capacity 2 Cup',
        maxParticipants: 2,
        minParticipants: 2,
        registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
        quizzes: ['quiz_1'],
      },
    });
    await handleCreateTournament(createCtx.req, createCtx.res, { adminAuth: createCtx.adminAuth, adminDb: db });
    const tId = createCtx.getData().tournament.id;

    // Unauthenticated rejected (401)
    const unauth = createMockReqRes({ body: { tournamentId: tId } });
    await handleRegisterTournament(unauth.req, unauth.res, { adminAuth: unauth.adminAuth, adminDb: db });
    expect(unauth.getStatus()).toBe(401);

    // Spoofing another UID rejected (403)
    const spoof = createMockReqRes({
      headers: { authorization: 'Bearer p1_token' },
      body: { tournamentId: tId, participantId: 'p2' },
    });
    await handleRegisterTournament(spoof.req, spoof.res, { adminAuth: spoof.adminAuth, adminDb: db });
    expect(spoof.getStatus()).toBe(403);

    // Concurrent registrations: 3 players race for 2 slots -> exactly 2 succeed, 1 rejected with 403
    const [r1, r2, r3] = await Promise.all([
      (async () => {
        const ctx = createMockReqRes({ headers: { authorization: 'Bearer p1_token' }, body: { tournamentId: tId } });
        await handleRegisterTournament(ctx.req, ctx.res, { adminAuth: ctx.adminAuth, adminDb: db });
        return ctx.getStatus();
      })(),
      (async () => {
        const ctx = createMockReqRes({ headers: { authorization: 'Bearer p2_token' }, body: { tournamentId: tId } });
        await handleRegisterTournament(ctx.req, ctx.res, { adminAuth: ctx.adminAuth, adminDb: db });
        return ctx.getStatus();
      })(),
      (async () => {
        const ctx = createMockReqRes({ headers: { authorization: 'Bearer p3_token' }, body: { tournamentId: tId } });
        await handleRegisterTournament(ctx.req, ctx.res, { adminAuth: ctx.adminAuth, adminDb: db });
        return ctx.getStatus();
      })(),
    ]);

    const statuses = [r1, r2, r3].sort();
    expect(statuses).toEqual([200, 200, 403]);

    // Duplicate registration rejected (409)
    const dup = createMockReqRes({
      headers: { authorization: 'Bearer p1_token' },
      body: { tournamentId: tId },
    });
    await handleRegisterTournament(dup.req, dup.res, { adminAuth: dup.adminAuth, adminDb: db });
    expect(dup.getStatus()).toBe(409);

    // Cancel registration frees slot cleanly
    const cancel = createMockReqRes({
      headers: { authorization: 'Bearer p2_token' },
      body: { tournamentId: tId },
    });
    await handleCancelRegistration(cancel.req, cancel.res, { adminAuth: cancel.adminAuth, adminDb: db });
    expect(cancel.getStatus()).toBe(200);
  });

  it('[P3-03] enforces host/admin authorization and prevents invalid transitions or double match completion', async () => {
    const db = createStatefulFirestoreMock();
    const createCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: {
        title: 'Security Cup',
        maxParticipants: 4,
        minParticipants: 2,
        registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
        quizzes: ['quiz_1'],
      },
    });
    await handleCreateTournament(createCtx.req, createCtx.res, { adminAuth: createCtx.adminAuth, adminDb: db });
    const tId = createCtx.getData().tournament.id;

    // Register p1, p2
    for (const token of ['p1_token', 'p2_token']) {
      const ctx = createMockReqRes({ headers: { authorization: `Bearer ${token}` }, body: { tournamentId: tId } });
      await handleRegisterTournament(ctx.req, ctx.res, { adminAuth: ctx.adminAuth, adminDb: db });
    }

    // Non-host cannot start round (403)
    const nonHostStart = createMockReqRes({
      headers: { authorization: 'Bearer p1_token' },
      body: { tournamentId: tId },
    });
    await handleStartRound(nonHostStart.req, nonHostStart.res, { adminAuth: nonHostStart.adminAuth, adminDb: db });
    expect(nonHostStart.getStatus()).toBe(403);

    // Host starts round
    const hostStart = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: tId },
    });
    await handleStartRound(hostStart.req, hostStart.res, { adminAuth: hostStart.adminAuth, adminDb: db });
    const matchId = hostStart.getData().round.matches[0].id;

    // Non-host cannot finalize match (403)
    const nonHostFin = createMockReqRes({
      headers: { authorization: 'Bearer p1_token' },
      body: { tournamentId: tId, matchId, winnerId: 'p1', score1: 9999, score2: 0 },
    });
    await handleFinalizeMatch(nonHostFin.req, nonHostFin.res, { adminAuth: nonHostFin.adminAuth, adminDb: db });
    expect(nonHostFin.getStatus()).toBe(403);

    // Concurrent finalization: first wins, second is idempotent without overwriting scores
    const [f1, f2] = await Promise.all([
      (async () => {
        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { tournamentId: tId, matchId, winnerId: 'p1', score1: 1500, score2: 900 },
        });
        await handleFinalizeMatch(ctx.req, ctx.res, { adminAuth: ctx.adminAuth, adminDb: db });
        return ctx.getData();
      })(),
      (async () => {
        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { tournamentId: tId, matchId, winnerId: 'p2', score1: 100, score2: 2000 },
        });
        await handleFinalizeMatch(ctx.req, ctx.res, { adminAuth: ctx.adminAuth, adminDb: db });
        return ctx.getData();
      })(),
    ]);
    expect(f1.match.winnerId).toBe('p1');
    expect(f2.match.winnerId).toBe('p1');

    // Complete tournament
    const done = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: tId },
    });
    await handleStartRound(done.req, done.res, { adminAuth: done.adminAuth, adminDb: db });
    expect(done.getStatus()).toBe(200);
    expect(done.getData().tournament.status).toBe('completed');

    // Advancing/starting a completed tournament is rejected (400)
    const invalidTransition = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: tId },
    });
    await handleStartRound(invalidTransition.req, invalidTransition.res, {
      adminAuth: invalidTransition.adminAuth,
      adminDb: db,
    });
    expect(invalidTransition.getStatus()).toBe(400);
  });

  it('[P3-04] derives match scores from linked authoritative game session instead of forged client scores', async () => {
    const db = createStatefulFirestoreMock();
    await db.collection('games').doc('linked_game_1').collection('players').doc('p1').set({ score: 2500 });
    await db.collection('games').doc('linked_game_1').collection('players').doc('p2').set({ score: 1100 });

    const createCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: {
        title: 'Linked Game Cup',
        maxParticipants: 4,
        minParticipants: 2,
        registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
        quizzes: ['quiz_1'],
      },
    });
    await handleCreateTournament(createCtx.req, createCtx.res, { adminAuth: createCtx.adminAuth, adminDb: db });
    const tId = createCtx.getData().tournament.id;

    for (const token of ['p1_token', 'p2_token']) {
      const ctx = createMockReqRes({ headers: { authorization: `Bearer ${token}` }, body: { tournamentId: tId } });
      await handleRegisterTournament(ctx.req, ctx.res, { adminAuth: ctx.adminAuth, adminDb: db });
    }
    const startCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: tId },
    });
    await handleStartRound(startCtx.req, startCtx.res, { adminAuth: startCtx.adminAuth, adminDb: db });
    const tDoc = (await db.collection('tournaments').doc(tId).get()).data();
    tDoc.rounds[0].matches[0].gameId = 'linked_game_1';
    await db.collection('tournaments').doc(tId).set(tDoc);

    // Client tries to forge p2 as winner with 99999 -> server overrides from linked_game_1
    const finCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: tId, matchId: tDoc.rounds[0].matches[0].id, winnerId: 'p2', score1: 0, score2: 99999 },
    });
    await handleFinalizeMatch(finCtx.req, finCtx.res, { adminAuth: finCtx.adminAuth, adminDb: db });
    expect(finCtx.getStatus()).toBe(200);
    expect(finCtx.getData().match.winnerId).toBe('p1');
    expect(finCtx.getData().match.score1).toBe(2500);
    expect(finCtx.getData().match.score2).toBe(1100);
  });

  it('[P3-05] integrates with Phase 2 persistent certificates: blocks incomplete tournaments and deduplicates completion', async () => {
    const db = createStatefulFirestoreMock();
    const createCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: {
        title: 'Certificate Cup',
        maxParticipants: 4,
        minParticipants: 2,
        registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
        quizzes: ['quiz_1'],
      },
    });
    await handleCreateTournament(createCtx.req, createCtx.res, { adminAuth: createCtx.adminAuth, adminDb: db });
    const tId = createCtx.getData().tournament.id;

    for (const [token, nickname] of [
      ['p1_token', 'Alice'],
      ['p2_token', 'Bob'],
    ]) {
      const ctx = createMockReqRes({
        headers: { authorization: `Bearer ${token}` },
        body: { tournamentId: tId, nickname },
      });
      await handleRegisterTournament(ctx.req, ctx.res, { adminAuth: ctx.adminAuth, adminDb: db });
    }

    // Incomplete tournament certificate issuance must be rejected (400)
    const earlyCert = createMockReqRes({
      headers: { authorization: 'Bearer p1_token' },
      body: { ownerId: 'p1', assessmentType: 'tournament', assessmentId: tId },
    });
    await handleIssueCertificate(earlyCert.req, earlyCert.res, { adminAuth: earlyCert.adminAuth, adminDb: db });
    expect(earlyCert.getStatus()).toBe(400);

    // Start, finalize, and complete tournament
    const s1 = createMockReqRes({ headers: { authorization: 'Bearer host_token' }, body: { tournamentId: tId } });
    await handleStartRound(s1.req, s1.res, { adminAuth: s1.adminAuth, adminDb: db });
    const matchId = s1.getData().round.matches[0].id;

    const fin = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: tId, matchId, winnerId: 'p1', score1: 2000, score2: 1400 },
    });
    await handleFinalizeMatch(fin.req, fin.res, { adminAuth: fin.adminAuth, adminDb: db });

    const complete = createMockReqRes({ headers: { authorization: 'Bearer host_token' }, body: { tournamentId: tId } });
    await handleStartRound(complete.req, complete.res, { adminAuth: complete.adminAuth, adminDb: db });
    expect(complete.getData().tournament.status).toBe('completed');

    // Champion p1 gets authoritative tournament_champion certificate; duplicate request is idempotent
    const cert1 = createMockReqRes({
      headers: { authorization: 'Bearer p1_token' },
      body: { ownerId: 'p1', assessmentType: 'tournament', assessmentId: tId, type: 'quiz_completion' },
    });
    await handleIssueCertificate(cert1.req, cert1.res, { adminAuth: cert1.adminAuth, adminDb: db });
    expect(cert1.getStatus()).toBe(201);
    expect(cert1.getData().certificate.type).toBe('tournament_champion');
    expect(cert1.getData().certificate.rank).toBe(1);
    expect(cert1.getData().certificate.score).toBe(2000);

    const certDup = createMockReqRes({
      headers: { authorization: 'Bearer p1_token' },
      body: { ownerId: 'p1', assessmentType: 'tournament', assessmentId: tId },
    });
    await handleIssueCertificate(certDup.req, certDup.res, { adminAuth: certDup.adminAuth, adminDb: db });
    expect(certDup.getStatus()).toBe(201);
    expect(certDup.getData().isDuplicate).toBe(true);
    expect(certDup.getData().certificate.id).toBe(cert1.getData().certificate.id);
  });

  it('[P3.1-01] firestore.rules enforces private tournament visibility and active registration on matches and results', () => {
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    // Helper checks non-anonymous user, public visibility or host or active status == 'registered'
    expect(rules).toContain('function isTournamentReadable(tournamentId, tournamentData)');
    expect(rules).toContain('isNonAnonymous()');
    expect(rules).toContain("tournamentData.visibility != 'private'");
    expect(rules).toContain('tournamentData.hostId == request.auth.uid');
    expect(rules).toContain("data.status == 'registered'");

    // Parent, matches, and results all enforce isTournamentReadable and disallow client writes
    const tournamentBlock = rules.slice(rules.indexOf('match /tournaments/{tournamentId}'));
    expect(tournamentBlock).toContain('allow read: if isTournamentReadable(tournamentId, resource.data);');
    expect(tournamentBlock).toMatch(/match \/matches\/\{matchId\}\s*\{[\s\S]*?isTournamentReadable\(/);
    expect(tournamentBlock).toMatch(/match \/matches\/\{matchId\}\s*\{[\s\S]*?allow write:\s*if false;/);
    expect(tournamentBlock).toMatch(/match \/results\/\{resultId\}\s*\{[\s\S]*?isTournamentReadable\(/);
    expect(tournamentBlock).toMatch(/match \/results\/\{resultId\}\s*\{[\s\S]*?allow write:\s*if false;/);
  });

  it('[P3.1-02] linked-game match finalization fails closed on missing players, ignores client scores, and breaks ties deterministically', async () => {
    const db = createStatefulFirestoreMock();
    const createCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: {
        title: 'Linked Game Integrity Cup',
        maxParticipants: 4,
        minParticipants: 2,
        registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
        quizzes: ['quiz_1'],
      },
    });
    await handleCreateTournament(createCtx.req, createCtx.res, { adminAuth: createCtx.adminAuth, adminDb: db });
    const tId = createCtx.getData().tournament.id;

    for (const token of ['p1_token', 'p2_token']) {
      const ctx = createMockReqRes({ headers: { authorization: `Bearer ${token}` }, body: { tournamentId: tId } });
      await handleRegisterTournament(ctx.req, ctx.res, { adminAuth: ctx.adminAuth, adminDb: db });
    }

    const startCtx = createMockReqRes({ headers: { authorization: 'Bearer host_token' }, body: { tournamentId: tId } });
    await handleStartRound(startCtx.req, startCtx.res, { adminAuth: startCtx.adminAuth, adminDb: db });
    const matchId = startCtx.getData().round.matches[0].id;

    // Link match to an authoritative gameId in Firestore
    const tDoc = await db.collection('tournaments').doc(tId).get();
    const tData = tDoc.data();
    tData.rounds[0].matches[0].gameId = 'game_linked_1';
    await db.collection('tournaments').doc(tId).set(tData);
    const mDoc = await db.collection('tournaments').doc(tId).collection('matches').doc(matchId).get();
    await db.collection('tournaments').doc(tId).collection('matches').doc(matchId).set({
      ...mDoc.data(),
      gameId: 'game_linked_1',
    });

    // 1. Both players missing -> 404 (never fall back to client scores)
    const missingBoth = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: tId, matchId, winnerId: 'p2', score1: 10, score2: 999 },
    });
    await handleFinalizeMatch(missingBoth.req, missingBoth.res, { adminAuth: missingBoth.adminAuth, adminDb: db });
    expect(missingBoth.getStatus()).toBe(404);

    // 2. Only player1 exists, player2 missing -> 404
    await db.collection('games').doc('game_linked_1').collection('players').doc('p1').set({ score: 1500 });
    const missingP2 = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: tId, matchId, winnerId: 'p1', score1: 1500, score2: 0 },
    });
    await handleFinalizeMatch(missingP2.req, missingP2.res, { adminAuth: missingP2.adminAuth, adminDb: db });
    expect(missingP2.getStatus()).toBe(404);

    // 3. Exact tie in Firestore (1500 vs 1500), client tries to forge winnerId='p2' and fake scores -> deterministic higher seed (player1Id = p1) wins with 1500-1500
    await db.collection('games').doc('game_linked_1').collection('players').doc('p2').set({ score: 1500 });
    const tieFinalize = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: tId, matchId, winnerId: 'p2', score1: 100, score2: 9999 },
    });
    await handleFinalizeMatch(tieFinalize.req, tieFinalize.res, { adminAuth: tieFinalize.adminAuth, adminDb: db });
    expect(tieFinalize.getStatus()).toBe(200);
    expect(tieFinalize.getData().match.score1).toBe(1500);
    expect(tieFinalize.getData().match.score2).toBe(1500);
    expect(tieFinalize.getData().match.winnerId).toBe('p1');

    // 4. Repeated finalization is idempotent
    const repeatFin = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: tId, matchId, winnerId: 'p2', score1: 0, score2: 5000 },
    });
    await handleFinalizeMatch(repeatFin.req, repeatFin.res, { adminAuth: repeatFin.adminAuth, adminDb: db });
    expect(repeatFin.getStatus()).toBe(200);
    expect(repeatFin.getData().match.winnerId).toBe('p1');
    expect(repeatFin.getData().match.score1).toBe(1500);
  });

  it('[P3.1-03] handleStartRound returns HTTP 500 on unexpected Firestore errors and 400 on domain validation errors', async () => {
    const db = createStatefulFirestoreMock();
    const createCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: {
        title: 'Error Status Cup',
        maxParticipants: 4,
        minParticipants: 2,
        registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
        quizzes: ['quiz_1'],
      },
    });
    await handleCreateTournament(createCtx.req, createCtx.res, { adminAuth: createCtx.adminAuth, adminDb: db });
    const tId = createCtx.getData().tournament.id;

    for (const token of ['p1_token', 'p2_token', 'p3_token', 'p4_token']) {
      const ctx = createMockReqRes({ headers: { authorization: `Bearer ${token}` }, body: { tournamentId: tId } });
      await handleRegisterTournament(ctx.req, ctx.res, { adminAuth: ctx.adminAuth, adminDb: db });
    }

    // Start round 1
    const s1 = createMockReqRes({ headers: { authorization: 'Bearer host_token' }, body: { tournamentId: tId } });
    await handleStartRound(s1.req, s1.res, { adminAuth: s1.adminAuth, adminDb: db });
    expect(s1.getStatus()).toBe(200);

    // Attempting to advance before matches complete is a domain error -> 400
    const incompleteAdv = createMockReqRes({ headers: { authorization: 'Bearer host_token' }, body: { tournamentId: tId } });
    await handleStartRound(incompleteAdv.req, incompleteAdv.res, { adminAuth: incompleteAdv.adminAuth, adminDb: db });
    expect(incompleteAdv.getStatus()).toBe(400);

    // Unexpected Firestore/transaction failure -> 500 without leaking raw stack/error message
    const brokenDb = {
      ...db,
      runTransaction: async () => {
        throw new Error('SECRET_INTERNAL_FIRESTORE_FAILURE_DETAILS');
      },
    };
    const infraErr = createMockReqRes({ headers: { authorization: 'Bearer host_token' }, body: { tournamentId: tId } });
    await handleStartRound(infraErr.req, infraErr.res, { adminAuth: infraErr.adminAuth, adminDb: brokenDb });
    expect(infraErr.getStatus()).toBe(500);
    expect(infraErr.getData().error).not.toContain('SECRET_INTERNAL_FIRESTORE_FAILURE_DETAILS');
  });

  it('[P3.1-04] private tournament standings allow host and active participants, but deny withdrawn users and outsiders', async () => {
    const db = createStatefulFirestoreMock();
    const createCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: {
        title: 'Private Invitational',
        visibility: 'private',
        maxParticipants: 4,
        minParticipants: 2,
        registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
        quizzes: ['quiz_1'],
      },
    });
    await handleCreateTournament(createCtx.req, createCtx.res, { adminAuth: createCtx.adminAuth, adminDb: db });
    const tId = createCtx.getData().tournament.id;

    // p1 stays registered; p2 registers then withdraws; p3 never registers
    for (const token of ['p1_token', 'p2_token']) {
      const ctx = createMockReqRes({ headers: { authorization: `Bearer ${token}` }, body: { tournamentId: tId } });
      await handleRegisterTournament(ctx.req, ctx.res, { adminAuth: ctx.adminAuth, adminDb: db });
    }
    const withdrawP2 = createMockReqRes({ headers: { authorization: 'Bearer p2_token' }, body: { tournamentId: tId } });
    await handleCancelRegistration(withdrawP2.req, withdrawP2.res, { adminAuth: withdrawP2.adminAuth, adminDb: db });
    expect(withdrawP2.getStatus()).toBe(200);

    // Host allowed (200)
    const hostStandings = createMockReqRes({ headers: { authorization: 'Bearer host_token' }, params: { id: tId } });
    await handleGetTournamentStandings(hostStandings.req, hostStandings.res, { adminAuth: hostStandings.adminAuth, adminDb: db });
    expect(hostStandings.getStatus()).toBe(200);

    // Active participant p1 allowed (200)
    const p1Standings = createMockReqRes({ headers: { authorization: 'Bearer p1_token' }, params: { id: tId } });
    await handleGetTournamentStandings(p1Standings.req, p1Standings.res, { adminAuth: p1Standings.adminAuth, adminDb: db });
    expect(p1Standings.getStatus()).toBe(200);

    // Withdrawn participant p2 denied (403)
    const p2Standings = createMockReqRes({ headers: { authorization: 'Bearer p2_token' }, params: { id: tId } });
    await handleGetTournamentStandings(p2Standings.req, p2Standings.res, { adminAuth: p2Standings.adminAuth, adminDb: db });
    expect(p2Standings.getStatus()).toBe(403);

    // Unrelated user p3 denied (403)
    const p3Standings = createMockReqRes({ headers: { authorization: 'Bearer p3_token' }, params: { id: tId } });
    await handleGetTournamentStandings(p3Standings.req, p3Standings.res, { adminAuth: p3Standings.adminAuth, adminDb: db });
    expect(p3Standings.getStatus()).toBe(403);
  });

  it('[P3.1-05] registration seeds remain strictly unique across withdrawals and subsequent registrations', async () => {
    const db = createStatefulFirestoreMock();
    const createCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: {
        title: 'Seed Uniqueness Cup',
        maxParticipants: 4,
        minParticipants: 2,
        registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
        quizzes: ['quiz_1'],
      },
    });
    await handleCreateTournament(createCtx.req, createCtx.res, { adminAuth: createCtx.adminAuth, adminDb: db });
    const tId = createCtx.getData().tournament.id;

    // Register p1 (seed 1), p2 (seed 2), p3 (seed 3)
    for (const token of ['p1_token', 'p2_token', 'p3_token']) {
      const ctx = createMockReqRes({ headers: { authorization: `Bearer ${token}` }, body: { tournamentId: tId } });
      await handleRegisterTournament(ctx.req, ctx.res, { adminAuth: ctx.adminAuth, adminDb: db });
      expect(ctx.getStatus()).toBe(200);
    }

    // p2 withdraws
    const cancelP2 = createMockReqRes({ headers: { authorization: 'Bearer p2_token' }, body: { tournamentId: tId } });
    await handleCancelRegistration(cancelP2.req, cancelP2.res, { adminAuth: cancelP2.adminAuth, adminDb: db });
    expect(cancelP2.getStatus()).toBe(200);

    // p4 registers -> must receive seed 4 (not duplicate seed 3)
    const regP4 = createMockReqRes({ headers: { authorization: 'Bearer p4_token' }, body: { tournamentId: tId } });
    await handleRegisterTournament(regP4.req, regP4.res, { adminAuth: regP4.adminAuth, adminDb: db });
    expect(regP4.getStatus()).toBe(200);
    expect(regP4.getData().registration.seed).toBe(4);

    const activeRegs = await db.collection('tournaments').doc(tId).collection('registrations').where('status', '==', 'registered').get();
    const activeSeeds = activeRegs.docs.map((d: any) => d.data().seed);
    expect(activeSeeds).toHaveLength(3);
    expect(new Set(activeSeeds).size).toBe(3);
  });
});