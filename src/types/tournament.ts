/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type TournamentFormat = 'single_elimination' | 'points_based';

export type TournamentStatus =
  | 'draft'
  | 'registration_open'
  | 'active'
  | 'completed'
  | 'cancelled';

export type RegistrationStatus =
  | 'registered'
  | 'checked_in'
  | 'withdrawn'
  | 'disqualified';

export type MatchStatus =
  | 'pending'
  | 'ready'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'bye';

export type RoundStatus = 'pending' | 'active' | 'completed';

export interface TournamentRegistration {
  id: string;
  tournamentId: string;
  participantId: string;
  participantNickname: string;
  registeredAt: string;
  status: RegistrationStatus;
  seed?: number;
  initialElo?: number;
}

export interface TournamentMatch {
  id: string;
  tournamentId: string;
  roundId: string;
  roundNumber: number;
  matchNumber: number;
  player1Id?: string;
  player1Nickname?: string;
  player2Id?: string;
  player2Nickname?: string;
  gameId?: string;
  status: MatchStatus;
  winnerId?: string;
  score1?: number;
  score2?: number;
  isBye?: boolean;
  completedAt?: string;
  finalizedAt?: string;
}

export interface TournamentRound {
  id: string;
  tournamentId: string;
  roundNumber: number;
  name: string;
  quizId: string;
  status: RoundStatus;
  matches: TournamentMatch[];
  startedAt?: string;
  completedAt?: string;
}

export interface TournamentStanding {
  participantId: string;
  nickname: string;
  rank: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  points: number;
  totalScore: number;
  isEliminated: boolean;
  eloRating: number;
}

export interface TournamentAppealRecord {
  id: string;
  tournamentId: string;
  matchId?: string;
  participantId: string;
  participantName: string;
  reason: string;
  evidenceRef?: string;
  status: 'pending' | 'accepted' | 'rejected';
  reviewerId?: string;
  decisionNotes?: string;
  scoreAdjustment?: number;
  createdAt: string;
  resolvedAt?: string;
}

export interface Tournament {
  id: string;
  hostId: string;
  hostName: string;
  title: string;
  description: string;
  rules: string;
  format: TournamentFormat;
  status: TournamentStatus;
  visibility: 'public' | 'private';
  maxParticipants: number;
  minParticipants: number;
  participantCount: number;
  registrationDeadline: string; // ISO String
  scheduledStartTime?: string; // ISO String
  quizzes: string[]; // Quiz IDs for each round
  rounds: TournamentRound[];
  championId?: string;
  championNickname?: string;
  createdAt: string;
  updatedAt: string;
}
