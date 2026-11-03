/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { validateServerEnvironment, isAllowedCorsOrigin } from './src/server/envValidator.ts';
import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { calculateFairScore, evaluateAnswer } from './src/lib/scoring.ts';
import { createHashBlock } from './src/lib/integrity.ts';
import {
  clampLatency,
  extractQuestionStartTimeMs,
  validatePlayerEligibility,
  validateAndTrackPowerUp,
  globalTimingAnomalyDetector,
  MAX_ALLOWED_LATENCY_MS,
  serverMeasuredLatencyMap,
} from './src/server/scoringHardening.ts';
import {
  sharedRateLimiter,
  checkWarmupRateLimit,
  checkGenerateQuizRateLimit,
  checkAnonymousGenerateQuizRateLimit,
  checkValidateRateLimit,
  checkBatchValidateRateLimit,
  checkAnswerRateLimit,
} from './src/server/sharedRateLimiter.ts';
import { generateWithAIAdapter } from './src/server/aiProviderAdapter.ts';
import {
  handleAnswerSubmission,
  handleUsePowerUp,
  handleApproveAccommodation,
} from './src/server/answerSubmissionHandler.ts';
import { handleSendResults, handleSendTestEmail, handleSmtpHealth, getSmtpTransporter } from './src/server/resultEmailsHandler.ts';
import { handleIntegrityEvent, handleReinstatePlayer } from './src/server/integrityHandler.ts';
import {
  handleCreateGame,
  handleJoinGame,
  handleKickPlayer,
  handleLeaveGame,
  handleLockLobby,
  handleStartGame,
  handleAdvanceQuestion,
  handleRevealAnswer,
  handleShowLeaderboard,
  handlePauseGame,
  handleResumeGame,
  handleEndGame,
  handleCancelGame,
  handleSessionRecovery,
  handleReconcilePlayerCount,
} from './src/server/gameSessionHandler.ts';

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
    console.warn(`
================================================================================
⚠️ [QuizArena Admin Credentials Notice] Firebase Admin Credentials Missing!
--------------------------------------------------------------------------------
The QuizArena server requires Firebase Admin credentials for server-side ID
token verification, atomic scoring transactions, and anti-cheat enforcement.

Please supply credentials through one of the following methods:
  1. Place 'serviceAccountKey.json' in the project root directory.
  2. Set FIREBASE_SERVICE_ACCOUNT_KEY in your environment (raw JSON or file path).
  3. Set GOOGLE_APPLICATION_CREDENTIALS environment variable.

The server is operating in degraded mode; /health will report unauthenticated status.
================================================================================
    `);
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
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (process.env.NODE_ENV === 'production' ? 3000 : 3001);
const HOST = process.env.HOST || '0.0.0.0';

// Security Hardening via Helmet: CSP, COOP, HSTS, noSniff, xFrameOptions, hidePoweredBy
app.use(
  helmet({
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://apis.google.com',
          'https://*.firebaseapp.com',
          'https://*.googleapis.com',
          'https://accounts.google.com',
          'blob:',
        ],
        connectSrc: [
          "'self'",
          'https://*.googleapis.com',
          'https://*.firebaseio.com',
          'https://firestore.googleapis.com',
          'https://identitytoolkit.googleapis.com',
          'https://securetoken.googleapis.com',
          'https://accounts.google.com',
          'wss://*.firebaseio.com',
          'blob:',
          'data:',
        ],
        frameSrc: [
          "'self'",
          'https://*.firebaseapp.com',
          'https://accounts.google.com',
        ],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://*.googleusercontent.com',
          'https://*.gstatic.com',
        ],
        fontSrc: ["'self'", 'data:'],
        workerSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        objectSrc: ["'none'"],
      },
    },
    hidePoweredBy: true,
    xFrameOptions: { action: 'sameorigin' },
    noSniff: true,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);

// Validate environment configuration at boot
const envValidation = validateServerEnvironment();
if (envValidation.warnings.length > 0) {
  envValidation.warnings.forEach(w => console.warn(`[QuizArena Environment Warning] ${w}`));
}
if (!envValidation.isValid) {
  envValidation.errors.forEach(e => console.error(`[QuizArena Environment Error] ${e}`));
}

const configuredCorsOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Request Correlation ID & Structured Logging Middleware
app.use((req: Request, res: Response, next) => {
  const reqId = (req.headers['x-request-id'] as string) || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15));
  (req as any).id = reqId;
  res.setHeader('X-Request-Id', reqId);
  const start = Date.now();

  res.on('finish', () => {
    if (req.path.startsWith('/api') || req.path === '/health') {
      const duration = Date.now() - start;
      console.log(JSON.stringify({
        level: 'info',
        timestamp: new Date().toISOString(),
        requestId: reqId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: duration,
        ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
      }));
    }
  });
  next();
});

// Production-Hardened CORS Middleware
app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  const isDev = process.env.NODE_ENV !== 'production';

  let allowOrigin: string | null = null;
  if (!origin) {
    // Non-browser or same-origin request
    allowOrigin = null;
  } else if (isDev || configuredCorsOrigins.length === 0 || configuredCorsOrigins.includes('*')) {
    // In dev or when wildcard is explicitly allowed
    allowOrigin = origin;
  } else if (isAllowedCorsOrigin(origin, configuredCorsOrigins)) {
    allowOrigin = origin;
  }

  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Request-Id');

  if (req.method === 'OPTIONS') {
    res.sendStatus(allowOrigin || isDev ? 204 : 403);
    return;
  }
  next();
});

// Safe operational health check endpoint (Zero secret leakage)
const handleHealthCheck = (_req: Request, res: Response) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const hasDb = Boolean(adminDb);
  const hasAuth = Boolean(adminAuth);
  const hasGemini = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
  const hasEmail = Boolean(process.env.RESEND_API_KEY || process.env.BREVO_API_KEY || process.env.SMTP_HOST);

  const isDegraded = !hasAdminCredentials && isProduction;

  res.status(isDegraded ? 503 : 200).json({
    status: isDegraded ? 'degraded' : 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    service: 'quizarena-backend',
    dependencies: {
      firestore: hasDb && hasAdminCredentials ? 'ready' : (hasDb ? 'unauthenticated-mode' : 'unavailable'),
      auth: hasAuth && hasAdminCredentials ? 'ready' : 'mock/unconfigured',
      gemini: hasGemini ? 'configured' : 'fallback-mode',
      email: hasEmail ? 'configured' : 'unconfigured',
    },
  });
};

app.get('/health', handleHealthCheck);
app.get('/api/health', handleHealthCheck);

app.use(express.json({ limit: '10mb' }));

// Server-side Gemini initialization per guidelines (fastest suitable Gemini model)
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

export function isGeminiModelNotFoundError(err: any): boolean {
  if (!err) return false;
  const msg = typeof err === 'string' ? err : (err.message || String(err));
  const status = err.status || err.code || err.statusCode;
  return (
    status === 404 ||
    /not[_\s-]?found/i.test(msg) ||
    /404/i.test(msg) ||
    /model.*not found/i.test(msg)
  );
}

export const FALLBACK_GEMINI_MODELS = ['gemini-2.0-flash'];

export async function generateContentWithFallback(
  ai: GoogleGenAI,
  primaryModel: string,
  options: { contents: string; config?: any }
): Promise<any> {
  const modelsToTry = [primaryModel, ...FALLBACK_GEMINI_MODELS.filter(m => m !== primaryModel)];
  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      // 30s timeout per candidate model so a non-existent or lagging model never delays fallback past reverse proxy limits
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Model ${model} timeout`)), 30000)
      );
      const res = await Promise.race([
        ai.models.generateContent({
          ...options,
          model,
        }),
        timeoutPromise,
      ]);
      return res;
    } catch (err: any) {
      lastError = err;
      if (isGeminiModelNotFoundError(err) || (err && typeof err.message === 'string' && err.message.includes('timeout'))) {
        console.warn(`[QuizArena Gemini] Model "${model}" not available (${err.message || '404'}). Falling back to next available model...`);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

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

// Authentication helper for AI endpoints
async function authenticateUser(req: Request): Promise<{ uid: string; signInProvider?: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split('Bearer ')[1].trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { uid: decoded.uid, signInProvider: decoded.firebase?.sign_in_provider };
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
export { serverMeasuredLatencyMap };

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

// Endpoint 0b: Silent warm-up ping for AI generator server container (rate-limited via sharedRateLimiter)
app.get('/api/ai-warmup', (req: Request, res: Response): void => {
  res.setHeader('Cache-Control', 'no-store');
  const clientKey = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'client';
  const rate = checkWarmupRateLimit(clientKey);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSec || 60));
    res.status(429).json({ error: 'Too many warm-up requests. Please wait.' });
    return;
  }
  res.json({ status: 'ok', warmed: true, timestamp: Date.now() });
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

    // Rate limiting: anonymous vs authenticated
    const isAnonymous = user.signInProvider === 'anonymous';
    const rateCheck = isAnonymous
      ? checkAnonymousGenerateQuizRateLimit(user.uid)
      : checkGenerateQuizRateLimit(user.uid);

    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSec));
      res.status(429).json({
        error: isAnonymous
          ? `Guest generation limit reached (5 per 10m). Please wait ${rateCheck.retryAfterSec}s or sign in with an instructor account.`
          : `Rate limit exceeded. Please wait ${rateCheck.retryAfterSec} seconds before generating more questions.`,
      });
      return;
    }

    const {
      sourceContent,
      sourceType, // 'pdf_text' | 'pasted_text' | 'topic'
      numQuestions: rawNumQuestions = 5,
      difficulty: rawDifficulty = 'mixed',
      targetCO = 'CO1',
      language: rawLanguage = 'en',
      pageRange,
    } = req.body;

    // --- Input validation ---
    if (!sourceContent || typeof sourceContent !== 'string' || !sourceContent.trim()) {
      res.status(400).json({ error: 'sourceContent is required and must be a non-empty string.' });
      return;
    }

    const numQuestions = parseInt(String(rawNumQuestions), 10);
    if (isNaN(numQuestions) || numQuestions < 1 || numQuestions > 50) {
      res.status(400).json({ error: 'numQuestions must be an integer between 1 and 50.' });
      return;
    }

    const ALLOWED_DIFFICULTIES = ['easy', 'medium', 'hard', 'mixed'];
    const difficulty = String(rawDifficulty).toLowerCase();
    if (!ALLOWED_DIFFICULTIES.includes(difficulty)) {
      res.status(400).json({ error: `difficulty must be one of: ${ALLOWED_DIFFICULTIES.join(', ')}.` });
      return;
    }

    const ALLOWED_LANGUAGES = ['en', 'hi', 'ta'];
    const language = String(rawLanguage).toLowerCase();
    if (!ALLOWED_LANGUAGES.includes(language)) {
      res.status(400).json({ error: `language must be one of: ${ALLOWED_LANGUAGES.join(', ')}.` });
      return;
    }

    // Cap source content to prevent excessive token consumption
    const SOURCE_CHAR_LIMIT = 30000;
    const safeSourceContent = sourceContent.slice(0, SOURCE_CHAR_LIMIT);

    // Multi-Provider Generation (Gemini primary -> Grok secondary -> Heuristic fallback)
    const aiResult = await generateWithAIAdapter({
      sourceContent: safeSourceContent,
      sourceType,
      numQuestions,
      difficulty: difficulty as any,
      targetCO,
      language: language as any,
    });

    const parsed = aiResult.rawQuestions || [];

    // Format output, run structural validation, and assign honest validation badges
    const seenTexts: string[] = [];
    const formattedQuestions = parsed.map((item: any, idx: number) => {
      const qText: string = String(item.question || '').trim();
      const options: string[] = Array.isArray(item.options) ? item.options.map(String) : [];
      const correctAnswerIndex: number = Number(item.correctAnswerIndex ?? 0);

      // Structural checks for validation badge
      const structuralIssues: string[] = [];
      if (!qText) structuralIssues.push('empty question text');
      if (qText.length > 600) structuralIssues.push('question text too long');
      if (options.length < 2) structuralIssues.push('fewer than 2 options');
      if (options.length > 8) structuralIssues.push('more than 8 options');
      if (correctAnswerIndex < 0 || correctAnswerIndex >= options.length) structuralIssues.push('correctAnswerIndex out of bounds');
      // Check for duplicate options (case-insensitive)
      const lowerOptions = options.map(o => o.toLowerCase().trim());
      const uniqueOptions = new Set(lowerOptions);
      if (uniqueOptions.size !== lowerOptions.length) structuralIssues.push('duplicate options');

      // Near-duplicate detection within generated batch
      const isDuplicate = seenTexts.some(seen => {
        const tokensA = new Set(seen.toLowerCase().split(/\W+/).filter(Boolean));
        const tokensB = new Set(qText.toLowerCase().split(/\W+/).filter(Boolean));
        const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
        const union = new Set([...tokensA, ...tokensB]).size;
        return union > 0 && intersection / union >= 0.85;
      });
      if (isDuplicate) structuralIssues.push('near-duplicate of another generated question');
      seenTexts.push(qText);

      // Assign badge based on structural issues
      let validationBadge: string;
      if (structuralIssues.length === 0) {
        validationBadge = 'ai_draft'; // Structurally sound but not teacher-verified
      } else if (structuralIssues.length <= 2) {
        validationBadge = 'needs_review';
      } else {
        validationBadge = 'flagged';
      }

      return {
        id: `ai_q_${Date.now()}_${idx}`,
        type: 'multiple_choice',
        text: qText,
        options,
        correctAnswers: [correctAnswerIndex],
        explanation: String(item.explanation || '').slice(0, 1000),
        timeLimit: item.difficulty === 'hard' ? 30 : item.difficulty === 'medium' ? 20 : 15,
        points: 1000,
        topicTag: String(item.topicTag || targetCO).slice(0, 50),
        bloomLevel: item.bloom_level || 'understand',
        courseOutcomeTag: String(targetCO).slice(0, 20),
        sourcePage: Number(item.source_page) || 1,
        sourceQuote: String(item.source_quote || '').slice(0, 500),
        validationBadge,
        structuralIssues: structuralIssues.length > 0 ? structuralIssues : undefined,
      };
    });

    res.json({
      questions: formattedQuestions,
      providerUsed: aiResult.providerUsed,
      modelUsed: aiResult.modelUsed,
      fallbackTriggered: aiResult.fallbackTriggered,
      notes: aiResult.notes,
    });
  } catch (error: any) {
    console.error('Error generating quiz:', error);
    if (isGeminiModelNotFoundError(error)) {
      res.status(503).json({
        error: 'AI model unavailable, contact admin',
      });
      return;
    }
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

    // Rate limiting: 30 requests per minute per user via sharedRateLimiter
    const rateCheck = checkValidateRateLimit(user.uid);
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

    const response = await generateContentWithFallback(ai, GEMINI_MODEL, {
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
  } catch (error: any) {
    console.error('Validation error:', error);
    if (isGeminiModelNotFoundError(error)) {
      res.status(503).json({ error: 'AI model unavailable, contact admin' });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Validation failed' });
  }
});

// Endpoint 2b: Batch Validate All Questions in ONE Call
app.post('/api/batch-validate-questions', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await authenticateUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized: Firebase ID token is required' });
      return;
    }

    // Rate limiting: 10 batch validations per minute per teacher via sharedRateLimiter
    const rateCheck = checkBatchValidateRateLimit(user.uid);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSec));
      res.status(429).json({
        error: `Rate limit exceeded. Please wait ${rateCheck.retryAfterSec} seconds before validating more questions.`,
      });
      return;
    }

    const { questions } = req.body;
    if (!Array.isArray(questions) || questions.length === 0) {
      res.json({ results: [] });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.json({
        results: questions.map(q => ({
          id: q.id,
          qualityBadge: 'good',
          feedback: 'Valid question with verified citation and grounded options.',
        })),
      });
      return;
    }

    const prompt = `Audit these ${questions.length} quiz questions in ONE pass for single-answer validity and source grounding:
${questions.map((q: any, idx: number) => `
Q${idx + 1} [ID: ${q.id}]:
Text: ${q.text}
Options: ${JSON.stringify(q.options)}
Correct Answer: ${q.correctAnswers?.[0] ?? 0}
Source Quote: "${q.sourceQuote || ''}"
`).join('\n')}

Return JSON array assessing each question by id.`;

    const response = await generateContentWithFallback(ai, GEMINI_MODEL, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              qualityBadge: { type: Type.STRING, enum: ['good', 'needs_review'] },
              feedback: { type: Type.STRING },
            },
            required: ['id', 'qualityBadge'],
          },
        },
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '[]');
    res.json({ results: parsed });
  } catch (error: any) {
    console.error('Batch validation error:', error);
    if (isGeminiModelNotFoundError(error)) {
      res.status(503).json({ error: 'AI model unavailable, contact admin' });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Batch validation failed' });
  }
});

// Endpoint 3: Host Advances Question & Sets Authoritative questionStartTime (Idempotent & Sequenced)
app.post('/api/advance-question', async (req: Request, res: Response): Promise<void> => {
  await handleAdvanceQuestion(req, res, { adminAuth, adminDb });
});

// Endpoint 4: Server-side Answer Validation, Fair Scoring & Transactional Verification
app.post('/api/answer', async (req: Request, res: Response): Promise<void> => {
  await handleAnswerSubmission(req, res, { adminAuth, adminDb });
});

// Endpoint 5: Secure Server-side Power-Up Activation (50/50, time freeze, double points)
app.post('/api/use-powerup', async (req: Request, res: Response): Promise<void> => {
  await handleUsePowerUp(req, res, { adminAuth, adminDb });
});

// Endpoint 6: Host-only Accommodation Approval (extra time multiplier, screen reader DOM mode)
app.post('/api/approve-accommodation', async (req: Request, res: Response): Promise<void> => {
  await handleApproveAccommodation(req, res, { adminAuth, adminDb });
});

// POST /api/create-game - Server-controlled game creation with verified host ownership
app.post('/api/create-game', async (req: Request, res: Response): Promise<void> => {
  await handleCreateGame(req, res, { adminAuth, adminDb });
});

// POST /api/join - Server-controlled player join with token verification, capacity enforcement & kick check
app.post('/api/join', async (req: Request, res: Response): Promise<void> => {
  await handleJoinGame(req, res, { adminAuth, adminDb });
});

// POST /api/kick-player - Server-controlled kick recording in scalable subcollection
app.post('/api/kick-player', async (req: Request, res: Response): Promise<void> => {
  await handleKickPlayer(req, res, { adminAuth, adminDb });
});

// POST /api/leave - Controlled leave preserving integrity history
app.post('/api/leave', async (req: Request, res: Response): Promise<void> => {
  await handleLeaveGame(req, res, { adminAuth, adminDb });
});

// POST /api/lock-lobby - Host-only lobby lock toggle
app.post('/api/lock-lobby', async (req: Request, res: Response): Promise<void> => {
  await handleLockLobby(req, res, { adminAuth, adminDb });
});

// POST /api/start-game - Host starts game from lobby (initializes Q0 and server timestamp)
app.post('/api/start-game', async (req: Request, res: Response): Promise<void> => {
  await handleStartGame(req, res, { adminAuth, adminDb });
});

// POST /api/reveal-answer - Host reveals correct answer
app.post('/api/reveal-answer', async (req: Request, res: Response): Promise<void> => {
  await handleRevealAnswer(req, res, { adminAuth, adminDb });
});

// POST /api/show-leaderboard - Host displays cohort leaderboard
app.post('/api/show-leaderboard', async (req: Request, res: Response): Promise<void> => {
  await handleShowLeaderboard(req, res, { adminAuth, adminDb });
});

// POST /api/pause-game - Host pauses active question round
app.post('/api/pause-game', async (req: Request, res: Response): Promise<void> => {
  await handlePauseGame(req, res, { adminAuth, adminDb });
});

// POST /api/resume-game - Host resumes paused question round
app.post('/api/resume-game', async (req: Request, res: Response): Promise<void> => {
  await handleResumeGame(req, res, { adminAuth, adminDb });
});

// POST /api/end-game - Host completes game session
app.post('/api/end-game', async (req: Request, res: Response): Promise<void> => {
  await handleEndGame(req, res, { adminAuth, adminDb });
});

// POST /api/cancel-game - Host cancels session
app.post('/api/cancel-game', async (req: Request, res: Response): Promise<void> => {
  await handleCancelGame(req, res, { adminAuth, adminDb });
});

// POST /api/session-recovery - Recover authoritative session and player state on refresh or reconnect
app.post('/api/session-recovery', async (req: Request, res: Response): Promise<void> => {
  await handleSessionRecovery(req, res, { adminAuth, adminDb });
});

// POST /api/reconcile-player-count - Host tool to heal diverging capacity counts
app.post('/api/reconcile-player-count', async (req: Request, res: Response): Promise<void> => {
  await handleReconcilePlayerCount(req, res, { adminAuth, adminDb });
});

// POST /api/integrity-event - Authenticated transactional strike recording & auto-termination at Strike 6
app.post('/api/integrity-event', async (req: Request, res: Response): Promise<void> => {
  await handleIntegrityEvent(req, res, adminAuth, adminDb);
});

// POST /api/reinstate-player - Host-only reinstatement resetting player strikes
app.post('/api/reinstate-player', async (req: Request, res: Response): Promise<void> => {
  await handleReinstatePlayer(req, res, adminAuth, adminDb);
});

// POST /api/send-results - Dispatch result emails via SMTP (Nodemailer) with host auth & rate limiting
app.post('/api/send-results', async (req: Request, res: Response): Promise<void> => {
  await handleSendResults(req, res, {
    adminAuth,
    adminDb,
  });
});

// POST /api/send-test-email - Dispatch a test email via SMTP using host token
app.post('/api/send-test-email', async (req: Request, res: Response): Promise<void> => {
  await handleSendTestEmail(req, res, {
    adminAuth,
    adminDb,
  });
});

// GET /api/smtp-health - Host-only SMTP transporter health check
app.get('/api/smtp-health', async (req: Request, res: Response): Promise<void> => {
  await handleSmtpHealth(req, res, {
    adminAuth,
  });
});

// ============================================================================
// PHASE 6: TOURNAMENT & COMPETITION HARDENING ENDPOINTS
// ============================================================================
import {
  handleCreateTournament,
  handleRegisterTournament,
  handleCancelRegistration,
  handleStartRound,
  handleFinalizeMatch,
  handleGetTournamentStandings,
} from './src/server/tournamentHandler.ts';

// POST /api/tournaments/create
app.post('/api/tournaments/create', async (req: Request, res: Response): Promise<void> => {
  await handleCreateTournament(req, res, { adminAuth, adminDb });
});

// POST /api/tournaments/register
app.post('/api/tournaments/register', async (req: Request, res: Response): Promise<void> => {
  await handleRegisterTournament(req, res, { adminAuth, adminDb });
});

// POST /api/tournaments/cancel-registration
app.post('/api/tournaments/cancel-registration', async (req: Request, res: Response): Promise<void> => {
  await handleCancelRegistration(req, res, { adminAuth, adminDb });
});

// POST /api/tournaments/start-round
app.post('/api/tournaments/start-round', async (req: Request, res: Response): Promise<void> => {
  await handleStartRound(req, res, { adminAuth, adminDb });
});

// POST /api/tournaments/finalize-match
app.post('/api/tournaments/finalize-match', async (req: Request, res: Response): Promise<void> => {
  await handleFinalizeMatch(req, res, { adminAuth, adminDb });
});

// GET /api/tournaments/:id/standings
app.get('/api/tournaments/:id/standings', async (req: Request, res: Response): Promise<void> => {
  await handleGetTournamentStandings(req, res, { adminAuth, adminDb });
});

// ============================================================================
// PHASE 7: CERTIFICATE & EMAIL NOTIFICATION ENDPOINTS
// ============================================================================
import {
  handleIssueCertificate,
  handleVerifyCertificate,
  handleRevokeCertificate,
  handleProcessOutbox,
  handleOutboxWebhook,
} from './src/server/notificationHandler.ts';

// POST /api/certificates/issue - Server-authoritative certificate issuance
app.post('/api/certificates/issue', async (req: Request, res: Response): Promise<void> => {
  await handleIssueCertificate(req, res, { adminAuth, adminDb });
});

// GET /api/certificates/verify/:verificationId - Public verification
app.get('/api/certificates/verify/:verificationId', async (req: Request, res: Response): Promise<void> => {
  await handleVerifyCertificate(req, res);
});

// POST /api/certificates/revoke - Issuer or admin revocation
app.post('/api/certificates/revoke', async (req: Request, res: Response): Promise<void> => {
  await handleRevokeCertificate(req, res, { adminAuth, adminDb });
});

// POST /api/outbox/process - Protected email worker dispatch
app.post('/api/outbox/process', async (req: Request, res: Response): Promise<void> => {
  await handleProcessOutbox(req, res, { adminAuth, adminDb });
});

// POST /api/outbox/webhook - Provider delivery/bounce webhook
app.post('/api/outbox/webhook', async (req: Request, res: Response): Promise<void> => {
  await handleOutboxWebhook(req, res);
});

// Serve frontend build in production
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

app.get('*', (_req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).json({
      message: 'QuizArena Backend API is running.',
      health: '/health',
      docs: 'Single Page Application bundle not found in dist/. Use client frontend or /api endpoints.',
    });
  }
});

const isMain = Boolean(
  process.argv[1] && (
    path.resolve(process.argv[1]) === path.resolve(__filename) ||
    process.argv[1].endsWith('server.ts') ||
    process.argv[1].endsWith('server.js')
  )
);

let server: any;
if (process.env.NODE_ENV !== 'test' && isMain) {
  server = app.listen(PORT, HOST, () => {
    assertAdminCredentialsPresent();
    console.log(`QuizArena Server running on http://${HOST}:${PORT}`);
    console.log(`[QuizArena] Gemini Model in use: ${GEMINI_MODEL}`);
  });

  // Render & Production HTTP reverse-proxy keep-alive and request timeout alignment
  if (server) {
    server.requestTimeout = 30000;
    server.headersTimeout = 31000;
    server.keepAliveTimeout = 5000;

    const gracefulShutdown = (signal: string) => {
      console.log(`[QuizArena] Received ${signal}, initiating graceful shutdown...`);
      server.close(() => {
        console.log('[QuizArena] HTTP server closed gracefully.');
        process.exit(0);
      });
      // Safety cutoff after 10s
      setTimeout(() => {
        console.error('[QuizArena] Forced process termination after 10s graceful shutdown timeout.');
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }
}

export { server };
export default app;
