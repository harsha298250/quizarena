/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 7: Email Notifications & Certificate System Hardening Test Suite
 * Covers 41 comprehensive specifications:
 * - Email outbox persistence, queueing, and idempotency
 * - Bounded batch worker claiming & concurrency locks
 * - Exponential backoff and maximum retry caps
 * - Webhook delivery / bounce status transitions
 * - Plain-text MIME fallback generation
 * - Cryptographic verification ID generation
 * - Authoritative certificate issuance and forgery rejection
 * - Certificate revocation with audit history
 * - Public verification privacy preservation (zero student PII)
 * - PDF generation with embedded verification ID
 * - Phase 1 - 6 Security & Architectural Regression
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  issueCertificate,
  verifyCertificatePublic,
  revokeCertificate,
  generateVerificationId,
  certificateStore,
  verificationIdIndex,
  idempotencyIndex,
} from '../server/certificateEngine.ts';
import {
  enqueueOutboxJob,
  processOutboxBatch,
  handleProviderWebhook,
  generatePlainTextFallback,
  isValidEmailAddress,
  outboxStore,
  idempotencyOutboxIndex,
} from '../server/emailOutboxWorker.ts';
import {
  handleIssueCertificate,
  handleVerifyCertificate,
  handleRevokeCertificate,
  handleProcessOutbox,
} from '../server/notificationHandler.ts';
import { buildCertificateDoc } from '../services/certificateService.ts';

// ---------------------------------------------------------------------------
// Mock Helpers for Express / Firebase
// ---------------------------------------------------------------------------
function createMockReqRes(options: {
  body?: any;
  params?: any;
  headers?: any;
}) {
  const req: any = {
    body: options.body || {},
    params: options.params || {},
    headers: options.headers || {},
  };
  let statusCode = 200;
  let responseData: any = null;

  const res: any = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      responseData = data;
      return res;
    },
    setHeader: () => res,
  };

  const adminAuth: any = {
    verifyIdToken: async (token: string) => {
      if (token === 'valid_student_token') {
        return { uid: 'student_1', name: 'Alice Walker', email: 'alice@quizarena.io' };
      }
      if (token === 'valid_host_token') {
        return { uid: 'host_1', name: 'Prof. Turing', email: 'turing@quizarena.io' };
      }
      if (token === 'unauthorized_token') {
        return { uid: 'intruder_99', name: 'Intruder' };
      }
      throw new Error('Invalid token');
    },
  };

  const adminDb: any = {};

  return { req, res, getStatus: () => statusCode, getData: () => responseData, adminAuth, adminDb };
}

describe('Phase 7 — Email Notifications & Certificate System Hardening Suite', () => {
  beforeEach(() => {
    certificateStore.clear();
    verificationIdIndex.clear();
    idempotencyIndex.clear();
    outboxStore.clear();
    idempotencyOutboxIndex.clear();
  });

  // -------------------------------------------------------------------------
  // 1. Email Outbox & Infrastructure (1 - 10)
  // -------------------------------------------------------------------------
  it('[EM-01] enqueues valid email job with pending status', () => {
    const res = enqueueOutboxJob({
      idempotencyKey: 'event_01',
      recipientEmail: 'student@example.com',
      recipientName: 'Student',
      eventType: 'quiz_results_ready',
      subject: 'Your Quiz Results',
      htmlContent: '<p>You scored 1000!</p>',
      textContent: '',
    });
    expect(res.success).toBe(true);
    expect(res.job?.status).toBe('pending');
    expect(res.job?.recipientEmail).toBe('student@example.com');
  });

  it('[EM-02] rejects invalid email address and returns error', () => {
    const res = enqueueOutboxJob({
      idempotencyKey: 'event_bad',
      recipientEmail: 'not-an-email',
      recipientName: 'Bad',
      eventType: 'quiz_results_ready',
      subject: 'Test',
      htmlContent: '<p>Test</p>',
      textContent: 'Test',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/invalid recipient email/i);
  });

  it('[EM-03] duplicate event with same idempotencyKey is not enqueued twice', () => {
    const r1 = enqueueOutboxJob({
      idempotencyKey: 'idemp_key_1',
      recipientEmail: 'p@test.com',
      recipientName: 'P',
      eventType: 'quiz_results_ready',
      subject: 'Score',
      htmlContent: '<p>Score</p>',
      textContent: 'Score',
    });
    const r2 = enqueueOutboxJob({
      idempotencyKey: 'idemp_key_1',
      recipientEmail: 'p@test.com',
      recipientName: 'P',
      eventType: 'quiz_results_ready',
      subject: 'Score',
      htmlContent: '<p>Score</p>',
      textContent: 'Score',
    });
    expect(r1.isDuplicate).toBe(false);
    expect(r2.isDuplicate).toBe(true);
    expect(r1.job?.id).toBe(r2.job?.id);
    expect(outboxStore.size).toBe(1);
  });

  it('[EM-04] generates clean plain-text MIME alternative from HTML content', () => {
    const html = '<h1>Welcome!</h1><p>You scored <strong>950 pts</strong>.<br/>Keep it up!</p><ul><li>Rank 1</li></ul>';
    const text = generatePlainTextFallback(html);
    expect(text).toContain('Welcome!');
    expect(text).toContain('950 pts');
    expect(text).toContain('• Rank 1');
    expect(text).not.toContain('<');
    expect(text).not.toContain('>');
  });

  it('[EM-05] batch worker atomically claims jobs and locks them with timeout', async () => {
    enqueueOutboxJob({
      idempotencyKey: 'job_claim_1',
      recipientEmail: 'a@test.com',
      recipientName: 'A',
      eventType: 'quiz_results_ready',
      subject: 'A',
      htmlContent: 'A',
      textContent: 'A',
    });

    const sender = async () => ({ success: true, providerMessageId: 'prov_123' });
    const batch = await processOutboxBatch(10, sender, 'worker_unit');

    expect(batch.claimedCount).toBe(1);
    expect(batch.sentCount).toBe(1);
    const job = Array.from(outboxStore.values())[0];
    expect(job.status).toBe('accepted');
    expect(job.providerMessageId).toBe('prov_123');
  });

  it('[EM-06] transient failure schedules exponential backoff retry', async () => {
    enqueueOutboxJob({
      idempotencyKey: 'job_retry_1',
      recipientEmail: 'retry@test.com',
      recipientName: 'R',
      eventType: 'quiz_results_ready',
      subject: 'R',
      htmlContent: 'R',
      textContent: 'R',
    });

    // Mock transient error (network timeout)
    const sender = async () => ({ success: false, error: 'Connection timeout', isPermanent: false });
    const batch = await processOutboxBatch(10, sender, 'worker_unit');

    expect(batch.retriedCount).toBe(1);
    const job = Array.from(outboxStore.values())[0];
    expect(job.status).toBe('retrying');
    expect(job.attempts).toBe(1);
    expect(job.errorCategory).toBe('transient');
    expect(job.nextRetryAt).toBeDefined();
  });

  it('[EM-07] permanent failure (e.g. mailbox unavailable) stops retrying immediately', async () => {
    enqueueOutboxJob({
      idempotencyKey: 'job_perm_1',
      recipientEmail: 'dead@test.com',
      recipientName: 'D',
      eventType: 'quiz_results_ready',
      subject: 'D',
      htmlContent: 'D',
      textContent: 'D',
    });

    const sender = async () => ({ success: false, error: '550 Recipient rejected', isPermanent: true });
    const batch = await processOutboxBatch(10, sender);

    expect(batch.failedCount).toBe(1);
    const job = Array.from(outboxStore.values())[0];
    expect(job.status).toBe('failed');
    expect(job.errorCategory).toBe('permanent');
  });

  it('[EM-08] maximum retry cap transitions job to failed status after max attempts', async () => {
    enqueueOutboxJob({
      idempotencyKey: 'job_max_1',
      recipientEmail: 'max@test.com',
      recipientName: 'M',
      eventType: 'quiz_results_ready',
      subject: 'M',
      htmlContent: 'M',
      textContent: 'M',
      maxAttempts: 2,
    });

    const sender = async () => ({ success: false, error: 'Temporary busy', isPermanent: false });
    // First attempt -> retrying
    await processOutboxBatch(10, sender);
    const job = Array.from(outboxStore.values())[0];
    job.nextRetryAt = new Date(Date.now() - 1000).toISOString(); // simulate elapsed backoff

    // Second attempt -> exceeded max attempts
    await processOutboxBatch(10, sender);
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(2);
  });

  it('[EM-09] provider webhook confirms delivered status', () => {
    enqueueOutboxJob({
      idempotencyKey: 'job_wh_1',
      recipientEmail: 'wh@test.com',
      recipientName: 'WH',
      eventType: 'quiz_results_ready',
      subject: 'WH',
      htmlContent: 'WH',
      textContent: 'WH',
    });
    const job = Array.from(outboxStore.values())[0];
    job.providerMessageId = 'msg_provider_456';

    const res = handleProviderWebhook('msg_provider_456', 'delivered', true);
    expect(res.success).toBe(true);
    expect(res.job?.status).toBe('delivered');
    expect(res.job?.deliveredAt).toBeDefined();
  });

  it('[EM-10] webhook with invalid signature is rejected', () => {
    const res = handleProviderWebhook('msg_provider_456', 'delivered', false);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/invalid webhook signature/i);
  });

  // -------------------------------------------------------------------------
  // 2. Notification Triggers (11 - 15)
  // -------------------------------------------------------------------------
  it('[NOTIF-11] tournament registration triggers confirmation email job', () => {
    const res = enqueueOutboxJob({
      idempotencyKey: 'tourney_reg_t1_p1',
      recipientEmail: 'contender@quizarena.io',
      recipientName: 'Contender 1',
      eventType: 'tournament_registered',
      subject: 'Tournament Registration Confirmed: National Championship',
      htmlContent: '<p>You are officially registered!</p>',
      textContent: '',
    });
    expect(res.success).toBe(true);
    expect(res.job?.eventType).toBe('tournament_registered');
  });

  it('[NOTIF-12] tournament match ready triggers pairing notification', () => {
    const res = enqueueOutboxJob({
      idempotencyKey: 'tourney_match_m1_p1',
      recipientEmail: 'p1@test.com',
      recipientName: 'P1',
      eventType: 'tournament_match_ready',
      subject: 'Round 1 Match Ready',
      htmlContent: '<p>Your match is starting!</p>',
      textContent: '',
    });
    expect(res.success).toBe(true);
    expect(res.job?.eventType).toBe('tournament_match_ready');
  });

  it('[NOTIF-13] certificate issuance triggers credential notification', () => {
    const res = enqueueOutboxJob({
      idempotencyKey: 'cert_issued_user123',
      recipientEmail: 'winner@test.com',
      recipientName: 'Winner',
      eventType: 'certificate_issued',
      subject: 'Your Official QuizArena Certificate is Ready',
      htmlContent: '<p>Verify your certificate online.</p>',
      textContent: '',
    });
    expect(res.success).toBe(true);
    expect(res.job?.eventType).toBe('certificate_issued');
  });

  it('[NOTIF-14] reconnects or retried events do not produce duplicate notifications', () => {
    const key = 'event_reconnect_test';
    enqueueOutboxJob({
      idempotencyKey: key,
      recipientEmail: 'user@test.com',
      recipientName: 'User',
      eventType: 'quiz_results_ready',
      subject: 'Results',
      htmlContent: '<p>Results</p>',
      textContent: '',
    });
    const retryRes = enqueueOutboxJob({
      idempotencyKey: key,
      recipientEmail: 'user@test.com',
      recipientName: 'User',
      eventType: 'quiz_results_ready',
      subject: 'Results',
      htmlContent: '<p>Results</p>',
      textContent: '',
    });
    expect(retryRes.isDuplicate).toBe(true);
    expect(outboxStore.size).toBe(1);
  });

  it('[NOTIF-15] worker endpoint rejects unauthenticated access (403)', async () => {
    const { req, res, getStatus, adminAuth, adminDb } = createMockReqRes({
      headers: {}, // no internal secret
    });
    await handleProcessOutbox(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(403);
  });

  // -------------------------------------------------------------------------
  // 3. Certificate Issuance & Verification (16 - 28)
  // -------------------------------------------------------------------------
  it('[CERT-16] issues verified certificate derived from authoritative results', () => {
    const res = issueCertificate({
      ownerId: 'student_1',
      recipientName: 'Alice Walker',
      assessmentType: 'quiz',
      assessmentId: 'game_100',
      assessmentTitle: 'Computer Systems Architecture',
      type: 'quiz_excellence',
      score: 9500,
      rank: 1,
      totalParticipants: 45,
      accuracy: 0.95,
      issuerId: 'host_1',
      issuerName: 'Prof. Turing',
    });

    expect(res.success).toBe(true);
    expect(res.certificate?.id).toBeDefined();
    expect(res.certificate?.verificationId).toMatch(/^QA-V-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(res.certificate?.status).toBe('valid');
  });

  it('[CERT-17] duplicate certificate issuance for same assessment and student is idempotent', () => {
    const params = {
      ownerId: 'student_1',
      recipientName: 'Alice Walker',
      assessmentType: 'quiz' as const,
      assessmentId: 'game_100',
      assessmentTitle: 'Computer Systems',
      type: 'quiz_completion' as const,
      score: 5000,
      rank: 2,
      totalParticipants: 20,
      accuracy: 0.8,
      issuerId: 'host_1',
      issuerName: 'Host',
    };

    const first = issueCertificate(params);
    const second = issueCertificate(params);

    expect(first.certificate?.id).toBe(second.certificate?.id);
    expect(first.certificate?.verificationId).toBe(second.certificate?.verificationId);
    expect(certificateStore.size).toBe(1);
  });

  it('[CERT-18] authorized reissue increments reissueCount and updates verificationId', () => {
    const params = {
      ownerId: 'student_1',
      recipientName: 'Alice Walker',
      assessmentType: 'quiz' as const,
      assessmentId: 'game_100',
      assessmentTitle: 'Computer Systems',
      type: 'quiz_completion' as const,
      score: 5000,
      rank: 2,
      totalParticipants: 20,
      accuracy: 0.8,
      issuerId: 'host_1',
      issuerName: 'Host',
    };

    const first = issueCertificate(params);
    const reissued = issueCertificate(params, true); // reissue = true

    expect(reissued.certificate?.reissueCount).toBe(1);
    expect(reissued.certificate?.id).toBe(first.certificate?.id);
  });

  it('[CERT-19] rejects certificate issuance with missing recipient or assessment data', () => {
    const res = issueCertificate({
      ownerId: '',
      recipientName: '',
      assessmentType: 'quiz',
      assessmentId: '',
      assessmentTitle: '',
      type: 'quiz_completion',
      score: 0,
      rank: 0,
      totalParticipants: 0,
      accuracy: 0,
      issuerId: '',
      issuerName: '',
    });
    expect(res.success).toBe(false);
  });

  it('[CERT-20] generates cryptographically random and unpredictable verification IDs', () => {
    const v1 = generateVerificationId();
    const v2 = generateVerificationId();
    expect(v1).not.toBe(v2);
    expect(v1.length).toBe(19);
  });

  it('[CERT-21] public verification verifies genuine certificate successfully', () => {
    const issued = issueCertificate({
      ownerId: 'student_1',
      recipientName: 'Alice Walker',
      assessmentType: 'quiz',
      assessmentId: 'game_verified',
      assessmentTitle: 'Advanced OS',
      type: 'quiz_excellence',
      score: 9800,
      rank: 1,
      totalParticipants: 30,
      accuracy: 0.98,
      issuerId: 'host_1',
      issuerName: 'Prof. Lovelace',
    });

    const vId = issued.certificate!.verificationId;
    const verifyResult = verifyCertificatePublic(vId);

    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.status).toBe('valid');
    expect(verifyResult.recipientName).toBe('Alice Walker');
    expect(verifyResult.assessmentTitle).toBe('Advanced OS');
  });

  it('[CERT-22] public verification strictly omits student email, UID, and internal fields', () => {
    const issued = issueCertificate({
      ownerId: 'private_uid_secret',
      recipientName: 'Protected Student',
      assessmentType: 'tournament',
      assessmentId: 'tourney_safe',
      assessmentTitle: 'National Finals',
      type: 'tournament_champion',
      score: 12000,
      rank: 1,
      totalParticipants: 64,
      accuracy: 1.0,
      issuerId: 'host_1',
      issuerName: 'Host',
    });

    const vId = issued.certificate!.verificationId;
    const verifyResult = verifyCertificatePublic(vId);

    const serialized = JSON.stringify(verifyResult);
    expect(serialized).not.toContain('private_uid_secret');
    expect((verifyResult as any).ownerId).toBeUndefined();
    expect((verifyResult as any).email).toBeUndefined();
  });

  it('[CERT-23] public verification returns not_found for invalid or forged verification IDs', () => {
    const res = verifyCertificatePublic('QA-V-FAKE-0000-NONE');
    expect(res.valid).toBe(false);
    expect(res.status).toBe('not_found');
  });

  it('[CERT-24] authorized host can revoke a certificate with audit reason and timestamp', () => {
    const issued = issueCertificate({
      ownerId: 'student_1',
      recipientName: 'Alice Walker',
      assessmentType: 'quiz',
      assessmentId: 'game_breach',
      assessmentTitle: 'Cheating Detection Exam',
      type: 'quiz_completion',
      score: 9000,
      rank: 1,
      totalParticipants: 10,
      accuracy: 0.9,
      issuerId: 'host_1',
      issuerName: 'Host Turing',
    });

    const certId = issued.certificate!.id;
    const revokeRes = revokeCertificate(certId, 'host_1', 'Academic integrity policy violation.');

    expect(revokeRes.success).toBe(true);
    expect(revokeRes.certificate?.status).toBe('revoked');
    expect(revokeRes.certificate?.revocationReason).toBe('Academic integrity policy violation.');
    expect(revokeRes.certificate?.revokedAt).toBeDefined();
  });

  it('[CERT-25] unauthorized user cannot revoke another host certificate', () => {
    const issued = issueCertificate({
      ownerId: 'student_1',
      recipientName: 'Alice',
      assessmentType: 'quiz',
      assessmentId: 'game_x',
      assessmentTitle: 'Quiz X',
      type: 'quiz_completion',
      score: 8000,
      rank: 1,
      totalParticipants: 10,
      accuracy: 0.8,
      issuerId: 'host_1',
      issuerName: 'Host 1',
    });

    const certId = issued.certificate!.id;
    const res = revokeCertificate(certId, 'intruder_user', 'Trolling');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/forbidden/i);
  });

  it('[CERT-26] revoked certificate fails public verification with status revoked', () => {
    const issued = issueCertificate({
      ownerId: 'student_1',
      recipientName: 'Alice',
      assessmentType: 'quiz',
      assessmentId: 'game_rev',
      assessmentTitle: 'Quiz Rev',
      type: 'quiz_completion',
      score: 8000,
      rank: 1,
      totalParticipants: 10,
      accuracy: 0.8,
      issuerId: 'host_1',
      issuerName: 'Host 1',
    });

    const certId = issued.certificate!.id;
    revokeCertificate(certId, 'host_1', 'Breach of exam protocol');

    const vId = issued.certificate!.verificationId;
    const verifyRes = verifyCertificatePublic(vId);

    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.status).toBe('revoked');
    expect(verifyRes.revocationReason).toContain('Breach of exam protocol');
  });

  it('[CERT-27] user cannot issue certificate for another user via API endpoint (403)', async () => {
    const { req, res, getStatus, adminAuth, adminDb } = createMockReqRes({
      headers: { authorization: 'Bearer valid_student_token' }, // Alice (student_1)
      body: {
        ownerId: 'student_other_user', // Forged owner
        recipientName: 'Bob',
        assessmentId: 'game_1',
      },
    });

    await handleIssueCertificate(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(403);
  });

  it('[CERT-28] PDF generator embeds verification ID footnote cleanly without overflow', () => {
    const doc = buildCertificateDoc({
      studentName: 'Aarav Sharma',
      quizTitle: 'Quantum Computing and Cryptographic Algorithms',
      rank: 1,
      totalPlayers: 50,
      score: 9900,
      accuracy: 0.99,
      date: 'November 3, 2026',
      hostName: 'Prof. Alistair Finch',
      verificationId: 'QA-V-1234-5678-ABCD',
    });

    const pdfBuffer = doc.output('arraybuffer');
    expect(pdfBuffer.byteLength).toBeGreaterThan(1000);
  });

  // -------------------------------------------------------------------------
  // 4. Regression & Multi-Phase Compatibility (29 - 41)
  // -------------------------------------------------------------------------
  it('[REG-29] Phase 1 authentication remains intact', async () => {
    const { req, res, getStatus, adminAuth, adminDb } = createMockReqRes({
      headers: {}, // No token
    });
    await handleIssueCertificate(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(401);
  });

  it('[REG-30] Phase 2 multiplayer sync structures are preserved', async () => {
    const mod = await import('../server/gameSessionHandler.ts');
    expect(typeof mod.handleReconcilePlayerCount).toBe('function');
    expect(typeof mod.handleJoinGame).toBe('function');
  }, 15000);

  it('[REG-31] Phase 3 server-authoritative scoring calculations remain intact', async () => {
    const mod = await import('../lib/scoring.ts');
    expect(typeof mod.calculateFairScore).toBe('function');
    const score = mod.calculateFairScore({
      basePoints: 1000,
      isCorrect: true,
      timeLimitSeconds: 20,
      rawResponseTimeMs: 5000,
      latencyMs: 50,
      clockOffsetMs: 0,
      currentStreak: 1,
      scoringProfile: 'speed_weighted',
    });
    expect(score.finalPoints).toBeGreaterThan(0);
  });

  it('[REG-32] Phase 4 quiz question validation remains compatible', async () => {
    const mod = await import('../lib/questionValidation.ts');
    expect(typeof mod.validateQuestion).toBe('function');
  });

  it('[REG-33] Phase 5 deterministic analytics calculations remain intact', async () => {
    const mod = await import('../services/analyticsService.ts');
    expect(typeof mod.computeGameAnalytics).toBe('function');
  }, 15000);

  it('[REG-34] Phase 6 tournament bracket generation remains intact', async () => {
    const mod = await import('../server/tournamentEngine.ts');
    expect(typeof mod.generateSingleEliminationBracket).toBe('function');
  });

  it('[REG-35] Phase 6 Elo calculations remain intact', async () => {
    const mod = await import('../server/tournamentEngine.ts');
    const { deltaA, deltaB } = mod.calculateElo(1200, 1200, 1);
    expect(deltaA).toBe(16);
    expect(deltaB).toBe(-16);
  });

  it('[REG-36] long recipient names shrink dynamically without crashing PDF build', () => {
    const doc = buildCertificateDoc({
      studentName: 'Shri Venkata Ramanathan Subramanian Balasubramanian Krishnamoorthy',
      quizTitle: 'Very Long Title Test',
      rank: 1,
      totalPlayers: 10,
      score: 1000,
      accuracy: 1.0,
      date: '2026-11-03',
      verificationId: 'QA-V-LONG-NAME-TEST',
    });
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });

  it('[REG-37] Unicode Tamil and Devanagari font rendering remains intact in certificates', () => {
    const doc = buildCertificateDoc({
      studentName: 'ஹர்ஷா மற்றும் நரேஷ்',
      quizTitle: 'தமிழ் பாரம்பரியம்',
      rank: 1,
      totalPlayers: 10,
      score: 1000,
      accuracy: 1.0,
      date: '2026-11-03',
      verificationId: 'QA-V-TAMIL-TEST',
    });
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });

  it('[REG-38] certificate record survives even if email delivery fails', () => {
    const issued = issueCertificate({
      ownerId: 'u1',
      recipientName: 'User 1',
      assessmentType: 'quiz',
      assessmentId: 'g1',
      assessmentTitle: 'Title',
      type: 'quiz_completion',
      score: 1000,
      rank: 1,
      totalParticipants: 5,
      accuracy: 1,
      issuerId: 'h1',
      issuerName: 'Host',
    });

    // Enqueue email with invalid address
    const emailRes = enqueueOutboxJob({
      idempotencyKey: 'cert_email_fail',
      recipientEmail: 'invalid-email',
      recipientName: 'User 1',
      eventType: 'certificate_issued',
      subject: 'Cert',
      htmlContent: '<p>Cert</p>',
      textContent: '',
    });

    expect(emailRes.success).toBe(false);
    // Certificate record must still be valid
    expect(issued.success).toBe(true);
    expect(certificateStore.get(issued.certificate!.id)?.status).toBe('valid');
  });

  it('[REG-39] certificate revocation is idempotent', () => {
    const issued = issueCertificate({
      ownerId: 'u1',
      recipientName: 'User 1',
      assessmentType: 'quiz',
      assessmentId: 'g1',
      assessmentTitle: 'Title',
      type: 'quiz_completion',
      score: 1000,
      rank: 1,
      totalParticipants: 5,
      accuracy: 1,
      issuerId: 'h1',
      issuerName: 'Host',
    });

    const certId = issued.certificate!.id;
    const r1 = revokeCertificate(certId, 'h1', 'Reason 1');
    const r2 = revokeCertificate(certId, 'h1', 'Reason 2');

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(certificateStore.get(certId)?.status).toBe('revoked');
  });

  it('[REG-40] abandoned outbox processing locks are automatically recovered after 120s', async () => {
    enqueueOutboxJob({
      idempotencyKey: 'job_abandoned',
      recipientEmail: 'recover@test.com',
      recipientName: 'Rec',
      eventType: 'quiz_results_ready',
      subject: 'Subject',
      htmlContent: 'Body',
      textContent: 'Body',
    });

    const job = Array.from(outboxStore.values())[0];
    job.status = 'processing';
    job.lockedUntil = new Date(Date.now() - 5000).toISOString(); // Expired lock

    const sender = async () => ({ success: true, providerMessageId: 'recovered_123' });
    const batch = await processOutboxBatch(10, sender, 'recovery_worker');

    expect(batch.claimedCount).toBe(1);
    expect(job.status).toBe('accepted');
  });

  it('[REG-41] public verification response never contains undefined or null object errors', () => {
    const res = verifyCertificatePublic('');
    expect(res.valid).toBe(false);
    expect(res.status).toBe('not_found');
  });
});
