/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from '@google/genai';
import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { calculateFairScore, evaluateAnswer } from '../lib/scoring.ts';
import { createHashBlock } from '../lib/integrity.ts';
import {
  clampLatency,
  globalRateLimiter,
  extractQuestionStartTimeMs,
  validatePlayerEligibility,
  validateAndTrackPowerUp,
  globalTimingAnomalyDetector,
  MAX_ALLOWED_LATENCY_MS,
} from './scoringHardening.ts';

let rawFirebaseConfig: any = {};
try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    rawFirebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
} catch (e) {}

const firebaseProjectId = process.env.VITE_FIREBASE_PROJECT_ID || rawFirebaseConfig.projectId;
const firestoreDbId = process.env.VITE_FIREBASE_DATABASE_ID || rawFirebaseConfig.firestoreDatabaseId || '(default)';

if (!getApps().length && firebaseProjectId) {
  initializeApp({
    projectId: firebaseProjectId,
  });
}

function getAdminDb() {
  return getFirestore(firestoreDbId);
}

function getAdminAuth() {
  return getAuth();
}

const GEMINI_MODEL = 'gemini-3.8-flash';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(
  clientKey: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const record = rateLimitMap.get(clientKey);

  if (!record || now > record.resetAt) {
    rateLimitMap.set(clientKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (record.count >= maxRequests) {
    const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, retryAfterSec };
  }

  record.count += 1;
  return { allowed: true };
}

export function handleTime(_req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.end(JSON.stringify({ serverTime: Date.now() }));
}

export async function handleGenerateQuiz(req: IncomingMessage, res: ServerResponse) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Unauthorized: Firebase ID token is required to generate quizzes.' }));
      return;
    }

    const token = authHeader.split('Bearer ')[1].trim();
    let uid = '';
    try {
      const decoded = await getAdminAuth().verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Unauthorized: Invalid Firebase ID token.' }));
      return;
    }

    const rateCheck = checkRateLimit(`gen_${uid}`, 10, 60 * 1000);
    if (!rateCheck.allowed) {
      res.statusCode = 429;
      res.setHeader('Retry-After', String(rateCheck.retryAfterSec));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `Rate limit exceeded. Please wait ${rateCheck.retryAfterSec}s.` }));
      return;
    }

    const data = await parseBody(req);
    const {
      sourceContent,
      sourceType = 'text',
      numQuestions = 5,
      difficulty = 'mixed',
      targetCO = 'CO1',
      language = 'en',
    } = data;

    if (!sourceContent) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'sourceContent is required' }));
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not configured in server environment.' }));
      return;
    }

    const prompt = `
You are an expert assessment specialist generating high quality quiz questions for QuizArena.
Source Type: ${sourceType}
Course Outcome Target: ${targetCO}
Target Language: ${language}
Difficulty: ${difficulty}
Bloom's Taxonomy Guideline:
- Easy: Remember / Recall definitions
- Medium: Understand / Standard application
- Hard: Analyze / Evaluate scenarios & edge cases

SOURCE MATERIAL:
${sourceContent.slice(0, 24000)}

INSTRUCTIONS:
1. Generate ${numQuestions} questions strictly grounded in this material.
2. Provide 4 plausible options for each question.
3. Zero-indexed correct answer in correctAnswerIndex.
4. Short explanation of why the answer is correct.
`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              correctAnswerIndex: { type: Type.INTEGER },
              explanation: { type: Type.STRING },
              difficulty: {
                type: Type.STRING,
                enum: ['easy', 'medium', 'hard'],
              },
              bloom_level: {
                type: Type.STRING,
                enum: ['remember', 'understand', 'apply', 'analyze', 'evaluate'],
              },
              source_page: { type: Type.INTEGER },
              source_quote: { type: Type.STRING },
              topicTag: { type: Type.STRING },
            },
            required: ['question', 'options', 'correctAnswerIndex', 'explanation', 'difficulty', 'bloom_level'],
          },
        },
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '[]');
    const formattedQuestions = parsed.map((item: any, idx: number) => ({
      id: `ai_q_${Date.now()}_${idx}`,
      type: 'multiple_choice',
      text: item.question,
      options: item.options,
      correctAnswers: [item.correctAnswerIndex],
      explanation: item.explanation,
      timeLimit: item.difficulty === 'hard' ? 30 : item.difficulty === 'medium' ? 20 : 15,
      points: 1000,
      topicTag: item.topicTag || targetCO,
      bloomLevel: item.bloom_level || 'understand',
      courseOutcomeTag: targetCO,
      sourcePage: item.source_page || 1,
      sourceQuote: item.source_quote || '',
      validationBadge: 'good',
    }));

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ questions: formattedQuestions }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Generation failed' }));
  }
}

export async function handleAdvanceQuestion(req: IncomingMessage, res: ServerResponse) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Unauthorized: Missing or invalid Authorization header' }));
      return;
    }

    const idToken = authHeader.split('Bearer ')[1].trim();
    let hostUid = '';
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      hostUid = decoded.uid;
    } catch {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Unauthorized: Invalid Firebase ID token' }));
      return;
    }

    const body = await parseBody(req);
    const { gameId, questionIndex, timeLimit } = body;
    if (!gameId || questionIndex === undefined) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'gameId and questionIndex are required' }));
      return;
    }

    const adminDb = getAdminDb();
    const gameDocRef = adminDb.doc(`games/${gameId}`);
    const gameDoc = await gameDocRef.get();
    if (!gameDoc.exists) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Game session not found' }));
      return;
    }

    const gameData = gameDoc.data() || {};
    if (gameData.hostId !== hostUid) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Forbidden: Only the game host can advance questions' }));
      return;
    }

    const durationSec = timeLimit || gameData.questions?.[questionIndex]?.timeLimit || gameData.timeLimit || 20;
    const now = Date.now();

    await gameDocRef.update({
      status: 'question_active',
      currentQuestionIndex: questionIndex,
      questionStartTime: FieldValue.serverTimestamp(),
      questionStartTimeMs: now,
      timeLimit: durationSec,
      isPaused: false,
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        status: 'question_active',
        currentQuestionIndex: questionIndex,
        questionStartTimeMs: now,
        timeLimit: durationSec,
      })
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to advance question' }));
  }
}

export async function handleAnswer(req: IncomingMessage, res: ServerResponse) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Unauthorized: Missing or invalid Authorization header' }));
      return;
    }

    const idToken = authHeader.split('Bearer ')[1].trim();
    let playerId = '';
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      playerId = decoded.uid;
    } catch (authError) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Unauthorized: Invalid or expired Firebase ID token' }));
      return;
    }

    // Task 3(f): Rate limiting per uid on /api/answer
    const rateCheck = globalRateLimiter.check(`ans_${playerId}`, 10, 10 * 1000);
    if (!rateCheck.allowed) {
      res.statusCode = 429;
      res.setHeader('Retry-After', String(rateCheck.retryAfterSec));
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: `Rate limit exceeded. Please wait ${rateCheck.retryAfterSec} seconds before submitting another answer.`,
        })
      );
      return;
    }

    const body = await parseBody(req);
    const {
      gameId,
      questionIndex,
      selectedIndices = [],
      textAnswer,
      prevHash = '0000000000000000000000000000000000000000000000000000000000000000',
      clientTimestamp,
      powerUps,
      rawResponseTimeMs,
    } = body;

    if (!gameId || questionIndex === undefined) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'gameId and questionIndex are required' }));
      return;
    }

    const adminDb = getAdminDb();
    const gameDocRef = adminDb.doc(`games/${gameId}`);
    const gameDoc = await gameDocRef.get();
    if (!gameDoc.exists) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Game session not found' }));
      return;
    }

    const gameData = gameDoc.data() || {};
    if (gameData.status !== 'question_active') {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Question is not active for answers' }));
      return;
    }

    if (gameData.currentQuestionIndex !== questionIndex) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Question index mismatch' }));
      return;
    }

    // Task 3(b): Use server-set questionStartTime for elapsed time calculation
    const now = Date.now();
    const timeLimitSec = gameData.timeLimit || 20;
    const allowedWindowMs = timeLimitSec * 1000 + 3500;
    const questionStartMs =
      extractQuestionStartTimeMs(gameData.questionStartTime) ||
      gameData.questionStartTimeMs ||
      0;

    let serverElapsedMs = rawResponseTimeMs || 1000;
    if (questionStartMs > 0) {
      serverElapsedMs = Math.max(0, now - questionStartMs);
      if (serverElapsedMs > allowedWindowMs) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Answer submitted too late: question time limit expired' }));
        return;
      }
    }

    const secretDocRef = adminDb.doc(`games/${gameId}/secrets/answerKey`);
    const secretDoc = await secretDocRef.get();
    let secretQuestion: any = null;
    if (secretDoc.exists) {
      const secretData = secretDoc.data() || {};
      const answersList = secretData.answers || [];
      secretQuestion = answersList.find((a: any) => a.questionIndex === questionIndex);
    }
    if (!secretQuestion && gameData.questions?.[questionIndex]) {
      secretQuestion = gameData.questions[questionIndex];
    }
    if (!secretQuestion) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Answer key not found for this question' }));
      return;
    }

    const isCorrect = evaluateAnswer(
      secretQuestion.type,
      selectedIndices,
      secretQuestion.correctAnswers || [],
      textAnswer,
      secretQuestion.acceptedTextAnswers || []
    );

    // Task 3(c): Wrap the duplicate check, player verification, power-up check, and answer write in a Firestore transaction
    const answerId = `ans_${questionIndex}_${playerId}`;
    const answerDocRef = adminDb.doc(`games/${gameId}/answers/${answerId}`);
    const playerDocRef = adminDb.doc(`games/${gameId}/players/${playerId}`);

    let txResult: any;
    try {
      txResult = await adminDb.runTransaction(async (transaction) => {
        // Task 3(e): Verify player existence and ensure player is not kicked
        const playerDoc = await transaction.get(playerDocRef);
        const playerEligibility = validatePlayerEligibility(playerDoc.exists, playerDoc.data());
        if (!playerEligibility.eligible) {
          const err: any = new Error(playerEligibility.error);
          err.statusCode = playerEligibility.statusCode;
          throw err;
        }

        const playerData = playerDoc.data() || {};

        // Task 3(c): Reject duplicate answers inside transaction
        const existingAnswerDoc = await transaction.get(answerDocRef);
        if (existingAnswerDoc.exists) {
          const err: any = new Error('Duplicate answer: already submitted for this question');
          err.statusCode = 409;
          throw err;
        }

        // Task 3(d): Track power-up usage per player on the server (single use)
        const requestedDoublePoints = Boolean(powerUps?.doublePoints || powerUps?.doublePointsUsed);
        const powerUpCheck = validateAndTrackPowerUp(
          playerData,
          requestedDoublePoints ? 'doublePoints' : undefined
        );
        if (!powerUpCheck.allowed) {
          const err: any = new Error(powerUpCheck.error);
          err.statusCode = 400;
          throw err;
        }
        const willUseDoublePoints = powerUpCheck.willUse;

        // Task 3(a): Stop trusting playerData.latencyMs, clamp to server-side maximum of 300 ms
        const clampedLatency = clampLatency(playerData.latencyMs);

        const currentStreak = playerData.streak || 0;
        const currentScore = playerData.score || 0;
        const maxStreak = playerData.maxStreak || 0;
        const correctCount = playerData.correctCount || 0;

        const scoreResult = calculateFairScore({
          basePoints: secretQuestion.points || 1000,
          isCorrect,
          timeLimitSeconds: secretQuestion.timeLimit || timeLimitSec,
          rawResponseTimeMs: serverElapsedMs,
          latencyMs: clampedLatency,
          clockOffsetMs: 0,
          currentStreak,
          scoringProfile: gameData.settings?.scoringProfile || 'speed_weighted',
          doublePointsPowerUp: willUseDoublePoints,
        });

        const auditBlock = await createHashBlock(
          prevHash,
          questionIndex,
          playerId,
          questionIndex,
          scoreResult.finalPoints,
          now
        );

        const submissionData = {
          id: answerId,
          gameId,
          playerId,
          playerNickname: playerData.nickname || 'Player',
          questionIndex,
          selectedIndices,
          textAnswer: textAnswer || null,
          isCorrect,
          pointsAwarded: scoreResult.finalPoints,
          responseTimeMs: scoreResult.compensatedResponseTimeMs,
          clientTimestamp: clientTimestamp || now,
          serverTimestamp: now,
          serverSubmittedAt: FieldValue.serverTimestamp(),
          prevHash,
          hash: auditBlock.hash,
          powerUpsUsed: {
            doublePoints: willUseDoublePoints,
          },
        };

        transaction.set(answerDocRef, submissionData);

        // Server-side timing anomaly detection (implausibly fast or uniform timing across questions)
        const timingAnomaly = globalTimingAnomalyDetector.recordAndCheck(playerId, serverElapsedMs);
        if (timingAnomaly.isAnomaly) {
          const flagId = `flag_${now}_${Math.random().toString(36).substring(2, 7)}`;
          const flagDocRef = adminDb.doc(`games/${gameId}/flags/${flagId}`);
          transaction.set(flagDocRef, {
            id: flagId,
            playerId,
            playerNickname: playerData.nickname || 'Player',
            type: timingAnomaly.type,
            severity: timingAnomaly.severity || 'medium',
            reason: timingAnomaly.reason,
            timestamp: new Date().toISOString(),
            questionIndex,
          });
        }

        const newStreak = scoreResult.newStreak;
        const newScore = currentScore + scoreResult.finalPoints;
        const newMaxStreak = Math.max(maxStreak, newStreak);
        const newCorrectCount = isCorrect ? correctCount + 1 : correctCount;

        const playerUpdates: Record<string, any> = {
          score: FieldValue.increment(scoreResult.finalPoints),
          streak: newStreak,
          maxStreak: newMaxStreak,
          correctCount: isCorrect ? FieldValue.increment(1) : correctCount,
          lastSeen: FieldValue.serverTimestamp(),
        };

        if (willUseDoublePoints) {
          playerUpdates['powerUps.doublePointsUsed'] = true;
          playerUpdates['usedPowerUps.doublePoints'] = true;
        }

        transaction.update(playerDocRef, playerUpdates);

        return {
          submissionData,
          updatedPlayer: {
            id: playerId,
            score: newScore,
            streak: newStreak,
            maxStreak: newMaxStreak,
            correctCount: newCorrectCount,
            powerUps: {
              ...(playerData.powerUps || {}),
              doublePointsUsed: Boolean(playerData.powerUps?.doublePointsUsed || willUseDoublePoints),
            },
          },
        };
      });
    } catch (txError: any) {
      if (txError.statusCode) {
        res.statusCode = txError.statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: txError.message }));
        return;
      }
      throw txError;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        submission: {
          ...txResult.submissionData,
          serverSubmittedAt: now,
        },
        updatedPlayer: txResult.updatedPlayer,
      })
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal error processing answer',
      })
    );
  }
}
