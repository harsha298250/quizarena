/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Tournament,
  TournamentFormat,
  TournamentStatus,
  TournamentRegistration,
  TournamentRound,
  TournamentMatch,
  TournamentStanding,
  MatchStatus,
} from '../types/tournament';

export interface CreateTournamentParams {
  hostId: string;
  hostName: string;
  title: string;
  description: string;
  rules?: string;
  format?: TournamentFormat;
  visibility?: 'public' | 'private';
  maxParticipants?: number;
  minParticipants?: number;
  registrationDeadline: string;
  scheduledStartTime?: string;
  quizzes: string[];
}

/**
 * Validates tournament creation configuration.
 */
export function validateTournamentConfig(params: Partial<CreateTournamentParams>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!params.hostId || typeof params.hostId !== 'string' || !params.hostId.trim()) {
    errors.push('Host ID is required.');
  }

  if (!params.title || typeof params.title !== 'string' || params.title.trim().length < 3) {
    errors.push('Tournament title must be at least 3 characters.');
  } else if (params.title.length > 100) {
    errors.push('Tournament title cannot exceed 100 characters.');
  }

  const minPart = params.minParticipants ?? 2;
  const maxPart = params.maxParticipants ?? 64;

  if (minPart < 2) {
    errors.push('Minimum participants must be at least 2.');
  }
  if (maxPart > 128) {
    errors.push('Maximum participants cannot exceed 128.');
  }
  if (minPart > maxPart) {
    errors.push('Minimum participants cannot exceed maximum participants.');
  }

  if (!params.registrationDeadline || isNaN(new Date(params.registrationDeadline).getTime())) {
    errors.push('Valid registration deadline timestamp is required.');
  }

  if (params.scheduledStartTime && isNaN(new Date(params.scheduledStartTime).getTime())) {
    errors.push('Scheduled start time is invalid.');
  }

  if (params.scheduledStartTime && params.registrationDeadline) {
    if (new Date(params.registrationDeadline).getTime() > new Date(params.scheduledStartTime).getTime()) {
      errors.push('Registration deadline cannot be after the scheduled start time.');
    }
  }

  if (!params.quizzes || !Array.isArray(params.quizzes) || params.quizzes.length === 0) {
    errors.push('At least one quiz must be selected for the tournament.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates lifecycle transition for tournaments.
 */
export function isValidTournamentTransition(
  from: TournamentStatus,
  to: TournamentStatus
): boolean {
  const transitions: Record<TournamentStatus, TournamentStatus[]> = {
    draft: ['registration_open', 'cancelled'],
    registration_open: ['active', 'cancelled'],
    active: ['completed', 'cancelled'],
    completed: [], // Terminal
    cancelled: [], // Terminal
  };

  return transitions[from]?.includes(to) ?? false;
}

/**
 * Generates a single-elimination bracket supporting non-power-of-two participant counts
 * with deterministic bye assignments.
 */
export function generateSingleEliminationBracket(
  tournamentId: string,
  participants: Array<{ id: string; nickname: string }>,
  quizzes: string[]
): TournamentRound[] {
  const count = participants.length;
  if (count < 2) {
    throw new Error('Single-elimination tournament requires at least 2 participants.');
  }

  // Calculate bracket capacity as the next power of 2
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(count)));
  const numRounds = Math.log2(bracketSize);
  const numByes = bracketSize - count;

  const rounds: TournamentRound[] = [];

  // Seed participants: Byes are awarded to the highest-seeded players
  // e.g. If count = 6, bracketSize = 8, byes = 2 (assigned to Seeds 1 and 2)
  const firstRoundMatches: TournamentMatch[] = [];
  let byeAssigned = 0;
  let participantIdx = 0;

  for (let matchNum = 1; matchNum <= bracketSize / 2; matchNum++) {
    const matchId = `${tournamentId}_r1_m${matchNum}`;
    const p1 = participants[participantIdx++];
    
    // Check if this match gets a bye for player 2
    if (byeAssigned < numByes && p1) {
      byeAssigned++;
      firstRoundMatches.push({
        id: matchId,
        tournamentId,
        roundId: `${tournamentId}_r1`,
        roundNumber: 1,
        matchNumber: matchNum,
        player1Id: p1.id,
        player1Nickname: p1.nickname,
        status: 'completed',
        winnerId: p1.id,
        score1: 0,
        score2: 0,
        isBye: true,
        finalizedAt: new Date().toISOString(),
      });
    } else {
      const p2 = participants[participantIdx++];
      firstRoundMatches.push({
        id: matchId,
        tournamentId,
        roundId: `${tournamentId}_r1`,
        roundNumber: 1,
        matchNumber: matchNum,
        player1Id: p1?.id,
        player1Nickname: p1?.nickname,
        player2Id: p2?.id,
        player2Nickname: p2?.nickname,
        status: p1 && p2 ? 'ready' : 'pending',
        isBye: false,
      });
    }
  }

  rounds.push({
    id: `${tournamentId}_r1`,
    tournamentId,
    roundNumber: 1,
    name: numRounds === 1 ? 'Finals' : 'Round 1: Preliminary Bracket',
    quizId: quizzes[0] || 'default_quiz',
    status: 'active',
    matches: firstRoundMatches,
    startedAt: new Date().toISOString(),
  });

  // Generate placeholders for subsequent rounds
  for (let r = 2; r <= numRounds; r++) {
    const roundMatchCount = bracketSize / Math.pow(2, r);
    const roundName =
      r === numRounds
        ? 'Grand Finals'
        : r === numRounds - 1
        ? 'Semi-Finals'
        : `Round ${r}`;

    const roundMatches: TournamentMatch[] = [];
    for (let m = 1; m <= roundMatchCount; m++) {
      roundMatches.push({
        id: `${tournamentId}_r${r}_m${m}`,
        tournamentId,
        roundId: `${tournamentId}_r${r}`,
        roundNumber: r,
        matchNumber: m,
        status: 'pending',
        isBye: false,
      });
    }

    rounds.push({
      id: `${tournamentId}_r${r}`,
      tournamentId,
      roundNumber: r,
      name: roundName,
      quizId: quizzes[r - 1] || quizzes[0] || 'default_quiz',
      status: 'pending',
      matches: roundMatches,
    });
  }

  return rounds;
}

/**
 * Advances winning participants into the next round's matches deterministically.
 */
export function advanceWinnersToNextRound(
  currentRound: TournamentRound,
  nextRound: TournamentRound
): { updatedNextRound: TournamentRound; advancedCount: number } {
  // Verify all matches in current round are completed
  const uncompleted = currentRound.matches.filter(
    m => m.status !== 'completed' && m.status !== 'bye'
  );
  if (uncompleted.length > 0) {
    throw new Error(
      `Cannot advance to round ${nextRound.roundNumber}: ${uncompleted.length} match(es) still pending.`
    );
  }

  const winners = currentRound.matches
    .map(m => ({
      id: m.winnerId!,
      nickname:
        m.winnerId === m.player1Id ? m.player1Nickname! : m.player2Nickname!,
      matchNumber: m.matchNumber,
    }))
    .filter(w => Boolean(w.id));

  // Sort by matchNumber so winner of Match 1 plays winner of Match 2, etc.
  winners.sort((a, b) => a.matchNumber - b.matchNumber);

  const updatedMatches = [...nextRound.matches];
  let advancedCount = 0;

  for (let i = 0; i < winners.length; i += 2) {
    const matchIdx = Math.floor(i / 2);
    if (matchIdx < updatedMatches.length) {
      const match = { ...updatedMatches[matchIdx] };
      const p1 = winners[i];
      const p2 = winners[i + 1];

      if (p1 && match.player1Id !== p1.id) {
        match.player1Id = p1.id;
        match.player1Nickname = p1.nickname;
        advancedCount++;
      }
      if (p2 && match.player2Id !== p2.id) {
        match.player2Id = p2.id;
        match.player2Nickname = p2.nickname;
        advancedCount++;
      }

      if (match.player1Id && match.player2Id) {
        match.status = 'ready';
      }
      updatedMatches[matchIdx] = match;
    }
  }

  return {
    updatedNextRound: {
      ...nextRound,
      matches: updatedMatches,
      status: updatedMatches.some(m => m.status === 'ready') ? 'active' : nextRound.status,
    },
    advancedCount,
  };
}

/**
 * Calculates Elo rating changes based on chess-standard Elo formula (K-factor = 32)
 */
export function calculateElo(
  ratingA: number,
  ratingB: number,
  actualScoreA: 1 | 0.5 | 0, // 1 for win, 0.5 for tie, 0 for loss
  kFactor: number = 32
): { newRatingA: number; newRatingB: number; deltaA: number; deltaB: number } {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;

  const actualScoreB = 1 - actualScoreA;

  const deltaA = Math.round(kFactor * (actualScoreA - expectedA));
  const deltaB = Math.round(kFactor * (actualScoreB - expectedB));

  return {
    newRatingA: Math.max(100, ratingA + deltaA),
    newRatingB: Math.max(100, ratingB + deltaB),
    deltaA,
    deltaB,
  };
}

/**
 * Deterministically computes tournament leaderboard standings from verified match records.
 */
export function computeTournamentStandings(
  registrations: TournamentRegistration[],
  rounds: TournamentRound[]
): TournamentStanding[] {
  const statsMap = new Map<
    string,
    {
      nickname: string;
      matchesPlayed: number;
      wins: number;
      losses: number;
      points: number;
      totalScore: number;
      isEliminated: boolean;
      eloRating: number;
    }
  >();

  // Initialize with verified registrants
  registrations.forEach(r => {
    statsMap.set(r.participantId, {
      nickname: r.participantNickname,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      points: 0,
      totalScore: 0,
      isEliminated: r.status === 'disqualified' || r.status === 'withdrawn',
      eloRating: r.initialElo || 1200,
    });
  });

  // Process completed matches exactly once
  const processedMatchIds = new Set<string>();

  rounds.forEach(round => {
    round.matches.forEach(match => {
      if (
        (match.status === 'completed' || match.status === 'bye') &&
        !processedMatchIds.has(match.id)
      ) {
        processedMatchIds.add(match.id);

        const p1 = match.player1Id ? statsMap.get(match.player1Id) : null;
        const p2 = match.player2Id ? statsMap.get(match.player2Id) : null;

        if (match.isBye && p1) {
          p1.wins++;
          p1.points += 3; // 3 points for bye/win
          return;
        }

        if (p1 && p2 && match.winnerId) {
          p1.matchesPlayed++;
          p2.matchesPlayed++;
          p1.totalScore += match.score1 || 0;
          p2.totalScore += match.score2 || 0;

          if (match.winnerId === match.player1Id) {
            p1.wins++;
            p1.points += 3; // 3 points for win
            p2.losses++;
            p2.isEliminated = true;

            const elo = calculateElo(p1.eloRating, p2.eloRating, 1);
            p1.eloRating = elo.newRatingA;
            p2.eloRating = elo.newRatingB;
          } else if (match.winnerId === match.player2Id) {
            p2.wins++;
            p2.points += 3;
            p1.losses++;
            p1.isEliminated = true;

            const elo = calculateElo(p1.eloRating, p2.eloRating, 0);
            p1.eloRating = elo.newRatingA;
            p2.eloRating = elo.newRatingB;
          }
        }
      }
    });
  });

  // Sort standings: Wins (desc), Points (desc), Total Score (desc), Elo (desc)
  const sorted = Array.from(statsMap.entries()).map(([participantId, val]) => ({
    participantId,
    ...val,
    rank: 0,
  }));

  sorted.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.points !== a.points) return b.points - a.points;
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return b.eloRating - a.eloRating;
  });

  return sorted.map((s, idx) => ({ ...s, rank: idx + 1 }));
}
