/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 6: Tournament & Competition System Hardening Test Suite
 * Covers 40 comprehensive specifications:
 * - Tournament Creation & Validation
 * - Lifecycle State Machine Transitions
 * - Atomic Registration & Concurrency Guards
 * - Single-Elimination Deterministic Bracket Generation
 * - Non-power-of-two Participants & Bye Handling
 * - Idempotent Match Finalization & Advancement
 * - Chess-Standard Elo Rating Calculations
 * - Standings & Leaderboard Determinism
 * - Security & Authorization Boundaries
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateTournamentConfig,
  isValidTournamentTransition,
  generateSingleEliminationBracket,
  advanceWinnersToNextRound,
  calculateElo,
  computeTournamentStandings,
} from '../server/tournamentEngine.ts';
import {
  inMemoryTournaments,
  inMemoryRegistrations,
  handleCreateTournament,
  handleRegisterTournament,
  handleCancelRegistration,
  handleStartRound,
  handleFinalizeMatch,
  handleGetTournamentStandings,
} from '../server/tournamentHandler.ts';
import type { Tournament, TournamentRegistration } from '../types/tournament.ts';

// ---------------------------------------------------------------------------
// Mock Helpers for Express / Firebase
// ---------------------------------------------------------------------------
function createMockReqRes(options: {
  body?: any;
  params?: any;
  headers?: any;
  user?: any;
}) {
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
    setHeader: () => res,
  };

  const adminAuth: any = {
    verifyIdToken: async (token: string) => {
      if (token === 'valid_host_token') {
        return { uid: 'host_123', name: 'Prof. Turing', email: 'turing@quizarena.io' };
      }
      if (token === 'valid_player_1') {
        return { uid: 'player_1', name: 'Alice' };
      }
      if (token === 'valid_player_2') {
        return { uid: 'player_2', name: 'Bob' };
      }
      if (token === 'valid_player_3') {
        return { uid: 'player_3', name: 'Charlie' };
      }
      if (token === 'valid_player_4') {
        return { uid: 'player_4', name: 'David' };
      }
      if (token === 'valid_player_5') {
        return { uid: 'player_5', name: 'Eve' };
      }
      if (token === 'anonymous_token') {
        return { uid: 'anon_1', firebase: { sign_in_provider: 'anonymous' } };
      }
      throw new Error('Invalid token');
    },
  };

  const adminDb: any = {};

  return { req, res, getStatus: () => statusCode, getData: () => responseData, adminAuth, adminDb };
}

describe('Phase 6 — Tournament & Competition Hardening Suite', () => {
  beforeEach(() => {
    inMemoryTournaments.clear();
    inMemoryRegistrations.clear();
  });

  // -------------------------------------------------------------------------
  // 1. Creation & Authorization (1 - 5)
  // -------------------------------------------------------------------------
  it('[TN-01] authorized host creates tournament successfully', async () => {
    const { req, res, getStatus, getData, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_host_token' },
      body: {
        title: 'National Algo Championship',
        description: 'Elite algorithm tournament',
        registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
        quizzes: ['quiz_cs_01'],
      },
    });

    await handleCreateTournament(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(201);
    expect(getData().success).toBe(true);
    expect(getData().tournament.hostId).toBe('host_123');
    expect(getData().tournament.status).toBe('registration_open');
  });

  it('[TN-02] unauthenticated creation is rejected with 401', async () => {
    const { req, res, getStatus, getData, adminAuth, adminDb } = createMockReqRes({
      body: { title: 'No Auth Cup' },
    });

    await handleCreateTournament(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(401);
  });

  it('[TN-03] anonymous user cannot create a tournament (403)', async () => {
    const { req, res, getStatus, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer anonymous_token' },
      body: { title: 'Anon Tourney', quizzes: ['q1'] },
    });

    await handleCreateTournament(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(403);
  });

  it('[TN-04] invalid tournament configuration (title too short) is rejected', () => {
    const res = validateTournamentConfig({
      hostId: 'host_1',
      title: 'A', // < 3 chars
      registrationDeadline: new Date().toISOString(),
      quizzes: ['q1'],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => /title/i.test(e))).toBe(true);
  });

  it('[TN-05] invalid participant boundary (min > max) is rejected', () => {
    const res = validateTournamentConfig({
      hostId: 'host_1',
      title: 'Valid Title',
      minParticipants: 16,
      maxParticipants: 8,
      registrationDeadline: new Date().toISOString(),
      quizzes: ['q1'],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => /cannot exceed/i.test(e))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Lifecycle Transitions (6 - 11)
  // -------------------------------------------------------------------------
  it('[TN-06] valid lifecycle transition draft -> registration_open is permitted', () => {
    expect(isValidTournamentTransition('draft', 'registration_open')).toBe(true);
  });

  it('[TN-07] valid lifecycle transition registration_open -> active is permitted', () => {
    expect(isValidTournamentTransition('registration_open', 'active')).toBe(true);
  });

  it('[TN-08] valid lifecycle transition active -> completed is permitted', () => {
    expect(isValidTournamentTransition('active', 'completed')).toBe(true);
  });

  it('[TN-09] invalid lifecycle transition completed -> active is blocked', () => {
    expect(isValidTournamentTransition('completed', 'active')).toBe(false);
  });

  it('[TN-10] completed tournament cannot be cancelled or reopened', () => {
    expect(isValidTournamentTransition('completed', 'cancelled')).toBe(false);
    expect(isValidTournamentTransition('completed', 'registration_open')).toBe(false);
  });

  it('[TN-11] cancelled tournament is terminal and cannot transition', () => {
    expect(isValidTournamentTransition('cancelled', 'active')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 3. Registration Concurrency & Capacity (12 - 17)
  // -------------------------------------------------------------------------
  it('[TN-12] participant registers successfully when registration is open', async () => {
    // Seed tournament
    inMemoryTournaments.set('t_1', {
      id: 't_1',
      hostId: 'host_123',
      hostName: 'Prof. Turing',
      title: 'Championship',
      description: '',
      rules: '',
      format: 'single_elimination',
      status: 'registration_open',
      visibility: 'public',
      maxParticipants: 4,
      minParticipants: 2,
      participantCount: 0,
      registrationDeadline: new Date(Date.now() + 100000).toISOString(),
      quizzes: ['q1'],
      rounds: [],
      createdAt: '',
      updatedAt: '',
    });

    const { req, res, getStatus, getData, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_player_1' },
      body: { tournamentId: 't_1', nickname: 'Alice' },
    });

    await handleRegisterTournament(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(200);
    expect(getData().success).toBe(true);
    expect(getData().registration.participantId).toBe('player_1');
  });

  it('[TN-13] duplicate registration for the same UID is rejected with 409', async () => {
    inMemoryTournaments.set('t_1', {
      id: 't_1',
      hostId: 'host_123',
      hostName: 'Prof. Turing',
      title: 'Championship',
      description: '',
      rules: '',
      format: 'single_elimination',
      status: 'registration_open',
      visibility: 'public',
      maxParticipants: 4,
      minParticipants: 2,
      participantCount: 0,
      registrationDeadline: new Date(Date.now() + 100000).toISOString(),
      quizzes: ['q1'],
      rounds: [],
      createdAt: '',
      updatedAt: '',
    });

    const { req, res, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_player_1' },
      body: { tournamentId: 't_1', nickname: 'Alice' },
    });

    // Register twice
    await handleRegisterTournament(req, res, { adminAuth, adminDb });
    const { req: req2, res: res2, getStatus: getStatus2 } = createMockReqRes({
      headers: { authorization: 'Bearer valid_player_1' },
      body: { tournamentId: 't_1', nickname: 'Alice Again' },
    });
    await handleRegisterTournament(req2, res2, { adminAuth, adminDb });

    expect(getStatus2()).toBe(409);
  });

  it('[TN-14] registration after deadline is rejected with 400', async () => {
    inMemoryTournaments.set('t_past', {
      id: 't_past',
      hostId: 'host_1',
      hostName: 'Host',
      title: 'Past Cup',
      description: '',
      rules: '',
      format: 'single_elimination',
      status: 'registration_open',
      visibility: 'public',
      maxParticipants: 8,
      minParticipants: 2,
      participantCount: 0,
      registrationDeadline: new Date(Date.now() - 10000).toISOString(), // expired
      quizzes: ['q1'],
      rounds: [],
      createdAt: '',
      updatedAt: '',
    });

    const { req, res, getStatus, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_player_2' },
      body: { tournamentId: 't_past', nickname: 'Late Bob' },
    });

    await handleRegisterTournament(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(400);
  });

  it('[TN-15] registration capacity limit is strictly enforced (rejects when full with 403)', async () => {
    inMemoryTournaments.set('t_cap2', {
      id: 't_cap2',
      hostId: 'host_1',
      hostName: 'Host',
      title: 'Tiny Cup',
      description: '',
      rules: '',
      format: 'single_elimination',
      status: 'registration_open',
      visibility: 'public',
      maxParticipants: 2, // capacity 2
      minParticipants: 2,
      participantCount: 0,
      registrationDeadline: new Date(Date.now() + 100000).toISOString(),
      quizzes: ['q1'],
      rounds: [],
      createdAt: '',
      updatedAt: '',
    });

    // Fill player 1
    const { req: r1, res: s1, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_player_1' },
      body: { tournamentId: 't_cap2', nickname: 'P1' },
    });
    await handleRegisterTournament(r1, s1, { adminAuth, adminDb });

    // Fill player 2
    const { req: r2, res: s2 } = createMockReqRes({
      headers: { authorization: 'Bearer valid_player_2' },
      body: { tournamentId: 't_cap2', nickname: 'P2' },
    });
    await handleRegisterTournament(r2, s2, { adminAuth, adminDb });

    // Player 3 attempts to register
    const { req: r3, res: s3, getStatus: status3 } = createMockReqRes({
      headers: { authorization: 'Bearer valid_player_3' },
      body: { tournamentId: 't_cap2', nickname: 'P3' },
    });
    await handleRegisterTournament(r3, s3, { adminAuth, adminDb });

    expect(status3()).toBe(403);
  });

  it('[TN-16] registration cancellation sets status to withdrawn and decrements count', async () => {
    inMemoryTournaments.set('t_cap2', {
      id: 't_cap2',
      hostId: 'host_1',
      hostName: 'Host',
      title: 'Tiny Cup',
      description: '',
      rules: '',
      format: 'single_elimination',
      status: 'registration_open',
      visibility: 'public',
      maxParticipants: 4,
      minParticipants: 2,
      participantCount: 0,
      registrationDeadline: new Date(Date.now() + 100000).toISOString(),
      quizzes: ['q1'],
      rounds: [],
      createdAt: '',
      updatedAt: '',
    });

    const { req, res, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_player_1' },
      body: { tournamentId: 't_cap2', nickname: 'P1' },
    });
    await handleRegisterTournament(req, res, { adminAuth, adminDb });

    const { req: cReq, res: cRes, getStatus: cStatus } = createMockReqRes({
      headers: { authorization: 'Bearer valid_player_1' },
      body: { tournamentId: 't_cap2' },
    });
    await handleCancelRegistration(cReq, cRes, { adminAuth, adminDb });

    expect(cStatus()).toBe(200);
    const regs = inMemoryRegistrations.get('t_cap2') || [];
    expect(regs.find(r => r.participantId === 'player_1')?.status).toBe('withdrawn');
  });

  it('[TN-17] registration cancellation after tournament start is rejected', async () => {
    inMemoryTournaments.set('t_cap2', {
      id: 't_cap2',
      hostId: 'host_1',
      hostName: 'Host',
      title: 'Tiny Cup',
      description: '',
      rules: '',
      format: 'single_elimination',
      status: 'active',
      visibility: 'public',
      maxParticipants: 4,
      minParticipants: 2,
      participantCount: 1,
      registrationDeadline: new Date(Date.now() + 100000).toISOString(),
      quizzes: ['q1'],
      rounds: [],
      createdAt: '',
      updatedAt: '',
    });

    const { req, res, getStatus, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_player_1' },
      body: { tournamentId: 't_cap2' },
    });
    await handleCancelRegistration(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(400);
  });

  // -------------------------------------------------------------------------
  // 4. Bracket Generation & Odd Counts / Byes (18 - 23)
  // -------------------------------------------------------------------------
  it('[TN-18] generates single elimination bracket for power-of-2 participants (4 players -> 2 rounds)', () => {
    const participants = [
      { id: 'p1', nickname: 'Alice' },
      { id: 'p2', nickname: 'Bob' },
      { id: 'p3', nickname: 'Charlie' },
      { id: 'p4', nickname: 'David' },
    ];
    const rounds = generateSingleEliminationBracket('tourney_4p', participants, ['q1', 'q2']);

    expect(rounds.length).toBe(2); // Semi-Finals and Grand Finals
    expect(rounds[0].matches.length).toBe(2);
    expect(rounds[1].matches.length).toBe(1);
    expect(rounds[0].matches[0].isBye).toBe(false);
  });

  it('[TN-19] non-power-of-2 participant count (5 players) generates 3 byes to reach bracket size 8', () => {
    const participants = [
      { id: 'p1', nickname: 'Seed 1' },
      { id: 'p2', nickname: 'Seed 2' },
      { id: 'p3', nickname: 'Seed 3' },
      { id: 'p4', nickname: 'Seed 4' },
      { id: 'p5', nickname: 'Seed 5' },
    ];
    const rounds = generateSingleEliminationBracket('tourney_5p', participants, ['q1']);

    expect(rounds.length).toBe(3); // 8 bracket size => log2(8) = 3 rounds
    const r1 = rounds[0];
    expect(r1.matches.length).toBe(4);
    const byeMatches = r1.matches.filter(m => m.isBye);
    expect(byeMatches.length).toBe(3); // 8 - 5 = 3 byes
    expect(byeMatches[0].winnerId).toBe('p1'); // Seed 1 gets bye
    expect(byeMatches[0].status).toBe('completed');
  });

  it('[TN-20] participant count of 3 yields 1 bye and 1 active match in Round 1', () => {
    const participants = [
      { id: 'p1', nickname: 'P1' },
      { id: 'p2', nickname: 'P2' },
      { id: 'p3', nickname: 'P3' },
    ];
    const rounds = generateSingleEliminationBracket('tourney_3p', participants, ['q1']);
    expect(rounds.length).toBe(2);
    const r1Matches = rounds[0].matches;
    expect(r1Matches.length).toBe(2);
    expect(r1Matches[0].isBye).toBe(true);
    expect(r1Matches[1].isBye).toBe(false);
  });

  it('[TN-21] bracket generation rejects fewer than 2 participants', () => {
    expect(() =>
      generateSingleEliminationBracket('tourney_err', [{ id: 'p1', nickname: 'Sole' }], ['q1'])
    ).toThrow(/at least 2/i);
  });

  it('[TN-22] assigned participants do not appear in multiple matches in the same round', () => {
    const participants = [
      { id: 'p1', nickname: 'A' },
      { id: 'p2', nickname: 'B' },
      { id: 'p3', nickname: 'C' },
      { id: 'p4', nickname: 'D' },
    ];
    const rounds = generateSingleEliminationBracket('t_unique', participants, ['q1']);
    const r1Players = rounds[0].matches.flatMap(m => [m.player1Id, m.player2Id].filter(Boolean));
    expect(new Set(r1Players).size).toBe(4);
  });

  it('[TN-23] byes do not generate fictitious opponent names or placeholder IDs', () => {
    const participants = [
      { id: 'p1', nickname: 'P1' },
      { id: 'p2', nickname: 'P2' },
      { id: 'p3', nickname: 'P3' },
    ];
    const rounds = generateSingleEliminationBracket('t_byes', participants, ['q1']);
    const byeMatch = rounds[0].matches.find(m => m.isBye);
    expect(byeMatch?.player2Id).toBeUndefined();
    expect(byeMatch?.player2Nickname).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 5. Match Finalization & Advancement (24 - 30)
  // -------------------------------------------------------------------------
  function seedTestFinalTournament() {
    const participants = [
      { id: 'player_1', nickname: 'Alice' },
      { id: 'player_2', nickname: 'Bob' },
    ];
    const rounds = generateSingleEliminationBracket('t_final', participants, ['q1']);
    inMemoryTournaments.set('t_final', {
      id: 't_final',
      hostId: 'host_123',
      hostName: 'Host',
      title: 'Final Cup',
      description: '',
      rules: '',
      format: 'single_elimination',
      status: 'active',
      visibility: 'public',
      maxParticipants: 2,
      minParticipants: 2,
      participantCount: 2,
      registrationDeadline: '',
      quizzes: ['q1'],
      rounds,
      createdAt: '',
      updatedAt: '',
    });
    inMemoryRegistrations.set('t_final', [
      { id: 'r1', tournamentId: 't_final', participantId: 'player_1', participantNickname: 'Alice', registeredAt: '', status: 'registered' },
      { id: 'r2', tournamentId: 't_final', participantId: 'player_2', participantNickname: 'Bob', registeredAt: '', status: 'registered' },
    ]);
  }

  it('[TN-24] host finalizes match with verified scores and winnerId', async () => {
    seedTestFinalTournament();
    const tournament = inMemoryTournaments.get('t_final')!;
    const matchId = tournament.rounds[0].matches[0].id;
    const { req, res, getStatus, getData, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_host_token' },
      body: {
        tournamentId: 't_final',
        matchId,
        winnerId: 'player_1',
        score1: 2500,
        score2: 1800,
      },
    });

    await handleFinalizeMatch(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(200);
    expect(getData().match.status).toBe('completed');
    expect(getData().match.winnerId).toBe('player_1');
    expect(getData().match.score1).toBe(2500);
  });

  it('[TN-25] non-host cannot finalize match (403 Forbidden)', async () => {
    seedTestFinalTournament();
    const matchId = 't_final_r1_m1';
    const { req, res, getStatus, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_player_1' }, // not host
      body: {
        tournamentId: 't_final',
        matchId,
        winnerId: 'player_1',
      },
    });

    await handleFinalizeMatch(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(403);
  });

  it('[TN-26] invalid winnerId (not in match) is rejected with 400', async () => {
    seedTestFinalTournament();
    const matchId = 't_final_r1_m1';
    const { req, res, getStatus, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_host_token' },
      body: {
        tournamentId: 't_final',
        matchId,
        winnerId: 'random_intruder',
      },
    });

    await handleFinalizeMatch(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(400);
  });

  it('[TN-27] match finalization is idempotent (replays do not duplicate results)', async () => {
    seedTestFinalTournament();
    const matchId = 't_final_r1_m1';
    const { req, res, getStatus, getData, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_host_token' },
      body: {
        tournamentId: 't_final',
        matchId,
        winnerId: 'player_1',
        score1: 2500,
        score2: 1800,
      },
    });

    await handleFinalizeMatch(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(200);

    // Replay
    const { req: r2, res: s2, getStatus: st2, getData: d2 } = createMockReqRes({
      headers: { authorization: 'Bearer valid_host_token' },
      body: {
        tournamentId: 't_final',
        matchId,
        winnerId: 'player_1',
      },
    });
    await handleFinalizeMatch(r2, s2, { adminAuth, adminDb });
    expect(st2()).toBe(200);
    expect(d2().message).toMatch(/already finalized/i);
  });

  it('[TN-28] advance winners moves verified winners into Round 2', () => {
    const participants = [
      { id: 'p1', nickname: 'Alice' },
      { id: 'p2', nickname: 'Bob' },
      { id: 'p3', nickname: 'Charlie' },
      { id: 'p4', nickname: 'David' },
    ];
    const rounds = generateSingleEliminationBracket('t_adv', participants, ['q1', 'q2']);
    
    // Complete R1 matches
    rounds[0].matches[0].status = 'completed';
    rounds[0].matches[0].winnerId = 'p1';
    rounds[0].matches[1].status = 'completed';
    rounds[0].matches[1].winnerId = 'p3';

    const { updatedNextRound, advancedCount } = advanceWinnersToNextRound(rounds[0], rounds[1]);
    expect(advancedCount).toBe(2);
    expect(updatedNextRound.matches[0].player1Id).toBe('p1');
    expect(updatedNextRound.matches[0].player2Id).toBe('p3');
    expect(updatedNextRound.matches[0].status).toBe('ready');
  });

  it('[TN-29] advancement is blocked if any match in current round is uncompleted', () => {
    const participants = [
      { id: 'p1', nickname: 'Alice' },
      { id: 'p2', nickname: 'Bob' },
      { id: 'p3', nickname: 'Charlie' },
      { id: 'p4', nickname: 'David' },
    ];
    const rounds = generateSingleEliminationBracket('t_adv_err', participants, ['q1', 'q2']);
    rounds[0].matches[0].status = 'completed';
    rounds[0].matches[0].winnerId = 'p1';
    // Match 2 is left pending

    expect(() => advanceWinnersToNextRound(rounds[0], rounds[1])).toThrow(/still pending/i);
  });

  it('[TN-30] advancement is idempotent (repeated call does not duplicate players or matches)', () => {
    const participants = [
      { id: 'p1', nickname: 'Alice' },
      { id: 'p2', nickname: 'Bob' },
      { id: 'p3', nickname: 'Charlie' },
      { id: 'p4', nickname: 'David' },
    ];
    const rounds = generateSingleEliminationBracket('t_idemp', participants, ['q1', 'q2']);
    rounds[0].matches[0].status = 'completed';
    rounds[0].matches[0].winnerId = 'p1';
    rounds[0].matches[1].status = 'completed';
    rounds[0].matches[1].winnerId = 'p3';

    const firstAdv = advanceWinnersToNextRound(rounds[0], rounds[1]);
    const secondAdv = advanceWinnersToNextRound(rounds[0], firstAdv.updatedNextRound);

    expect(secondAdv.advancedCount).toBe(0); // already set
    expect(secondAdv.updatedNextRound.matches[0].player1Id).toBe('p1');
  });

  // -------------------------------------------------------------------------
  // 6. Elo Calculation & Standings Determinism (31 - 36)
  // -------------------------------------------------------------------------
  it('[TN-31] calculates chess-standard Elo update for winner and loser', () => {
    // Both 1200 rating, player A wins
    const { newRatingA, newRatingB, deltaA, deltaB } = calculateElo(1200, 1200, 1);
    expect(deltaA).toBe(16);
    expect(deltaB).toBe(-16);
    expect(newRatingA).toBe(1216);
    expect(newRatingB).toBe(1184);
  });

  it('[TN-32] Elo rating update for upset win grants larger delta', () => {
    // Player A (1000) beats Player B (1400)
    const { deltaA, deltaB } = calculateElo(1000, 1400, 1);
    expect(deltaA).toBeGreaterThan(25);
    expect(deltaB).toBeLessThan(-25);
  });

  it('[TN-33] Elo tie splits points evenly with zero delta for equal ratings', () => {
    const { deltaA, deltaB } = calculateElo(1200, 1200, 0.5);
    expect(deltaA).toBe(0);
    expect(deltaB).toBe(0);
  });

  it('[TN-34] deterministic leaderboard ranks by wins, points, score, and Elo', () => {
    const registrations: TournamentRegistration[] = [
      { id: 'r1', tournamentId: 't', participantId: 'p1', participantNickname: 'Alice', registeredAt: '', status: 'registered', initialElo: 1200 },
      { id: 'r2', tournamentId: 't', participantId: 'p2', participantNickname: 'Bob', registeredAt: '', status: 'registered', initialElo: 1200 },
      { id: 'r3', tournamentId: 't', participantId: 'p3', participantNickname: 'Charlie', registeredAt: '', status: 'registered', initialElo: 1200 },
    ];

    const rounds = generateSingleEliminationBracket('t', [
      { id: 'p1', nickname: 'Alice' },
      { id: 'p2', nickname: 'Bob' },
      { id: 'p3', nickname: 'Charlie' },
    ], ['q1']);

    // Finalize matches
    rounds[0].matches[1].status = 'completed';
    rounds[0].matches[1].winnerId = 'p2';
    rounds[0].matches[1].score1 = 1000;
    rounds[0].matches[1].score2 = 2000;

    const standings = computeTournamentStandings(registrations, rounds);
    expect(standings.length).toBe(3);
    expect(standings[0].rank).toBe(1);
    // P1 had bye (1 win), P2 had win (1 win), P3 had loss (0 wins)
    expect(standings.find(s => s.participantId === 'p3')?.losses).toBe(1);
    expect(standings.find(s => s.participantId === 'p3')?.isEliminated).toBe(true);
  });

  it('[TN-35] two sequential standings calculations on identical data match 100%', () => {
    const registrations: TournamentRegistration[] = [
      { id: 'r1', tournamentId: 't', participantId: 'p1', participantNickname: 'Alice', registeredAt: '', status: 'registered' },
      { id: 'r2', tournamentId: 't', participantId: 'p2', participantNickname: 'Bob', registeredAt: '', status: 'registered' },
    ];
    const rounds = generateSingleEliminationBracket('t', [
      { id: 'p1', nickname: 'Alice' },
      { id: 'p2', nickname: 'Bob' },
    ], ['q1']);

    const s1 = computeTournamentStandings(registrations, rounds);
    const s2 = computeTournamentStandings(registrations, rounds);
    expect(s1).toEqual(s2);
  });

  it('[TN-36] GET /api/tournaments/:id/standings returns verified rankings and champion', async () => {
    seedTestFinalTournament();
    const { req, res, getStatus, getData, adminAuth, adminDb } = createMockReqRes({
      params: { id: 't_final' },
    });

    await handleGetTournamentStandings(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(200);
    expect(getData().tournamentId).toBe('t_final');
    expect(Array.isArray(getData().standings)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. Security, Privacy & Integrity Boundaries (37 - 40)
  // -------------------------------------------------------------------------
  it('[TN-37] private tournament requires authentication to view standings (401 if unauthenticated)', async () => {
    inMemoryTournaments.set('t_priv', {
      id: 't_priv',
      hostId: 'host_1',
      hostName: 'Host',
      title: 'Secret Tournament',
      description: '',
      rules: '',
      format: 'single_elimination',
      status: 'active',
      visibility: 'private',
      maxParticipants: 4,
      minParticipants: 2,
      participantCount: 2,
      registrationDeadline: '',
      quizzes: ['q1'],
      rounds: [],
      createdAt: '',
      updatedAt: '',
    });

    const { req, res, getStatus, adminAuth, adminDb } = createMockReqRes({
      params: { id: 't_priv' },
      headers: {}, // no auth header
    });

    await handleGetTournamentStandings(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(401);
  });

  it('[TN-38] non-host cannot start rounds (403 Forbidden)', async () => {
    seedTestFinalTournament();
    const { req, res, getStatus, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_player_1' },
      body: { tournamentId: 't_final' },
    });

    await handleStartRound(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(403);
  });

  it('[TN-39] tournament completion accurately records champion', async () => {
    seedTestFinalTournament();
    const t = inMemoryTournaments.get('t_final')!;
    t.rounds[0].matches[0].status = 'completed';
    t.rounds[0].matches[0].winnerId = 'player_1';

    const { req, res, getStatus, getData, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_host_token' },
      body: { tournamentId: 't_final' },
    });

    await handleStartRound(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(200);
    expect(getData().tournament.status).toBe('completed');
    expect(getData().tournament.championId).toBe('player_1');
  });

  it('[TN-40] tournament cannot start with fewer than minimum participants', async () => {
    inMemoryTournaments.set('t_under', {
      id: 't_under',
      hostId: 'host_123',
      hostName: 'Host',
      title: 'Under Cup',
      description: '',
      rules: '',
      format: 'single_elimination',
      status: 'registration_open',
      visibility: 'public',
      maxParticipants: 8,
      minParticipants: 4, // requires 4
      participantCount: 1,
      registrationDeadline: new Date(Date.now() + 100000).toISOString(),
      quizzes: ['q1'],
      rounds: [],
      createdAt: '',
      updatedAt: '',
    });
    inMemoryRegistrations.set('t_under', [
      { id: 'r1', tournamentId: 't_under', participantId: 'p1', participantNickname: 'P1', registeredAt: '', status: 'registered' },
    ]);

    const { req, res, getStatus, getData, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_host_token' },
      body: { tournamentId: 't_under' },
    });

    await handleStartRound(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(400);
    expect(getData().error).toMatch(/at least 4/i);
  });
});
