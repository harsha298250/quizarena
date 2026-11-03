/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AvatarConfig } from './avatar';
export type { AvatarConfig };

export type QuestionType =
  | 'multiple_choice'
  | 'multi_select'
  | 'true_false'
  | 'type_answer'
  | 'ordering'
  | 'image_based'
  | 'poll'
  | 'word_cloud'
  | 'open_ended'
  | 'info_slide';

export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';

export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'mixed';

export type GameMode =
  | 'classic'
  | 'accuracy'
  | 'team'
  | 'survival'
  | 'ghost'
  | 'async_challenge'
  | 'solo_practice';

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  options: string[]; // 2-6 options
  correctAnswers: number[]; // indices of correct options (or accepted text for type_answer)
  acceptedTextAnswers?: string[];
  explanation: string;
  timeLimit: number; // in seconds (5-120 or 0 for unlimited)
  points: number; // 0, 1000 (standard), 2000 (double)
  imageUrl?: string;
  topicTag: string;
  bloomLevel: BloomLevel;
  courseOutcomeTag: string; // e.g. "CO1", "CO2", "CO3"
  sourcePage?: number;
  sourceQuote?: string;
  validationBadge?: 'good' | 'check' | 'weak';
  orderItems?: string[]; // for ordering question type
}

export interface Quiz {
  id: string;
  title: string;
  description: string;
  authorId: string;
  authorName?: string;
  isPublic: boolean;
  gameMode: GameMode;
  tags: string[];
  questions: Question[];
  coverColor?: string;
  createdAt: string;
  updatedAt: string;
}

export type GameSessionStatus =
  | 'lobby'
  | 'question_active'
  | 'reveal'
  | 'leaderboard'
  | 'paused'
  | 'finished'
  | 'cancelled';

export interface GameSettings {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  allowLateJoin: boolean;
  enablePowerUps: boolean;
  antiCheatDetection: boolean;
  secureMode?: boolean;
  requireFullscreen?: boolean;
  lockAnswerOnStrike3?: boolean;
  strike2PointPenalty?: number;
  preventCopyPaste?: boolean;
  showLeaderboardBetween: boolean;
  autoEmailResults: boolean;
  scoringProfile: 'speed_weighted' | 'accuracy_only';
  requireApprovalToJoin: boolean;
  teamMode: boolean;
}

export interface PlayerAccommodations {
  extraTimeMultiplier: number; // 1, 1.5, 2
  fewerOptions: boolean; // hide 1-2 wrong options
  muteSound: boolean;
  dyslexiaFont: boolean;
  largeText: boolean;
  readAloud: boolean;
  speechRate?: number; // 0.8, 1.0, 1.25
}

export interface PlayerPowerUps {
  fiftyFiftyUsed: boolean;
  doublePointsUsed: boolean;
  timeFreezeUsed: boolean;
}

export interface Player {
  id: string;
  nickname: string;
  avatar: string;
  avatarConfig?: AvatarConfig;
  email?: string;
  emailConsent?: boolean;
  team?: string;
  score: number;
  streak: number;
  maxStreak: number;
  correctCount: number;
  latencyMs: number;
  clockOffsetMs: number;
  integrityScore: number; // 0-100 (100 = spotless)
  strikes?: number;
  isTerminated?: boolean;
  status?: string; // 'active' | 'terminated_integrity'
  lastEvent?: string;
  lastEventTime?: string;
  accessibleApproved?: boolean; // Host-approved accessible DOM fallback for screen readers
  powerUps: PlayerPowerUps;
  accommodations: PlayerAccommodations;
  isKicked?: boolean;
  isEliminated?: boolean;
  joinedAt: string;
  lastSeen: string;
}

export interface AnswerSubmission {
  id: string;
  playerId: string;
  playerNickname: string;
  questionIndex: number;
  selectedIndices: number[];
  textAnswer?: string;
  isCorrect: boolean;
  pointsAwarded: number;
  responseTimeMs: number; // latency compensated
  clientTimestamp: number;
  serverTimestamp: number;
  prevHash: string;
  hash: string;
}

export interface IntegrityFlag {
  id: string;
  playerId: string;
  playerNickname: string;
  type:
    | 'tab_switch'
    | 'window_blur'
    | 'fullscreen_exit'
    | 'paste_detected'
    | 'suspicious_timing'
    | 'burst_join'
    | 'extension_injection'
    | 'devtools_open'
    | 'webdriver_detected'
    | 'uniform_timing'
    | 'copy_paste_attempt';
  severity: 'low' | 'medium' | 'high';
  reason: string;
  timestamp: string;
  questionIndex?: number;
}

export interface LiveQAQuestion {
  id: string;
  authorName: string;
  text: string;
  upvotes: number;
  upvoters: string[];
  isAnswered: boolean;
  createdAt: string;
}

export interface GameSession {
  id: string;
  pin: string;
  hostId: string;
  hostName: string;
  quizId: string;
  quizTitle: string;
  status: GameSessionStatus;
  gameMode: GameMode;
  currentQuestionIndex: number;
  questionStartTime: number | null; // epoch ms
  timeLimit: number;
  isPaused: boolean;
  pauseRemainingMs?: number;
  settings: GameSettings;
  questions: Question[];
  createdAt: string;
  updatedAt: string;
}

export interface CompetitionRound {
  id: string;
  name: string; // e.g. "Round 1: Qualifiers", "Semi-Finals", "Grand Finale"
  quizId: string;
  roundType: 'qualifier' | 'semi' | 'final';
  qualificationRule: 'top_n' | 'min_score';
  qualificationValue: number; // e.g. top 8 or min 5000 pts
  status: 'pending' | 'active' | 'completed';
  gameId?: string;
}

export interface CompetitionAppeal {
  id: string;
  competitionId: string;
  playerId: string;
  playerName: string;
  questionNumber: number;
  disputeReason: string;
  proposedFix: string;
  status: 'pending' | 'accepted' | 'rejected';
  organizerNotes?: string;
  pointAdjustment?: number;
  createdAt: string;
}

export interface Competition {
  id: string;
  title: string;
  description: string;
  bannerUrl?: string;
  organizerId: string;
  organizerName: string;
  status: 'upcoming' | 'in_progress' | 'completed';
  rules: string;
  rounds: CompetitionRound[];
  teams?: { id: string; name: string; members: string[]; score: number }[];
  createdAt: string;
}

export interface MailQueueItem {
  id: string;
  to: string;
  recipientName: string;
  subject: string;
  htmlContent: string;
  status: 'queued' | 'sent' | 'failed';
  errorMessage?: string;
  metadata: {
    gameId: string;
    quizTitle: string;
    score: number;
    rank: number;
    accuracy: number;
  };
  createdAt: string;
}

export interface CourseOutcomeStat {
  coTag: string;
  totalQuestions: number;
  correctAnswers: number;
  accuracyRate: number;
  attainmentTarget: number; // e.g. 60%
  isAttained: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatar: string;
  role: 'host' | 'player' | 'judge';
  eloRating?: number;
  createdAt: string;
}
