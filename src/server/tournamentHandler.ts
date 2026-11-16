/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import {
  Tournament,
  TournamentRegistration,
  TournamentMatch,
} from '../types/tournament';
import {
  validateTournamentConfig,
  isValidTournamentTransition,
  generateSingleEliminationBracket,
  advanceWinnersToNextRound,
  computeTournamentStandings,
} from './tournamentEngine';
import { assertAccountActive } from './accountDeletionEngine';
import {
  checkTournamentRateLimit,
  checkTournamentReadRateLimit,
  extractClientIp,
  sendRateLimitResponse,
} from './sharedRateLimiter';

export interface TournamentRouteDependencies {
  adminAuth: Auth;
  adminDb: Firestore;
}

/**
 * Legacy in-memory stores.
 * @deprecated Retained ONLY for legacy synchronous unit tests when NODE_ENV==='test' and no Firestore mock is passed.
 * Production paths fail closed (503) if adminDb is unavailable.
 */
export const inMemoryTournaments = new Map<string, Tournament>();
export const inMemoryRegistrations = new Map<string, TournamentRegistration[]>();
export const inMemoryGames = new Map<string, any>();

function hasFirestore(adminDb: any): adminDb is Firestore {
  return Boolean(
    adminDb &&
    typeof adminDb.collection === 'function' &&
    typeof adminDb.runTransaction === 'function'
  );
}

function isAdminUser(user: any): boolean {
  return Boolean(
    user &&
    user.firebase?.sign_in_provider !== 'anonymous' &&
    (user.admin === true || user.role === 'admin')
  );
}

async function authenticate(req: Request, adminAuth: Auth) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split('Bearer ')[1].trim();
  try {
    return await adminAuth.verifyIdToken(token, true);
  } catch {
    return null;
  }
}

/**
 * POST /api/tournaments/create
 */
export async function handleCreateTournament(
  req: Request,
  res: Response,
  deps: TournamentRouteDependencies
): Promise<void> {
  const user = await authenticate(req, deps.adminAuth);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized: Valid Firebase ID token is required.' });
    return;
  }

  if (user.firebase?.sign_in_provider === 'anonymous') {
    res.status(403).json({ error: 'Anonymous users cannot create or host tournaments.' });
    return;
  }

  // SEC-05: Server-side email verification required to host tournaments
  if (user.email_verified !== true) {
    res.status(403).json({
      error: 'Email verification required to host tournaments.',
      code: 'EMAIL_NOT_VERIFIED',
    });
    return;
  }

  const acct = await assertAccountActive(deps.adminDb, user.uid);
  if (!acct.active) {
    res.status(403).json({ error: acct.error });
    return;
  }

  const rateCheck = checkTournamentRateLimit(user.uid);
  if (!rateCheck.allowed) {
    sendRateLimitResponse(res, rateCheck.retryAfterSec, {
      error: `Too many tournament requests. Please wait ${rateCheck.retryAfterSec}s.`,
    });
    return;
  }

  const {
    title,
    description = '',
    rules = '',
    format = 'single_elimination',
    visibility = 'public',
    maxParticipants = 32,
    minParticipants = 2,
    registrationDeadline,
    scheduledStartTime,
    quizzes = [],
  } = req.body || {};

  const validation = validateTournamentConfig({
    hostId: user.uid,
    title,
    description,
    rules,
    format,
    visibility,
    maxParticipants: Number(maxParticipants),
    minParticipants: Number(minParticipants),
    registrationDeadline,
    scheduledStartTime,
    quizzes,
  });

  if (!validation.valid) {
    res.status(400).json({ error: validation.errors.join(' ') });
    return;
  }

  const nowIso = new Date().toISOString();
  const tournamentId = `tourney_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const newTournament: Tournament = {
    id: tournamentId,
    hostId: user.uid,
    hostName: (user.name as string) || (user.email as string) || 'Tournament Host',
    title: title.trim(),
    description: description.trim(),
    rules: rules.trim(),
    format,
    status: 'registration_open',
    visibility,
    maxParticipants: Number(maxParticipants),
    minParticipants: Number(minParticipants),
    participantCount: 0,
    registrationDeadline,
    ...(scheduledStartTime ? { scheduledStartTime } : {}),
    quizzes,
    rounds: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (hasFirestore(deps.adminDb)) {
    try {
      await deps.adminDb.collection('tournaments').doc(tournamentId).set(newTournament);
      res.status(201).json({ success: true, tournament: newTournament });
      return;
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to persist tournament in Firestore.' });
      return;
    }
  }

  if (process.env.NODE_ENV !== 'test') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative Firestore database is not configured.' });
    return;
  }

  inMemoryTournaments.set(tournamentId, newTournament);
  inMemoryRegistrations.set(tournamentId, []);
  res.status(201).json({ success: true, tournament: newTournament });
}

/**
 * POST /api/tournaments/register
 */
export async function handleRegisterTournament(
  req: Request,
  res: Response,
  deps: TournamentRouteDependencies
): Promise<void> {
  const user = await authenticate(req, deps.adminAuth);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized: Authentication required to register.' });
    return;
  }

  const acct = await assertAccountActive(deps.adminDb, user.uid);
  if (!acct.active) {
    res.status(403).json({ error: acct.error });
    return;
  }

  const rateCheck = checkTournamentRateLimit(user.uid);
  if (!rateCheck.allowed) {
    sendRateLimitResponse(res, rateCheck.retryAfterSec, {
      error: `Too many tournament requests. Please wait ${rateCheck.retryAfterSec}s.`,
    });
    return;
  }

  const { tournamentId, nickname, participantId: requestedParticipantId } = req.body || {};
  if (!tournamentId || typeof tournamentId !== 'string') {
    res.status(400).json({ error: 'tournamentId is required.' });
    return;
  }

  if (requestedParticipantId && requestedParticipantId !== user.uid) {
    res.status(403).json({ error: 'Forbidden: Cannot register on behalf of another user.' });
    return;
  }

  const safeNickname = String(nickname || user.name || user.email || 'Player').trim().slice(0, 30) || 'Player';

  if (hasFirestore(deps.adminDb)) {
    try {
      const result = await deps.adminDb.runTransaction(async (tx: Transaction) => {
        const tRef = deps.adminDb.collection('tournaments').doc(tournamentId);
        const regsCol = tRef.collection('registrations');
        const myRegRef = regsCol.doc(user.uid);

        // Reads BEFORE writes
        const [tSnap, myRegSnap, activeRegsSnap] = await Promise.all([
          tx.get(tRef),
          tx.get(myRegRef),
          tx.get(regsCol.where('status', '==', 'registered')),
        ]);

        if (!tSnap.exists) {
          return { statusCode: 404, error: 'Tournament not found.' };
        }

        const tournament = tSnap.data() as Tournament;

        if (tournament.status !== 'registration_open') {
          return {
            statusCode: 400,
            error: `Registration is not open for this tournament (Status: ${tournament.status}).`,
          };
        }

        if (Date.now() > new Date(tournament.registrationDeadline).getTime()) {
          return { statusCode: 400, error: 'Registration deadline has passed.' };
        }

        if (myRegSnap.exists && myRegSnap.data()?.status === 'registered') {
          return { statusCode: 409, error: 'You are already registered for this tournament.' };
        }

        const activeCount = activeRegsSnap.size;
        if (activeCount >= tournament.maxParticipants) {
          return {
            statusCode: 403,
            error: 'Tournament is full. Maximum participant capacity reached.',
          };
        }

        const maxActiveSeed = activeRegsSnap.docs.reduce((max, doc) => {
          const docSeed = Number(doc.data()?.seed);
          return Number.isFinite(docSeed) && docSeed > max ? docSeed : max;
        }, 0);

        const nowIso = new Date().toISOString();
        const registration: TournamentRegistration = {
          id: `reg_${user.uid}`,
          tournamentId,
          participantId: user.uid,
          participantNickname: safeNickname,
          registeredAt: nowIso,
          status: 'registered',
          seed: maxActiveSeed + 1,
          initialElo: 1200,
        };

        tx.set(myRegRef, registration);
        tx.set(
          tRef,
          {
            participantCount: activeCount + 1,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        return { statusCode: 200, registration };
      });

      if (result.error) {
        res.status(result.statusCode).json({ error: result.error });
        return;
      }

      clearTournamentStandingsCache(tournamentId);
      res.status(200).json({ success: true, registration: result.registration });
      return;
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to register for tournament.' });
      return;
    }
  }

  if (process.env.NODE_ENV !== 'test') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative Firestore database is not configured.' });
    return;
  }

  const tournament = inMemoryTournaments.get(tournamentId);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found.' });
    return;
  }
  if (tournament.status !== 'registration_open') {
    res.status(400).json({ error: `Registration is not open for this tournament (Status: ${tournament.status}).` });
    return;
  }
  if (Date.now() > new Date(tournament.registrationDeadline).getTime()) {
    res.status(400).json({ error: 'Registration deadline has passed.' });
    return;
  }
  const currentRegs = inMemoryRegistrations.get(tournamentId) || [];
  if (currentRegs.some(r => r.participantId === user.uid && r.status === 'registered')) {
    res.status(409).json({ error: 'You are already registered for this tournament.' });
    return;
  }
  if (currentRegs.filter(r => r.status === 'registered').length >= tournament.maxParticipants) {
    res.status(403).json({ error: 'Tournament is full. Maximum participant capacity reached.' });
    return;
  }

  const registration: TournamentRegistration = {
    id: `reg_${user.uid}`,
    tournamentId,
    participantId: user.uid,
    participantNickname: safeNickname,
    registeredAt: new Date().toISOString(),
    status: 'registered',
    seed: currentRegs.length + 1,
    initialElo: 1200,
  };
  currentRegs.push(registration);
  inMemoryRegistrations.set(tournamentId, currentRegs);
  tournament.participantCount = currentRegs.filter(r => r.status === 'registered').length;
  tournament.updatedAt = new Date().toISOString();
  clearTournamentStandingsCache(tournamentId);
  res.status(200).json({ success: true, registration });
}

/**
 * POST /api/tournaments/cancel-registration
 */
export async function handleCancelRegistration(
  req: Request,
  res: Response,
  deps: TournamentRouteDependencies
): Promise<void> {
  const user = await authenticate(req, deps.adminAuth);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const acct = await assertAccountActive(deps.adminDb, user.uid);
  if (!acct.active) {
    res.status(403).json({ error: acct.error });
    return;
  }

  const rateCheck = checkTournamentRateLimit(user.uid);
  if (!rateCheck.allowed) {
    sendRateLimitResponse(res, rateCheck.retryAfterSec, {
      error: `Too many tournament requests. Please wait ${rateCheck.retryAfterSec}s.`,
    });
    return;
  }

  const { tournamentId } = req.body || {};
  if (!tournamentId || typeof tournamentId !== 'string') {
    res.status(400).json({ error: 'tournamentId is required.' });
    return;
  }

  if (hasFirestore(deps.adminDb)) {
    try {
      const result = await deps.adminDb.runTransaction(async (tx: Transaction) => {
        const tRef = deps.adminDb.collection('tournaments').doc(tournamentId);
        const regsCol = tRef.collection('registrations');
        const myRegRef = regsCol.doc(user.uid);

        const [tSnap, myRegSnap, activeRegsSnap] = await Promise.all([
          tx.get(tRef),
          tx.get(myRegRef),
          tx.get(regsCol.where('status', '==', 'registered')),
        ]);

        if (!tSnap.exists) {
          return { statusCode: 404, error: 'Tournament not found.' };
        }

        const tournament = tSnap.data() as Tournament;
        if (tournament.status !== 'registration_open') {
          return { statusCode: 400, error: 'Cannot cancel registration once tournament has started.' };
        }

        if (myRegSnap.exists && myRegSnap.data()?.status === 'registered') {
          const nowIso = new Date().toISOString();
          tx.set(myRegRef, { status: 'withdrawn', withdrawnAt: nowIso }, { merge: true });
          tx.set(
            tRef,
            {
              participantCount: Math.max(0, activeRegsSnap.size - 1),
              updatedAt: nowIso,
            },
            { merge: true }
          );
        }

        return { statusCode: 200 };
      });

      if (result.error) {
        res.status(result.statusCode).json({ error: result.error });
        return;
      }

      clearTournamentStandingsCache(tournamentId);
      res.status(200).json({ success: true, message: 'Registration cancelled.' });
      return;
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to cancel registration.' });
      return;
    }
  }

  if (process.env.NODE_ENV !== 'test') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative Firestore database is not configured.' });
    return;
  }

  const tournament = inMemoryTournaments.get(tournamentId);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found.' });
    return;
  }
  if (tournament.status !== 'registration_open') {
    res.status(400).json({ error: 'Cannot cancel registration once tournament has started.' });
    return;
  }
  const currentRegs = inMemoryRegistrations.get(tournamentId) || [];
  const regIdx = currentRegs.findIndex(r => r.participantId === user.uid && r.status === 'registered');
  if (regIdx >= 0) {
    currentRegs[regIdx].status = 'withdrawn';
    tournament.participantCount = currentRegs.filter(r => r.status === 'registered').length;
    tournament.updatedAt = new Date().toISOString();
  }
  clearTournamentStandingsCache(tournamentId);
  res.status(200).json({ success: true, message: 'Registration cancelled.' });
}

/**
 * POST /api/tournaments/start-round
 * Initializes brackets (registration_open -> active), advances rounds, or finalizes tournament (active -> completed).
 */
export async function handleStartRound(
  req: Request,
  res: Response,
  deps: TournamentRouteDependencies
): Promise<void> {
  const user = await authenticate(req, deps.adminAuth);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const acct = await assertAccountActive(deps.adminDb, user.uid);
  if (!acct.active) {
    res.status(403).json({ error: acct.error });
    return;
  }

  const rateCheck = checkTournamentRateLimit(user.uid);
  if (!rateCheck.allowed) {
    sendRateLimitResponse(res, rateCheck.retryAfterSec, {
      error: `Too many tournament requests. Please wait ${rateCheck.retryAfterSec}s.`,
    });
    return;
  }

  const { tournamentId } = req.body || {};
  if (!tournamentId || typeof tournamentId !== 'string') {
    res.status(400).json({ error: 'tournamentId is required.' });
    return;
  }

  if (hasFirestore(deps.adminDb)) {
    try {
      const result = await deps.adminDb.runTransaction(async (tx: Transaction) => {
        const tRef = deps.adminDb.collection('tournaments').doc(tournamentId);
        const regsCol = tRef.collection('registrations');

        const [tSnap, allRegsSnap] = await Promise.all([tx.get(tRef), tx.get(regsCol)]);

        if (!tSnap.exists) {
          return { statusCode: 404, error: 'Tournament not found.' };
        }

        const tournament = tSnap.data() as Tournament;
        if (tournament.hostId !== user.uid && !isAdminUser(user)) {
          return { statusCode: 403, error: 'Forbidden: Only the tournament host can start rounds.' };
        }

        if (tournament.status === 'completed' || tournament.status === 'cancelled') {
          return {
            statusCode: 400,
            error: `Invalid status transition: Tournament is already ${tournament.status}.`,
          };
        }

        const allRegs = (allRegsSnap.docs || []).map(d => d.data() as TournamentRegistration);
        const activeRegs = allRegs
          .filter(r => r.status === 'registered')
          .sort((a, b) => {
            const seedDiff = (a.seed || 0) - (b.seed || 0);
            if (seedDiff !== 0) return seedDiff;
            return a.participantId.localeCompare(b.participantId);
          });

        if (activeRegs.length < tournament.minParticipants) {
          return {
            statusCode: 400,
            error: `Cannot start tournament: At least ${tournament.minParticipants} registered participants are required (current: ${activeRegs.length}).`,
          };
        }

        const nowIso = new Date().toISOString();

        // Transition: registration_open -> active (initialize bracket)
        if (tournament.status === 'registration_open') {
          if (!isValidTournamentTransition(tournament.status, 'active')) {
            return { statusCode: 400, error: `Invalid tournament transition from ${tournament.status} to active.` };
          }

          const participants = activeRegs.map(r => ({
            id: r.participantId,
            nickname: r.participantNickname,
          }));

          const rounds = generateSingleEliminationBracket(tournamentId, participants, tournament.quizzes);
          const updatedTournament: Tournament = {
            ...tournament,
            rounds,
            status: 'active',
            participantCount: activeRegs.length,
            updatedAt: nowIso,
          };

          tx.set(tRef, updatedTournament);
          for (const round of rounds) {
            for (const match of round.matches) {
              tx.set(tRef.collection('matches').doc(match.id), match);
            }
          }

          return { statusCode: 200, round: rounds[0], tournament: updatedTournament };
        }

        // Active tournament: advance to next round or complete
        const rounds = Array.isArray(tournament.rounds) ? [...tournament.rounds] : [];
        const currentActiveIdx = rounds.findIndex(r => r.status === 'active');
        if (currentActiveIdx < 0) {
          return { statusCode: 400, error: 'No active round found.' };
        }

        const currentRound = rounds[currentActiveIdx];
        const nextRound = rounds[currentActiveIdx + 1];

        if (!nextRound) {
          if (!isValidTournamentTransition(tournament.status, 'completed')) {
            return { statusCode: 400, error: `Invalid transition from ${tournament.status} to completed.` };
          }

          const finalMatch = currentRound.matches[0];
          if (!finalMatch || !finalMatch.winnerId) {
            return { statusCode: 400, error: 'Final match is not completed yet.' };
          }

          const updatedCurrentRound = { ...currentRound, status: 'completed' as const, completedAt: nowIso };
          rounds[currentActiveIdx] = updatedCurrentRound;

          const championNickname =
            finalMatch.winnerId === finalMatch.player1Id
              ? finalMatch.player1Nickname
              : finalMatch.player2Nickname;

          const updatedTournament: Tournament = {
            ...tournament,
            rounds,
            status: 'completed',
            championId: finalMatch.winnerId,
            championNickname,
            updatedAt: nowIso,
          };

          const standings = computeTournamentStandings(allRegs, rounds);
          const totalParticipants = Math.max(1, standings.length);

          tx.set(tRef, { ...updatedTournament, completedAt: nowIso });
          for (const standing of standings) {
            const totalMatches = Math.max(1, standing.matchesPlayed);
            const accuracy = Math.min(1, Math.max(0, standing.wins / totalMatches));

            tx.set(tRef.collection('results').doc(standing.participantId), {
              ...standing,
              tournamentId,
              accuracy,
              completedAt: nowIso,
            });

            tx.set(
              regsCol.doc(standing.participantId),
              {
                nickname: standing.nickname,
                rank: standing.rank,
                score: standing.totalScore,
                accuracy,
                totalParticipants,
                completedAt: nowIso,
              },
              { merge: true }
            );
          }

          return {
            statusCode: 200,
            message: 'Tournament completed!',
            tournament: updatedTournament,
            standings,
          };
        }

        let updatedNextRound: typeof nextRound;
        try {
          const advancement = advanceWinnersToNextRound(currentRound, nextRound);
          updatedNextRound = advancement.updatedNextRound;
        } catch (domainErr: any) {
          return {
            statusCode: 400,
            error: domainErr?.message || 'Cannot advance tournament round.',
          };
        }

        rounds[currentActiveIdx] = { ...currentRound, status: 'completed', completedAt: nowIso };
        rounds[currentActiveIdx + 1] = updatedNextRound;

        const updatedTournament: Tournament = {
          ...tournament,
          rounds,
          updatedAt: nowIso,
        };

        tx.set(tRef, updatedTournament);
        for (const match of updatedNextRound.matches) {
          tx.set(tRef.collection('matches').doc(match.id), match);
        }

        return { statusCode: 200, round: updatedNextRound, tournament: updatedTournament };
      });

      if (result.error) {
        res.status(result.statusCode).json({ error: result.error });
        return;
      }

      clearTournamentStandingsCache(tournamentId);

      res.status(200).json({
        success: true,
        ...(result.message ? { message: result.message } : {}),
        ...(result.round ? { round: result.round } : {}),
        ...(result.standings ? { standings: result.standings } : {}),
        tournament: result.tournament,
      });
      return;
    } catch (err: any) {
      console.error('[Tournament] Failed to advance tournament round:', err);
      res.status(500).json({ error: 'Failed to advance tournament round due to a server error.' });
      return;
    }
  }

  if (process.env.NODE_ENV !== 'test') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative Firestore database is not configured.' });
    return;
  }

  // Legacy NODE_ENV==='test' fallback when no Firestore mock is passed
  const tournament = inMemoryTournaments.get(tournamentId);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found.' });
    return;
  }
  if (tournament.hostId !== user.uid) {
    res.status(403).json({ error: 'Forbidden: Only the tournament host can start rounds.' });
    return;
  }
  const registrations = (inMemoryRegistrations.get(tournamentId) || []).filter(r => r.status === 'registered');
  if (registrations.length < tournament.minParticipants) {
    res.status(400).json({
      error: `Cannot start tournament: At least ${tournament.minParticipants} registered participants are required (current: ${registrations.length}).`,
    });
    return;
  }
  if (tournament.status === 'registration_open') {
    const participants = registrations.map(r => ({ id: r.participantId, nickname: r.participantNickname }));
    const rounds = generateSingleEliminationBracket(tournamentId, participants, tournament.quizzes);
    tournament.rounds = rounds;
    tournament.status = 'active';
    tournament.updatedAt = new Date().toISOString();
    clearTournamentStandingsCache(tournamentId);
    res.status(200).json({ success: true, round: rounds[0], tournament });
    return;
  }
  const currentActiveIdx = tournament.rounds.findIndex(r => r.status === 'active');
  if (currentActiveIdx < 0) {
    res.status(400).json({ error: 'No active round found.' });
    return;
  }
  const currentRound = tournament.rounds[currentActiveIdx];
  const nextRound = tournament.rounds[currentActiveIdx + 1];
  if (!nextRound) {
    const finalMatch = currentRound.matches[0];
    if (finalMatch && finalMatch.winnerId) {
      tournament.status = 'completed';
      tournament.championId = finalMatch.winnerId;
      tournament.championNickname =
        finalMatch.winnerId === finalMatch.player1Id ? finalMatch.player1Nickname : finalMatch.player2Nickname;
      tournament.updatedAt = new Date().toISOString();
      clearTournamentStandingsCache(tournamentId);
      res.status(200).json({ success: true, message: 'Tournament completed!', tournament });
      return;
    }
    res.status(400).json({ error: 'Final match is not completed yet.' });
    return;
  }
  try {
    const { updatedNextRound } = advanceWinnersToNextRound(currentRound, nextRound);
    currentRound.status = 'completed';
    currentRound.completedAt = new Date().toISOString();
    tournament.rounds[currentActiveIdx + 1] = updatedNextRound;
    tournament.updatedAt = new Date().toISOString();
    clearTournamentStandingsCache(tournamentId);
    res.status(200).json({ success: true, round: updatedNextRound, tournament });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to advance winners.' });
  }
}

/**
 * POST /api/tournaments/finalize-match
 */
export async function handleFinalizeMatch(
  req: Request,
  res: Response,
  deps: TournamentRouteDependencies
): Promise<void> {
  const user = await authenticate(req, deps.adminAuth);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const acct = await assertAccountActive(deps.adminDb, user.uid);
  if (!acct.active) {
    res.status(403).json({ error: acct.error });
    return;
  }

  const rateCheck = checkTournamentRateLimit(user.uid);
  if (!rateCheck.allowed) {
    sendRateLimitResponse(res, rateCheck.retryAfterSec, {
      error: `Too many tournament requests. Please wait ${rateCheck.retryAfterSec}s.`,
    });
    return;
  }

  const { tournamentId, matchId, winnerId, score1, score2 } = req.body || {};
  if (!tournamentId || !matchId) {
    res.status(400).json({ error: 'tournamentId and matchId are required.' });
    return;
  }

  const MAX_MATCH_SCORE = 500000;

  if (hasFirestore(deps.adminDb)) {
    try {
      const result = await deps.adminDb.runTransaction(async (tx: Transaction) => {
        const tRef = deps.adminDb.collection('tournaments').doc(tournamentId);
        const tSnap = await tx.get(tRef);

        if (!tSnap.exists) {
          return { statusCode: 404, error: 'Tournament not found.' };
        }

        const tournament = tSnap.data() as Tournament;
        if (tournament.hostId !== user.uid && !isAdminUser(user)) {
          return { statusCode: 403, error: 'Forbidden: Only the tournament host can finalize matches.' };
        }

        if (tournament.status !== 'active') {
          return { statusCode: 400, error: `Cannot finalize match when tournament status is ${tournament.status}.` };
        }

        const rounds = Array.isArray(tournament.rounds) ? tournament.rounds.map(r => ({
          ...r,
          matches: [...r.matches],
        })) : [];

        let targetRoundIdx = -1;
        let targetMatchIdx = -1;
        for (let rIdx = 0; rIdx < rounds.length; rIdx++) {
          const mIdx = rounds[rIdx].matches.findIndex(item => item.id === matchId);
          if (mIdx >= 0) {
            targetRoundIdx = rIdx;
            targetMatchIdx = mIdx;
            break;
          }
        }

        if (targetRoundIdx < 0 || targetMatchIdx < 0) {
          return { statusCode: 404, error: 'Match not found.' };
        }

        const targetMatch = { ...rounds[targetRoundIdx].matches[targetMatchIdx] };

        if (targetMatch.status === 'completed') {
          return { statusCode: 200, match: targetMatch, message: 'Match already finalized.' };
        }

        if (!targetMatch.player1Id || !targetMatch.player2Id) {
          return { statusCode: 400, error: 'Cannot finalize match: participants have not been determined.' };
        }

        let resolvedWinnerId = winnerId;
        let resolvedScore1 = 0;
        let resolvedScore2 = 0;

        // If match is linked to an authoritative game session, derive scores exclusively from Firestore players
        if (targetMatch.gameId) {
          const gameDocRef = deps.adminDb.collection('games').doc(targetMatch.gameId);
          const gameSnap = await tx.get(gameDocRef);
          if (gameSnap.exists) {
            const gameData = gameSnap.data();
            if (gameData?.hostId && gameData.hostId !== tournament.hostId) {
              return {
                statusCode: 403,
                error: 'Forbidden: Linked game session does not belong to this tournament host.',
              };
            }
            if (gameData?.status && gameData.status !== 'finished') {
              return {
                statusCode: 400,
                error: `Cannot finalize match: linked game session is still ${gameData.status}. Game must be finished first.`,
              };
            }
          }

          const playersCol = gameDocRef.collection('players');
          const [p1Snap, p2Snap] = await Promise.all([
            tx.get(playersCol.doc(targetMatch.player1Id)),
            tx.get(playersCol.doc(targetMatch.player2Id)),
          ]);
          if (!p1Snap.exists || !p2Snap.exists) {
            return {
              statusCode: 404,
              error: 'Authoritative game player records not found for linked match.',
            };
          }
          resolvedScore1 = Math.max(0, Number(p1Snap.data()?.score) || 0);
          resolvedScore2 = Math.max(0, Number(p2Snap.data()?.score) || 0);
          if (resolvedScore1 > resolvedScore2) {
            resolvedWinnerId = targetMatch.player1Id;
          } else if (resolvedScore2 > resolvedScore1) {
            resolvedWinnerId = targetMatch.player2Id;
          } else {
            // Deterministic server-side tie-breaker: higher bracket seed (player1Id slot)
            resolvedWinnerId = targetMatch.player1Id;
          }
        } else {
          // Manual / unlinked match score validation
          if (score1 === undefined || score2 === undefined) {
            return { statusCode: 400, error: 'score1 and score2 are required for unlinked matches.' };
          }
          const numScore1 = Number(score1);
          const numScore2 = Number(score2);
          if (!Number.isFinite(numScore1) || !Number.isFinite(numScore2) || numScore1 < 0 || numScore2 < 0) {
            return { statusCode: 400, error: 'Match scores must be non-negative finite numbers.' };
          }
          if (!Number.isInteger(numScore1) || !Number.isInteger(numScore2)) {
            return { statusCode: 400, error: 'Match scores must be integers.' };
          }
          if (numScore1 > MAX_MATCH_SCORE || numScore2 > MAX_MATCH_SCORE) {
            return { statusCode: 400, error: `Match scores cannot exceed ${MAX_MATCH_SCORE}.` };
          }
          if (!winnerId || (winnerId !== targetMatch.player1Id && winnerId !== targetMatch.player2Id)) {
            return { statusCode: 400, error: 'Invalid winnerId: Must match player1Id or player2Id.' };
          }
          // Enforce score-winner consistency
          if (numScore1 > numScore2 && winnerId !== targetMatch.player1Id) {
            return { statusCode: 400, error: `Invalid winnerId: Player 1 has higher score (${numScore1} > ${numScore2}).` };
          }
          if (numScore2 > numScore1 && winnerId !== targetMatch.player2Id) {
            return { statusCode: 400, error: `Invalid winnerId: Player 2 has higher score (${numScore2} > ${numScore1}).` };
          }
          resolvedScore1 = numScore1;
          resolvedScore2 = numScore2;
          resolvedWinnerId = winnerId;
        }

        const nowIso = new Date().toISOString();
        targetMatch.winnerId = resolvedWinnerId;
        targetMatch.score1 = resolvedScore1;
        targetMatch.score2 = resolvedScore2;
        targetMatch.status = 'completed';
        targetMatch.finalizedAt = nowIso;

        rounds[targetRoundIdx].matches[targetMatchIdx] = targetMatch;

        tx.set(tRef, { rounds, updatedAt: nowIso }, { merge: true });
        tx.set(tRef.collection('matches').doc(targetMatch.id), targetMatch);

        return { statusCode: 200, match: targetMatch };
      });

      if (result.error) {
        res.status(result.statusCode).json({ error: result.error });
        return;
      }

      clearTournamentStandingsCache(tournamentId);

      res.status(200).json({
        success: true,
        match: result.match,
        ...(result.message ? { message: result.message } : {}),
      });
      return;
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to finalize match.' });
      return;
    }
  }

  if (process.env.NODE_ENV !== 'test') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative Firestore database is not configured.' });
    return;
  }

  const tournament = inMemoryTournaments.get(tournamentId);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found.' });
    return;
  }
  if (tournament.hostId !== user.uid) {
    res.status(403).json({ error: 'Forbidden: Only the tournament host can finalize matches.' });
    return;
  }
  if (tournament.status !== 'active') {
    res.status(400).json({ error: `Cannot finalize match when tournament status is ${tournament.status}.` });
    return;
  }
  let targetMatch: TournamentMatch | null = null;
  for (const r of tournament.rounds) {
    const m = r.matches.find(item => item.id === matchId);
    if (m) {
      targetMatch = m;
      break;
    }
  }
  if (!targetMatch) {
    res.status(404).json({ error: 'Match not found.' });
    return;
  }
  if (targetMatch.status === 'completed') {
    res.status(200).json({ success: true, match: targetMatch, message: 'Match already finalized.' });
    return;
  }
  if (!targetMatch.player1Id || !targetMatch.player2Id) {
    res.status(400).json({ error: 'Cannot finalize match: participants have not been determined.' });
    return;
  }

  let resolvedWinnerId = winnerId;
  let resolvedScore1 = 0;
  let resolvedScore2 = 0;

  if (targetMatch.gameId) {
    // In-memory test representation of linked game
    const game = inMemoryGames.get(targetMatch.gameId);
    if (!game) {
      res.status(404).json({ error: 'Linked game session not found.' });
      return;
    }
    if (game.status !== 'finished') {
      res.status(400).json({ error: `Cannot finalize match: linked game session is still ${game.status}. Game must be finished first.` });
      return;
    }
    const p1 = (game.players || []).find((p: any) => p.id === targetMatch.player1Id);
    const p2 = (game.players || []).find((p: any) => p.id === targetMatch.player2Id);
    if (!p1 || !p2) {
      res.status(404).json({ error: 'Authoritative game player records not found for linked match.' });
      return;
    }
    resolvedScore1 = Math.max(0, Number(p1.score) || 0);
    resolvedScore2 = Math.max(0, Number(p2.score) || 0);
    resolvedWinnerId = resolvedScore1 > resolvedScore2 ? targetMatch.player1Id : resolvedScore2 > resolvedScore1 ? targetMatch.player2Id : targetMatch.player1Id;
  } else {
    if (score1 === undefined || score2 === undefined) {
      res.status(400).json({ error: 'score1 and score2 are required for unlinked matches.' });
      return;
    }
    const numScore1 = Number(score1);
    const numScore2 = Number(score2);
    if (!Number.isFinite(numScore1) || !Number.isFinite(numScore2) || numScore1 < 0 || numScore2 < 0) {
      res.status(400).json({ error: 'Match scores must be non-negative finite numbers.' });
      return;
    }
    if (!Number.isInteger(numScore1) || !Number.isInteger(numScore2)) {
      res.status(400).json({ error: 'Match scores must be integers.' });
      return;
    }
    if (numScore1 > MAX_MATCH_SCORE || numScore2 > MAX_MATCH_SCORE) {
      res.status(400).json({ error: `Match scores cannot exceed ${MAX_MATCH_SCORE}.` });
      return;
    }
    if (!winnerId || (winnerId !== targetMatch.player1Id && winnerId !== targetMatch.player2Id)) {
      res.status(400).json({ error: 'Invalid winnerId: Must match player1Id or player2Id.' });
      return;
    }
    if (numScore1 > numScore2 && winnerId !== targetMatch.player1Id) {
      res.status(400).json({ error: `Invalid winnerId: Player 1 has higher score (${numScore1} > ${numScore2}).` });
      return;
    }
    if (numScore2 > numScore1 && winnerId !== targetMatch.player2Id) {
      res.status(400).json({ error: `Invalid winnerId: Player 2 has higher score (${numScore2} > ${numScore1}).` });
      return;
    }
    resolvedScore1 = numScore1;
    resolvedScore2 = numScore2;
    resolvedWinnerId = winnerId;
  }

  targetMatch.winnerId = resolvedWinnerId;
  targetMatch.score1 = resolvedScore1;
  targetMatch.score2 = resolvedScore2;
  targetMatch.status = 'completed';
  targetMatch.finalizedAt = new Date().toISOString();
  tournament.updatedAt = new Date().toISOString();
  clearTournamentStandingsCache(tournamentId);
  res.status(200).json({ success: true, match: targetMatch });
}

interface StandingsCacheEntry {
  body: any;
  cachedAt: number;
}
export const publicStandingsCache = new Map<string, StandingsCacheEntry>();
export const STANDINGS_CACHE_TTL_MS = 5_000;
export const MAX_STANDINGS_CACHE_ENTRIES = 500;

export function clearTournamentStandingsCache(tournamentId?: string): void {
  if (tournamentId) {
    for (const key of publicStandingsCache.keys()) {
      if (key.startsWith(`${tournamentId}:`)) {
        publicStandingsCache.delete(key);
      }
    }
  } else {
    publicStandingsCache.clear();
  }
}

/**
 * GET /api/tournaments/:id/standings
 */
export async function handleGetTournamentStandings(
  req: Request,
  res: Response,
  deps: TournamentRouteDependencies
): Promise<void> {
  const readRate = checkTournamentReadRateLimit(extractClientIp(req));
  if (!readRate.allowed) {
    sendRateLimitResponse(res, readRate.retryAfterSec, {
      error: `Too many standings requests. Please wait ${readRate.retryAfterSec}s.`,
    });
    return;
  }

  const { id } = req.params;
  if (!id || typeof id !== 'string' || id.trim().length === 0 || id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    res.status(400).json({ error: 'Invalid tournament ID format.' });
    return;
  }

  let limit = 50;
  let offset = 0;
  const query = req.query || {};
  if (query.limit !== undefined) {
    const parsedLimit = parseInt(String(query.limit), 10);
    if (isNaN(parsedLimit) || parsedLimit <= 0) {
      res.status(400).json({ error: 'Invalid limit parameter: must be a positive integer.' });
      return;
    }
    limit = Math.min(parsedLimit, 100);
  }
  if (query.offset !== undefined) {
    const parsedOffset = parseInt(String(query.offset), 10);
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      res.status(400).json({ error: 'Invalid offset parameter: must be a non-negative integer.' });
      return;
    }
    if (parsedOffset > 500) {
      res.status(400).json({ error: 'Invalid offset parameter: offset cannot exceed 500.' });
      return;
    }
    offset = parsedOffset;
  }

  const cacheKey = `${id}:${offset}:${limit}`;
  const now = Date.now();
  const cached = publicStandingsCache.get(cacheKey);
  if (cached && now - cached.cachedAt < STANDINGS_CACHE_TTL_MS) {
    res.status(200).json(cached.body);
    return;
  }

  if (hasFirestore(deps.adminDb)) {
    try {
      const tRef = deps.adminDb.collection('tournaments').doc(id);
      const tSnap = await tRef.get();
      if (!tSnap.exists) {
        res.status(404).json({ error: 'Tournament not found.' });
        return;
      }

      const tournament = tSnap.data() as Tournament;

      if (tournament.visibility === 'private') {
        const user = await authenticate(req, deps.adminAuth);
        if (!user) {
          res.status(401).json({ error: 'Authentication required for private tournament.' });
          return;
        }
        const acct = await assertAccountActive(deps.adminDb, user.uid);
        if (!acct.active) {
          res.status(403).json({ error: acct.error });
          return;
        }
        const isHostOrAdmin = tournament.hostId === user.uid || isAdminUser(user);
        if (!isHostOrAdmin) {
          const myRegSnap = await tRef.collection('registrations').doc(user.uid).get();
          if (!myRegSnap.exists || myRegSnap.data()?.status !== 'registered') {
            res.status(403).json({ error: 'Forbidden: You do not have access to this private tournament.' });
            return;
          }
        }
      }

      const regCol = tRef.collection('registrations');
      const maxParticipantsConfig = Math.max(16, Number(tournament.maxParticipants) || 128);
      // Ensure queryCap covers the requested window up to offset + limit + 1 (safely bounded at 1024)
      const queryCap = Math.min(Math.max(offset + limit + 1, maxParticipantsConfig), 1024);
      const regsSnap = typeof regCol.limit === 'function'
        ? await regCol.limit(queryCap + 1).get()
        : await regCol.get();
      const rawDocs = regsSnap.docs || [];
      const isCapped = rawDocs.length > queryCap;
      const effectiveDocs = isCapped ? rawDocs.slice(0, queryCap) : rawDocs;
      const registrations = effectiveDocs.map(d => d.data() as TournamentRegistration);
      const allStandings = computeTournamentStandings(registrations, tournament.rounds || []);
      const paginatedStandings = offset >= allStandings.length
        ? []
        : allStandings.slice(offset, offset + limit);

      const hasMore = paginatedStandings.length > 0 && allStandings.length > offset + limit;

      const responseBody = {
        tournamentId: id,
        title: tournament.title,
        status: tournament.status,
        championId: tournament.championId,
        championNickname: tournament.championNickname,
        standings: paginatedStandings,
        pagination: {
          total: isCapped ? undefined : allStandings.length,
          count: paginatedStandings.length,
          limit,
          offset,
          hasMore,
          isCapped,
          ...(isCapped ? { approximateTotal: queryCap } : {}),
        },
      };

      if (tournament.visibility !== 'private') {
        if (publicStandingsCache.size >= MAX_STANDINGS_CACHE_ENTRIES) {
          const oldestKey = publicStandingsCache.keys().next().value;
          if (oldestKey) publicStandingsCache.delete(oldestKey);
        }
        publicStandingsCache.set(cacheKey, { body: responseBody, cachedAt: now });
      }

      res.status(200).json(responseBody);
      return;
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to load tournament standings.' });
      return;
    }
  }

  if (process.env.NODE_ENV !== 'test') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative Firestore database is not configured.' });
    return;
  }

  const tournament = inMemoryTournaments.get(id);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found.' });
    return;
  }
  if (tournament.visibility === 'private') {
    const user = await authenticate(req, deps.adminAuth);
    if (!user) {
      res.status(401).json({ error: 'Authentication required for private tournament.' });
      return;
    }
  }
  const registrations = inMemoryRegistrations.get(id) || [];
  const allStandings = computeTournamentStandings(registrations, tournament.rounds);
  const paginatedStandings = allStandings.slice(offset, offset + limit);
  res.status(200).json({
    tournamentId: id,
    title: tournament.title,
    status: tournament.status,
    championId: tournament.championId,
    championNickname: tournament.championNickname,
    standings: paginatedStandings,
    pagination: {
      total: allStandings.length,
      count: paginatedStandings.length,
      limit,
      offset,
      hasMore: allStandings.length > offset + limit,
      isCapped: false,
    },
  });
}

/**
 * GET /api/tournaments
 * Lists tournaments visible to the authenticated caller or public viewers with pagination.
 */
export async function handleListTournaments(
  req: Request,
  res: Response,
  deps: TournamentRouteDependencies
): Promise<void> {
  const readRate = checkTournamentReadRateLimit(extractClientIp(req));
  if (!readRate.allowed) {
    sendRateLimitResponse(res, readRate.retryAfterSec, {
      error: `Too many tournament requests. Please wait ${readRate.retryAfterSec}s.`,
    });
    return;
  }

  let limit = 20;
  let offset = 0;
  const query = req.query || {};
  if (query.limit !== undefined) {
    const parsedLimit = parseInt(String(query.limit), 10);
    if (isNaN(parsedLimit) || parsedLimit <= 0) {
      res.status(400).json({ error: 'Invalid limit parameter: must be a positive integer.' });
      return;
    }
    limit = Math.min(parsedLimit, 50);
  }
  if (query.offset !== undefined) {
    const parsedOffset = parseInt(String(query.offset), 10);
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      res.status(400).json({ error: 'Invalid offset parameter: must be a non-negative integer.' });
      return;
    }
    offset = parsedOffset;
  }

  const user = await authenticate(req, deps.adminAuth);

  if (hasFirestore(deps.adminDb)) {
    try {
      const tourneysCol = deps.adminDb.collection('tournaments');
      const fetchBound = Math.min(limit + offset + 1, 100);
      const snap = await tourneysCol.orderBy('createdAt', 'desc').limit(fetchBound).get().catch(async () => {
        return await tourneysCol.limit(fetchBound).get();
      });

      const list: Tournament[] = [];
      for (const doc of snap.docs) {
        const t = doc.data() as Tournament;
        if (t.visibility !== 'private' || (user && (t.hostId === user.uid || isAdminUser(user)))) {
          list.push(t);
        }
      }

      const paginatedList = list.slice(offset, offset + limit);

      res.status(200).json({
        tournaments: paginatedList,
        pagination: {
          limit,
          offset,
          count: paginatedList.length,
          hasMore: list.length > offset + limit,
        },
      });
      return;
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to list tournaments.' });
      return;
    }
  }

  if (process.env.NODE_ENV !== 'test') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative Firestore database is not configured.' });
    return;
  }

  const list = Array.from(inMemoryTournaments.values()).filter(t => {
    return t.visibility !== 'private' || (user && (t.hostId === user.uid || isAdminUser(user)));
  });
  const paginatedList = list.slice(offset, offset + limit);
  res.status(200).json({
    tournaments: paginatedList,
    pagination: {
      limit,
      offset,
      count: paginatedList.length,
      hasMore: list.length > offset + limit,
    },
  });
}

/**
 * GET /api/tournaments/:id
 * Fetches a single tournament's details.
 */
export async function handleGetTournament(
  req: Request,
  res: Response,
  deps: TournamentRouteDependencies
): Promise<void> {
  const readRate = checkTournamentReadRateLimit(extractClientIp(req));
  if (!readRate.allowed) {
    sendRateLimitResponse(res, readRate.retryAfterSec, {
      error: `Too many tournament requests. Please wait ${readRate.retryAfterSec}s.`,
    });
    return;
  }

  const { id } = req.params;
  if (!id || typeof id !== 'string' || id.trim().length === 0 || id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    res.status(400).json({ error: 'Invalid tournament ID format.' });
    return;
  }

  if (hasFirestore(deps.adminDb)) {
    try {
      const tDoc = await deps.adminDb.collection('tournaments').doc(id).get();
      if (!tDoc.exists) {
        res.status(404).json({ error: 'Tournament not found.' });
        return;
      }
      const tournament = tDoc.data() as Tournament;

      if (tournament.visibility === 'private') {
        const user = await authenticate(req, deps.adminAuth);
        if (!user) {
          res.status(401).json({ error: 'Authentication required for private tournament.' });
          return;
        }
        const isHostOrAdmin = tournament.hostId === user.uid || isAdminUser(user);
        if (!isHostOrAdmin) {
          const regDoc = await deps.adminDb.collection('tournaments').doc(id).collection('registrations').doc(user.uid).get();
          if (!regDoc.exists || regDoc.data()?.status !== 'registered') {
            res.status(403).json({ error: 'Forbidden: You do not have access to this private tournament.' });
            return;
          }
        }
      }

      res.status(200).json({ tournament });
      return;
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to load tournament.' });
      return;
    }
  }

  if (process.env.NODE_ENV !== 'test') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative Firestore database is not configured.' });
    return;
  }

  const tournament = inMemoryTournaments.get(id);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found.' });
    return;
  }
  res.status(200).json({ tournament });
}
