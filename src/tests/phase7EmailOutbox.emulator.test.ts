/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp, type App as AdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth, type Auth as AdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  EMAIL_OUTBOX_COLLECTION,
  EMAIL_WEBHOOK_EVENTS_COLLECTION,
  EMAIL_OUTBOX_METRICS_COLLECTION,
  EMAIL_OUTBOX_METRICS_DOC_ID,
  enqueueOutboxJobPersistent,
  processOutboxBatchPersistent,
  renewOutboxLeasePersistent,
  completeClaimedOutboxJobPersistent,
  getOutboxMetricsPersistent,
  reconcileOutboxMetricsPersistent,
  cancelOutboxJobsForAccountDeletion,
  type PersistentEmailSender,
} from '../server/emailOutboxEngine.ts';
import {
  dispatchSingleEmail,
  getResolvedEmailProvider,
  getResolvedFromAddress,
} from '../server/resultEmailsHandler.ts';
import { handleOutboxWebhook } from '../server/notificationHandler.ts';
import {
  ACCOUNT_DELETION_EMAIL_BLOCKS_COLLECTION,
  hashIdentifier,
} from '../server/accountDeletionEngine.ts';

function createProviderSender(transporterOverride: any = null): PersistentEmailSender {
  return async (job) => {
    const provider = getResolvedEmailProvider();
    const fromAddress = getResolvedFromAddress(provider);
    try {
      const dispatchResult = await dispatchSingleEmail({
        to: job.recipientEmail,
        recipientName: job.recipientName || 'Participant',
        subject: job.subject,
        html: job.htmlContent,
        transporter: transporterOverride,
        fromAddress,
        idempotencyKey: job.idempotencyKey,
      });
      if (dispatchResult.status === 'sent') {
        return {
          success: true,
          provider: dispatchResult.provider || provider,
          providerMessageId: dispatchResult.messageId || `msg_${job.id}`,
        };
      }
      return {
        success: false,
        error: 'Email delivery provider is not configured or skipped dispatch.',
        isPermanent: false,
      };
    } catch (err: any) {
      const isPermanent = Boolean(
        err?.isPermanent ||
          err?.status === 403 ||
          err?.status === 422 ||
          /invalid|550|rejected|401|403|422|unauthorized|forbidden|domain.not.verified|not.allowed/i.test(
            err?.message || ''
          )
      );
      return {
        success: false,
        error: err?.message,
        isPermanent,
        isAmbiguous: Boolean(err?.isAmbiguous),
        retryAfterSec: err?.retryAfter,
        errorCategory: err?.errorCategory,
      };
    }
  };
}

const DEMO_PROJECT_ID = 'demo-quizarena-test';

function signSvixPayload(secret: string, svixId: string, timestampSec: number, rawBody: string): string {
  const rawKey = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice('whsec_'.length), 'base64')
    : Buffer.from(secret, 'utf8');
  const signed = `${svixId}.${timestampSec}.${rawBody}`;
  const sig = crypto.createHmac('sha256', rawKey).update(signed, 'utf8').digest('base64');
  return `v1,${sig}`;
}

function createMockReqRes(opts: {
  headers?: Record<string, string>;
  body?: any;
  rawBody?: Buffer;
}) {
  let statusCode = 200;
  let responseBody: any = null;
  const req: any = {
    headers: opts.headers || {},
    body: opts.body || {},
    rawBody: opts.rawBody,
  };
  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      responseBody = data;
      return res;
    },
  };
  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseBody,
  };
}

describe('Phase 7.3 — Durable Email Outbox Provider, Worker & Webhook Emulator Integration', () => {
  let adminApp: AdminApp;
  let adminAuth: AdminAuth;
  let adminDb: AdminFirestore;
  let rulesEnv: RulesTestEnvironment;
  let mockServer: http.Server;
  let mockPort = 0;
  let origFetch: typeof fetch;
  let providerHandler: (req: http.IncomingMessage, bodyStr: string, res: http.ServerResponse) => void;

  const savedEnv = {
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };

  beforeAll(async () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

    adminApp = initializeAdminApp({ projectId: DEMO_PROJECT_ID }, 'phase73-admin');
    adminAuth = getAdminAuth(adminApp);
    adminDb = getAdminFirestore(adminApp);

    rulesEnv = await initializeTestEnvironment({
      projectId: DEMO_PROJECT_ID,
      firestore: {
        rules: fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });

    providerHandler = (_req, _body, res) => {
      res.writeHead(500);
      res.end('unconfigured');
    };

    mockServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        providerHandler(req, bodyStr, res);
      });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = (mockServer.address() as any).port;
        resolve();
      });
    });

    // Route only api.resend.com / api.brevo.com calls to the local 127.0.0.1 test server
    origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input?.url || String(input);
      if (urlStr.startsWith('https://api.resend.com/')) {
        const localUrl = `http://127.0.0.1:${mockPort}/resend${urlStr.slice('https://api.resend.com'.length)}`;
        return origFetch(localUrl, init);
      }
      if (urlStr.startsWith('https://api.brevo.com/')) {
        const localUrl = `http://127.0.0.1:${mockPort}/brevo${urlStr.slice('https://api.brevo.com'.length)}`;
        return origFetch(localUrl, init);
      }
      return origFetch(input, init);
    }) as typeof fetch;
  });

  afterAll(async () => {
    globalThis.fetch = origFetch;
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
    if (rulesEnv) await rulesEnv.cleanup();
    if (adminApp) await deleteAdminApp(adminApp);
    process.env.EMAIL_PROVIDER = savedEnv.EMAIL_PROVIDER;
    process.env.RESEND_API_KEY = savedEnv.RESEND_API_KEY;
    process.env.BREVO_API_KEY = savedEnv.BREVO_API_KEY;
    process.env.WEBHOOK_SECRET = savedEnv.WEBHOOK_SECRET;
    process.env.EMAIL_FROM = savedEnv.EMAIL_FROM;
  });

  beforeEach(async () => {
    await rulesEnv.clearFirestore();
    process.env.EMAIL_FROM = 'QuizArena Test <noreply@example.test>';
    delete process.env.RESEND_API_KEY;
    delete process.env.BREVO_API_KEY;
    delete process.env.WEBHOOK_SECRET;
    delete process.env.EMAIL_PROVIDER;
  });

  it('1. tests Resend, Brevo, and SMTP delivery, rejections, rate limits, and ambiguous timeouts', async () => {
    // --- A. Resend ---
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_local_only_key';

    let seenIdempotencyHeader: string | undefined;
    let resendMode: 'accept' | 'reject_403' | 'rate_429' | 'server_500' = 'accept';

    providerHandler = (req, _body, res) => {
      if (req.url?.startsWith('/resend/')) {
        seenIdempotencyHeader = req.headers['idempotency-key'] as string | undefined;
        if (resendMode === 'accept') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'resend_msg_101' }));
        } else if (resendMode === 'reject_403') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Forbidden sender' }));
        } else if (resendMode === 'rate_429') {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '15' });
          res.end(JSON.stringify({ message: 'Too many requests' }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Upstream 500' }));
        }
      }
    };

    const rAccept = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_1',
      idempotencyKey: 'resend-accept-1',
      recipientEmail: 'student1@example.test',
      recipientName: 'Student 1',
      eventType: 'quiz_results_ready',
      subject: 'Your Quiz Results',
      htmlContent: '<p>Score: 90%</p>',
      textContent: 'Score: 90%',
    });
    expect(rAccept.isDuplicate).toBe(false);
    expect(rAccept.job).toBeDefined();

    // Duplicate enqueue returns existing job without creating a second doc
    const rDup = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_1',
      idempotencyKey: 'resend-accept-1',
      recipientEmail: 'student1@example.test',
      recipientName: 'Student 1',
      eventType: 'quiz_results_ready',
      subject: 'Your Quiz Results',
      htmlContent: '<p>Score: 90%</p>',
      textContent: 'Score: 90%',
    });
    expect(rDup.isDuplicate).toBe(true);
    expect(rDup.job!.id).toBe(rAccept.job!.id);

    const pAccept = await processOutboxBatchPersistent(adminDb, 10, createProviderSender(), 'worker-1');
    expect(pAccept.acceptedCount).toBe(1);
    expect(seenIdempotencyHeader).toBe(rAccept.job!.idempotencyKey);
    const acceptSnap = await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(rAccept.job!.id).get();
    expect(acceptSnap.data()?.status).toBe('accepted');
    expect(acceptSnap.data()?.providerMessageId).toBe('resend_msg_101');

    // Resend 403 -> permanent failed
    resendMode = 'reject_403';
    const r403 = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_1',
      idempotencyKey: 'resend-403',
      recipientEmail: 'student2@example.test',
      recipientName: 'Student 2',
      eventType: 'quiz_results_ready',
      subject: 'Results',
      htmlContent: '<p>Hi</p>',
      textContent: 'Hi',
    });
    const p403 = await processOutboxBatchPersistent(adminDb, 10, createProviderSender(), 'worker-1');
    expect(p403.failedCount).toBe(1);
    expect((await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(r403.job!.id).get()).data()?.status).toBe('failed');

    // Resend 429 -> retrying with Retry-After respected
    resendMode = 'rate_429';
    const r429 = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_1',
      idempotencyKey: 'resend-429',
      recipientEmail: 'student3@example.test',
      recipientName: 'Student 3',
      eventType: 'quiz_results_ready',
      subject: 'Results',
      htmlContent: '<p>Hi</p>',
      textContent: 'Hi',
    });
    const nowMs = Date.now();
    const p429 = await processOutboxBatchPersistent(adminDb, 10, createProviderSender(), 'worker-1', { nowMs });
    expect(p429.retriedCount).toBe(1);
    const snap429 = (await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(r429.job!.id).get()).data()!;
    expect(snap429.status).toBe('retrying');
    expect(Date.parse(snap429.nextRetryAt) - nowMs).toBeGreaterThanOrEqual(14_000);

    // Resend 500 -> retrying
    resendMode = 'server_500';
    const r500 = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_1',
      idempotencyKey: 'resend-500',
      recipientEmail: 'student4@example.test',
      recipientName: 'Student 4',
      eventType: 'quiz_results_ready',
      subject: 'Results',
      htmlContent: '<p>Hi</p>',
      textContent: 'Hi',
    });
    const p500 = await processOutboxBatchPersistent(adminDb, 10, createProviderSender(), 'worker-1');
    expect(p500.retriedCount).toBe(1);
    expect((await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(r500.job!.id).get()).data()?.status).toBe('retrying');

    // --- B. Brevo ---
    await rulesEnv.clearFirestore();
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_PROVIDER = 'brevo';
    process.env.BREVO_API_KEY = 'xkeysib_test_local_only';

    let brevoMode: 'accept' | 'reject_400' | 'timeout' = 'accept';
    providerHandler = (req, _body, res) => {
      if (req.url?.startsWith('/brevo/')) {
        if (brevoMode === 'accept') {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ messageId: '<brevo_msg_202@example.test>' }));
        } else if (brevoMode === 'reject_400') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Invalid parameter' }));
        } else {
          // Simulate socket hangup / ambiguous timeout after request dispatch
          req.socket.destroy();
        }
      }
    };

    await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_2',
      idempotencyKey: 'brevo-accept',
      recipientEmail: 'b1@example.test',
      recipientName: 'Brevo 1',
      eventType: 'quiz_results_ready',
      subject: 'Brevo Results',
      htmlContent: '<p>Done</p>',
      textContent: 'Done',
    });
    expect((await processOutboxBatchPersistent(adminDb, 10, createProviderSender(), 'worker-b')).acceptedCount).toBe(1);

    brevoMode = 'reject_400';
    const b400 = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_2',
      idempotencyKey: 'brevo-400',
      recipientEmail: 'b2@example.test',
      recipientName: 'Brevo 2',
      eventType: 'quiz_results_ready',
      subject: 'Brevo 400',
      htmlContent: '<p>Done</p>',
      textContent: 'Done',
    });
    expect((await processOutboxBatchPersistent(adminDb, 10, createProviderSender(), 'worker-b')).failedCount).toBe(1);
    expect((await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(b400.job!.id).get()).data()?.status).toBe('failed');

    brevoMode = 'timeout';
    const bTimeout = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_2',
      idempotencyKey: 'brevo-timeout',
      recipientEmail: 'b3@example.test',
      recipientName: 'Brevo 3',
      eventType: 'quiz_results_ready',
      subject: 'Brevo Timeout',
      htmlContent: '<p>Done</p>',
      textContent: 'Done',
    });
    const pBrevoTimeout = await processOutboxBatchPersistent(adminDb, 10, createProviderSender(), 'worker-b');
    expect(pBrevoTimeout.ambiguousCount).toBe(1);
    expect(pBrevoTimeout.acceptedCount).toBe(0);
    expect(
      (await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(bTimeout.job!.id).get()).data()?.status
    ).toBe('ambiguous');

    // --- C. SMTP ---
    await rulesEnv.clearFirestore();
    delete process.env.BREVO_API_KEY;
    process.env.EMAIL_PROVIDER = 'smtp';

    const sOk = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_3',
      idempotencyKey: 'smtp-ok',
      recipientEmail: 's1@example.test',
      recipientName: 'SMTP 1',
      eventType: 'quiz_results_ready',
      subject: 'SMTP OK',
      htmlContent: '<p>SMTP</p>',
      textContent: 'SMTP',
    });
    const okTransporter: any = {
      sendMail: async () => ({ messageId: 'smtp_msg_303' }),
    };
    expect(
      (await processOutboxBatchPersistent(adminDb, 10, createProviderSender(okTransporter), 'worker-s')).acceptedCount
    ).toBe(1);
    expect((await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(sOk.job!.id).get()).data()?.status).toBe('accepted');

    const sFail = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_3',
      idempotencyKey: 'smtp-fail',
      recipientEmail: 's2@example.test',
      recipientName: 'SMTP 2',
      eventType: 'quiz_results_ready',
      subject: 'SMTP Fail',
      htmlContent: '<p>SMTP</p>',
      textContent: 'SMTP',
    });
    const permFailTransporter: any = {
      sendMail: async () => {
        const err: any = new Error('550 Mailbox unavailable');
        err.responseCode = 550;
        err.isPermanent = true;
        throw err;
      },
    };
    expect(
      (await processOutboxBatchPersistent(adminDb, 10, createProviderSender(permFailTransporter), 'worker-s'))
        .failedCount
    ).toBe(1);
    expect((await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(sFail.job!.id).get()).data()?.status).toBe('failed');

    const sAmb = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_3',
      idempotencyKey: 'smtp-amb',
      recipientEmail: 's3@example.test',
      recipientName: 'SMTP 3',
      eventType: 'quiz_results_ready',
      subject: 'SMTP Timeout',
      htmlContent: '<p>SMTP</p>',
      textContent: 'SMTP',
    });
    const timeoutTransporter: any = {
      sendMail: async () => {
        const err: any = new Error('Greeting never received (ETIMEDOUT)');
        err.code = 'ETIMEDOUT';
        err.isAmbiguous = true;
        throw err;
      },
    };
    const pSmtpAmb = await processOutboxBatchPersistent(
      adminDb,
      10,
      createProviderSender(timeoutTransporter),
      'worker-s'
    );
    expect(pSmtpAmb.ambiguousCount).toBe(1);
    expect((await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(sAmb.job!.id).get()).data()?.status).toBe('ambiguous');
  });

  it('2. enforces worker concurrency, lease renewal, expired lease takeover, fencing, and maxAttempts', async () => {
    process.env.EMAIL_PROVIDER = 'smtp';

    const enq = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_w',
      idempotencyKey: 'worker-race-1',
      recipientEmail: 'race@example.test',
      recipientName: 'Race User',
      eventType: 'quiz_results_ready',
      subject: 'Race Test',
      htmlContent: '<p>Race</p>',
      textContent: 'Race',
      maxAttempts: 2,
    });

    // Two concurrent workers race to process the same job with a short 200ms lease
    let notifyFirstClaimed!: () => void;
    const firstClaimedGate = new Promise<void>((r) => {
      notifyFirstClaimed = r;
    });
    let releaseFirstSend!: () => void;
    const firstSendGate = new Promise<void>((r) => {
      releaseFirstSend = r;
    });
    const slowTransporter: any = {
      sendMail: async () => {
        notifyFirstClaimed();
        await firstSendGate;
        return { messageId: 'slow_msg_1' };
      },
    };
    const fastTransporter: any = {
      sendMail: async () => ({ messageId: 'fast_msg_2' }),
    };

    const t0 = Date.now();
    const w1Promise = processOutboxBatchPersistent(adminDb, 10, createProviderSender(slowTransporter), 'worker-1', {
      leaseMs: 200,
      nowMs: t0,
    });
    // Wait deterministically until worker-1 has claimed the job and entered sendMail
    await firstClaimedGate;
    const w2Early = await processOutboxBatchPersistent(adminDb, 10, createProviderSender(fastTransporter), 'worker-2', {
      leaseMs: 200,
      nowMs: t0 + 40,
    });
    expect(w2Early.claimedCount).toBe(0);

    // Renew lease for worker-1, and verify stale worker-2 cannot renew
    const renewOk = await renewOutboxLeasePersistent(adminDb, enq.job!.id, 'worker-1', 1, 5000);
    expect(renewOk.renewed).toBe(true);
    const renewWrong = await renewOutboxLeasePersistent(adminDb, enq.job!.id, 'worker-2', 1, 5000);
    expect(renewWrong.renewed).toBe(false);

    // Force lease expiration in Firestore, then worker-2 reclaims (leaseVersion -> 2)
    await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(enq.job!.id).update({
      lockedUntil: new Date(t0 - 1000).toISOString(),
    });
    const w2Reclaim = await processOutboxBatchPersistent(adminDb, 10, createProviderSender(fastTransporter), 'worker-2', {
      leaseMs: 5000,
      nowMs: t0 + 300,
    });
    expect(w2Reclaim.claimedCount).toBe(1);
    expect(w2Reclaim.acceptedCount).toBe(1);

    // Release slow worker-1; its stale completion must be fenced out
    releaseFirstSend();
    const w1Done = await w1Promise;
    expect(w1Done.staleLeaseCount).toBe(1);

    const finalJob = (await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(enq.job!.id).get()).data()!;
    expect(finalJob.status).toBe('accepted');
    expect(finalJob.providerMessageId).toBe('fast_msg_2');
    expect(finalJob.leaseVersion).toBe(2);

    // maxAttempts exhaustion -> terminal failed
    const enqMax = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_w',
      idempotencyKey: 'max-attempts-1',
      recipientEmail: 'max@example.test',
      recipientName: 'Max User',
      eventType: 'quiz_results_ready',
      subject: 'Max Attempts',
      htmlContent: '<p>Retry</p>',
      textContent: 'Retry',
      maxAttempts: 2,
    });
    const transientTransporter: any = {
      sendMail: async () => {
        const err: any = new Error('Temporary 421');
        err.isPermanent = false;
        throw err;
      },
    };

    const attempt1 = await processOutboxBatchPersistent(adminDb, 10, createProviderSender(transientTransporter), 'worker-r', {
      nowMs: t0,
    });
    expect(attempt1.retriedCount).toBe(1);
    const attempt2 = await processOutboxBatchPersistent(adminDb, 10, createProviderSender(transientTransporter), 'worker-r', {
      nowMs: t0 + 120_000,
    });
    expect(attempt2.failedCount).toBe(1);
    expect((await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(enqMax.job!.id).get()).data()?.status).toBe('failed');
  });

  it('3. enforces Resend Svix webhook signatures, replay/dedup protection, terminal-state guard, and fail-closed providers', async () => {
    process.env.WEBHOOK_SECRET = `whsec_${Buffer.from('quizarena_phase73_webhook_secret_key').toString('base64')}`;

    // Unsupported providers fail closed with 501
    process.env.EMAIL_PROVIDER = 'brevo';
    const brevoRes = createMockReqRes({ body: {} });
    await handleOutboxWebhook(brevoRes.req, brevoRes.res, { adminDb });
    expect(brevoRes.getStatus()).toBe(501);

    process.env.EMAIL_PROVIDER = 'smtp';
    const smtpRes = createMockReqRes({ body: {} });
    await handleOutboxWebhook(smtpRes.req, smtpRes.res, { adminDb });
    expect(smtpRes.getStatus()).toBe(501);

    // Switch to Resend and seed an accepted job
    process.env.EMAIL_PROVIDER = 'resend';
    const enq = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_wh',
      idempotencyKey: 'wh-job-1',
      recipientEmail: 'wh@example.test',
      recipientName: 'Webhook User',
      eventType: 'quiz_results_ready',
      subject: 'Webhook Test',
      htmlContent: '<p>WH</p>',
      textContent: 'WH',
    });
    await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(enq.job!.id).update({
      status: 'accepted',
      provider: 'resend',
      providerMessageId: 're_msg_wh_1',
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const deliveredPayload = { type: 'email.delivered', data: { email_id: 're_msg_wh_1' } };
    const deliveredRaw = JSON.stringify(deliveredPayload);

    // Invalid signature -> 401
    const badSig = createMockReqRes({
      headers: {
        'svix-id': 'msg_bad',
        'svix-timestamp': String(nowSec),
        'svix-signature': 'v1,aW52YWxpZHNpZw==',
      },
      body: deliveredPayload,
      rawBody: Buffer.from(deliveredRaw, 'utf8'),
    });
    await handleOutboxWebhook(badSig.req, badSig.res, { adminDb });
    expect(badSig.getStatus()).toBe(401);

    // Expired timestamp (> 300s) -> 401
    const expiredTs = nowSec - 600;
    const expiredSig = signSvixPayload(process.env.WEBHOOK_SECRET, 'msg_exp', expiredTs, deliveredRaw);
    const expRes = createMockReqRes({
      headers: {
        'svix-id': 'msg_exp',
        'svix-timestamp': String(expiredTs),
        'svix-signature': expiredSig,
      },
      body: deliveredPayload,
      rawBody: Buffer.from(deliveredRaw, 'utf8'),
    });
    await handleOutboxWebhook(expRes.req, expRes.res, { adminDb });
    expect(expRes.getStatus()).toBe(401);

    // Valid signature -> delivered
    const validSig = signSvixPayload(process.env.WEBHOOK_SECRET, 'msg_deliv_1', nowSec, deliveredRaw);
    const okRes = createMockReqRes({
      headers: {
        'svix-id': 'msg_deliv_1',
        'svix-timestamp': String(nowSec),
        'svix-signature': validSig,
      },
      body: deliveredPayload,
      rawBody: Buffer.from(deliveredRaw, 'utf8'),
    });
    await handleOutboxWebhook(okRes.req, okRes.res, { adminDb });
    expect(okRes.getStatus()).toBe(200);
    expect(okRes.getData().job.status).toBe('delivered');

    // Replay / duplicate svix-id -> duplicate: true, metrics not double-counted
    const dupRes = createMockReqRes({
      headers: {
        'svix-id': 'msg_deliv_1',
        'svix-timestamp': String(nowSec),
        'svix-signature': validSig,
      },
      body: deliveredPayload,
      rawBody: Buffer.from(deliveredRaw, 'utf8'),
    });
    await handleOutboxWebhook(dupRes.req, dupRes.res, { adminDb });
    expect(dupRes.getStatus()).toBe(200);
    expect(dupRes.getData().duplicate).toBe(true);

    // Out-of-order bounced event after terminal delivered -> ignored, status stays delivered
    const bouncedPayload = { type: 'email.bounced', data: { email_id: 're_msg_wh_1' } };
    const bouncedRaw = JSON.stringify(bouncedPayload);
    const bouncedSig = signSvixPayload(process.env.WEBHOOK_SECRET, 'msg_bounce_late', nowSec, bouncedRaw);
    const lateRes = createMockReqRes({
      headers: {
        'svix-id': 'msg_bounce_late',
        'svix-timestamp': String(nowSec),
        'svix-signature': bouncedSig,
      },
      body: bouncedPayload,
      rawBody: Buffer.from(bouncedRaw, 'utf8'),
    });
    await handleOutboxWebhook(lateRes.req, lateRes.res, { adminDb });
    expect(lateRes.getStatus()).toBe(200);
    expect(lateRes.getData().job.status).toBe('delivered');

    // Verify metrics & webhook event count before concurrent test
    const metricsAfterSeq = await getOutboxMetricsPersistent(adminDb);
    expect(metricsAfterSeq.delivered).toBe(1);

    // Concurrent duplicate webhook requests (Promise.all) under Firestore transaction contention
    const enqConc = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_wh',
      idempotencyKey: 'wh-job-concurrent',
      recipientEmail: 'wh-conc@example.test',
      recipientName: 'Concurrent Webhook User',
      eventType: 'quiz_results_ready',
      subject: 'Concurrent Webhook Test',
      htmlContent: '<p>Concurrent</p>',
      textContent: 'Concurrent',
    });
    await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(enqConc.job!.id).update({
      status: 'accepted',
      provider: 'resend',
      providerMessageId: 're_msg_wh_concurrent',
    });

    const concPayload = { type: 'email.delivered', data: { email_id: 're_msg_wh_concurrent' } };
    const concRaw = JSON.stringify(concPayload);
    const concSvixId = 'msg_concurrent_1';
    const concSig = signSvixPayload(process.env.WEBHOOK_SECRET, concSvixId, nowSec, concRaw);

    const concMocks = Array.from({ length: 5 }, () =>
      createMockReqRes({
        headers: {
          'svix-id': concSvixId,
          'svix-timestamp': String(nowSec),
          'svix-signature': concSig,
        },
        body: concPayload,
        rawBody: Buffer.from(concRaw, 'utf8'),
      })
    );

    await Promise.all(concMocks.map((m) => handleOutboxWebhook(m.req, m.res, { adminDb })));

    expect(concMocks.every((m) => m.getStatus() === 200)).toBe(true);
    const nonDuplicateResponses = concMocks.filter((m) => !m.getData()?.duplicate);
    const duplicateResponses = concMocks.filter((m) => m.getData()?.duplicate === true);
    expect(nonDuplicateResponses).toHaveLength(1);
    expect(duplicateResponses).toHaveLength(4);

    // Only one effective webhook event record stored in emailWebhookEvents for concSvixId
    const webhookEventsSnap = await adminDb
      .collection(EMAIL_WEBHOOK_EVENTS_COLLECTION)
      .where('eventId', '==', concSvixId)
      .get();
    expect(webhookEventsSnap.size).toBe(1);

    // Outbox job transitioned once to delivered and metrics incremented exactly once
    const concJobData = (await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(enqConc.job!.id).get()).data()!;
    expect(concJobData.status).toBe('delivered');
    const metricsAfterConc = await getOutboxMetricsPersistent(adminDb);
    expect(metricsAfterConc.delivered).toBe(2);
  });

  it('4. enforces account deletion suppression, stale-worker fencing, and accurate metrics reconciliation', async () => {
    process.env.EMAIL_PROVIDER = 'smtp';
    const uid = 'del_outbox_user';
    const email = 'deleted.student@example.test';

    const job1 = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_del',
      idempotencyKey: 'del-job-1',
      recipientUid: uid,
      recipientEmail: email,
      recipientName: 'Deleted Student',
      eventType: 'quiz_results_ready',
      subject: 'Private Results',
      htmlContent: '<p>Score</p>',
      textContent: 'Score',
    });

    // Simulate active worker-1 having claimed the job at leaseVersion 1 with a providerMessageId
    await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(job1.job!.id).update({
      status: 'processing',
      lockedBy: 'worker-stale',
      leaseVersion: 1,
      lockedUntil: new Date(Date.now() + 60_000).toISOString(),
      provider: 'resend',
      providerMessageId: 're_msg_cancelled_late',
    });

    // Account deletion cancels & scrubs PII and increments leaseVersion -> 2
    const cancelRes = await cancelOutboxJobsForAccountDeletion(adminDb, {
      uid,
      email,
      pseudoId: 'deleted_pseudo_1',
    });
    expect(cancelRes.cancelledCount).toBe(1);

    // Stale worker-stale tries to mark job as accepted and restore fields -> fenced out!
    const staleComplete = await completeClaimedOutboxJobPersistent(adminDb, job1.job!.id, 'worker-stale', 1, {
      status: 'accepted',
      provider: 'smtp',
      providerMessageId: 'should_not_apply',
    });
    expect(staleComplete.updated).toBe(false);
    expect(staleComplete.staleLease).toBe(true);

    const scrubbed = (await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(job1.job!.id).get()).data()!;
    expect(scrubbed.status).toBe('cancelled');
    expect(scrubbed.recipientEmail).toBe('[deleted]');
    expect(scrubbed.recipientName).toBe('Deleted User');
    expect(scrubbed.subject).toBe('[cancelled]');
    expect(scrubbed.htmlContent).toBe('');
    expect(scrubbed.textContent).toBe('');
    expect(scrubbed.leaseVersion).toBe(2);

    // Late valid Resend email.delivered webhook for the cancelled job must be safely ignored
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.WEBHOOK_SECRET = `whsec_${Buffer.from('quizarena_phase73_webhook_secret_key').toString('base64')}`;
    const metricsBeforeLateWebhook = await getOutboxMetricsPersistent(adminDb);

    const lateNowSec = Math.floor(Date.now() / 1000);
    const lateDeliveredPayload = { type: 'email.delivered', data: { email_id: 're_msg_cancelled_late' } };
    const lateDeliveredRaw = JSON.stringify(lateDeliveredPayload);
    const lateDeliveredSig = signSvixPayload(
      process.env.WEBHOOK_SECRET,
      'msg_late_after_cancel',
      lateNowSec,
      lateDeliveredRaw
    );
    const lateAfterCancelRes = createMockReqRes({
      headers: {
        'svix-id': 'msg_late_after_cancel',
        'svix-timestamp': String(lateNowSec),
        'svix-signature': lateDeliveredSig,
      },
      body: lateDeliveredPayload,
      rawBody: Buffer.from(lateDeliveredRaw, 'utf8'),
    });
    await handleOutboxWebhook(lateAfterCancelRes.req, lateAfterCancelRes.res, { adminDb });
    expect(lateAfterCancelRes.getStatus()).toBe(200);
    expect(lateAfterCancelRes.getData().job.status).toBe('cancelled');

    const afterLateWebhook = (await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(job1.job!.id).get()).data()!;
    expect(afterLateWebhook.status).toBe('cancelled');
    expect(afterLateWebhook.recipientEmail).toBe('[deleted]');
    expect(afterLateWebhook.recipientName).toBe('Deleted User');
    expect(afterLateWebhook.subject).toBe('[cancelled]');
    expect(afterLateWebhook.htmlContent).toBe('');
    expect(afterLateWebhook.textContent).toBe('');
    expect(afterLateWebhook.deliveredAt).toBeUndefined();

    const metricsAfterLateWebhook = await getOutboxMetricsPersistent(adminDb);
    expect(metricsAfterLateWebhook.delivered).toBe(metricsBeforeLateWebhook.delivered);
    expect(metricsAfterLateWebhook.cancelled).toBe(metricsBeforeLateWebhook.cancelled);

    process.env.EMAIL_PROVIDER = 'smtp';

    // Enqueue job2 while not yet blocked, then write deletion email block before worker runs -> worker must cancel, never send
    const job2 = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_del',
      idempotencyKey: 'del-job-2',
      recipientUid: uid,
      recipientEmail: email,
      recipientName: 'Deleted Student',
      eventType: 'quiz_results_ready',
      subject: 'Should Be Suppressed',
      htmlContent: '<p>Suppressed</p>',
      textContent: 'Suppressed',
    });
    expect(job2.success).toBe(true);

    await adminDb
      .collection(ACCOUNT_DELETION_EMAIL_BLOCKS_COLLECTION)
      .doc(hashIdentifier(email))
      .set({ emailHash: hashIdentifier(email), createdAt: new Date().toISOString() });

    // Enqueue-time suppression guard rejects new jobs for blocked email immediately
    const job3Blocked = await enqueueOutboxJobPersistent(adminDb, {
      idempotencyScope: 'host_del',
      idempotencyKey: 'del-job-3-blocked',
      recipientUid: uid,
      recipientEmail: email,
      recipientName: 'Deleted Student',
      eventType: 'quiz_results_ready',
      subject: 'Blocked At Enqueue',
      htmlContent: '<p>Blocked</p>',
      textContent: 'Blocked',
    });
    expect(job3Blocked.success).toBe(false);
    expect(job3Blocked.suppressed).toBe(true);

    let sendMailCalled = 0;
    const spyTransporter: any = {
      sendMail: async () => {
        sendMailCalled++;
        return { messageId: 'never_sent' };
      },
    };
    const procSuppressed = await processOutboxBatchPersistent(
      adminDb,
      10,
      createProviderSender(spyTransporter),
      'worker-sup'
    );
    expect(sendMailCalled).toBe(0);
    expect(procSuppressed.cancelledCount).toBe(1);
    expect((await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(job2.job!.id).get()).data()?.status).toBe('cancelled');

    // Corrupt metrics doc intentionally, then run reconcileOutboxMetricsPersistent -> restores exact counts
    await adminDb.collection(EMAIL_OUTBOX_METRICS_COLLECTION).doc(EMAIL_OUTBOX_METRICS_DOC_ID).set({
      pending: 99,
      cancelled: 0,
      updatedAt: new Date().toISOString(),
    });
    const recon = await reconcileOutboxMetricsPersistent(adminDb);
    expect(recon.reconciled).toBe(true);
    const metrics = await getOutboxMetricsPersistent(adminDb);
    expect(metrics.pending).toBe(0);
    expect(metrics.cancelled).toBe(2);
  });
});
