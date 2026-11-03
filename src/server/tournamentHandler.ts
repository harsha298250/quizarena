/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import {
  Tournament,
  TournamentRegistration,
  TournamentRound,
  TournamentMatch,
} from '../types/tournament';
import {
  validateTournamentConfig,
  generateSingleEliminationBracket,
  advanceWinnersToNextRound,
  computeTournamentStandings,
} from './tournamentEngine';

export interface TournamentRouteDependencies {
  adminAuth: Auth;
  adminDb: Firestore;
}

// In-memory persistent tournament store (used for test environments or Firestore fallback)
export const inMemoryTournaments = new Map<string, Tournament>();
export const inMemoryRegistrations = new Map<string, TournamentRegistration[]>(); // tournamentId -> registrations

/**
 * Helper to authenticate token and return DecodedIdToken or null
 */
async function authenticate(req: Request, adminAuth: Auth) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split('Bearer ')[1].trim();
  try {
    return await adminAuth.verifyIdToken(token);
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

  // Anonymous users cannot host tournaments
  if (user.firebase?.sign_in_provider === 'anonymous') {
    res.status(403).json({ error: 'Anonymous users cannot create or host tournaments.' });
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
  } = req.body;

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

  const tournamentId = `tourney_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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
    scheduledStartTime,
    quizzes,
    rounds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Persist in memory store
  inMemoryTournaments.set(tournamentId, newTournament);
  inMemoryRegistrations.set(tournamentId, []);

  // Persist in Firestore if available
  if (deps.adminDb && typeof deps.adminDb.collection === 'function') {
    try {
      await deps.adminDb.collection('tournaments').doc(tournamentId).set(newTournament);
    } catch (e) {
      console.warn('Firestore tournament creation non-fatal error:', e);
    }
  }

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

  const { tournamentId, nickname } = req.body;
  if (!tournamentId) {
    res.status(400).json({ error: 'tournamentId is required.' });
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

  // Check deadline
  if (new Date().getTime() > new Date(tournament.registrationDeadline).getTime()) {
    res.status(400).json({ error: 'Registration deadline has passed.' });
    return;
  }

  const currentRegs = inMemoryRegistrations.get(tournamentId) || [];

  // Check duplicate registration
  if (currentRegs.some(r => r.participantId === user.uid && r.status === 'registered')) {
    res.status(409).json({ error: 'You are already registered for this tournament.' });
    return;
  }

  // Check capacity
  if (currentRegs.filter(r => r.status === 'registered').length >= tournament.maxParticipants) {
    res.status(403).json({ error: 'Tournament is full. Maximum participant capacity reached.' });
    return;
  }

  const registration: TournamentRegistration = {
    id: `reg_${user.uid}`,
    tournamentId,
    participantId: user.uid,
    participantNickname: (nickname || user.name || user.email || 'Player').slice(0, 30),
    registeredAt: new Date().toISOString(),
    status: 'registered',
    seed: currentRegs.length + 1,
    initialElo: 1200,
  };

  currentRegs.push(registration);
  inMemoryRegistrations.set(tournamentId, currentRegs);
  tournament.participantCount = currentRegs.filter(r => r.status === 'registered').length;
  tournament.updatedAt = new Date().toISOString();

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

  const { tournamentId } = req.body;
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

  res.status(200).json({ success: true, message: 'Registration cancelled.' });
}

/**
 * POST /api/tournaments/start-round
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

  const { tournamentId } = req.body;
  const tournament = inMemoryTournaments.get(tournamentId);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found.' });
    return;
  }

  if (tournament.hostId !== user.uid) {
    res.status(403).json({ error: 'Forbidden: Only the tournament host can start rounds.' });
    return;
  }

  const registrations = (inMemoryRegistrations.get(tournamentId) || []).filter(
    r => r.status === 'registered'
  );

  if (registrations.length < tournament.minParticipants) {
    res.status(400).json({
      error: `Cannot start tournament: At least ${tournament.minParticipants} registered participants are required (current: ${registrations.length}).`,
    });
    return;
  }

  // If tournament is in registration_open, initialize bracket (Round 1)
  if (tournament.status === 'registration_open') {
    const participants = registrations.map(r => ({
      id: r.participantId,
      nickname: r.participantNickname,
    }));

    const rounds = generateSingleEliminationBracket(
      tournamentId,
      participants,
      tournament.quizzes
    );

    tournament.rounds = rounds;
    tournament.status = 'active';
    tournament.updatedAt = new Date().toISOString();

    res.status(200).json({ success: true, round: rounds[0], tournament });
    return;
  }

  // If tournament is already active, advance to next round
  const currentActiveIdx = tournament.rounds.findIndex(r => r.status === 'active');
  if (currentActiveIdx < 0) {
    res.status(400).json({ error: 'No active round found.' });
    return;
  }

  const currentRound = tournament.rounds[currentActiveIdx];
  const nextRound = tournament.rounds[currentActiveIdx + 1];

  if (!nextRound) {
    // Grand finals completed! Determine champion
    const finalMatch = currentRound.matches[0];
    if (finalMatch && finalMatch.winnerId) {
      tournament.status = 'completed';
      tournament.championId = finalMatch.winnerId;
      tournament.championNickname =
        finalMatch.winnerId === finalMatch.player1Id
          ? finalMatch.player1Nickname
          : finalMatch.player2Nickname;
      tournament.updatedAt = new Date().toISOString();
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

  const { tournamentId, matchId, winnerId, score1, score2 } = req.body;
  const tournament = inMemoryTournaments.get(tournamentId);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found.' });
    return;
  }

  if (tournament.hostId !== user.uid) {
    res.status(403).json({ error: 'Forbidden: Only the tournament host can finalize matches.' });
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

  // Idempotency check: Already completed matches cannot be overwritten
  if (targetMatch.status === 'completed') {
    res.status(200).json({ success: true, match: targetMatch, message: 'Match already finalized.' });
    return;
  }

  // Verify winnerId is actually one of the players
  if (winnerId !== targetMatch.player1Id && winnerId !== targetMatch.player2Id) {
    res.status(400).json({ error: 'Invalid winnerId: Must match player1Id or player2Id.' });
    return;
  }

  targetMatch.winnerId = winnerId;
  targetMatch.score1 = Number(score1) || 0;
  targetMatch.score2 = Number(score2) || 0;
  targetMatch.status = 'completed';
  targetMatch.finalizedAt = new Date().toISOString();
  tournament.updatedAt = new Date().toISOString();

  res.status(200).json({ success: true, match: targetMatch });
}

/**
 * GET /api/tournaments/:id/standings
 */
export async function handleGetTournamentStandings(
  req: Request,
  res: Response,
  deps: TournamentRouteDependencies
): Promise<void> {
  const { id } = req.params;
  const tournament = inMemoryTournaments.get(id);
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found.' });
    return;
  }

  // Private tournaments require authentication and permission
  if (tournament.visibility === 'private') {
    const user = await authenticate(req, deps.adminAuth);
    if (!user) {
      res.status(401).json({ error: 'Authentication required for private tournament.' });
      return;
    }
  }

  const registrations = inMemoryRegistrations.get(id) || [];
  const standings = computeTournamentStandings(registrations, tournament.rounds);

  res.status(200).json({
    tournamentId: id,
    title: tournament.title,
    status: tournament.status,
    championId: tournament.championId,
    championNickname: tournament.championNickname,
    standings,
  });
}
