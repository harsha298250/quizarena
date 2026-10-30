/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Question, Player, AnswerSubmission, GameSession, Quiz } from '../types/quiz';
import { db, isFirebaseConfigured } from '../lib/firebase';
import { collection, getDocs, query, where, orderBy, doc, getDoc } from 'firebase/firestore';

export interface QuestionAnalytics {
  questionIndex: number;
  questionId: string;
  questionText: string;
  bloomLevel: string;
  courseOutcomeTag: string;
  timeLimit: number;
  totalAttempts: number;
  correctAttempts: number;
  accuracy: number; // 0 - 100
  avgTimeSec: number;
  optionDistribution: Record<number, number>;
  mostChosenWrongOption: {
    optionIndex: number;
    optionText: string;
    count: number;
    percentage: number;
  } | null;
  discriminationIndex: number; // -1.0 to 1.0
}

export interface CourseOutcomeAnalytics {
  coTag: string;
  totalQuestions: number;
  totalAttempts: number;
  correctAnswers: number;
  accuracyRate: number; // 0.0 - 1.0
  attainmentTarget: number; // 0.0 - 1.0
  isAttained: boolean;
}

export interface BloomAnalytics {
  name: string;
  bloomLevel: string;
  value: number; // question count
  totalAttempts: number;
  correctAttempts: number;
  accuracy: number;
}

export interface FinishedGameSummary {
  id: string;
  quizTitle: string;
  pin: string;
  finishedAt: string;
  playerCount: number;
  isDemo?: boolean;
}

export interface FullGameAnalytics {
  gameId: string;
  quizTitle: string;
  finishedAt: string;
  totalPlayers: number;
  overallAccuracy: number;
  averageScore: number;
  isDemoData: boolean;
  questionStats: QuestionAnalytics[];
  hardestQuestions: QuestionAnalytics[];
  coStats: CourseOutcomeAnalytics[];
  bloomStats: BloomAnalytics[];
  topPerformers: Array<{ rank: number; nickname: string; score: number }>;
  lowestPerformers: Array<{ rank: number; nickname: string; score: number }>;
}

/**
 * Pure, deterministic computation of all analytics metrics from real answers, players, and questions.
 * Zero Math.random, zero seeded mock values.
 */
export function computeGameAnalytics(
  questions: Question[],
  players: Player[],
  answers: AnswerSubmission[],
  attainmentThresholdPercent: number = 60,
  gameMetadata?: { gameId: string; quizTitle: string; finishedAt?: string; isDemo?: boolean }
): FullGameAnalytics {
  const totalPlayers = players.length;
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

  // Determine Upper and Lower tiers for Discrimination Index
  // Standard psychometrics: 27% top, 27% bottom (or halves if cohort < 10)
  const tierSize = totalPlayers >= 10 ? Math.max(1, Math.round(totalPlayers * 0.27)) : Math.max(1, Math.floor(totalPlayers / 2));
  const upperPlayerIds = new Set(sortedPlayers.slice(0, tierSize).map(p => p.id));
  const lowerPlayerIds = new Set(sortedPlayers.slice(-tierSize).map(p => p.id));

  // Build Answer lookups by questionIndex
  const answersByQuestion = new Map<number, AnswerSubmission[]>();
  answers.forEach(ans => {
    const list = answersByQuestion.get(ans.questionIndex) || [];
    list.push(ans);
    answersByQuestion.set(ans.questionIndex, list);
  });

  // 1. Per-Question Analytics
  const questionStats: QuestionAnalytics[] = questions.map((q, idx) => {
    const qAnswers = answersByQuestion.get(idx) || [];
    const totalAttempts = qAnswers.length;
    const correctAttempts = qAnswers.filter(a => a.isCorrect).length;
    const accuracy = totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 1000) / 10 : 0;

    const totalTimeMs = qAnswers.reduce((sum, a) => sum + (a.responseTimeMs || 0), 0);
    const avgTimeSec = totalAttempts > 0 ? Math.round((totalTimeMs / totalAttempts / 1000) * 10) / 10 : 0;

    // Option distribution
    const optionDistribution: Record<number, number> = {};
    (q.options || []).forEach((_, oIdx) => {
      optionDistribution[oIdx] = 0;
    });

    qAnswers.forEach(a => {
      (a.selectedIndices || []).forEach(selIdx => {
        if (typeof selIdx === 'number' && optionDistribution[selIdx] !== undefined) {
          optionDistribution[selIdx]++;
        }
      });
    });

    // Most-chosen wrong option
    const correctIdx = q.correctAnswers?.[0] ?? -1;
    let mostChosenWrong: { optionIndex: number; optionText: string; count: number; percentage: number } | null = null;
    let maxWrongCount = 0;

    (q.options || []).forEach((optText, oIdx) => {
      if (oIdx !== correctIdx) {
        const count = optionDistribution[oIdx] || 0;
        if (count > maxWrongCount) {
          maxWrongCount = count;
          mostChosenWrong = {
            optionIndex: oIdx,
            optionText: optText,
            count,
            percentage: totalAttempts > 0 ? Math.round((count / totalAttempts) * 1000) / 10 : 0,
          };
        }
      }
    });

    // Discrimination Index D = (R_upper / N_upper) - (R_lower / N_lower)
    let discriminationIndex = 0;
    if (tierSize > 0 && totalAttempts > 0) {
      const upperAnswers = qAnswers.filter(a => upperPlayerIds.has(a.playerId));
      const lowerAnswers = qAnswers.filter(a => lowerPlayerIds.has(a.playerId));

      const upperCorrect = upperAnswers.filter(a => a.isCorrect).length;
      const lowerCorrect = lowerAnswers.filter(a => a.isCorrect).length;

      const upperRate = upperAnswers.length > 0 ? upperCorrect / upperAnswers.length : 0;
      const lowerRate = lowerAnswers.length > 0 ? lowerCorrect / lowerAnswers.length : 0;

      discriminationIndex = Math.round((upperRate - lowerRate) * 100) / 100;
    }

    return {
      questionIndex: idx,
      questionId: q.id,
      questionText: q.text,
      bloomLevel: q.bloomLevel || 'understand',
      courseOutcomeTag: q.courseOutcomeTag || 'CO1',
      timeLimit: q.timeLimit || 20,
      totalAttempts,
      correctAttempts,
      accuracy,
      avgTimeSec,
      optionDistribution,
      mostChosenWrongOption: mostChosenWrong,
      discriminationIndex,
    };
  });

  // 2. Hardest Questions Ranked by Lowest Accuracy Ascending
  const hardestQuestions = [...questionStats].sort((a, b) => a.accuracy - b.accuracy);

  // 3. Course Outcome (CO) Attainment
  const targetRatio = attainmentThresholdPercent / 100;
  const coGroups = new Map<string, { totalQuestions: number; totalAttempts: number; correctAnswers: number }>();

  questions.forEach(q => {
    const tag = q.courseOutcomeTag || 'CO1';
    if (!coGroups.has(tag)) {
      coGroups.set(tag, { totalQuestions: 0, totalAttempts: 0, correctAnswers: 0 });
    }
    coGroups.get(tag)!.totalQuestions++;
  });

  answers.forEach(ans => {
    const q = questions[ans.questionIndex];
    if (q) {
      const tag = q.courseOutcomeTag || 'CO1';
      const g = coGroups.get(tag);
      if (g) {
        g.totalAttempts++;
        if (ans.isCorrect) g.correctAnswers++;
      }
    }
  });

  const coStats: CourseOutcomeAnalytics[] = Array.from(coGroups.entries()).map(([coTag, val]) => {
    const accuracyRate = val.totalAttempts > 0 ? val.correctAnswers / val.totalAttempts : 0;
    return {
      coTag,
      totalQuestions: val.totalQuestions,
      totalAttempts: val.totalAttempts,
      correctAnswers: val.correctAnswers,
      accuracyRate,
      attainmentTarget: targetRatio,
      isAttained: accuracyRate >= targetRatio,
    };
  });

  // 4. Bloom Taxonomy Breakdown
  const bloomGroups = new Map<string, { count: number; totalAttempts: number; correctAttempts: number }>();
  questions.forEach(q => {
    const level = q.bloomLevel || 'understand';
    if (!bloomGroups.has(level)) {
      bloomGroups.set(level, { count: 0, totalAttempts: 0, correctAttempts: 0 });
    }
    bloomGroups.get(level)!.count++;
  });

  answers.forEach(ans => {
    const q = questions[ans.questionIndex];
    if (q) {
      const level = q.bloomLevel || 'understand';
      const g = bloomGroups.get(level);
      if (g) {
        g.totalAttempts++;
        if (ans.isCorrect) g.correctAttempts++;
      }
    }
  });

  const bloomStats: BloomAnalytics[] = Array.from(bloomGroups.entries()).map(([level, val]) => {
    const acc = val.totalAttempts > 0 ? Math.round((val.correctAttempts / val.totalAttempts) * 100) : 0;
    return {
      name: level.toUpperCase(),
      bloomLevel: level,
      value: val.count,
      totalAttempts: val.totalAttempts,
      correctAttempts: val.correctAttempts,
      accuracy: acc,
    };
  });

  // Overall calculations
  const totalAnswersCount = answers.length;
  const totalCorrectAnswers = answers.filter(a => a.isCorrect).length;
  const overallAccuracy = totalAnswersCount > 0 ? Math.round((totalCorrectAnswers / totalAnswersCount) * 1000) / 10 : 0;
  const averageScore = totalPlayers > 0 ? Math.round(sortedPlayers.reduce((sum, p) => sum + p.score, 0) / totalPlayers) : 0;

  const topPerformers = sortedPlayers.slice(0, 3).map((p, i) => ({ rank: i + 1, nickname: p.nickname, score: p.score }));
  const lowestPerformers = sortedPlayers.slice(-2).map((p, i) => ({ rank: totalPlayers - 1 + i, nickname: p.nickname, score: p.score }));

  return {
    gameId: gameMetadata?.gameId || 'game_current',
    quizTitle: gameMetadata?.quizTitle || 'Arena Quiz',
    finishedAt: gameMetadata?.finishedAt || new Date().toISOString(),
    totalPlayers,
    overallAccuracy,
    averageScore,
    isDemoData: Boolean(gameMetadata?.isDemo),
    questionStats,
    hardestQuestions,
    coStats,
    bloomStats,
    topPerformers,
    lowestPerformers,
  };
}

/**
 * Fetch finished games available in Firestore and LocalStorage
 */
export async function getFinishedGamesList(): Promise<FinishedGameSummary[]> {
  const gamesMap = new Map<string, FinishedGameSummary>();

  // 1. Fetch from Firestore if configured
  if (isFirebaseConfigured && db) {
    try {
      const gamesCol = collection(db, 'games');
      const q = query(gamesCol, where('status', '==', 'finished'));
      const snap = await getDocs(q);
      snap.forEach(d => {
        const data = d.data() as GameSession;
        gamesMap.set(d.id, {
          id: d.id,
          quizTitle: data.quizTitle || 'Assessment Arena',
          pin: data.pin || '000000',
          finishedAt: data.updatedAt || data.createdAt || new Date().toISOString(),
          playerCount: 0,
          isDemo: d.id.startsWith('demo_'),
        });
      });
    } catch (e) {
      console.warn('Firestore finished games query non-fatal fallback:', e);
    }
  }

  // 2. Fetch from LocalStorage
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('quizarena_game_')) {
        const gameId = key.replace('quizarena_game_', '');
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.status === 'finished' || parsed.questions?.length > 0) {
              const playersKey = `quizarena_players_${gameId}`;
              let pCount = 0;
              try {
                const pRaw = localStorage.getItem(playersKey);
                if (pRaw) pCount = JSON.parse(pRaw).length;
              } catch {}

              gamesMap.set(gameId, {
                id: gameId,
                quizTitle: parsed.quizTitle || 'Saved Game Arena',
                pin: parsed.pin || '000000',
                finishedAt: parsed.updatedAt || parsed.createdAt || new Date().toISOString(),
                playerCount: pCount,
                isDemo: gameId.startsWith('demo_') || parsed.isDemo,
              });
            }
          }
        } catch {}
      }
    }
  } catch (e) {}

  return Array.from(gamesMap.values()).sort(
    (a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime()
  );
}

/**
 * Load complete dataset (Questions, Players, Answers) for a given game ID
 */
export async function loadGameData(gameId: string): Promise<{
  game: GameSession | null;
  questions: Question[];
  players: Player[];
  answers: AnswerSubmission[];
}> {
  let game: GameSession | null = null;
  let questions: Question[] = [];
  let players: Player[] = [];
  const answers: AnswerSubmission[] = [];

  // Check Firestore
  if (isFirebaseConfigured && db) {
    try {
      const gDoc = await getDoc(doc(db, 'games', gameId));
      if (gDoc.exists()) {
        game = gDoc.data() as GameSession;
        questions = game.questions || [];

        // Players subcollection
        const pSnap = await getDocs(collection(db, 'games', gameId, 'players'));
        pSnap.forEach(d => {
          players.push({ id: d.id, ...d.data() } as Player);
        });

        // Answers subcollection
        const aSnap = await getDocs(collection(db, 'games', gameId, 'answers'));
        aSnap.forEach(d => {
          answers.push({ id: d.id, ...d.data() } as AnswerSubmission);
        });
      }
    } catch (e) {
      console.warn('Firestore loadGameData failed, checking local storage:', e);
    }
  }

  // Fallback to local storage
  if (!game) {
    try {
      const raw = localStorage.getItem(`quizarena_game_${gameId}`);
      if (raw) {
        game = JSON.parse(raw);
        questions = game?.questions || [];
      }
    } catch {}
  }

  if (players.length === 0) {
    try {
      const raw = localStorage.getItem(`quizarena_players_${gameId}`);
      if (raw) players = JSON.parse(raw);
    } catch {}
  }

  if (answers.length === 0) {
    try {
      const raw = localStorage.getItem(`quizarena_answers_${gameId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) answers.push(...parsed);
      }
    } catch {}
  }

  return { game, questions, players, answers };
}
