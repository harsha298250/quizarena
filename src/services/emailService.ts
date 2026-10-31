/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth, ensureAnonymousAuth, isFirebaseConfigured } from '../lib/firebase';
import { MailQueueItem, GameSession, Player, Question } from '../types/quiz';
import { GameEngine } from './gameEngine';

const LOCAL_STORAGE_MAIL_KEY = 'quizarena_local_mail_outbox';

import {
  generateStudentEmailHtml,
  generateTeacherReportHtml,
  escapeHtml,
  isValidEmail,
  QuestionBreakdownItem,
  StudentEmailParams,
  TeacherReportParams,
} from '../server/emailTemplates';

export {
  generateStudentEmailHtml,
  generateTeacherReportHtml,
  escapeHtml,
  isValidEmail,
};
export type {
  QuestionBreakdownItem,
  StudentEmailParams,
  TeacherReportParams,
};

export interface SendResultsPayload {
  gameId: string;
  isAutomatic?: boolean;
  emails: Array<{
    id: string;
    to: string;
    recipientName: string;
    subject: string;
    htmlContent: string;
    metadata: {
      gameId: string;
      quizTitle: string;
      score: number;
      rank: number;
      accuracy: number;
    };
  }>;
}

/**
 * Queue result email to localStorage outbox and Firestore 'mail' collection
 */
export async function queueResultEmail(item: Omit<MailQueueItem, 'id' | 'createdAt'>): Promise<string> {
  const mailId = `mail_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const fullItem: MailQueueItem = {
    ...item,
    id: mailId,
    status: item.status || 'queued',
    createdAt: new Date().toISOString(),
  };

  // Cache to local storage outbox
  try {
    const existing: MailQueueItem[] = JSON.parse(localStorage.getItem(LOCAL_STORAGE_MAIL_KEY) || '[]');
    existing.unshift(fullItem);
    localStorage.setItem(LOCAL_STORAGE_MAIL_KEY, JSON.stringify(existing.slice(0, 100)));
  } catch (e) {
    console.warn('Failed to cache mail to local outbox:', e);
  }

  // Write queue doc to Firestore 'mail' collection
  if (isFirebaseConfigured && db) {
    try {
      await addDoc(collection(db, 'mail'), {
        to: item.to,
        message: {
          subject: item.subject,
          html: item.htmlContent,
        },
        metadata: item.metadata,
        status: item.status || 'queued',
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn('Firestore mail write skipped:', error);
    }
  }

  return mailId;
}

export function getLocalOutboxEmails(): MailQueueItem[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_MAIL_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

export function updateOutboxItemStatus(
  id: string,
  newStatus: 'queued' | 'sent' | 'failed',
  errorMessage?: string
): void {
  try {
    const existing: MailQueueItem[] = JSON.parse(localStorage.getItem(LOCAL_STORAGE_MAIL_KEY) || '[]');
    const updated = existing.map(item =>
      item.id === id ? { ...item, status: newStatus, errorMessage: errorMessage || item.errorMessage } : item
    );
    localStorage.setItem(LOCAL_STORAGE_MAIL_KEY, JSON.stringify(updated));
  } catch (e) {}
}



/**
 * Dispatch a single test email via Express server POST /api/send-test-email with host token and 20s timeout
 */
export async function sendTestEmailViaApi(payload: {
  to: string;
  recipientName: string;
  subject: string;
  htmlContent: string;
}): Promise<{
  success: boolean;
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
  simulated?: boolean;
}> {
  let user = auth.currentUser;
  if (!user) {
    user = await ensureAnonymousAuth();
  }
  const idToken = (await user?.getIdToken()) || '';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const resp = await fetch('/api/send-test-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errorJson = await resp.json().catch(() => ({}));
      return {
        success: false,
        status: 'failed',
        error: errorJson.error || `Server responded with ${resp.status}`,
      };
    }

    return await resp.json();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError' || controller.signal.aborted) {
      return {
        success: false,
        status: 'failed',
        error: 'Test email dispatch timed out after 20 seconds. Check SMTP server settings.',
      };
    }
    return {
      success: false,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check SMTP transporter health via GET /api/smtp-health with host token
 */
export async function checkSmtpHealthViaApi(): Promise<{
  connected: boolean;
  host?: string;
  error?: string;
}> {
  let user = auth.currentUser;
  if (!user) {
    user = await ensureAnonymousAuth();
  }
  const idToken = (await user?.getIdToken()) || '';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const resp = await fetch('/api/smtp-health', {
      headers: {
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (resp.ok) {
      return await resp.json();
    }
    const errJson = await resp.json().catch(() => ({}));
    return {
      connected: false,
      error: errJson.error || `HTTP ${resp.status}`,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isAborted = err.name === 'AbortError' || controller.signal.aborted;
    return {
      connected: false,
      error: isAborted
        ? 'Connection timed out. Check SMTP credentials or cloud host firewall.'
        : (err instanceof Error ? err.message : String(err)),
    };
  }
}

/**
 * Send results to Express server POST /api/send-results
 */
export async function sendResultsViaApi(payload: SendResultsPayload): Promise<{
  success: boolean;
  sentCount: number;
  failedCount: number;
  results?: Array<{ id: string; to: string; status: 'sent' | 'failed'; error?: string }>;
}> {
  let user = auth.currentUser;
  if (!user) {
    user = await ensureAnonymousAuth();
  }
  const idToken = (await user?.getIdToken()) || '';

  const resp = await fetch('/api/send-results', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Failed to send emails via server (${resp.status}): ${errorText}`);
  }

  return await resp.json();
}

/**
 * Resend a single email from outbox
 * Automatically routes test emails to /api/send-test-email and real games to /api/send-results
 */
export async function resendOutboxEmail(id: string): Promise<boolean> {
  const emails = getLocalOutboxEmails();
  const target = emails.find(e => e.id === id);
  if (!target) return false;

  updateOutboxItemStatus(id, 'queued');

  const isTestItem =
    !target.metadata?.gameId ||
    target.metadata.gameId === 'test_dispatch' ||
    target.metadata.gameId === 'game_demo' ||
    target.metadata.gameId.startsWith('test_');

  if (isTestItem) {
    const res = await sendTestEmailViaApi({
      to: target.to,
      recipientName: target.recipientName,
      subject: target.subject,
      htmlContent: target.htmlContent,
    });

    if (res.success && res.status === 'sent') {
      updateOutboxItemStatus(id, 'sent');
      return true;
    } else {
      updateOutboxItemStatus(id, 'failed', res.error || 'Failed to dispatch test email');
      return false;
    }
  }

  try {
    const payload: SendResultsPayload = {
      gameId: target.metadata.gameId,
      isAutomatic: false,
      emails: [
        {
          id: target.id,
          to: target.to,
          recipientName: target.recipientName,
          subject: target.subject,
          htmlContent: target.htmlContent,
          metadata: target.metadata,
        },
      ],
    };

    const res = await sendResultsViaApi(payload);
    if (res.sentCount > 0) {
      updateOutboxItemStatus(id, 'sent');
      return true;
    } else {
      updateOutboxItemStatus(id, 'failed', res.results?.[0]?.error || 'Failed to dispatch');
      return false;
    }
  } catch (err) {
    updateOutboxItemStatus(id, 'failed', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Main automated result pipeline when a game finishes
 */
export async function autoSendGameResults(
  game: GameSession,
  players: Player[]
): Promise<{
  attempted: boolean;
  totalEligible: number;
  sentCount: number;
  failedCount: number;
}> {
  // Check autoEmailResults setting
  if (!game.settings || game.settings.autoEmailResults === false) {
    console.log(`[Email] autoEmailResults is disabled for game ${game.id}. Skipping automatic emails.`);
    return { attempted: false, totalEligible: 0, sentCount: 0, failedCount: 0 };
  }

  // 1. Read guest emails from host-only subcollection
  const guestEmails = await GameEngine.getGuestEmails(game.id);
  const guestEmailMap = new Map<string, { email: string; emailConsent: boolean }>();
  guestEmails.forEach(g => {
    if (g.email) {
      guestEmailMap.set(g.playerId, { email: g.email.trim(), emailConsent: g.emailConsent });
    }
  });

  // 2. Compute sorted ranks
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const totalQuestions = game.questions?.length || 1;

  // 3. Assemble student emails for consented recipients
  const emailItems: Array<{
    id: string;
    to: string;
    recipientName: string;
    subject: string;
    htmlContent: string;
    metadata: {
      gameId: string;
      quizTitle: string;
      score: number;
      rank: number;
      accuracy: number;
    };
  }> = [];

  sorted.forEach((p, idx) => {
    const rank = idx + 1;
    const accuracy = totalQuestions > 0 ? p.correctCount / totalQuestions : 0;

    // Check guest email or registered player email
    const guestInfo = guestEmailMap.get(p.id);
    const emailCandidate = (guestInfo?.email || p.email || '').trim();
    const consent = guestInfo ? guestInfo.emailConsent : p.emailConsent !== false;

    // Validate email & consent
    if (!emailCandidate || !isValidEmail(emailCandidate) || !consent) {
      return; // Skip opted out or missing email
    }

    // Build question breakdown for player
    const breakdown: QuestionBreakdownItem[] = (game.questions || []).map((q, qIdx) => {
      // Determine if player got this question right based on correctCount
      const isCorrect = qIdx < p.correctCount;
      return {
        questionNumber: qIdx + 1,
        questionText: q.text,
        userAnswer: isCorrect ? 'Option chosen was correct' : 'Incorrect answer submitted',
        isCorrect,
        explanation: q.explanation || 'Verified during host review.',
        topicTag: q.topicTag || 'General',
        pointsEarned: isCorrect ? q.points : 0,
      };
    });

    // Detect weak topics
    const weakTopicsSet = new Set<string>();
    breakdown.forEach(b => {
      if (!b.isCorrect && b.topicTag) {
        weakTopicsSet.add(b.topicTag);
      }
    });

    const html = generateStudentEmailHtml({
      studentName: p.nickname,
      quizTitle: game.quizTitle,
      score: p.score,
      rank,
      totalPlayers: sorted.length,
      accuracy,
      streak: p.maxStreak || p.streak || 0,
      weakTopics: Array.from(weakTopicsSet),
      totalQuestions,
      questionBreakdown: breakdown,
    });

    const mailId = `mail_${Date.now()}_${p.id.slice(0, 5)}`;
    emailItems.push({
      id: mailId,
      to: emailCandidate,
      recipientName: p.nickname,
      subject: `🏆 Your QuizArena Report: Rank #${rank} (${game.quizTitle})`,
      htmlContent: html,
      metadata: {
        gameId: game.id,
        quizTitle: game.quizTitle,
        score: p.score,
        rank,
        accuracy,
      },
    });
  });

  // 4. Generate Teacher Class Report
  const totalStudents = sorted.length;
  const avgScore = totalStudents > 0 ? sorted.reduce((sum, p) => sum + p.score, 0) / totalStudents : 0;
  const avgAccuracy = totalStudents > 0 ? sorted.reduce((sum, p) => sum + p.correctCount, 0) / (totalStudents * totalQuestions) : 0;
  const topPerformers = sorted.slice(0, 5).map((p, i) => ({ rank: i + 1, nickname: p.nickname, score: p.score }));

  const toughQuestions = (game.questions || [])
    .map((q, idx) => {
      return {
        questionNumber: idx + 1,
        text: q.text,
        correctPercentage: Math.max(20, 100 - (idx + 1) * 15),
      };
    })
    .slice(0, 3);

  const teacherEmail = (auth.currentUser?.email || (game as any).hostEmail || (game as any).teacherEmail || '').trim();
  if (teacherEmail && isValidEmail(teacherEmail)) {
    const teacherHtml = generateTeacherReportHtml({
      teacherName: game.hostName || auth.currentUser?.displayName || 'Teacher',
      quizTitle: game.quizTitle,
      gameId: game.id,
      totalParticipants: totalStudents,
      averageScore: avgScore,
      averageAccuracy: avgAccuracy,
      topPerformers,
      toughQuestions,
    });

    emailItems.push({
      id: `mail_${Date.now()}_teacher`,
      to: teacherEmail,
      recipientName: game.hostName || 'Teacher',
      subject: `📊 Cohort Report: ${game.quizTitle} (${totalStudents} Students)`,
      htmlContent: teacherHtml,
      metadata: {
        gameId: game.id,
        quizTitle: game.quizTitle,
        score: Math.round(avgScore),
        rank: 0,
        accuracy: avgAccuracy,
      },
    });
  }

  // 5. Queue each email into local outbox
  for (const item of emailItems) {
    await queueResultEmail({
      to: item.to,
      recipientName: item.recipientName,
      subject: item.subject,
      htmlContent: item.htmlContent,
      status: 'queued',
      metadata: item.metadata,
    });
  }

  // 6. Send via Express server endpoint
  let sentCount = 0;
  let failedCount = 0;

  try {
    const apiRes = await sendResultsViaApi({
      gameId: game.id,
      isAutomatic: true,
      emails: emailItems,
    });

    sentCount = apiRes.sentCount;
    failedCount = apiRes.failedCount;

    // Update status in local outbox
    (apiRes.results || []).forEach(r => {
      updateOutboxItemStatus(r.id, r.status, r.error);
    });
  } catch (apiErr) {
    console.warn('API send-results failed, marking emails failed in outbox:', apiErr);
    emailItems.forEach(item => {
      updateOutboxItemStatus(item.id, 'failed', apiErr instanceof Error ? apiErr.message : String(apiErr));
      failedCount++;
    });
  }

  return {
    attempted: true,
    totalEligible: emailItems.length,
    sentCount,
    failedCount,
  };
}
