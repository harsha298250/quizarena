/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import type { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { calculateFairScore, evaluateAnswer } from './src/lib/scoring.ts';
import { createHashBlock } from './src/lib/integrity.ts';
import {
  clampLatency,
  globalRateLimiter,
  extractQuestionStartTimeMs,
  validatePlayerEligibility,
  validateAndTrackPowerUp,
  globalTimingAnomalyDetector,
  MAX_ALLOWED_LATENCY_MS,
} from './src/server/scoringHardening.ts';
import { handleSendResults } from './src/server/resultEmailsHandler.ts';

dotenv.config();

// Exception guards to log and keep server alive
process.on('unhandledRejection', (reason, promise) => {
  console.error('[QuizArena] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err, origin) => {
  console.error(`[QuizArena] Uncaught Exception (${origin}):`, err);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Admin initialization for server-side ID token verification and database operations
let rawFirebaseConfig: any = {};
try {
  const configPath = path.join(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    rawFirebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
} catch (e) {
  console.warn('Could not read firebase-applet-config.json in server:', e);
}

const firebaseProjectId = process.env.VITE_FIREBASE_PROJECT_ID || rawFirebaseConfig.projectId;
const firestoreDbId = process.env.VITE_FIREBASE_DATABASE_ID || rawFirebaseConfig.firestoreDatabaseId || '(default)';

let adminCredential: any = undefined;

// 1. Check for FIREBASE_SERVICE_ACCOUNT_KEY env var (file path or inline JSON string)
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY.trim();
    const sa = raw.startsWith('{') ? JSON.parse(raw) : JSON.parse(fs.readFileSync(raw, 'utf-8'));
    adminCredential = cert(sa);
  } catch (err) {
    console.warn('Could not parse FIREBASE_SERVICE_ACCOUNT_KEY:', err);
  }
}

// 2. Check for local serviceAccountKey.json in root
if (!adminCredential) {
  const localKeyPath = path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(localKeyPath)) {
    try {
      const sa = JSON.parse(fs.readFileSync(localKeyPath, 'utf-8'));
      adminCredential = cert(sa);
    } catch (err) {
      console.warn('Could not parse local serviceAccountKey.json:', err);
    }
  }
}

const hasAdminCredentials = Boolean(
  adminCredential ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY
);

export function assertAdminCredentialsPresent(): void {
  if (!hasAdminCredentials && process.env.NODE_ENV !== 'test') {
    console.error(`
================================================================================
❌ [QuizArena Fatal Startup Error] Firebase Admin Credentials Missing!
--------------------------------------------------------------------------------
The QuizArena server requires Firebase Admin credentials for server-side ID
token verification, atomic scoring transactions, and anti-cheat enforcement.

Please supply credentials through one of the following methods:
  1. Place 'serviceAccountKey.json' in the project root directory.
  2. Set FIREBASE_SERVICE_ACCOUNT_KEY in your .env file (raw JSON or file path).
  3. Set GOOGLE_APPLICATION_CREDENTIALS environment variable.

Refer to README.md section "Firebase Admin SDK Credentials" for instructions.
================================================================================
    `);
    process.exit(1);
  }
}

if (!getApps().length && firebaseProjectId) {
  // Initialize Firebase Admin SDK (with cert if available, or ADC)
  initializeApp({
    ...(adminCredential ? { credential: adminCredential } : {}),
    projectId: firebaseProjectId,
  });
}

const adminDb = getFirestore(firestoreDbId);
const adminAuth = getAuth();

const app = express();
const PORT = process.env.PORT || (process.env.NODE_ENV === 'production' ? 3000 : 3001);

// Enable CORS for local development & proxy flexibility
app.use((_req: Request, res: Response, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// Server-side Gemini initialization per guidelines
const GEMINI_MODEL = 'gemini-3.8-flash';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY is not set in environment.');
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

// In-memory rate limiting map
interface RateLimitRecord {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitRecord>();

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

// Authentication helper for AI endpoints
async function authenticateUser(req: Request): Promise<{ uid: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split('Bearer ')[1].trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { uid: decoded.uid };
  } catch (err) {
    console.warn('AI endpoint authentication failed:', err);
    return null;
  }
}

interface PendingLatencyNonce {
  uid: string;
  issuedAt: number;
}
const pendingLatencyNonces = new Map<string, PendingLatencyNonce>();
export const serverMeasuredLatencyMap = new Map<string, number>();

// Clean up stale latency nonces (> 30s) every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [nonce, data] of pendingLatencyNonces.entries()) {
    if (now - data.issuedAt > 30000) {
      pendingLatencyNonces.delete(nonce);
    }
  }
}, 120000).unref();

// Endpoint 0: Nonce-based high-precision server time & latency round trip
// (Client-supplied t and uid parameters removed; server measures RTT itself)
app.get('/api/time', async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const now = Date.now();

  const authUser = await authenticateUser(req);
  const nonce = req.query.nonce ? String(req.query.nonce) : null;

  // Step 2: Client echoes back the server-issued nonce
  if (nonce && authUser) {
    const pending = pendingLatencyNonces.get(nonce);
    if (pending && pending.uid === authUser.uid) {
      const rtt = Math.max(1, now - pending.issuedAt);
      const oneWayLatency = Math.min(Math.max(1, Math.round(rtt / 2)), MAX_ALLOWED_LATENCY_MS);
      serverMeasuredLatencyMap.set(authUser.uid, oneWayLatency);
      pendingLatencyNonces.delete(nonce);

      res.json({
        serverTime: now,
        latencyMs: oneWayLatency,
        roundTripMs: rtt,
      });
      return;
    }
  }

  // Step 1: Server issues a nonce and its own timestamp to authenticated user
  if (authUser) {
    const newNonce = `${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    pendingLatencyNonces.set(newNonce, {
      uid: authUser.uid,
      issuedAt: now,
    });
    res.json({
      serverTime: now,
      nonce: newNonce,
    });
    return;
  }

  // Unauthenticated fallback
  res.json({ serverTime: now });
});

// Endpoint 1: Generate Quiz Questions from Source Material (PDF / text / topic)
app.post('/api/generate-quiz', async (req: Request, res: Response): Promise<void> => {
  try {
    // Authenticate user via Firebase ID token
    const user = await authenticateUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized: Firebase ID token is required to generate quizzes.' });
      return;
    }

    // Rate limiting: 10 requests per minute per user
    const rateCheck = checkRateLimit(`gen_${user.uid}`, 10, 60 * 1000);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSec));
      res.status(429).json({
        error: `Rate limit exceeded. Please wait ${rateCheck.retryAfterSec} seconds before generating more questions.`,
      });
      return;
    }

    const {
      sourceContent,
      sourceType, // 'pdf_text' | 'pasted_text' | 'topic'
      numQuestions = 5,
      difficulty = 'mixed', // 'easy' | 'medium' | 'hard' | 'mixed'
      targetCO = 'CO1',
      language = 'en',
      pageRange,
    } = req.body;

    if (!sourceContent) {
      res.status(400).json({ error: 'sourceContent is required' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
      return;
    }

    const prompt = `
You are an expert pedagogy and assessment specialist generating high-quality quiz questions for QuizArena.
Source Type: ${sourceType}
Course Outcome Target: ${targetCO}
Target Language: ${language} (if 'ta' produce in Tamil, if 'hi' produce in Hindi, otherwise English)
Difficulty Specification: ${difficulty}
Bloom's Taxonomy Guideline:
- Easy: Bloom Recall / Remember (factual recall, definitions)
- Medium: Bloom Understand / Apply (comprehension, application to standard scenarios)
- Hard: Bloom Analyze / Evaluate (multi-step analysis, edge cases, plausible misconceptions, "Which of the following is NOT true")

SOURCE MATERIAL:
${sourceContent.slice(0, 24000)}

INSTRUCTIONS:
1. Generate exactly ${numQuestions} questions strictly grounded in the material provided.
2. For each question provide 4 plausible options. Distractors MUST be plausible and based on common misconceptions.
3. Mark the zero-indexed correct option in correctAnswers.
4. Cite the source_page (number if discernible, or 1) and exact short source_quote from the material.
5. Provide a clear pedagogical explanation for the correct answer.
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

    const text = response.text?.trim() || '[]';
    const parsed = JSON.parse(text);

    // Format output with unique IDs and QuizArena schema
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

    res.json({ questions: formattedQuestions });
  } catch (error) {
    console.error('Error generating quiz:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate quiz',
    });
  }
});

// Endpoint 2: Second-pass Validation & Scenario Conversion
app.post('/api/validate-question', async (req: Request, res: Response): Promise<void> => {
  try {
    // Authenticate user via Firebase ID token
    const user = await authenticateUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized: Firebase ID token is required to validate questions.' });
      return;
    }

    // Rate limiting: 30 requests per minute per user
    const rateCheck = checkRateLimit(`val_${user.uid}`, 30, 60 * 1000);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSec));
      res.status(429).json({
        error: `Rate limit exceeded. Please wait ${rateCheck.retryAfterSec} seconds before adapting questions.`,
      });
      return;
    }

    const { question, action } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      res.status(500).json({ error: 'Gemini API key is not configured' });
      return;
    }

    let prompt = '';
    if (action === 'convert_to_scenario') {
      prompt = `Rewrite this quiz question as a real-world analysis scenario for higher-order Bloom thinking:
Question: ${question.text}
Options: ${JSON.stringify(question.options)}
Explanation: ${question.explanation}
Keep 4 options with one clear correct answer. Return valid JSON.`;
    } else if (action === 'make_easier') {
      prompt = `Simplify this question to Bloom Recall level with clearer terminology:
Question: ${question.text}
Options: ${JSON.stringify(question.options)}
Explanation: ${question.explanation}
Return valid JSON.`;
    } else if (action === 'make_harder') {
      prompt = `Elevate this question to Bloom Analyze/Evaluate level with deeper distractors:
Question: ${question.text}
Options: ${JSON.stringify(question.options)}
Explanation: ${question.explanation}
Return valid JSON.`;
    } else {
      // Standard validation check
      prompt = `Audit this quiz question for ambiguity, distractor plausibility, and single correct answer validity:
Question: ${question.text}
Options: ${JSON.stringify(question.options)}
Correct Answer Index: ${question.correctAnswers[0]}
Explanation: ${question.explanation}
Return quality assessment.`;
    }

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            options: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            correctAnswerIndex: { type: Type.INTEGER },
            explanation: { type: Type.STRING },
            qualityBadge: {
              type: Type.STRING,
              enum: ['good', 'check', 'weak'],
            },
            feedbackNotes: { type: Type.STRING },
          },
          required: ['question', 'options', 'correctAnswerIndex', 'explanation', 'qualityBadge'],
        },
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    res.json(parsed);
  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Validation failed' });
  }
});

// Endpoint 3: Host Advances Question & Sets Authoritative questionStartTime
app.post('/api/advance-question', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
      return;
    }

    const idToken = authHeader.split('Bearer ')[1].trim();
    let hostUid = '';
    try {
      const decodedToken = await adminAuth.verifyIdToken(idToken);
      hostUid = decodedToken.uid;
    } catch {
      res.status(401).json({ error: 'Unauthorized: Invalid Firebase ID token' });
      return;
    }

    const { gameId, questionIndex, timeLimit } = req.body;
    if (!gameId || questionIndex === undefined) {
      res.status(400).json({ error: 'gameId and questionIndex are required' });
      return;
    }

    const gameDocRef = adminDb.doc(`games/${gameId}`);
    const gameDoc = await gameDocRef.get();
    if (!gameDoc.exists) {
      res.status(404).json({ error: 'Game session not found' });
      return;
    }

    const gameData = gameDoc.data() || {};
    if (gameData.hostId !== hostUid) {
      res.status(403).json({ error: 'Forbidden: Only the game host can advance questions' });
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

    res.json({
      success: true,
      status: 'question_active',
      currentQuestionIndex: questionIndex,
      questionStartTimeMs: now,
      timeLimit: durationSec,
    });
  } catch (error) {
    console.error('Error advancing question:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to advance question' });
  }
});

// Endpoint 4: Server-side Answer Validation, Fair Scoring & Transactional Verification
app.post('/api/answer', async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Verify Firebase ID Token via firebase-admin
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
      return;
    }

    const idToken = authHeader.split('Bearer ')[1].trim();
    let playerId = '';
    try {
      const decodedToken = await adminAuth.verifyIdToken(idToken);
      playerId = decodedToken.uid;
    } catch (authError) {
      console.warn('Token verification failed:', authError);
      res.status(401).json({ error: 'Unauthorized: Invalid or expired Firebase ID token' });
      return;
    }

    // Task 3(f): Rate limiting per uid on /api/answer
    const rateCheck = globalRateLimiter.check(`ans_${playerId}`, 10, 10 * 1000);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSec));
      res.status(429).json({
        error: `Rate limit exceeded. Please wait ${rateCheck.retryAfterSec} seconds before submitting another answer.`,
      });
      return;
    }

    const {
      gameId,
      questionIndex,
      selectedIndices = [],
      textAnswer,
      clientTimestamp,
      powerUps,
      rawResponseTimeMs,
    } = req.body;

    if (!gameId || questionIndex === undefined) {
      res.status(400).json({ error: 'gameId and questionIndex are required' });
      return;
    }

    // 2. Fetch game document and check if question is active
    const gameDocRef = adminDb.doc(`games/${gameId}`);
    const gameDoc = await gameDocRef.get();
    if (!gameDoc.exists) {
      res.status(404).json({ error: 'Game session not found' });
      return;
    }

    const gameData = gameDoc.data() || {};
    if (gameData.status !== 'question_active') {
      res.status(400).json({ error: 'Question is not active for answers' });
      return;
    }

    if (gameData.currentQuestionIndex !== questionIndex) {
      res.status(400).json({
        error: `Question index mismatch: expected ${gameData.currentQuestionIndex}, got ${questionIndex}`,
      });
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
        res.status(400).json({ error: 'Answer submitted too late: question time limit expired' });
        return;
      }
    }

    // 3. Fetch secret answer key from host-only subcollection games/{id}/secrets/answerKey
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
      res.status(500).json({ error: 'Answer key not found for this question' });
      return;
    }

    // 4. Compute correctness on server
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
        const measuredPing = serverMeasuredLatencyMap.get(playerId);
        const clampedLatency = clampLatency(measuredPing !== undefined ? measuredPing : playerData.latencyMs);

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

        // Task 7(e): Server looks up the previous hash instead of trusting client-supplied prevHash
        let serverPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';
        if (gameData.lastAuditHash) {
          serverPrevHash = gameData.lastAuditHash;
        } else {
          try {
            const latestAnswerSnap = await adminDb
              .collection(`games/${gameId}/answers`)
              .orderBy('serverTimestamp', 'desc')
              .limit(1)
              .get();
            if (!latestAnswerSnap.empty) {
              const lastData = latestAnswerSnap.docs[0].data();
              if (lastData?.hash) {
                serverPrevHash = lastData.hash;
              }
            }
          } catch (lookupErr) {
            console.warn('Could not query last answer hash for audit chain:', lookupErr);
          }
        }

        const auditBlock = await createHashBlock(
          serverPrevHash,
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
          prevHash: serverPrevHash,
          hash: auditBlock.hash,
          powerUpsUsed: {
            doublePoints: willUseDoublePoints,
          },
        };

        // Write answer document and update latest audit hash on the game doc
        transaction.set(answerDocRef, submissionData);
        transaction.update(gameDocRef, { lastAuditHash: auditBlock.hash });

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

        // Update player score, streaks, and mark power-up as used on server
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
        res.status(txError.statusCode).json({ error: txError.message });
        return;
      }
      throw txError;
    }

    res.json({
      success: true,
      submission: {
        ...txResult.submissionData,
        serverSubmittedAt: now,
      },
      updatedPlayer: txResult.updatedPlayer,
    });
  } catch (error) {
    console.error('Error processing answer submission:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error processing answer',
    });
  }
});

// POST /api/send-results - Dispatch result emails via SMTP (Nodemailer) with host auth & rate limiting
app.post('/api/send-results', async (req: Request, res: Response): Promise<void> => {
  await handleSendResults(req, res, {
    adminAuth,
    adminDb,
  });
});

// Serve frontend build in production
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  assertAdminCredentialsPresent();
  console.log(`QuizArena Server running on port ${PORT}`);
});

export default app;
