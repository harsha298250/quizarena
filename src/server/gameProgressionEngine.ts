/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { extractSecretAnswerForQuestion, resolveQuestionDuration } from './scoringHardening.ts';

export interface GameProgressionOptions {
  adminDb: Firestore;
  intervalMs?: number;
}

/**
 * Sweeps active games and applies authoritative time-based state transitions.
 * 1. question_active -> reveal (when now >= deadlineTimestampMs)
 * 2. reveal -> question_active (when now >= revealDeadlineTimestampMs and progressionMode !== 'manual')
 * 3. reveal -> finished (when last question completes in automatic mode)
 */
export async function progressActiveGames(adminDb: Firestore): Promise<void> {
  const now = Date.now();

  try {
    const activeGamesSnap = await adminDb
      .collection('games')
      .where('status', 'in', ['question_active', 'reveal'])
      .get();

    if (activeGamesSnap.empty) {
      return;
    }

    for (const doc of activeGamesSnap.docs) {
      const gameData = doc.data();
      if (!gameData || gameData.isPaused) {
        continue;
      }

      const gameId = doc.id;

      // 1. Transition question_active -> reveal when question time limit expires
      if (gameData.status === 'question_active') {
        const deadline = Number(gameData.deadlineTimestampMs || 0);
        if (deadline > 0 && now >= deadline) {
          try {
            await adminDb.runTransaction(async tx => {
              const freshSnap = await tx.get(doc.ref);
              if (!freshSnap.exists) return;
              const freshData = freshSnap.data();

              // Guard idempotency
              if (freshData?.status !== 'question_active' || freshData?.isPaused) {
                return;
              }

              const currentQuestionIndex = freshData.currentQuestionIndex || 0;
              let correctAnswers: number[] = [];
              let acceptedTextAnswers: string[] = [];

              // Read answer key secret
              const secretsDocRef = adminDb.doc(`games/${gameId}/secrets/answerKey`);
              const secretsSnap = await tx.get(secretsDocRef);
              if (secretsSnap.exists) {
                const secrets = secretsSnap.data() || {};
                const qSecret = extractSecretAnswerForQuestion(
                  secrets,
                  currentQuestionIndex,
                  freshData.questions?.[currentQuestionIndex]
                );
                if (qSecret) {
                  correctAnswers = Array.isArray(qSecret.correctAnswers) ? qSecret.correctAnswers : [];
                  acceptedTextAnswers = Array.isArray(qSecret.acceptedTextAnswers) ? qSecret.acceptedTextAnswers : [];
                }
              }

              const questions = Array.isArray(freshData.questions) ? [...freshData.questions] : [];
              if (questions[currentQuestionIndex]) {
                questions[currentQuestionIndex] = {
                  ...questions[currentQuestionIndex],
                  correctAnswers,
                  acceptedTextAnswers,
                };
              }

              const revealDeadlineTimestampMs = now + 5000;

              tx.update(doc.ref, {
                status: 'reveal',
                questions,
                revealDeadlineTimestampMs,
                updatedAt: FieldValue.serverTimestamp(),
              });
            });
          } catch (txErr) {
            console.warn(`[ProgressionEngine] Failed auto-reveal for game ${gameId}:`, txErr);
          }
        }
      }

      // 2. Transition reveal -> next question / finished when reveal window expires in automatic mode
      else if (gameData.status === 'reveal') {
        const isAuto = gameData.settings?.progressionMode !== 'manual';
        const revealDeadline = Number(gameData.revealDeadlineTimestampMs || 0);

        if (isAuto && revealDeadline > 0 && now >= revealDeadline) {
          try {
            await adminDb.runTransaction(async tx => {
              const freshSnap = await tx.get(doc.ref);
              if (!freshSnap.exists) return;
              const freshData = freshSnap.data();

              // Guard idempotency
              if (freshData?.status !== 'reveal' || freshData?.isPaused) {
                return;
              }

              const totalQuestions = Array.isArray(freshData.questions) ? freshData.questions.length : 0;
              const currentIndex = freshData.currentQuestionIndex || 0;
              const nextIndex = currentIndex + 1;

              if (nextIndex < totalQuestions) {
                const duration = resolveQuestionDuration(freshData, nextIndex);
                const deadlineTimestampMs = now + duration * 1000;

                tx.update(doc.ref, {
                  status: 'question_active',
                  currentQuestionIndex: nextIndex,
                  timeLimit: duration,
                  questionStartTime: FieldValue.serverTimestamp(),
                  questionStartTimeMs: now,
                  deadlineTimestampMs,
                  revealDeadlineTimestampMs: null,
                  isPaused: false,
                  pauseRemainingMs: null,
                  updatedAt: FieldValue.serverTimestamp(),
                });
              } else {
                // Assessment completed
                tx.update(doc.ref, {
                  status: 'finished',
                  revealDeadlineTimestampMs: null,
                  updatedAt: FieldValue.serverTimestamp(),
                });
              }
            });
          } catch (txErr) {
            console.warn(`[ProgressionEngine] Failed auto-advance for game ${gameId}:`, txErr);
          }
        }
      }
    }
  } catch (queryErr) {
    // Suppress transient query errors (e.g. index build or connection reset)
    console.warn('[ProgressionEngine] Active games scan error:', queryErr);
  }
}

/**
 * Starts a recurring background progression loop on the server.
 */
export function startGameProgressionLoop(options: GameProgressionOptions): () => void {
  const { adminDb, intervalMs = 1000 } = options;
  let isRunning = true;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (!isRunning) return;
    await progressActiveGames(adminDb);
    if (isRunning) {
      timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, intervalMs);

  return () => {
    isRunning = false;
    if (timer) clearTimeout(timer);
  };
}
