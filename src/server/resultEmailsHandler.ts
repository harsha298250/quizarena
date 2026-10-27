/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Request, Response } from 'express';
import {
  generateStudentEmailHtml,
  generateTeacherReportHtml,
  isValidEmail,
  QuestionBreakdownItem,
} from './emailTemplates.ts';

export const MAX_HOST_EMAIL_REQUESTS_PER_MIN = 5;
export const MAX_RECIPIENTS_PER_GAME = 100;

// Host rate limiter state: hostUid -> { count, resetAt }
const hostSendEmailRateLimiter = new Map<string, { count: number; resetAt: number }>();

export function checkHostEmailRateLimit(hostUid: string, now: number = Date.now()): boolean {
  const entry = hostSendEmailRateLimiter.get(hostUid);
  if (!entry || now > entry.resetAt) {
    hostSendEmailRateLimiter.set(hostUid, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (entry.count >= MAX_HOST_EMAIL_REQUESTS_PER_MIN) {
    return false;
  }
  entry.count++;
  return true;
}

export function resetHostEmailRateLimit(hostUid?: string): void {
  if (hostUid) {
    hostSendEmailRateLimiter.delete(hostUid);
  } else {
    hostSendEmailRateLimiter.clear();
  }
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
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER || process.env.BREVO_USER;
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
  });
}

export interface SendResultsOptions {
  adminAuth?: any;
  adminDb?: any;
  transporter?: Transporter | null;
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
    const decoded = await adminAuth.verifyIdToken(idToken);
    if (!decoded || !decoded.uid) {
      res.status(401).json({ error: 'Invalid Firebase ID token' });
      return;
    }
    hostUid = decoded.uid;
  } catch (authError) {
    res.status(401).json({ error: 'Invalid Firebase ID token' });
    return;
  }

  // 2. Rate limit per verified host UID
  if (!checkHostEmailRateLimit(hostUid)) {
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

  const transporter = options.transporter !== undefined ? options.transporter : getSmtpTransporter();
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || '"QuizArena" <noreply@quizarena.app>';

  const results: Array<{ id: string; to: string; status: 'sent' | 'failed'; error?: string; simulated?: boolean }> = [];
  let sentCount = 0;
  let failedCount = 0;

  for (const item of recipients) {
    if (!item.to || !item.htmlContent) {
      results.push({ id: item.id, to: item.to, status: 'failed', error: 'Missing to address or html content' });
      failedCount++;
      continue;
    }

    try {
      if (transporter) {
        await transporter.sendMail({
          from: fromAddress,
          to: item.to,
          subject: item.subject,
          html: item.htmlContent,
        });
        results.push({ id: item.id, to: item.to, status: 'sent' });
        sentCount++;
      } else {
        // Simulated sending (local demo & testing without live SMTP env)
        results.push({ id: item.id, to: item.to, status: 'sent', simulated: true });
        sentCount++;
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
    totalProcessed: recipients.length,
    capped,
    results,
  });
}
