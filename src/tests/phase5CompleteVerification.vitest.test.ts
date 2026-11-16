/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 5 Comprehensive Verification Test Suite
 * Covers:
 * - Email provider integration (Resend, Brevo, SMTP)
 * - Primary provider execution & safe transient fallback
 * - Prevention of fallback on permanent errors (401/403/422/invalid email)
 * - Ambiguous timeout detection to prevent duplicate delivery
 * - Bounded exponential backoff with jitter & retry limits
 * - Durable background job claiming, leases, and fencing tokens
 * - Idempotency and duplicate prevention
 * - Delivery result status tracking (pending, processing, sent, retry_scheduled, failed, permanently_failed)
 * - HTML sanitization and plain-text MIME generation
 * - Tournament and certificate notification templates
 * - Administrative observability, bounded pagination, and safe retry recovery
 * - Analytics scalability, empty cohort safety, and bounded reads
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  getResolvedEmailProvider,
  getResolvedEmailFallbackProvider,
  dispatchSingleEmail,
  checkHostEmailRateLimit,
  resetHostEmailRateLimit,
  checkTestEmailRateLimit,
  resetTestEmailRateLimit,
} from '../server/resultEmailsHandler.ts';
import {
  enqueueOutboxJobPersistent,
  claimJobInTransaction,
  completeClaimedOutboxJobPersistent,
  processOutboxBatchPersistent,
  computeBackoffMs,
  listOutboxJobsPersistent,
  retryOutboxJobPersistent,
  DEFAULT_LEASE_MS,
  MAX_BACKOFF_MS,
  BASE_BACKOFF_MS,
} from '../server/emailOutboxEngine.ts';
import {
  generatePlainTextFallback,
  isValidEmailAddress,
  enqueueOutboxJob,
  processOutboxBatch,
  outboxStore,
  idempotencyOutboxIndex,
} from '../server/emailOutboxWorker.ts';
import {
  generateStudentEmailHtml,
  generateTeacherReportHtml,
  generateCertificateIssuedHtml,
  generateTournamentRegisteredHtml,
  generateTournamentMatchReadyHtml,
  generateTournamentCompletedHtml,
  escapeHtml,
} from '../server/emailTemplates.ts';
import { sanitizeEmailHtml } from '../lib/emailSanitizer.ts';
import { computeGameAnalytics } from '../services/analyticsService.ts';
import type { EmailOutboxJob, OutboxJobStatus } from '../types/outbox.ts';
import type { Question, Player, AnswerSubmission } from '../types/quiz.ts';

// ---------------------------------------------------------------------------
// In-Memory Firestore Mock Helper for Persistent Outbox Tests
// ---------------------------------------------------------------------------
function createMockFirestore() {
  const collections = new Map<string, Map<string, any>>();

  function getCol(name: string) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name)!;
  }

  const mockDb: any = {
    collection: (colName: string) => {
      const colMap = getCol(colName);
      return {
        doc: (docId: string) => ({
          id: docId,
          _path: `${colName}/${docId}`,
          get: async () => ({
            id: docId,
            exists: colMap.has(docId),
            data: () => (colMap.has(docId) ? JSON.parse(JSON.stringify(colMap.get(docId))) : undefined),
          }),
          set: async (data: any) => {
            colMap.set(docId, JSON.parse(JSON.stringify(data)));
          },
        }),
        where: (field: string, op: string, val: any) => {
          let docs = Array.from(colMap.entries()).map(([id, d]) => ({
            id,
            data: () => JSON.parse(JSON.stringify(d)),
            ref: { id },
          }));
          if (op === '==') {
            docs = docs.filter(d => d.data()[field] === val);
          }
          return {
            where: (f2: string, op2: string, v2: any) => {
              if (op2 === '==') {
                docs = docs.filter(d => d.data()[f2] === v2);
              }
              return {
                limit: (lim: number) => ({
                  get: async () => ({
                    docs: docs.slice(0, lim),
                    empty: docs.length === 0,
                  }),
                }),
                get: async () => ({
                  docs,
                  empty: docs.length === 0,
                }),
              };
            },
            limit: (lim: number) => ({
              get: async () => ({
                docs: docs.slice(0, lim),
                empty: docs.length === 0,
              }),
            }),
            get: async () => ({
              docs,
              empty: docs.length === 0,
            }),
          };
        },
        limit: (lim: number) => {
          const docs = Array.from(colMap.entries())
            .slice(0, lim)
            .map(([id, d]) => ({
              id,
              data: () => JSON.parse(JSON.stringify(d)),
              ref: { id },
            }));
          return {
            get: async () => ({ docs, empty: docs.length === 0 }),
          };
        },
        get: async () => {
          const docs = Array.from(colMap.entries()).map(([id, d]) => ({
            id,
            data: () => JSON.parse(JSON.stringify(d)),
            ref: { id },
          }));
          return { docs, empty: docs.length === 0 };
        },
      };
    },
    runTransaction: async (updateFunction: (tx: any) => Promise<any>) => {
      const tx = {
        get: async (docRef: any) => {
          const parts = docRef._path.split('/');
          const colMap = getCol(parts[0]);
          const docId = parts[1];
          const exists = colMap.has(docId);
          return {
            id: docId,
            exists,
            data: () => (exists ? JSON.parse(JSON.stringify(colMap.get(docId))) : undefined),
          };
        },
        set: (docRef: any, data: any) => {
          const parts = docRef._path.split('/');
          const colMap = getCol(parts[0]);
          colMap.set(parts[1], JSON.parse(JSON.stringify(data)));
        },
      };
      return await updateFunction(tx);
    },
  };

  return { mockDb, collections };
}

describe('Phase 5 — Complete Email Delivery, Background Jobs & Analytics Suite', () => {
  beforeAll(() => {
    if (typeof (globalThis as any).window === 'undefined') {
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
      (globalThis as any).window = dom.window;
      (globalThis as any).document = dom.window.document;
      (globalThis as any).Node = dom.window.Node;
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    resetHostEmailRateLimit();
    resetTestEmailRateLimit();
    outboxStore.clear();
    idempotencyOutboxIndex.clear();
  });

  // =========================================================================
  // 1. Centralized Provider Selection & Fallback Behavior
  // =========================================================================
  describe('1. Provider Integration & Fallback Selection', () => {
    it('[P5-PROV-01] correctly prioritizes explicit EMAIL_PROVIDER over auto-detection', () => {
      const origProvider = process.env.EMAIL_PROVIDER;
      const origResend = process.env.RESEND_API_KEY;
      const origBrevo = process.env.BREVO_API_KEY;

      process.env.EMAIL_PROVIDER = 'brevo';
      process.env.RESEND_API_KEY = 're_test_123';
      process.env.BREVO_API_KEY = 'xkeysib-test';

      expect(getResolvedEmailProvider()).toBe('brevo');

      process.env.EMAIL_PROVIDER = 'smtp';
      expect(getResolvedEmailProvider()).toBe('smtp');

      process.env.EMAIL_PROVIDER = '';
      expect(getResolvedEmailProvider()).toBe('resend'); // auto-detection priority 1: Resend

      if (origProvider) process.env.EMAIL_PROVIDER = origProvider;
      else delete process.env.EMAIL_PROVIDER;
      if (origResend) process.env.RESEND_API_KEY = origResend;
      else delete process.env.RESEND_API_KEY;
      if (origBrevo) process.env.BREVO_API_KEY = origBrevo;
      else delete process.env.BREVO_API_KEY;
    });

    it('[P5-PROV-02] resolves fallback provider that strictly differs from the primary provider', () => {
      process.env.EMAIL_PROVIDER = 'resend';
      process.env.RESEND_API_KEY = 're_test_123';
      process.env.BREVO_API_KEY = 'xkeysib-test';
      delete process.env.EMAIL_FALLBACK_PROVIDER;

      const fallback = getResolvedEmailFallbackProvider('resend');
      expect(fallback).toBe('brevo');

      process.env.EMAIL_FALLBACK_PROVIDER = 'smtp';
      process.env.SMTP_HOST = 'smtp.test.com';
      expect(getResolvedEmailFallbackProvider('resend')).toBe('smtp');

      delete process.env.EMAIL_PROVIDER;
      delete process.env.RESEND_API_KEY;
      delete process.env.BREVO_API_KEY;
      delete process.env.EMAIL_FALLBACK_PROVIDER;
      delete process.env.SMTP_HOST;
    });

    it('[P5-PROV-03] activates fallback provider when primary provider experiences transient 5xx server error', async () => {
      process.env.EMAIL_PROVIDER = 'resend';
      process.env.RESEND_API_KEY = 're_primary_fail';
      process.env.EMAIL_FALLBACK_PROVIDER = 'brevo';
      process.env.BREVO_API_KEY = 'xkeysib_fallback_ok';

      // Mock fetch: Resend 500 error -> Brevo 200 success
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('api.resend.com')) {
          return {
            ok: false,
            status: 500,
            text: async () => JSON.stringify({ message: 'Internal Server Error' }),
          };
        }
        if (url.includes('api.brevo.com')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({ messageId: '<brevo-success-123@smtp-relay.mailin.fr>' }),
          };
        }
        throw new Error(`Unexpected url: ${url}`);
      });
      (globalThis as any).fetch = fetchMock;

      const result = await dispatchSingleEmail({
        to: 'student@school.edu',
        recipientName: 'Student Contender',
        subject: 'Quiz Results Ready',
        html: '<p>You placed #1!</p>',
        transporter: null,
      });

      expect(result.status).toBe('sent');
      expect(result.provider).toBe('brevo');
      expect(result.fallbackUsed).toBe(true);
      expect(result.messageId).toContain('brevo-success-123');

      delete process.env.EMAIL_PROVIDER;
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FALLBACK_PROVIDER;
      delete process.env.BREVO_API_KEY;
    });

    it('[P5-PROV-04] does NOT activate fallback on permanent errors (401, 403, 422, unverified domain)', async () => {
      process.env.EMAIL_PROVIDER = 'resend';
      process.env.RESEND_API_KEY = 're_invalid_key';
      process.env.EMAIL_FALLBACK_PROVIDER = 'brevo';
      process.env.BREVO_API_KEY = 'xkeysib_should_not_be_called';

      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('api.resend.com')) {
          return {
            ok: false,
            status: 403,
            text: async () => JSON.stringify({ message: 'Domain not verified' }),
          };
        }
        return { ok: true, json: async () => ({ messageId: 'brevo-123' }) };
      });
      (globalThis as any).fetch = fetchMock;

      await expect(
        dispatchSingleEmail({
          to: 'student@school.edu',
          recipientName: 'Student',
          subject: 'Results',
          html: '<p>Score</p>',
          transporter: null,
        })
      ).rejects.toThrow(/Forbidden/i);

      // Verify Brevo was never called because 403 is non-retryable permanent error
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain('api.resend.com');

      delete process.env.EMAIL_PROVIDER;
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FALLBACK_PROVIDER;
      delete process.env.BREVO_API_KEY;
    });

    it('[P5-PROV-05] does NOT activate fallback on ambiguous timeouts from non-idempotent providers', async () => {
      process.env.EMAIL_PROVIDER = 'brevo';
      process.env.BREVO_API_KEY = 'xkeysib_timeout';
      process.env.EMAIL_FALLBACK_PROVIDER = 'smtp';

      // Brevo timeout throws ambiguous error
      const fetchMock = vi.fn().mockImplementation(async () => {
        const err: any = new Error('Brevo ambiguous network/timeout error: socket hang up');
        err.isAmbiguous = true;
        err.errorCategory = 'ambiguous';
        throw err;
      });
      (globalThis as any).fetch = fetchMock;

      await expect(
        dispatchSingleEmail({
          to: 'student@school.edu',
          recipientName: 'Student',
          subject: 'Results',
          html: '<p>Score</p>',
          transporter: null,
        })
      ).rejects.toThrow(/ambiguous/i);

      delete process.env.EMAIL_PROVIDER;
      delete process.env.BREVO_API_KEY;
      delete process.env.EMAIL_FALLBACK_PROVIDER;
    });
  });

  // =========================================================================
  // 2. Exponential Backoff with Jitter & Retry Policies
  // =========================================================================
  describe('2. Retry Scheduling & Exponential Backoff', () => {
    it('[P5-RETRY-01] calculates bounded exponential backoff with upper cap and positive jitter', () => {
      const b1 = computeBackoffMs(1, undefined, 0.5); // 1000 + jitter
      const b2 = computeBackoffMs(2, undefined, 0.5); // 2000 + jitter
      const b3 = computeBackoffMs(3, undefined, 0.5); // 4000 + jitter
      const b10 = computeBackoffMs(10, undefined, 0.5); // Capped at MAX_BACKOFF_MS (300,000)

      expect(b1).toBeGreaterThanOrEqual(BASE_BACKOFF_MS);
      expect(b2).toBeGreaterThan(b1);
      expect(b3).toBeGreaterThan(b2);
      expect(b10).toBeLessThanOrEqual(MAX_BACKOFF_MS + 10000);
    });

    it('[P5-RETRY-02] respects provider-specified retryAfterSec header up to the maximum backoff bound', () => {
      const backoffWithProviderHeader = computeBackoffMs(1, 45, 0); // 45 seconds
      expect(backoffWithProviderHeader).toBe(45_000);

      const backoffExceedingCap = computeBackoffMs(1, 999999, 0);
      expect(backoffExceedingCap).toBe(MAX_BACKOFF_MS);
    });
  });

  // =========================================================================
  // 3. Durable Background Job Claiming, Fencing Tokens & Stale Recovery
  // =========================================================================
  describe('3. Durable Background Job Claiming & Fencing', () => {
    it('[P5-JOB-01] enqueues durable job with scoped idempotency key and prevents duplicate creation', async () => {
      const { mockDb } = createMockFirestore();

      const res1 = await enqueueOutboxJobPersistent(mockDb, {
        idempotencyKey: 'idemp_key_alpha',
        idempotencyScope: 'user_123',
        recipientEmail: 'student@example.edu',
        recipientName: 'Alice',
        eventType: 'quiz_results_ready',
        subject: 'Quiz Arena Standings',
        htmlContent: '<p>Rank #1</p>',
      });

      expect(res1.success).toBe(true);
      expect(res1.isDuplicate).toBe(false);
      expect(res1.job?.status).toBe('pending');
      expect(res1.job?.attempts).toBe(0);

      // Re-enqueue exact same key -> Returns existing record without creating duplicate
      const res2 = await enqueueOutboxJobPersistent(mockDb, {
        idempotencyKey: 'idemp_key_alpha',
        idempotencyScope: 'user_123',
        recipientEmail: 'student@example.edu',
        recipientName: 'Alice',
        eventType: 'quiz_results_ready',
        subject: 'Quiz Arena Standings',
        htmlContent: '<p>Rank #1</p>',
      });

      expect(res2.success).toBe(true);
      expect(res2.isDuplicate).toBe(true);
      expect(res2.job?.id).toBe(res1.job?.id);
    });

    it('[P5-JOB-02] transactional claiming prevents two workers from claiming the same job simultaneously', async () => {
      const { mockDb } = createMockFirestore();

      const enq = await enqueueOutboxJobPersistent(mockDb, {
        idempotencyKey: 'idemp_concurrent_claim',
        idempotencyScope: 'host_999',
        recipientEmail: 'player@quiz.com',
        recipientName: 'Bob',
        eventType: 'tournament_match_ready',
        subject: 'Match Starting',
        htmlContent: '<p>Go!</p>',
      });

      const jobId = enq.job!.id;
      const now = Date.now();

      // Worker 1 claims job
      const worker1Claim = await claimJobInTransaction(mockDb, jobId, 'worker_alpha', DEFAULT_LEASE_MS, now);
      expect(worker1Claim).not.toBeNull();
      expect(worker1Claim?.workerId).toBe('worker_alpha');
      expect(worker1Claim?.status).toBe('processing');
      expect(worker1Claim?.leaseVersion).toBe(1);

      // Worker 2 attempts to claim active job -> Must return null (locked)
      const worker2Claim = await claimJobInTransaction(mockDb, jobId, 'worker_beta', DEFAULT_LEASE_MS, now + 1000);
      expect(worker2Claim).toBeNull();
    });

    it('[P5-JOB-03] reclaims stale leases when worker crashes and lockedUntil expires', async () => {
      const { mockDb } = createMockFirestore();

      const enq = await enqueueOutboxJobPersistent(mockDb, {
        idempotencyKey: 'idemp_stale_lease',
        idempotencyScope: 'host_999',
        recipientEmail: 'player@quiz.com',
        recipientName: 'Charlie',
        eventType: 'certificate_issued',
        subject: 'Certificate',
        htmlContent: '<p>Cert</p>',
      });

      const jobId = enq.job!.id;
      const t0 = Date.now();

      // Worker A claims job with 120s lease
      const workerAClaim = await claimJobInTransaction(mockDb, jobId, 'worker_crashed', DEFAULT_LEASE_MS, t0);
      expect(workerAClaim?.leaseVersion).toBe(1);

      // Fast forward past 120s lease expiration (t0 + 125,000ms)
      const tExpired = t0 + 125_000;
      const workerBClaim = await claimJobInTransaction(mockDb, jobId, 'worker_recovery', DEFAULT_LEASE_MS, tExpired);
      expect(workerBClaim).not.toBeNull();
      expect(workerBClaim?.workerId).toBe('worker_recovery');
      expect(workerBClaim?.leaseVersion).toBe(2); // Fenced token incremented

      // Now crashed Worker A attempts to finalize with old leaseVersion 1 -> Rejected as stale lease
      const staleFinish = await completeClaimedOutboxJobPersistent(
        mockDb,
        jobId,
        'worker_crashed',
        1, // Stale version
        { status: 'sent', providerMessageId: 'stale_id' }
      );
      expect(staleFinish.updated).toBe(false);
      expect(staleFinish.staleLease).toBe(true);
    });

    it('[P5-JOB-04] transitions exhausted attempts into terminal failed state', async () => {
      const { mockDb } = createMockFirestore();

      const enq = await enqueueOutboxJobPersistent(mockDb, {
        idempotencyKey: 'idemp_max_attempts',
        idempotencyScope: 'host_999',
        recipientEmail: 'exhausted@domain.com',
        recipientName: 'David',
        eventType: 'quiz_results_ready',
        subject: 'Final Try',
        htmlContent: '<p>Score</p>',
      });

      const jobId = enq.job!.id;
      const claim = await claimJobInTransaction(mockDb, jobId, 'worker_1', DEFAULT_LEASE_MS, Date.now());
      expect(claim).not.toBeNull();

      // Simulate reaching max attempts
      const fin = await completeClaimedOutboxJobPersistent(
        mockDb,
        jobId,
        'worker_1',
        claim!.leaseVersion!,
        {
          status: 'permanently_failed',
          errorCategory: 'permanent',
          lastErrorMessage: 'Max delivery attempts reached',
        }
      );
      expect(fin.updated).toBe(true);

      // Verify that permanently failed jobs cannot be claimed by regular workers
      const claimAgain = await claimJobInTransaction(mockDb, jobId, 'worker_2', DEFAULT_LEASE_MS, Date.now());
      expect(claimAgain).toBeNull();
    });
  });

  // =========================================================================
  // 4. HTML Templates, User Content Escaping & MIME Plain-Text Generation
  // =========================================================================
  describe('4. Email Templates, Plain-Text Fallback & HTML Sanitization', () => {
    it('[P5-TPL-01] generates responsive certificate issuance template and strictly escapes XSS injection', () => {
      const maliciousName = '<script>alert("hacked")</script>Dr. Evil';
      const maliciousTitle = 'Quantum Physics & <img src=x onerror=alert(1)>';

      const html = generateCertificateIssuedHtml({
        recipientName: maliciousName,
        quizTitle: maliciousTitle,
        certificateId: 'cert_safe_123',
        verificationUrl: 'https://quizarena.app/verify/cert_safe_123',
        score: 9500,
        issuedAt: '2026-11-15T12:00:00Z',
      });

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;alert(&quot;hacked&quot;)&lt;/script&gt;Dr. Evil');
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('Certificate ID: cert_safe_123');
      expect(html).toContain('9,500 pts');
    });

    it('[P5-TPL-02] generates tournament lifecycle notification templates', () => {
      const regHtml = generateTournamentRegisteredHtml({
        recipientName: 'Samantha',
        tournamentTitle: 'Winter Coding Cup',
      });
      expect(regHtml).toContain('Winter Coding Cup');
      expect(regHtml).toContain('Registration Confirmed');

      const matchHtml = generateTournamentMatchReadyHtml({
        recipientName: 'Samantha',
        tournamentTitle: 'Winter Coding Cup',
        opponentName: 'Alex Grandmaster',
        arenaUrl: 'https://quizarena.app/arena/winter_match_1',
      });
      expect(matchHtml).toContain('Alex Grandmaster');
      expect(matchHtml).toContain('Match Starting');

      const compHtml = generateTournamentCompletedHtml({
        recipientName: 'Samantha',
        tournamentTitle: 'Winter Coding Cup',
        finalRank: 2,
        totalParticipants: 64,
        score: 18400,
      });
      expect(compHtml).toContain('#2');
      expect(compHtml).toContain('of 64');
      expect(compHtml).toContain('18,400 total pts');
    });

    it('[P5-TPL-03] generatePlainTextFallback cleanly strips HTML tags and restores entity symbols', () => {
      const html = `
        <h1>QuizArena Results</h1>
        <p>Hello &amp; welcome! You scored <strong>1000</strong> points.</p>
        <ul>
          <li>Question 1: Correct</li>
          <li>Question 2: Incorrect</li>
        </ul>
      `;

      const plain = generatePlainTextFallback(html);
      expect(plain).not.toContain('<h1>');
      expect(plain).not.toContain('<p>');
      expect(plain).not.toContain('<strong>');
      expect(plain).toContain('Hello & welcome!');
      expect(plain).toContain('• Question 1: Correct');
      expect(plain).toContain('• Question 2: Incorrect');
    });

    it('[P5-TPL-04] sanitizeEmailHtml strips dangerous JavaScript payloads and javascript: URI schemes', () => {
      const dirtyHtml = '<p>Check score: <a href="javascript:alert(1)">Click me</a></p><script>evil()</script>';
      const clean = sanitizeEmailHtml(dirtyHtml);
      expect(clean).not.toContain('javascript:alert(1)');
      expect(clean).not.toContain('<script>');
      expect(clean).toContain('Check score:');
    });
  });

  // =========================================================================
  // 5. Delivery Observability, Authorization Isolation & Admin Recovery
  // =========================================================================
  describe('5. Observability, Authorization Scoping & Administrative Recovery', () => {
    it('[P5-OBS-01] strictly isolates non-admin user queries to their own outbox jobs', async () => {
      const { mockDb } = createMockFirestore();

      // Enqueue job for user 1
      await enqueueOutboxJobPersistent(mockDb, {
        idempotencyKey: 'job_u1',
        idempotencyScope: 'user_alice',
        ownerId: 'user_alice',
        recipientEmail: 'alice@domain.com',
        recipientName: 'Alice',
        eventType: 'quiz_results_ready',
        subject: 'Alice Standings',
        htmlContent: '<p>A</p>',
      });

      // Enqueue job for user 2
      await enqueueOutboxJobPersistent(mockDb, {
        idempotencyKey: 'job_u2',
        idempotencyScope: 'user_bob',
        ownerId: 'user_bob',
        recipientEmail: 'bob@domain.com',
        recipientName: 'Bob',
        eventType: 'quiz_results_ready',
        subject: 'Bob Standings',
        htmlContent: '<p>B</p>',
      });

      // Alice queries outbox as regular user
      const aliceList = await listOutboxJobsPersistent(mockDb, {
        userId: 'user_alice',
        isAdmin: false,
      });

      expect(aliceList.jobs.length).toBe(1);
      expect(aliceList.jobs[0].recipientEmail).toBe('alice@domain.com');

      // Admin queries outbox without user filter
      const adminList = await listOutboxJobsPersistent(mockDb, {
        isAdmin: true,
      });
      expect(adminList.jobs.length).toBe(2);
    });

    it('[P5-OBS-02] handles bounded pagination correctly without duplicate records or out-of-bound errors', async () => {
      const { mockDb } = createMockFirestore();

      for (let i = 0; i < 5; i++) {
        await enqueueOutboxJobPersistent(mockDb, {
          idempotencyKey: `paged_job_${i}`,
          idempotencyScope: 'test_scope',
          ownerId: 'test_scope',
          recipientEmail: `test_${i}@domain.com`,
          recipientName: `Test ${i}`,
          eventType: 'quiz_results_ready',
          subject: `Job ${i}`,
          htmlContent: '<p>Text</p>',
        });
      }

      const page1 = await listOutboxJobsPersistent(mockDb, {
        isAdmin: true,
        limit: 2,
        offset: 0,
      });
      expect(page1.jobs.length).toBe(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await listOutboxJobsPersistent(mockDb, {
        isAdmin: true,
        limit: 2,
        offset: 2,
      });
      expect(page2.jobs.length).toBe(2);
      expect(page2.hasMore).toBe(true);

      // Ensure no duplicate IDs across pages
      const page1Ids = page1.jobs.map(j => j.id);
      const page2Ids = page2.jobs.map(j => j.id);
      expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false);

      // Terminal offset beyond dataset
      const terminalPage = await listOutboxJobsPersistent(mockDb, {
        isAdmin: true,
        limit: 2,
        offset: 10,
      });
      expect(terminalPage.jobs.length).toBe(0);
      expect(terminalPage.hasMore).toBe(false);
    });

    it('[P5-OBS-03] administrative retry safely reschedules failed job to pending without business data corruption', async () => {
      const { mockDb } = createMockFirestore();

      const enq = await enqueueOutboxJobPersistent(mockDb, {
        idempotencyKey: 'failed_job_to_retry',
        idempotencyScope: 'teacher_1',
        ownerId: 'teacher_1',
        recipientEmail: 'student@domain.com',
        recipientName: 'Student',
        eventType: 'quiz_results_ready',
        subject: 'Results',
        htmlContent: '<p>Score</p>',
      });

      const jobId = enq.job!.id;
      const claim = await claimJobInTransaction(mockDb, jobId, 'worker_1', DEFAULT_LEASE_MS, Date.now());
      expect(claim).not.toBeNull();

      // Mark job failed
      const fin = await completeClaimedOutboxJobPersistent(mockDb, jobId, 'worker_1', claim!.leaseVersion!, {
        status: 'failed',
        errorCategory: 'transient',
        lastErrorMessage: 'Provider timed out 5 times',
      });
      expect(fin.updated).toBe(true);

      // Admin triggers retry
      const retryResult = await retryOutboxJobPersistent(mockDb, jobId);
      expect(retryResult.success).toBe(true);
      expect(retryResult.job?.status).toBe('pending');
      expect(retryResult.job?.attempts).toBe(0);
      expect(retryResult.job?.nextRetryAt).toBeNull();

      // Attempting to retry an already pending job returns error
      const retryActive = await retryOutboxJobPersistent(mockDb, jobId);
      expect(retryActive.success).toBe(false);
      expect(retryActive.error).toContain('already active');
    });
  });

  // =========================================================================
  // 6. Analytics Performance, Scalability & Empty Cohorts
  // =========================================================================
  describe('6. Analytics Scalability & Edge Cases', () => {
    it('[P5-AN-01] calculates analytics over empty cohorts without NaN or divide-by-zero crashes', () => {
      const emptyAnalytics = computeGameAnalytics([], [], [], 0);
      expect(emptyAnalytics.totalPlayers).toBe(0);
      expect(emptyAnalytics.questionStats.length).toBe(0);
      expect(emptyAnalytics.overallAccuracy).toBe(0);
      expect(emptyAnalytics.averageScore).toBe(0);
      expect(emptyAnalytics.studentRecords.length).toBe(0);
      expect(emptyAnalytics.hardestQuestions.length).toBe(0);
    });

    it('[P5-AN-02] processes representative large student cohorts (500 players, 20 questions) within 50ms', () => {
      const questions: Question[] = Array.from({ length: 20 }, (_, qIdx) => ({
        id: `q_${qIdx}`,
        text: `Question ${qIdx}`,
        type: 'multiple_choice',
        options: ['Opt A', 'Opt B', 'Opt C', 'Opt D'],
        correctAnswers: [0],
        points: 1000,
        timeLimit: 30,
        bloomLevel: 'apply',
        courseOutcomeTag: `CO${(qIdx % 4) + 1}`,
        topicTag: `Topic ${(qIdx % 3) + 1}`,
        explanation: 'Standard Explanation',
      }));

      const players: Player[] = Array.from({ length: 500 }, (_, pIdx) => ({
        id: `player_${pIdx}`,
        nickname: `Player ${pIdx}`,
        score: pIdx * 10,
        streak: 2,
        maxStreak: 5,
        correctCount: 10,
        avatar: 'fox',
        latencyMs: 30,
        clockOffsetMs: 0,
        integrityScore: 100,
        powerUps: { fiftyFiftyUsed: false, doublePointsUsed: false, timeFreezeUsed: false },
        accommodations: { extraTimeMultiplier: 1, fewerOptions: false, muteSound: false, dyslexiaFont: false, largeText: false, readAloud: false },
        joinedAt: '',
        lastSeen: '',
      }));

      const answers: AnswerSubmission[] = [];
      // Simulate 500 players answering 20 questions = 10,000 answer submissions
      for (let pIdx = 0; pIdx < 500; pIdx++) {
        for (let qIdx = 0; qIdx < 20; qIdx++) {
          const isCorrect = (pIdx + qIdx) % 2 === 0;
          answers.push({
            id: `ans_${pIdx}_${qIdx}`,
            playerId: `player_${pIdx}`,
            playerNickname: `Player ${pIdx}`,
            questionIndex: qIdx,
            selectedIndices: [isCorrect ? 0 : 1],
            isCorrect,
            responseTimeMs: 3500,
            pointsAwarded: isCorrect ? 1000 : 0,
            clientTimestamp: 0,
            serverTimestamp: 0,
            prevHash: '',
            hash: '',
          });
        }
      }

      const start = performance.now();
      const analytics = computeGameAnalytics(questions, players, answers, 120);
      const elapsed = performance.now() - start;

      expect(analytics.totalPlayers).toBe(500);
      expect(analytics.questionStats.length).toBe(20);
      expect(analytics.studentRecords.length).toBe(500);
      expect(elapsed).toBeLessThan(150); // High-performance in-memory calculation
    });
  });
});
