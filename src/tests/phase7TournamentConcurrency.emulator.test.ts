/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp, type App as AdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth, type Auth as AdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestore } from 'firebase-admin/firestore';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth as getClientAuth,
  connectAuthEmulator,
  signInWithCustomToken,
  type Auth as ClientAuth,
} from 'firebase/auth';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  handleCreateTournament,
  handleRegisterTournament,
  handleCancelRegistration,
  handleStartRound,
  handleFinalizeMatch,
  handleGetTournamentStandings,
} from '../server/tournamentHandler.ts';
import {
  cancelOutboxJobsForAccountDeletion,
} from '../server/emailOutboxEngine.ts';

const DEMO_PROJECT_ID = 'demo-quizarena-test';

function createMockReqRes(opts: {
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, string>;
}) {
  let statusCode = 200;
  let responseData: any = null;
  const req: any = {
    headers: opts.headers || {},
    body: opts.body || {},
    params: opts.params || {},
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
  };
  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
  };
}

describe('Phase 7.4 — Tournament Concurrency, Progression & Persistence Emulator Integration Suite', () => {
  let adminApp: AdminApp;
  let adminAuth: AdminAuth;
  let adminDb: AdminFirestore;
  let clientApp: FirebaseApp;
  let clientAuth: ClientAuth;
  let rulesEnv: RulesTestEnvironment;

  beforeAll(async () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

    adminApp = initializeAdminApp({ projectId: DEMO_PROJECT_ID }, 'phase74-admin');
    adminAuth = getAdminAuth(adminApp);
    adminDb = getAdminFirestore(adminApp);

    clientApp = initializeClientApp(
      {
        apiKey: 'demo-quizarena-api-key',
        authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`,
        projectId: DEMO_PROJECT_ID,
      },
      'phase74-client'
    );
    clientAuth = getClientAuth(clientApp);
    connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true });

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
    if (clientApp) await deleteClientApp(clientApp);
    if (adminApp) await deleteAdminApp(adminApp);
  });

  beforeEach(async () => {
    await rulesEnv.clearFirestore();
  });

  async function createVerifiedUser(uid: string, email: string, name: string) {
    // Delete any existing auth emulator user
    try {
      await adminAuth.deleteUser(uid);
    } catch {}
    await adminAuth.createUser({ uid, email, displayName: name });
    // Seed active user profile in Firestore
    await adminDb.collection('users').doc(uid).set({
      uid,
      email,
      name,
      role: 'player',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
  }

  async function getIdTokenForUser(uid: string): Promise<string> {
    const customToken = await adminAuth.createCustomToken(uid);
    const userCred = await signInWithCustomToken(clientAuth, customToken);
    return userCred.user.getIdToken();
  }

  it('1. enforces transactional concurrency on simultaneous registrations, capacity bounds, and seed uniqueness', async () => {
    const hostUid = 'host_tc_1';
    await createVerifiedUser(hostUid, 'host1@example.test', 'Host One');

    // Create a tournament with maxParticipants: 4
    const tRef = adminDb.collection('tournaments').doc('t_cap_4');
    const deadline = new Date(Date.now() + 3_600_000).toISOString();
    await tRef.set({
      id: 't_cap_4',
      title: 'Capacity Test Tournament',
      description: 'Concurrency test',
      hostId: hostUid,
      hostName: 'Host One',
      visibility: 'public',
      status: 'registration_open',
      minParticipants: 2,
      maxParticipants: 4,
      participantCount: 0,
      registrationDeadline: deadline,
      quizzes: [{ id: 'q_1', title: 'Quiz 1' }],
      rounds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Create 10 verified players
    const playerUids: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const uid = `player_tc_${i}`;
      await createVerifiedUser(uid, `p${i}@example.test`, `Player ${i}`);
      playerUids.push(uid);
    }

    // 10 players simultaneously register racing for 4 slots using Promise.all
    const regPromises = playerUids.map(async (uid, idx) => {
      const token = await getIdTokenForUser(uid);
      const mock = createMockReqRes({
        headers: { authorization: `Bearer ${token}` },
        body: { tournamentId: 't_cap_4', nickname: `Player ${idx + 1}` },
      });
      await handleRegisterTournament(mock.req, mock.res, { adminDb, adminAuth });
      return { uid, status: mock.getStatus(), data: mock.getData() };
    });

    const results = await Promise.all(regPromises);

    const successful = results.filter((r) => r.status === 200);
    const capacityRejected = results.filter((r) => r.status === 403);

    expect(successful).toHaveLength(4);
    expect(capacityRejected).toHaveLength(6);
    for (const r of capacityRejected) {
      expect(r.data.error).toMatch(/full|capacity/i);
    }

    // Verify registrations subcollection in Firestore
    const regsSnap = await tRef.collection('registrations').get();
    expect(regsSnap.size).toBe(4);

    const seeds = regsSnap.docs.map((d) => d.data().seed).sort((a, b) => a - b);
    expect(seeds).toEqual([1, 2, 3, 4]);

    // Verify tournament doc participantCount
    const finalTournament = (await tRef.get()).data()!;
    expect(finalTournament.participantCount).toBe(4);

    // Duplicate registration for an already registered user returns 409 and does not add a doc
    const registeredUid = successful[0].uid;
    const dupToken = await getIdTokenForUser(registeredUid);
    const dupMock = createMockReqRes({
      headers: { authorization: `Bearer ${dupToken}` },
      body: { tournamentId: 't_cap_4', nickname: 'Trying Again' },
    });
    await handleRegisterTournament(dupMock.req, dupMock.res, { adminDb, adminAuth });
    expect(dupMock.getStatus()).toBe(409);
    expect(dupMock.getData().error).toMatch(/already registered/i);

    // Total registrations remain 4 and participantCount remains 4
    expect((await tRef.collection('registrations').get()).size).toBe(4);
    expect((await tRef.get()).data()!.participantCount).toBe(4);
  });

  it('2. handles registration withdrawal, capacity slot reclamation, and non-overlapping seeds under concurrency', async () => {
    const hostUid = 'host_tc_2';
    await createVerifiedUser(hostUid, 'host2@example.test', 'Host Two');

    const tRef = adminDb.collection('tournaments').doc('t_withdraw');
    await tRef.set({
      id: 't_withdraw',
      title: 'Withdrawal Test Tournament',
      hostId: hostUid,
      hostName: 'Host Two',
      visibility: 'public',
      status: 'registration_open',
      minParticipants: 2,
      maxParticipants: 2,
      participantCount: 0,
      registrationDeadline: new Date(Date.now() + 3_600_000).toISOString(),
      quizzes: [{ id: 'q_1', title: 'Quiz 1' }],
      rounds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const p1Uid = 'player_w_1';
    const p2Uid = 'player_w_2';
    const p3Uid = 'player_w_3';
    await createVerifiedUser(p1Uid, 'pw1@example.test', 'Player W1');
    await createVerifiedUser(p2Uid, 'pw2@example.test', 'Player W2');
    await createVerifiedUser(p3Uid, 'pw3@example.test', 'Player W3');

    // Register p1 and p2 (tournament now full at 2/2)
    const t1 = await getIdTokenForUser(p1Uid);
    const m1 = createMockReqRes({
      headers: { authorization: `Bearer ${t1}` },
      body: { tournamentId: 't_withdraw', nickname: 'W1' },
    });
    await handleRegisterTournament(m1.req, m1.res, { adminDb, adminAuth });
    expect(m1.getStatus()).toBe(200);

    const t2 = await getIdTokenForUser(p2Uid);
    const m2 = createMockReqRes({
      headers: { authorization: `Bearer ${t2}` },
      body: { tournamentId: 't_withdraw', nickname: 'W2' },
    });
    await handleRegisterTournament(m2.req, m2.res, { adminDb, adminAuth });
    expect(m2.getStatus()).toBe(200);

    // p3 tries to register when full -> 403
    const t3 = await getIdTokenForUser(p3Uid);
    const m3Early = createMockReqRes({
      headers: { authorization: `Bearer ${t3}` },
      body: { tournamentId: 't_withdraw', nickname: 'W3' },
    });
    await handleRegisterTournament(m3Early.req, m3Early.res, { adminDb, adminAuth });
    expect(m3Early.getStatus()).toBe(403);

    // p1 withdraws concurrently with p3 registering for the newly opened slot
    const cancelMock = createMockReqRes({
      headers: { authorization: `Bearer ${t1}` },
      body: { tournamentId: 't_withdraw' },
    });
    const regMock = createMockReqRes({
      headers: { authorization: `Bearer ${t3}` },
      body: { tournamentId: 't_withdraw', nickname: 'W3' },
    });

    await handleCancelRegistration(cancelMock.req, cancelMock.res, { adminDb, adminAuth });
    expect(cancelMock.getStatus()).toBe(200);

    // p3 now successfully claims the reclaimed slot
    await handleRegisterTournament(regMock.req, regMock.res, { adminDb, adminAuth });
    expect(regMock.getStatus()).toBe(200);

    // Verify Firestore state
    const p1Doc = (await tRef.collection('registrations').doc(p1Uid).get()).data()!;
    expect(p1Doc.status).toBe('withdrawn');

    const p3Doc = (await tRef.collection('registrations').doc(p3Uid).get()).data()!;
    expect(p3Doc.status).toBe('registered');
    // Seed must be strictly greater than max active seed (seed 2 + 1 = 3)
    expect(p3Doc.seed).toBe(3);

    const activeRegs = await tRef.collection('registrations').where('status', '==', 'registered').get();
    expect(activeRegs.size).toBe(2);
    expect((await tRef.get()).data()!.participantCount).toBe(2);
  });

  it('3. prevents duplicate round generation and duplicate matches under concurrent round start requests', async () => {
    const hostUid = 'host_tc_3';
    await createVerifiedUser(hostUid, 'host3@example.test', 'Host Three');

    const tRef = adminDb.collection('tournaments').doc('t_round_race');
    await tRef.set({
      id: 't_round_race',
      title: 'Round Race Tournament',
      hostId: hostUid,
      hostName: 'Host Three',
      visibility: 'public',
      status: 'registration_open',
      minParticipants: 2,
      maxParticipants: 4,
      participantCount: 4,
      registrationDeadline: new Date(Date.now() + 3_600_000).toISOString(),
      quizzes: [{ id: 'q_1', title: 'Quiz 1' }, { id: 'q_2', title: 'Quiz 2' }],
      rounds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Register 4 active players with seeds 1..4
    for (let i = 1; i <= 4; i++) {
      const uid = `player_rr_${i}`;
      await createVerifiedUser(uid, `prr${i}@example.test`, `Player RR ${i}`);
      await tRef.collection('registrations').doc(uid).set({
        id: `reg_${uid}`,
        tournamentId: 't_round_race',
        participantId: uid,
        participantNickname: `Player RR ${i}`,
        status: 'registered',
        seed: i,
        registeredAt: new Date().toISOString(),
      });
    }

    const hostToken = await getIdTokenForUser(hostUid);

    // Two simultaneous host requests to start the tournament and generate the bracket
    const start1 = createMockReqRes({
      headers: { authorization: `Bearer ${hostToken}` },
      body: { tournamentId: 't_round_race' },
    });
    const start2 = createMockReqRes({
      headers: { authorization: `Bearer ${hostToken}` },
      body: { tournamentId: 't_round_race' },
    });

    await Promise.all([
      handleStartRound(start1.req, start1.res, { adminDb, adminAuth }),
      handleStartRound(start2.req, start2.res, { adminDb, adminAuth }),
    ]);

    const statuses = [start1.getStatus(), start2.getStatus()].sort();
    // One must succeed (200), and the conflicting concurrent request must fail cleanly (400)
    expect(statuses).toEqual([200, 400]);

    const finalTournament = (await tRef.get()).data()!;
    expect(finalTournament.status).toBe('active');
    expect(finalTournament.rounds).toHaveLength(2); // 4 players single elimination -> 2 rounds
    expect(finalTournament.rounds[0].status).toBe('active');

    // Verify matches subcollection contains exactly 3 bracket matches (2 in Round 1 + 1 in Finals)
    const matchesSnap = await tRef.collection('matches').get();
    expect(matchesSnap.size).toBe(3);
    const round1Matches = matchesSnap.docs.filter((d) => (d.data().roundNumber || d.data().round) === 1);
    const round2Matches = matchesSnap.docs.filter((d) => (d.data().roundNumber || d.data().round) === 2);
    expect(round1Matches).toHaveLength(2);
    expect(round2Matches).toHaveLength(1);
  });

  it('4. derives match scores from authoritative game session, idempotently finalizes matches, and secures standings', async () => {
    const hostUid = 'host_tc_4';
    const p1Uid = 'player_fin_1';
    const p2Uid = 'player_fin_2';

    await createVerifiedUser(hostUid, 'host4@example.test', 'Host Four');
    await createVerifiedUser(p1Uid, 'pfin1@example.test', 'Alice');
    await createVerifiedUser(p2Uid, 'pfin2@example.test', 'Bob');

    // Create a private tournament in active state with 1 match
    const tRef = adminDb.collection('tournaments').doc('t_finalize');
    const matchId = 'm_final_1';
    const gameId = 'game_auth_session_1';

    const rounds = [
      {
        roundNumber: 1,
        title: 'Championship Match',
        status: 'active' as const,
        matches: [
          {
            id: matchId,
            round: 1,
            player1Id: p1Uid,
            player1Nickname: 'Alice',
            player2Id: p2Uid,
            player2Nickname: 'Bob',
            gameId,
            status: 'pending' as const,
          },
        ],
      },
    ];

    await tRef.set({
      id: 't_finalize',
      title: 'Private Championship',
      hostId: hostUid,
      hostName: 'Host Four',
      visibility: 'private',
      status: 'active',
      minParticipants: 2,
      maxParticipants: 2,
      participantCount: 2,
      registrationDeadline: new Date(Date.now() + 3_600_000).toISOString(),
      quizzes: [{ id: 'q_1', title: 'Championship Quiz' }],
      rounds,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await tRef.collection('registrations').doc(p1Uid).set({
      id: `reg_${p1Uid}`,
      tournamentId: 't_finalize',
      participantId: p1Uid,
      participantNickname: 'Alice',
      status: 'registered',
      seed: 1,
      registeredAt: new Date().toISOString(),
    });
    await tRef.collection('registrations').doc(p2Uid).set({
      id: `reg_${p2Uid}`,
      tournamentId: 't_finalize',
      participantId: p2Uid,
      participantNickname: 'Bob',
      status: 'registered',
      seed: 2,
      registeredAt: new Date().toISOString(),
    });

    // Seed authoritative linked multiplayer game session in /games/{gameId}/players/*
    const playersCol = adminDb.collection('games').doc(gameId).collection('players');
    await playersCol.doc(p1Uid).set({
      uid: p1Uid,
      nickname: 'Alice',
      score: 1850,
      strikes: 0,
      status: 'active',
    });
    await playersCol.doc(p2Uid).set({
      uid: p2Uid,
      nickname: 'Bob',
      score: 1200,
      strikes: 0,
      status: 'active',
    });

    const hostToken = await getIdTokenForUser(hostUid);

    // Host sends 3 concurrent match finalization requests with forged client scores (score1: 0, score2: 9999)
    // Server must ignore forged scores and derive actual scores exclusively from /games/{gameId}/players/*
    const finPromises = Array.from({ length: 3 }, () => {
      const mock = createMockReqRes({
        headers: { authorization: `Bearer ${hostToken}` },
        body: {
          tournamentId: 't_finalize',
          matchId,
          winnerId: p2Uid, // Forged winner Bob
          score1: 0,       // Forged score
          score2: 9999,    // Forged score
        },
      });
      return handleFinalizeMatch(mock.req, mock.res, { adminDb, adminAuth }).then(() => mock);
    });

    const finResponses = await Promise.all(finPromises);
    expect(finResponses.every((m) => m.getStatus() === 200)).toBe(true);

    // Authoritative derived winner must be Alice (score 1850 vs 1200)
    const finalizedMatchSnap = await tRef.collection('matches').doc(matchId).get();
    const matchData = finalizedMatchSnap.data()!;
    expect(matchData.status).toBe('completed');
    expect(matchData.winnerId).toBe(p1Uid);
    expect(matchData.score1).toBe(1850);
    expect(matchData.score2).toBe(1200);

    // Complete tournament via handleStartRound
    const completeMock = createMockReqRes({
      headers: { authorization: `Bearer ${hostToken}` },
      body: { tournamentId: 't_finalize' },
    });
    await handleStartRound(completeMock.req, completeMock.res, { adminDb, adminAuth });
    expect(completeMock.getStatus()).toBe(200);
    expect(completeMock.getData().message).toMatch(/tournament completed/i);

    const completedTournament = (await tRef.get()).data()!;
    expect(completedTournament.status).toBe('completed');
    expect(completedTournament.championId).toBe(p1Uid);
    expect(completedTournament.championNickname).toBe('Alice');

    // Results subcollection documents created
    const r1 = (await tRef.collection('results').doc(p1Uid).get()).data()!;
    expect(r1.rank).toBe(1);
    expect(r1.wins).toBe(1);

    const r2 = (await tRef.collection('results').doc(p2Uid).get()).data()!;
    expect(r2.rank).toBe(2);
    expect(r2.wins).toBe(0);

    // Private tournament standings access control
    // Unauthenticated -> 401
    const unauthStandings = createMockReqRes({ params: { id: 't_finalize' } });
    await handleGetTournamentStandings(unauthStandings.req, unauthStandings.res, { adminDb, adminAuth });
    expect(unauthStandings.getStatus()).toBe(401);

    // Outsider user -> 403
    const outsiderUid = 'outsider_tc';
    await createVerifiedUser(outsiderUid, 'outsider@example.test', 'Outsider');
    const outsiderToken = await getIdTokenForUser(outsiderUid);
    const outsiderStandings = createMockReqRes({
      headers: { authorization: `Bearer ${outsiderToken}` },
      params: { id: 't_finalize' },
    });
    await handleGetTournamentStandings(outsiderStandings.req, outsiderStandings.res, { adminDb, adminAuth });
    expect(outsiderStandings.getStatus()).toBe(403);

    // Participant Alice -> 200
    const p1Token = await getIdTokenForUser(p1Uid);
    const p1Standings = createMockReqRes({
      headers: { authorization: `Bearer ${p1Token}` },
      params: { id: 't_finalize' },
    });
    await handleGetTournamentStandings(p1Standings.req, p1Standings.res, { adminDb, adminAuth });
    expect(p1Standings.getStatus()).toBe(200);
    expect(p1Standings.getData().championId).toBe(p1Uid);
    expect(p1Standings.getData().standings).toHaveLength(2);
  });
});

