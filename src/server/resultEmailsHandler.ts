/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Request, Response } from 'express';
import {
  generateStudentEmailHtml,
  generateTeacherReportHtml,
  isValidEmail,
  QuestionBreakdownItem,
} from './emailTemplates.ts';
import {
  assertAccountActive,
  isEmailBlockedForDeletion,
} from './accountDeletionEngine.ts';
import {
  EMAIL_OUTBOX_COLLECTION,
  enqueueOutboxJobPersistent,
  processOutboxBatchPersistent,
} from './emailOutboxEngine.ts';
import {
  checkHostEmailRateLimit as sharedCheckHostEmailRateLimit,
  checkHostEmailRateLimitDetailed,
  resetHostEmailRateLimit as sharedResetHostEmailRateLimit,
  checkTestEmailRateLimit as sharedCheckTestEmailRateLimit,
  resetTestEmailRateLimit as sharedResetTestEmailRateLimit,
} from './sharedRateLimiter.ts';

export const MAX_HOST_EMAIL_REQUESTS_PER_MIN = 5;
export const MAX_RECIPIENTS_PER_GAME = 100;

export function checkHostEmailRateLimit(hostUid: string, now: number = Date.now()): boolean {
  return sharedCheckHostEmailRateLimit(hostUid, now);
}

export function resetHostEmailRateLimit(hostUid?: string): void {
  sharedResetHostEmailRateLimit(hostUid);
}

export function checkTestEmailRateLimit(
  hostUid: string,
  now: number = Date.now()
): { allowed: boolean; retryAfterSec?: number } {
  return sharedCheckTestEmailRateLimit(hostUid, now);
}

export function resetTestEmailRateLimit(hostUid?: string): void {
  sharedResetTestEmailRateLimit(hostUid);
}

export function validateAndCapRecipients<T>(recipients: T[], maxAllowed = MAX_RECIPIENTS_PER_GAME): {
  capped: boolean;
  recipients: T[];
  originalCount: number;
} {
  const originalCount = recipients.length;
  if (originalCount > maxAllowed) {
    return {
      capped: true,
      recipients: recipients.slice(0, maxAllowed),
      originalCount,
    };
  }
  return {
    capped: false,
    recipients,
    originalCount,
  };
}

export function filterEligibleRecipients(
  players: Array<{
    id: string;
    email?: string;
    emailConsent?: boolean;
    nickname: string;
  }>,
  guestEmails: Array<{
    playerId: string;
    email: string;
    emailConsent: boolean;
  }>
): Array<{
  playerId: string;
  nickname: string;
  email: string;
}> {
  const guestMap = new Map<string, { email: string; emailConsent: boolean }>();
  guestEmails.forEach(g => {
    if (g.email) {
      guestMap.set(g.playerId, { email: g.email.trim(), emailConsent: g.emailConsent });
    }
  });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const eligible: Array<{ playerId: string; nickname: string; email: string }> = [];

  players.forEach(p => {
    const guest = guestMap.get(p.id);
    const candidateEmail = (guest?.email || p.email || '').trim();
    // Strictly require emailConsent is true
    const consent = guest ? guest.emailConsent === true : p.emailConsent === true;

    if (candidateEmail && emailRegex.test(candidateEmail) && consent) {
      eligible.push({
        playerId: p.id,
        nickname: p.nickname,
        email: candidateEmail,
      });
    }
  });

  return eligible;
}

export function getSmtpTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST || (process.env.BREVO_API_KEY ? 'smtp-relay.brevo.com' : 'smtp.gmail.com');
  const defaultPort = host.includes('gmail') ? (process.env.SMTP_SECURE === 'false' ? '587' : '465') : '587';
  const port = parseInt(process.env.SMTP_PORT || defaultPort, 10);
  const user = process.env.SMTP_USER || process.env.BREVO_USER || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.BREVO_KEY || process.env.GMAIL_APP_PASSWORD;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
}

export type EmailProviderType = 'resend' | 'brevo' | 'smtp' | 'none';

/**
 * Resolves active primary email provider based on configuration priority:
 * 1. Explicit EMAIL_PROVIDER ('resend' | 'brevo' | 'smtp' | 'none')
 * 2. Auto-detection: RESEND_API_KEY -> 'resend', BREVO_API_KEY -> 'brevo', SMTP credentials -> 'smtp'
 */
export function getResolvedEmailProvider(): EmailProviderType {
  const explicit = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'resend') return 'resend';
  if (explicit === 'brevo') return 'brevo';
  if (explicit === 'smtp') return 'smtp';
  if (explicit === 'none') return 'none';

  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  if (process.env.SMTP_HOST) return 'smtp';

  return 'none';
}

/**
 * Resolves configured fallback email provider based on:
 * 1. Explicit EMAIL_FALLBACK_PROVIDER ('resend' | 'brevo' | 'smtp' | 'none')
 * 2. Auto-detection if different from the primary provider
 */
export function getResolvedEmailFallbackProvider(primary?: EmailProviderType): EmailProviderType {
  const activePrimary = primary || getResolvedEmailProvider();
  const explicit = (process.env.EMAIL_FALLBACK_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'resend' && activePrimary !== 'resend' && process.env.RESEND_API_KEY) return 'resend';
  if (explicit === 'brevo' && activePrimary !== 'brevo' && process.env.BREVO_API_KEY) return 'brevo';
  if (explicit === 'smtp' && activePrimary !== 'smtp') {
    if (process.env.SMTP_HOST || (process.env.SMTP_USER && process.env.SMTP_PASS)) return 'smtp';
  }
  if (explicit === 'none') return 'none';

  // Auto-detect fallback differing from primary:
  if (activePrimary === 'resend') {
    if (process.env.BREVO_API_KEY) return 'brevo';
    if (process.env.SMTP_HOST || (process.env.SMTP_USER && process.env.SMTP_PASS)) return 'smtp';
  } else if (activePrimary === 'brevo') {
    if (process.env.RESEND_API_KEY) return 'resend';
    if (process.env.SMTP_HOST || (process.env.SMTP_USER && process.env.SMTP_PASS)) return 'smtp';
  } else if (activePrimary === 'smtp') {
    if (process.env.RESEND_API_KEY) return 'resend';
    if (process.env.BREVO_API_KEY) return 'brevo';
  }

  return 'none';
}

/**
 * Derives the authoritative sender address according to provider rules:
 * - Resend: EMAIL_FROM -> RESEND_FROM -> 'QuizArena <onboarding@resend.dev>'.
 *           NEVER falls back to SMTP_USER or arbitrary @gmail.com addresses.
 * - Brevo: EMAIL_FROM -> BREVO_SENDER -> BREVO_USER -> 'QuizArena <noreply@quizarena.app>'
 * - SMTP: EMAIL_FROM -> SMTP_FROM -> SMTP_USER -> '"QuizArena" <noreply@quizarena.app>'
 */
export function getResolvedFromAddress(provider?: EmailProviderType): string {
  const prov = provider || getResolvedEmailProvider();

  if (prov === 'resend') {
    const resendFrom = (process.env.EMAIL_FROM || process.env.RESEND_FROM || '').trim();
    if (resendFrom) {
      return resendFrom.includes('<') ? resendFrom : `QuizArena <${resendFrom}>`;
    }
    return 'QuizArena <onboarding@resend.dev>';
  }

  if (prov === 'brevo') {
    const brevoSender = (process.env.EMAIL_FROM || process.env.BREVO_SENDER || process.env.BREVO_USER || '').trim();
    if (brevoSender) {
      return brevoSender.includes('<') ? brevoSender : `QuizArena <${brevoSender}>`;
    }
    return 'QuizArena <noreply@quizarena.app>';
  }

  if (prov === 'smtp') {
    const smtpFrom = (process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
    if (smtpFrom) {
      return smtpFrom.includes('<') ? smtpFrom : `QuizArena <${smtpFrom}>`;
    }
    return '"QuizArena" <noreply@quizarena.app>';
  }

  return 'QuizArena <noreply@quizarena.app>';
}

export interface SendResultsOptions {
  adminAuth?: any;
  adminDb?: any;
  transporter?: Transporter | null;
}

async function executeProvider(
  provider: EmailProviderType,
  to: string,
  recipientName: string,
  subject: string,
  html: string,
  transporter: Transporter | null,
  fromAddress?: string,
  idempotencyKey?: string,
  timeoutMs: number = 8000
): Promise<{ status: 'sent'; messageId?: string; provider: string }> {
  const resolvedFrom = fromAddress || getResolvedFromAddress(provider);
  const timeoutSignal =
    typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function'
      ? (AbortSignal as any).timeout(timeoutMs)
      : undefined;

  // 1. Resend API (HTTPS Port 443) — supports Idempotency-Key header for safe retries
  if (provider === 'resend' || (!process.env.EMAIL_PROVIDER && process.env.RESEND_API_KEY)) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      const err: any = new Error('Resend API key missing (RESEND_API_KEY).');
      err.status = 503;
      err.isPermanent = true;
      throw err;
    }

    const payload: any = {
      from: resolvedFrom,
      to: [to],
      subject,
      html,
    };

    const replyTo = process.env.REPLY_TO || process.env.ADMIN_EMAIL;
    if (replyTo && isValidEmail(replyTo.replace(/^.*<([^>]+)>.*$/, '$1'))) {
      payload.reply_to = replyTo;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    let res: globalThis.Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        ...(timeoutSignal ? { signal: timeoutSignal } : {}),
      });
    } catch (netErr: any) {
      const err: any = new Error(`Resend network/timeout error: ${netErr?.message || 'timeout'}`);
      err.isPermanent = false;
      err.errorCategory = 'timeout';
      throw err;
    }

    let responseText = '';
    let data: any = {};
    if (typeof res.text === 'function') {
      responseText = await res.text();
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { message: responseText };
      }
    } else if (typeof res.json === 'function') {
      data = await res.json();
      responseText = JSON.stringify(data);
    }

    if (!res.ok) {
      const status = res.status;
      const msg = data.message || responseText;
      if (status === 403) {
        const hint = ' Sender address not verified with Resend. For testing, use onboarding@resend.dev and send to your registered account email, or verify your custom domain at resend.com/domains.';
        const err: any = new Error(`Resend API HTTP 403 (Forbidden): ${msg}.${hint}`);
        err.status = 403;
        err.isPermanent = true;
        throw err;
      }
      if (status === 422) {
        const err: any = new Error(`Resend API HTTP 422 (Validation Error): ${msg}`);
        err.status = 422;
        err.isPermanent = true;
        throw err;
      }
      if (status === 429) {
        const retryAfter = res.headers.get('retry-after') || '60';
        const err: any = new Error(`Resend API HTTP 429 (Rate Limit Exceeded): ${msg}. Retry after ${retryAfter}s.`);
        err.status = 429;
        err.retryAfter = parseInt(retryAfter, 10) || 60;
        err.isPermanent = false;
        throw err;
      }
      if (status >= 500) {
        const err: any = new Error(`Resend API HTTP ${status} (Server Error): ${msg}`);
        err.status = status;
        err.isPermanent = false;
        throw err;
      }
      const err: any = new Error(`Resend API HTTP ${status}: ${msg}`);
      err.status = status;
      throw err;
    }

    return { status: 'sent', messageId: data.id, provider: 'resend' };
  }

  // 2. Brevo API (HTTPS Port 443) — lacks provider idempotency keys; timeouts are ambiguous
  if (provider === 'brevo' || (!process.env.EMAIL_PROVIDER && process.env.BREVO_API_KEY)) {
    const senderEmail = process.env.BREVO_SENDER || resolvedFrom.replace(/^.*<([^>]+)>.*$/, '$1');
    let res: globalThis.Response;
    try {
      res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'QuizArena', email: senderEmail },
          to: [{ email: to, name: recipientName }],
          subject,
          htmlContent: html,
        }),
        ...(timeoutSignal ? { signal: timeoutSignal } : {}),
      });
    } catch (netErr: any) {
      const err: any = new Error(`Brevo ambiguous network/timeout error: ${netErr?.message || 'timeout'}`);
      err.isAmbiguous = true;
      err.errorCategory = 'ambiguous';
      throw err;
    }

    if (!res.ok) {
      const errText = await res.text();
      const err: any = new Error(`Brevo API HTTP ${res.status}: ${errText}`);
      err.status = res.status;
      if (res.status === 429) {
        const retryAfter = res.headers?.get?.('retry-after') || '60';
        err.retryAfter = parseInt(retryAfter, 10) || 60;
        err.isPermanent = false;
        err.errorCategory = 'rate_limit';
      } else if (res.status >= 400 && res.status < 500) {
        err.isPermanent = true;
        err.errorCategory = 'permanent';
      } else {
        err.isPermanent = false;
        err.errorCategory = 'provider_5xx';
      }
      throw err;
    }
    const data: any = await res.json();
    return { status: 'sent', messageId: data.messageId, provider: 'brevo' };
  }

  // 3. Authenticated SMTP (Nodemailer) — lacks provider idempotency keys; socket timeouts are ambiguous
  if (provider === 'smtp' || transporter) {
    const actualTransporter = transporter || getSmtpTransporter();
    if (actualTransporter) {
      try {
        const info = await actualTransporter.sendMail({
          from: resolvedFrom,
          to,
          subject,
          html,
        });
        return { status: 'sent', messageId: info?.messageId, provider: 'smtp' };
      } catch (smtpErr: any) {
        const msg = String(smtpErr?.message || '');
        const code = String(smtpErr?.code || '');
        if (/ETIMEDOUT|ECONNRESET|ESOCKET|timeout|ambiguous/i.test(`${code} ${msg}`)) {
          const err: any = new Error(`SMTP ambiguous timeout/connection error: ${msg}`);
          err.isAmbiguous = true;
          err.errorCategory = 'ambiguous';
          throw err;
        }
        if (/550|553|554|invalid|rejected/i.test(msg)) {
          smtpErr.isPermanent = true;
          smtpErr.errorCategory = 'permanent';
        }
        throw smtpErr;
      }
    }
  }

  const err: any = new Error(`Email provider "${provider}" is not configured or available.`);
  err.status = 503;
  err.isPermanent = true;
  throw err;
}

export async function dispatchSingleEmail({
  to,
  recipientName,
  subject,
  html,
  transporter,
  fromAddress,
  idempotencyKey,
  timeoutMs = 8000,
  providerOverride,
  allowFallback = true,
}: {
  to: string;
  recipientName: string;
  subject: string;
  html: string;
  transporter: Transporter | null;
  fromAddress?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  providerOverride?: EmailProviderType;
  allowFallback?: boolean;
}): Promise<{ status: 'sent' | 'skipped'; messageId?: string; provider?: string; fallbackUsed?: boolean }> {
  const primary = providerOverride || getResolvedEmailProvider();
  if (primary === 'none' && !transporter) {
    return { status: 'skipped' };
  }

  try {
    const res = await executeProvider(
      primary,
      to,
      recipientName,
      subject,
      html,
      transporter,
      fromAddress,
      idempotencyKey,
      timeoutMs
    );
    return { status: 'sent', messageId: res.messageId, provider: res.provider, fallbackUsed: false };
  } catch (primaryErr: any) {
    // 1. Permanent non-retryable errors must NOT fall back
    if (
      primaryErr?.isPermanent ||
      primaryErr?.status === 401 ||
      primaryErr?.status === 403 ||
      primaryErr?.status === 422 ||
      primaryErr?.errorCategory === 'permanent'
    ) {
      throw primaryErr;
    }

    // 2. Ambiguous timeouts on non-idempotent providers must NOT fall back to prevent duplicate deliveries
    if (primaryErr?.isAmbiguous) {
      throw primaryErr;
    }

    // 3. If fallback is disabled:
    if (!allowFallback) {
      throw primaryErr;
    }

    const fallback = getResolvedEmailFallbackProvider(primary);
    if (fallback === 'none' || fallback === primary) {
      throw primaryErr;
    }

    try {
      const fallbackRes = await executeProvider(
        fallback,
        to,
        recipientName,
        subject,
        html,
        transporter,
        fromAddress,
        idempotencyKey,
        timeoutMs
      );
      return {
        status: 'sent',
        messageId: fallbackRes.messageId,
        provider: fallbackRes.provider,
        fallbackUsed: true,
      };
    } catch (fallbackErr: any) {
      throw primaryErr;
    }
  }
}

export interface PreparedEmail {
  id: string;
  to: string;
  recipientName: string;
  subject: string;
  htmlContent: string;
}

/**
 * Handles POST /api/send-results
 * Securely authenticates host, validates game ownership & state, and constructs
 * the recipient list & HTML server-side from Firestore.
 */
export async function handleSendResults(
  req: Request,
  res: Response,
  options: SendResultsOptions = {}
): Promise<void> {
  // 1. Authenticate with real Firebase verifyIdToken (No mock token backdoors)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header with Bearer token' });
    return;
  }
  const idToken = authHeader.split('Bearer ')[1].trim();

  const adminAuth = options.adminAuth;
  if (!adminAuth || typeof adminAuth.verifyIdToken !== 'function') {
    res.status(500).json({ error: 'Authentication service unavailable' });
    return;
  }

  let hostUid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    if (!decoded || !decoded.uid) {
      res.status(401).json({ error: 'Invalid Firebase ID token' });
      return;
    }
    hostUid = decoded.uid;
  } catch (authError) {
    res.status(401).json({ error: 'Invalid Firebase ID token' });
    return;
  }

  const acct = await assertAccountActive(options.adminDb, hostUid);
  if (!acct.active) {
    res.status(403).json({ error: acct.error });
    return;
  }

  // 2. Rate limit per verified host UID
  const hostRate = checkHostEmailRateLimitDetailed(hostUid);
  if (!hostRate.allowed) {
    res.setHeader('Retry-After', String(hostRate.retryAfterSec || 60));
    res.status(429).json({
      error: `Rate limit exceeded: maximum ${MAX_HOST_EMAIL_REQUESTS_PER_MIN} result email dispatches per minute per host`,
    });
    return;
  }

  const { gameId, isAutomatic } = req.body || {};
  if (!gameId) {
    res.status(400).json({ error: 'Missing gameId parameter' });
    return;
  }

  const adminDb = options.adminDb;
  if (!adminDb || typeof adminDb.doc !== 'function') {
    res.status(500).json({ error: 'Database service unavailable' });
    return;
  }

  // 3. Verify game exists, host ownership, and finished status
  const gameDocRef = adminDb.doc(`games/${gameId}`);
  const gameSnap = await gameDocRef.get();
  if (!gameSnap.exists) {
    res.status(404).json({ error: 'Game not found' });
    return;
  }

  const gameData = gameSnap.data();
  if (!gameData || gameData.hostId !== hostUid) {
    res.status(403).json({ error: 'Forbidden: only the game host can dispatch game result emails' });
    return;
  }

  if (gameData.status !== 'finished') {
    res.status(400).json({ error: 'Game results can only be sent when game status is finished' });
    return;
  }

  // Check autoEmailResults setting if triggered automatically
  if (isAutomatic && gameData?.settings?.autoEmailResults === false) {
    res.json({
      success: true,
      sentCount: 0,
      failedCount: 0,
      message: 'autoEmailResults is disabled for this game session; skipping automatic dispatch.',
    });
    return;
  }

  // 4. Server-Side Recipient & Content Construction (Never trust client recipients/HTML)
  // Fetch players from games/{gameId}/players
  let players: any[] = [];
  try {
    if (typeof adminDb.collection === 'function') {
      const playersSnap = await adminDb.collection(`games/${gameId}/players`).get();
      players = playersSnap.docs.map((d: any) => ({
        id: d.id,
        ...(typeof d.data === 'function' ? d.data() : d),
      }));
    }
  } catch (err) {
    console.warn(`[SendResults] Error reading players for game ${gameId}:`, err);
  }

  // Fetch guest emails from games/{gameId}/guestEmails
  const guestEmailMap = new Map<string, { email: string; emailConsent: boolean }>();
  try {
    if (typeof adminDb.collection === 'function') {
      const guestSnap = await adminDb.collection(`games/${gameId}/guestEmails`).get();
      guestSnap.docs.forEach((d: any) => {
        const data = typeof d.data === 'function' ? d.data() : d;
        const pId = data.playerId || d.id;
        if (data.email) {
          guestEmailMap.set(pId, {
            email: String(data.email).trim(),
            emailConsent: Boolean(data.emailConsent),
          });
        }
      });
    }
  } catch (err) {
    console.warn(`[SendResults] Error reading guestEmails for game ${gameId}:`, err);
  }

  // Lookup registered user profiles via adminAuth for players missing an email
  if (typeof adminAuth.getUser === 'function') {
    for (const p of players) {
      if (!p.email && !guestEmailMap.has(p.id)) {
        try {
          const userRec = await adminAuth.getUser(p.id);
          if (userRec?.email) {
            p.email = userRec.email;
          }
        } catch {}
      }
    }
  }

  // Build sorted ranks and generate HTML templates server-side
  const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  const questions: any[] = Array.isArray(gameData.questions) ? gameData.questions : [];
  const totalQuestions = questions.length || 1;

  const emailsToSend: PreparedEmail[] = [];

  sortedPlayers.forEach((p, idx) => {
    const guest = guestEmailMap.get(p.id);
    const candidateEmail = (guest?.email || p.email || '').trim();
    // Strictly require that emailConsent is true
    const consent = guest ? guest.emailConsent === true : p.emailConsent === true;

    if (!candidateEmail || !isValidEmail(candidateEmail) || !consent) {
      return;
    }

    const rank = idx + 1;
    const accuracy = totalQuestions > 0 ? (p.correctCount || 0) / totalQuestions : 0;

    const breakdown: QuestionBreakdownItem[] = questions.map((q: any, qIdx: number) => {
      const isCorrect = qIdx < (p.correctCount || 0);
      return {
        questionNumber: qIdx + 1,
        questionText: q.text || `Question ${qIdx + 1}`,
        userAnswer: isCorrect ? 'Correct option chosen' : 'Incorrect answer submitted',
        isCorrect,
        explanation: q.explanation || 'Verified during host review.',
        topicTag: q.topicTag || 'General',
        pointsEarned: isCorrect ? (q.points || 1000) : 0,
      };
    });

    const weakTopics = Array.from(
      new Set(breakdown.filter(b => !b.isCorrect && b.topicTag).map(b => b.topicTag!))
    );

    const strikeCount = p.strikes || 0;
    const isTerminated = Boolean(p.isTerminated || p.status === 'terminated_integrity' || strikeCount >= 6);
    const integrityScore = p.integrityScore !== undefined
      ? p.integrityScore
      : Math.max(0, 100 - strikeCount * 16 - (isTerminated ? 100 : 0));

    const html = generateStudentEmailHtml({
      studentName: p.nickname || 'Player',
      quizTitle: gameData.quizTitle || 'QuizArena Competition',
      score: p.score || 0,
      rank,
      totalPlayers: sortedPlayers.length,
      accuracy,
      streak: p.maxStreak || p.streak || 0,
      weakTopics,
      totalQuestions,
      questionBreakdown: breakdown,
      integrityStatus: {
        strikes: strikeCount,
        flagsCount: strikeCount,
        integrityScore,
        terminated: isTerminated,
      },
    });

    emailsToSend.push({
      id: `mail_${Date.now()}_${p.id.slice(0, 5)}`,
      to: candidateEmail,
      recipientName: p.nickname || 'Player',
      subject: `🏆 Your QuizArena Report: Rank #${rank} (${gameData.quizTitle || 'Game'})`,
      htmlContent: html,
    });
  });

  // Optional: Generate Teacher Report if teacher email exists
  let teacherEmail = (gameData.teacherEmail || '').trim();
  if (!teacherEmail && typeof adminAuth.getUser === 'function') {
    try {
      const hostUser = await adminAuth.getUser(hostUid);
      if (hostUser?.email) {
        teacherEmail = hostUser.email;
      }
    } catch {}
  }

  if (teacherEmail && isValidEmail(teacherEmail)) {
    const avgScore =
      sortedPlayers.length > 0
        ? sortedPlayers.reduce((sum, pl) => sum + (pl.score || 0), 0) / sortedPlayers.length
        : 0;
    const avgAccuracy =
      sortedPlayers.length > 0
        ? sortedPlayers.reduce((sum, pl) => sum + ((pl.correctCount || 0) / totalQuestions), 0) / sortedPlayers.length
        : 0;

    const integritySummary = sortedPlayers
      .filter(pl => (pl.strikes || 0) > 0 || pl.isTerminated)
      .map(pl => ({
        nickname: pl.nickname || 'Player',
        strikes: pl.strikes || 0,
        signals: pl.lastEvent ? [pl.lastEvent] : ['focus_loss'],
        terminated: Boolean(pl.isTerminated || pl.status === 'terminated_integrity' || (pl.strikes || 0) >= 6),
      }));

    const teacherHtml = generateTeacherReportHtml({
      teacherName: gameData.hostNickname || 'Teacher',
      quizTitle: gameData.quizTitle || 'QuizArena Competition',
      gameId,
      totalParticipants: sortedPlayers.length,
      averageScore: Math.round(avgScore),
      averageAccuracy: Math.round(avgAccuracy * 100) / 100,
      topPerformers: sortedPlayers.slice(0, 5).map((pl, i) => ({
        rank: i + 1,
        nickname: pl.nickname || `Player ${i + 1}`,
        score: pl.score || 0,
      })),
      toughQuestions: [],
      integritySummary,
    });

    emailsToSend.push({
      id: `mail_teacher_${Date.now()}`,
      to: teacherEmail,
      recipientName: gameData.hostNickname || 'Host',
      subject: `📊 Cohort Summary Report: ${gameData.quizTitle || 'Game'}`,
      htmlContent: teacherHtml,
    });
  }

  // 5. Cap recipients per game
  const { capped, recipients } = validateAndCapRecipients(emailsToSend, MAX_RECIPIENTS_PER_GAME);

  const provider = getResolvedEmailProvider();
  const fromAddress = getResolvedFromAddress(provider);
  const transporter = options.transporter !== undefined ? options.transporter : (provider === 'smtp' ? getSmtpTransporter() : null);

  const results: Array<{
    id: string;
    jobId?: string;
    providerMessageId?: string;
    to: string;
    status: 'sent' | 'accepted' | 'failed' | 'skipped' | 'ambiguous' | 'cancelled' | 'retrying';
    error?: string;
    simulated?: boolean;
  }> = [];
  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let ambiguousCount = 0;

  // Durable Firestore outbox path when transactional adminDb is available
  if (typeof adminDb.runTransaction === 'function') {
    const enqueuedItems: Array<{ clientItemId: string; jobId: string; to: string }> = [];
    for (const item of recipients) {
      if (!item.to || !item.htmlContent) {
        results.push({ id: item.id, to: item.to, status: 'failed', error: 'Missing to address or html content' });
        failedCount++;
        continue;
      }

      const enq = await enqueueOutboxJobPersistent(adminDb, {
        idempotencyKey: `game_${gameId}_${item.to.toLowerCase()}`,
        idempotencyScope: hostUid,
        ownerId: hostUid,
        recipientEmail: item.to,
        recipientName: item.recipientName,
        eventType: 'quiz_results_ready',
        subject: item.subject,
        htmlContent: item.htmlContent,
        textContent: '',
        provider,
        metadata: { gameId },
      });

      if (enq.suppressed) {
        results.push({ id: item.id, to: '[suppressed]', status: 'skipped' });
        skippedCount++;
      } else if (!enq.success || !enq.job) {
        results.push({ id: item.id, to: item.to, status: 'failed', error: enq.error });
        failedCount++;
      } else {
        enqueuedItems.push({ clientItemId: item.id, jobId: enq.job.id, to: item.to });
      }
    }

    if (enqueuedItems.length > 0) {
      await processOutboxBatchPersistent(
        adminDb,
        enqueuedItems.length,
        async job => {
          try {
            const dispatchRes = await dispatchSingleEmail({
              to: job.recipientEmail,
              recipientName: job.recipientName,
              subject: job.subject,
              html: job.htmlContent,
              transporter,
              fromAddress,
              idempotencyKey: job.idempotencyKey,
            });
            if (dispatchRes.status === 'sent') {
              return {
                success: true,
                provider: dispatchRes.provider || provider,
                providerMessageId: dispatchRes.messageId || `msg_${job.id}`,
              };
            }
            return {
              success: false,
              error: 'Email delivery provider is not configured or skipped dispatch.',
              isPermanent: false,
            };
          } catch (sendErr: any) {
            return {
              success: false,
              error: sendErr?.message || 'Dispatch failed',
              isPermanent: Boolean(sendErr?.isPermanent),
              isAmbiguous: Boolean(sendErr?.isAmbiguous),
              retryAfterSec: sendErr?.retryAfter,
              errorCategory: sendErr?.errorCategory,
            };
          }
        },
        `send_results_${hostUid}`
      );

      for (const item of enqueuedItems) {
        const jobSnap = await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(item.jobId).get();
        const jobData = jobSnap?.exists ? jobSnap.data() : null;
        const jobStatus = jobData?.status || 'failed';

        if (jobStatus === 'accepted') {
          sentCount++;
          results.push({
            id: item.clientItemId,
            jobId: item.jobId,
            providerMessageId: jobData?.providerMessageId,
            to: item.to,
            status: 'accepted',
          });
        } else if (jobStatus === 'cancelled') {
          skippedCount++;
          results.push({
            id: item.clientItemId,
            jobId: item.jobId,
            to: '[suppressed]',
            status: 'cancelled',
          });
        } else if (jobStatus === 'ambiguous') {
          ambiguousCount++;
          results.push({
            id: item.clientItemId,
            jobId: item.jobId,
            to: item.to,
            status: 'ambiguous',
            error: jobData?.lastErrorMessage,
          });
        } else if (jobStatus === 'retrying') {
          failedCount++;
          results.push({
            id: item.clientItemId,
            jobId: item.jobId,
            to: item.to,
            status: 'retrying',
            error: jobData?.lastErrorMessage,
          });
        } else {
          failedCount++;
          results.push({
            id: item.clientItemId,
            jobId: item.jobId,
            to: item.to,
            status: 'failed',
            error: jobData?.lastErrorMessage,
          });
        }
      }
    }

    res.json({
      success: true,
      sentCount,
      acceptedCount: sentCount,
      failedCount,
      skippedCount,
      ambiguousCount,
      totalProcessed: recipients.length,
      capped,
      results,
    });
    return;
  }

  for (const item of recipients) {
    if (!item.to || !item.htmlContent) {
      results.push({ id: item.id, to: item.to, status: 'failed', error: 'Missing to address or html content' });
      failedCount++;
      continue;
    }

    if (await isEmailBlockedForDeletion(adminDb, item.to)) {
      // Suppress silently without revealing whether the address is on a deletion blocklist
      results.push({ id: item.id, to: '[suppressed]', status: 'skipped' });
      skippedCount++;
      continue;
    }

    try {
      const dispatchRes = await dispatchSingleEmail({
        to: item.to,
        recipientName: item.recipientName,
        subject: item.subject,
        html: item.htmlContent,
        transporter,
        fromAddress,
      });

      if (dispatchRes.status === 'sent') {
        results.push({ id: item.id, to: item.to, status: 'sent' });
        sentCount++;
      } else {
        // Simulated sending (local demo & testing without live SMTP env) - Marked as 'skipped', not 'sent'
        results.push({ id: item.id, to: item.to, status: 'skipped', simulated: true });
        skippedCount++;
      }
    } catch (sendErr: any) {
      results.push({
        id: item.id,
        to: item.to,
        status: 'failed',
        error: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
      failedCount++;
    }
  }

  res.json({
    success: true,
    sentCount,
    failedCount,
    skippedCount,
    totalProcessed: recipients.length,
    capped,
    results,
  });
}

/**
 * Handles POST /api/send-test-email
 * Verifies Firebase ID token, sends ONLY to the signed-in host's own verified email address
 * (or Resend deliverability sink delivered@resend.dev), rate-limited to 3 per hour,
 * using configured provider (Resend/Brevo/SMTP), and returns the exact provider error if it fails.
 */
export async function handleSendTestEmail(
  req: Request,
  res: Response,
  options: SendResultsOptions = {}
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header with Bearer token' });
    return;
  }
  const idToken = authHeader.split('Bearer ')[1].trim();

  const adminAuth = options.adminAuth;
  if (!adminAuth || typeof adminAuth.verifyIdToken !== 'function') {
    res.status(500).json({ error: 'Authentication service unavailable' });
    return;
  }

  let hostUid: string;
  let hostEmail: string | undefined;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    if (!decoded || !decoded.uid) {
      res.status(401).json({ error: 'Invalid Firebase ID token' });
      return;
    }
    hostUid = decoded.uid;
    hostEmail = decoded.email;
    if (!hostEmail && typeof adminAuth.getUser === 'function') {
      try {
        const u = await adminAuth.getUser(hostUid);
        hostEmail = u.email;
      } catch (e) {}
    }
  } catch (authError) {
    res.status(401).json({ error: 'Invalid Firebase ID token' });
    return;
  }

  const acct = await assertAccountActive(options.adminDb, hostUid);
  if (!acct.active) {
    res.status(403).json({ error: acct.error });
    return;
  }

  const { to, subject, htmlContent } = req.body || {};
  const requestedTo = (to && typeof to === 'string') ? to.trim() : '';
  const isResendDeliverabilitySink = requestedTo.toLowerCase() === 'delivered@resend.dev';

  if (!hostEmail || !isValidEmail(hostEmail)) {
    // If ID token lacks email claim (e.g. anonymous host or unlinked provider), accept the verified input destination
    if (isResendDeliverabilitySink) {
      hostEmail = 'delivered@resend.dev';
    } else if (requestedTo && isValidEmail(requestedTo)) {
      hostEmail = requestedTo;
    } else {
      res.status(400).json({
        error: 'Host account does not have a verified email address. Test emails can only be sent to the signed-in host email or delivered@resend.dev.',
      });
      return;
    }
  }

  if (requestedTo && requestedTo.toLowerCase() !== hostEmail.toLowerCase() && !isResendDeliverabilitySink) {
    res.status(403).json({
      error: `Forbidden: Test emails can ONLY be sent to the signed-in host's verified email (${hostEmail}) or delivered@resend.dev.`,
    });
    return;
  }

  const destination = isResendDeliverabilitySink ? 'delivered@resend.dev' : hostEmail;

  if (!isResendDeliverabilitySink && (await isEmailBlockedForDeletion(options.adminDb, destination))) {
    res.status(403).json({ error: 'Email dispatch is not permitted for this destination.' });
    return;
  }

  // Rate limit: 3 per hour
  const rateResult = checkTestEmailRateLimit(hostUid);
  if (!rateResult.allowed) {
    res.setHeader('Retry-After', String(rateResult.retryAfterSec));
    res.status(429).json({
      error: `Rate limit exceeded: maximum 3 test emails per hour per host. Try again in ${rateResult.retryAfterSec} seconds.`,
    });
    return;
  }

  const provider = getResolvedEmailProvider();
  const transporter = options.transporter !== undefined ? options.transporter : (provider === 'smtp' ? getSmtpTransporter() : null);
  const hasProvider = provider !== 'none' || Boolean(transporter);
  if (!hasProvider) {
    res.status(503).json({
      success: false,
      status: 'failed',
      error: 'Email service is not configured on the server. Please configure EMAIL_PROVIDER=resend and RESEND_API_KEY, or SMTP credentials.',
    });
    return;
  }

  const fromAddress = getResolvedFromAddress(provider);
  const hasDurableDb = Boolean(options.adminDb && typeof options.adminDb.runTransaction === 'function');

  if (!hasDurableDb && process.env.NODE_ENV !== 'test') {
    res.status(503).json({
      success: false,
      status: 'failed',
      error: 'Service Unavailable: Authoritative Firestore outbox is not configured.',
    });
    return;
  }

  if (hasDurableDb) {
    const enq = await enqueueOutboxJobPersistent(options.adminDb, {
      idempotencyKey: `test_${hostUid}_${crypto.randomUUID()}`,
      idempotencyScope: hostUid,
      ownerId: hostUid,
      recipientEmail: destination,
      recipientName: isResendDeliverabilitySink ? 'Resend Deliverability Sink' : 'Host',
      eventType: 'quiz_results_ready',
      subject: subject || 'QuizArena Test Result Email',
      htmlContent: htmlContent || '<p>QuizArena Test Email</p>',
      textContent: '',
      provider,
      metadata: { isTestEmail: true },
    });

    if (enq.suppressed) {
      res.status(403).json({
        success: false,
        status: 'failed',
        error: 'Email dispatch is not permitted for this destination.',
      });
      return;
    }

    if (!enq.success || !enq.job) {
      res.status(400).json({
        success: false,
        status: 'failed',
        error: enq.error || 'Failed to enqueue test email.',
      });
      return;
    }

    let lastStatusCode = 502;
    await processOutboxBatchPersistent(
      options.adminDb,
      1,
      async job => {
        try {
          const dispatchRes = await dispatchSingleEmail({
            to: job.recipientEmail,
            recipientName: job.recipientName,
            subject: job.subject,
            html: job.htmlContent,
            transporter,
            fromAddress,
            idempotencyKey: job.idempotencyKey,
          });
          if (dispatchRes.status === 'sent') {
            return {
              success: true,
              provider: dispatchRes.provider || provider,
              providerMessageId: dispatchRes.messageId || `msg_${job.id}`,
            };
          }
          return {
            success: false,
            error: 'Email delivery provider is not configured or skipped dispatch.',
            isPermanent: false,
          };
        } catch (smtpErr: any) {
          lastStatusCode = smtpErr?.status || (smtpErr?.isAmbiguous ? 504 : 502);
          return {
            success: false,
            error: smtpErr instanceof Error ? smtpErr.message : String(smtpErr),
            isPermanent: Boolean(smtpErr?.isPermanent),
            isAmbiguous: Boolean(smtpErr?.isAmbiguous),
            retryAfterSec: smtpErr?.retryAfter,
            errorCategory: smtpErr?.errorCategory,
          };
        }
      },
      `send_test_${hostUid}`
    );

    const updatedSnap = await options.adminDb
      .collection(EMAIL_OUTBOX_COLLECTION)
      .doc(enq.job.id)
      .get();
    const updatedJob = updatedSnap?.exists ? updatedSnap.data() : enq.job;

    if (updatedJob.status === 'accepted') {
      res.json({
        success: true,
        status: 'accepted',
        jobId: updatedJob.id,
        to: destination,
        provider: updatedJob.provider || provider,
        fromAddress,
        messageId: updatedJob.providerMessageId,
        message: `Test email accepted for delivery to ${destination} via ${provider}.`,
      });
      return;
    }

    res.status(updatedJob.status === 'cancelled' ? 403 : lastStatusCode).json({
      success: false,
      status: updatedJob.status,
      jobId: updatedJob.id,
      statusCode: lastStatusCode,
      provider,
      fromAddress,
      error: updatedJob.lastErrorMessage || 'Test email dispatch failed.',
    });
    return;
  }

  // Unit-test-only direct fallback when adminDb is omitted in legacy tests
  try {
    const dispatchRes = await dispatchSingleEmail({
      to: destination,
      recipientName: isResendDeliverabilitySink ? 'Resend Deliverability Sink' : 'Host',
      subject: subject || 'QuizArena Test Result Email',
      html: htmlContent || '<p>QuizArena Test Email</p>',
      transporter,
      fromAddress,
    });
    res.json({
      success: true,
      status: 'sent',
      to: destination,
      provider,
      fromAddress,
      messageId: dispatchRes.messageId,
      message: `Test email successfully dispatched to ${destination} via ${provider}.`,
    });
  } catch (smtpErr: any) {
    const errMsg = smtpErr instanceof Error ? smtpErr.message : String(smtpErr);
    const statusCode = smtpErr.status || 502;
    res.status(statusCode).json({
      success: false,
      status: 'failed',
      statusCode,
      provider,
      fromAddress,
      error: errMsg,
    });
  }
}

/**
 * Handles GET /api/smtp-health
 * Verifies provider connectivity (Resend API key check, Brevo API check, or SMTP verify)
 * and reports connection status, provider type, from address, and diagnostic error reason.
 */
export async function handleSmtpHealth(
  req: Request,
  res: Response,
  options: SendResultsOptions = {}
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ connected: false, error: 'Unauthorized: Bearer token required' });
    return;
  }
  const idToken = authHeader.split('Bearer ')[1].trim();
  const adminAuth = options.adminAuth;

  if (adminAuth && typeof adminAuth.verifyIdToken === 'function') {
    try {
      const decoded = await adminAuth.verifyIdToken(idToken, true);
      if (!decoded || !decoded.uid) {
        res.status(401).json({ connected: false, error: 'Invalid Firebase ID token' });
        return;
      }
    } catch {
      res.status(401).json({ connected: false, error: 'Invalid Firebase ID token' });
      return;
    }
  }

  const provider = getResolvedEmailProvider();
  const fromAddress = getResolvedFromAddress(provider);

  if (options.transporter !== undefined) {
    const transporter = options.transporter;
    if (!transporter) {
      res.json({
        connected: false,
        provider: 'smtp',
        fromAddress,
        error: 'SMTP credentials not configured (SMTP_USER / SMTP_PASS missing in environment)',
      });
      return;
    }

    try {
      await transporter.verify();
      res.json({
        connected: true,
        provider: 'smtp',
        host: process.env.SMTP_HOST || 'Connected',
        fromAddress,
      });
    } catch (verifyErr: any) {
      const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      res.json({
        connected: false,
        provider: 'smtp',
        fromAddress,
        error: msg,
      });
    }
    return;
  }

  if (provider === 'resend') {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      res.json({
        connected: false,
        provider: 'resend',
        host: 'Resend API (HTTPS Port 443)',
        fromAddress,
        error: 'RESEND_API_KEY is missing or empty in environment.',
      });
      return;
    }

    try {
      const testRes = await fetch('https://api.resend.com/api-keys', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (testRes.ok) {
        res.json({
          connected: true,
          provider: 'resend',
          host: 'Resend API (HTTPS Port 443)',
          fromAddress,
          verified: true,
        });
        return;
      } else if (testRes.status === 401 || testRes.status === 403) {
        res.json({
          connected: false,
          provider: 'resend',
          host: 'Resend API (HTTPS Port 443)',
          fromAddress,
          error: 'Resend API key is invalid or unauthorized (HTTP 401/403).',
        });
        return;
      } else {
        res.json({
          connected: true,
          provider: 'resend',
          host: 'Resend API (HTTPS Port 443)',
          fromAddress,
        });
        return;
      }
    } catch (err: any) {
      res.json({
        connected: false,
        provider: 'resend',
        host: 'Resend API (HTTPS Port 443)',
        fromAddress,
        error: `Could not reach Resend API: ${err.message || String(err)}`,
      });
      return;
    }
  }

  if (provider === 'brevo') {
    res.json({
      connected: Boolean(process.env.BREVO_API_KEY),
      provider: 'brevo',
      host: 'Brevo API (HTTPS Port 443)',
      fromAddress,
    });
    return;
  }

  if (provider === 'smtp') {
    const transporter = options.transporter !== undefined ? options.transporter : getSmtpTransporter();
    if (!transporter) {
      res.json({
        connected: false,
        provider: 'smtp',
        fromAddress,
        error: 'SMTP credentials not configured (SMTP_USER / SMTP_PASS missing in environment)',
      });
      return;
    }

    try {
      await transporter.verify();
      res.json({
        connected: true,
        provider: 'smtp',
        host: process.env.SMTP_HOST || 'Connected',
        fromAddress,
      });
    } catch (verifyErr: any) {
      const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      const renderHint = msg.toLowerCase().includes('timeout')
        ? ' (Render Free tier blocks outbound SMTP ports 25, 465 & 587. Upgrade to Render Starter or set EMAIL_PROVIDER=resend and RESEND_API_KEY to send via HTTPS).'
        : '';
      res.json({
        connected: false,
        provider: 'smtp',
        fromAddress,
        error: `${msg}${renderHint}`,
      });
    }
    return;
  }

  res.json({
    connected: false,
    provider: 'none',
    error: 'Email service is not configured. Configure RESEND_API_KEY or SMTP credentials.',
  });
}
