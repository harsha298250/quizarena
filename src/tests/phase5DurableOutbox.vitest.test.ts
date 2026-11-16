/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  EMAIL_OUTBOX_COLLECTION,
  EMAIL_OUTBOX_METRICS_COLLECTION,
  EMAIL_OUTBOX_METRICS_DOC_ID,
  computeBackoffMs,
  enqueueOutboxJobPersistent,
  processOutboxBatchPersistent,
  renewOutboxLeasePersistent,
  completeClaimedOutboxJobPersistent,
  handleProviderWebhookPersistent,
  getOutboxMetricsPersistent,
  reconcileOutboxMetricsPersistent,
  cancelOutboxJobsForAccountDeletion,
} from '../server/emailOutboxEngine.ts';
import { dispatchSingleEmail, handleSendResults, handleSendTestEmail } from '../server/resultEmailsHandler.ts';
import {
  handleOutboxEnqueue,
  handleProcessOutbox,
  handleOutboxWebhook,
  handleOutboxMetrics,
} from '../server/notificationHandler.ts';
import {
  ACCOUNT_DELETION_EMAIL_BLOCKS_COLLECTION,
  hashIdentifier,
} from '../server/accountDeletionEngine.ts';
import { sharedRateLimiter } from '../server/sharedRateLimiter.ts';

function createStatefulFirestoreMock() {
  const store = new Map<string, Record<string, any>>();
  let txChain = Promise.resolve();

  const matchesWhere = (docData: any, filters: Array<{ field: string; op: string; value: any }>) => {
    for (const f of filters) {
      if (f.op === '==' && docData?.[f.field] !== f.value) return false;
    }
    return true;
  };

  const makeCollectionRef = (colPath: string): any => ({
    doc: (id: string) => makeDocRef(`${colPath}/${id}`),
    where: (field: string, op: string, value: any) => makeQuery(colPath, [{ field, op, value }]),
    limit: (n: number) => makeQuery(colPath, [], n),
    startAfter: (doc: any) => makeQuery(colPath, [], undefined, doc?.id),
    get: async () => makeQuery(colPath, []).get(),
  });

  const makeDocRef = (docPath: string): any => ({
    id: docPath.split('/').pop()!,
    path: docPath,
    collection: (subCol: string) => makeCollectionRef(`${docPath}/${subCol}`),
    get: async () => {
      const data = store.get(docPath);
      return {
        exists: data !== undefined,
        id: docPath.split('/').pop()!,
        ref: makeDocRef(docPath),
        data: () => (data ? structuredClone(data) : undefined),
      };
    },
    set: async (data: any, opts?: { merge?: boolean }) => {
      if (opts?.merge && store.has(docPath)) {
        store.set(docPath, { ...store.get(docPath)!, ...structuredClone(data) });
      } else {
        store.set(docPath, structuredClone(data));
      }
    },
    delete: async () => {
      store.delete(docPath);
    },
  });

  const makeQuery = (
    colPath: string,
    filters: Array<{ field: string; op: string; value: any }>,
    limitNum?: number,
    cursorId?: string
  ): any => ({
    where: (field: string, op: string, value: any) =>
      makeQuery(colPath, [...filters, { field, op, value }], limitNum, cursorId),
    limit: (n: number) => makeQuery(colPath, filters, n, cursorId),
    startAfter: (doc: any) => makeQuery(colPath, filters, limitNum, doc?.id),
    get: async () => {
      const prefix = `${colPath}/`;
      const docs: any[] = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
          if (matchesWhere(v, filters)) {
            docs.push({
              id: k.slice(prefix.length),
              ref: makeDocRef(k),
              data: () => structuredClone(v),
            });
          }
        }
      }
      const startIdx = cursorId ? docs.findIndex(d => d.id === cursorId) + 1 : 0;
      const afterCursor = docs.slice(startIdx);
      const sliced = typeof limitNum === 'number' ? afterCursor.slice(0, limitNum) : afterCursor;
      return { empty: sliced.length === 0, size: sliced.length, docs: sliced };
    },
  });

  return {
    collection: (colPath: string) => makeCollectionRef(colPath),
    doc: (docPath: string) => makeDocRef(docPath),
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const run = async () => {
        const snapshot = new Map(Array.from(store.entries()).map(([k, v]) => [k, structuredClone(v)]));
        const writes: Array<() => void> = [];
        const tx = {
          get: async (target: any) => target.get(),
          set: (ref: any, data: any, opts?: { merge?: boolean }) => {
            writes.push(() => {
              if (opts?.merge && store.has(ref.path)) {
                store.set(ref.path, { ...store.get(ref.path)!, ...structuredClone(data) });
              } else {
                store.set(ref.path, structuredClone(data));
              }
            });
          },
          delete: (ref: any) => writes.push(() => store.delete(ref.path)),
        };
        try {
          const res = await fn(tx);
          for (const w of writes) w();
          return res;
        } catch (err) {
          store.clear();
          for (const [k, v] of snapshot.entries()) store.set(k, v);
          throw err;
        }
      };
      const next = txChain.then(run, run);
      txChain = next.then(() => undefined, () => undefined);
      return next;
    },
    _store: store,
  } as any;
}

function createMockAuth() {
  return {
    verifyIdToken: async (token: string, checkRevoked?: boolean) => {
      if (!checkRevoked) throw new Error('checkRevoked must be true');
      if (token === 'admin_token') return { uid: 'admin_1', admin: true, email_verified: true, firebase: { sign_in_provider: 'password' } };
      if (token === 'host1_token') return { uid: 'host_1', email: 'host1@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
      if (token === 'host2_token') return { uid: 'host_2', email: 'host2@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
      throw new Error('Invalid token');
    },
  } as any;
}

function createMockReqRes(opts: { headers?: Record<string, string>; body?: any; query?: Record<string, string>; rawBody?: Buffer }) {
  let statusCode = 200;
  let responseData: any = null;
  const req: any = {
    headers: opts.headers || {},
    body: opts.body || {},
    query: opts.query || {},
    rawBody: opts.rawBody,
  };
  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      responseData = payload;
      return this;
    },
  };
  return { req, res, getStatus: () => statusCode, getData: () => responseData };
}

describe('Phase 5 — Durable Email Outbox & Reliable Delivery Suite', () => {
  beforeEach(() => {
    sharedRateLimiter.reset();
    delete process.env.OUTBOX_WORKER_SECRET;
    delete process.env.WEBHOOK_SECRET;
    delete process.env.EMAIL_PROVIDER;
  });

  it('[P5-01] persists outbox jobs durably in Firestore and survives simulated restarts', async () => {
    const db = createStatefulFirestoreMock();
    const enq = await enqueueOutboxJobPersistent(db, {
      idempotencyKey: 'restart_key_1',
      idempotencyScope: 'host_1',
      ownerId: 'host_1',
      recipientEmail: 'student@example.com',
      recipientName: 'Alice',
      eventType: 'quiz_results_ready',
      subject: 'Quiz Results',
      htmlContent: '<p>Score: 100</p>',
      textContent: 'Score: 100',
    });

    expect(enq.success).toBe(true);
    expect(enq.job?.status).toBe('pending');

    // Simulate a fresh worker processing the persisted Firestore job
    const batch = await processOutboxBatchPersistent(
      db,
      10,
      async job => ({ success: true, provider: 'resend', providerMessageId: `msg_${job.id}` }),
      'fresh_worker_after_restart'
    );
    expect(batch.claimedCount).toBe(1);
    expect(batch.acceptedCount).toBe(1);

    const persisted = (await db.collection(EMAIL_OUTBOX_COLLECTION).doc(enq.job!.id).get()).data();
    expect(persisted.status).toBe('accepted'); // Accepted != delivered
    expect(persisted.providerMessageId).toBe(`msg_${enq.job!.id}`);
  });

  it('[P5-02] scopes idempotency keys by owner/event and hashes keys in Firestore', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();

    // host_1 enqueues with key "daily_report"
    const r1 = createMockReqRes({
      headers: { authorization: 'Bearer host1_token' },
      body: {
        idempotencyKey: 'daily_report',
        recipientEmail: 'a@example.com',
        subject: 'Report A',
        htmlContent: '<p>A</p>',
      },
    });
    await handleOutboxEnqueue(r1.req, r1.res, { adminAuth, adminDb: db });
    expect(r1.getStatus()).toBe(201);

    // host_1 retries with same key -> deduplicated (200)
    const r1Dup = createMockReqRes({
      headers: { authorization: 'Bearer host1_token' },
      body: {
        idempotencyKey: 'daily_report',
        recipientEmail: 'a@example.com',
        subject: 'Report A',
        htmlContent: '<p>A</p>',
      },
    });
    await handleOutboxEnqueue(r1Dup.req, r1Dup.res, { adminAuth, adminDb: db });
    expect(r1Dup.getStatus()).toBe(200);
    expect(r1Dup.getData().isDuplicate).toBe(true);
    expect(r1Dup.getData().jobId).toBe(r1.getData().jobId);

    // host_2 uses the SAME raw key "daily_report" -> distinct scope, creates new job (201)
    const r2 = createMockReqRes({
      headers: { authorization: 'Bearer host2_token' },
      body: {
        idempotencyKey: 'daily_report',
        recipientEmail: 'b@example.com',
        subject: 'Report B',
        htmlContent: '<p>B</p>',
      },
    });
    await handleOutboxEnqueue(r2.req, r2.res, { adminAuth, adminDb: db });
    expect(r2.getStatus()).toBe(201);
    expect(r2.getData().jobId).not.toBe(r1.getData().jobId);
  });

  it('[P5-03] prevents concurrent workers from claiming the same job and enforces lease renewal & fencing', async () => {
    const db = createStatefulFirestoreMock();
    const enq = await enqueueOutboxJobPersistent(db, {
      idempotencyKey: 'lease_fence_1',
      recipientEmail: 'alice@example.com',
      recipientName: 'Alice',
      eventType: 'quiz_results_ready',
      subject: 'Test',
      htmlContent: '<p>Hi</p>',
      textContent: 'Hi',
    });
    const jobId = enq.job!.id;

    // 1. Concurrent workers: only one claims the job
    const [w1, w2] = await Promise.all([
      processOutboxBatchPersistent(db, 10, async () => ({ success: true, providerMessageId: 'm1' }), 'worker_1'),
      processOutboxBatchPersistent(db, 10, async () => ({ success: true, providerMessageId: 'm2' }), 'worker_2'),
    ]);
    expect(w1.claimedCount + w2.claimedCount).toBe(1);

    // 2. Simulate crashed worker with expired lease + stale worker trying to overwrite newer worker
    const enq2 = await enqueueOutboxJobPersistent(db, {
      idempotencyKey: 'lease_fence_2',
      recipientEmail: 'bob@example.com',
      recipientName: 'Bob',
      eventType: 'quiz_results_ready',
      subject: 'Test 2',
      htmlContent: '<p>Hi</p>',
      textContent: 'Hi',
    });
    const jobId2 = enq2.job!.id;
    const expiredIso = new Date(Date.now() - 60_000).toISOString();
    await db.collection(EMAIL_OUTBOX_COLLECTION).doc(jobId2).set(
      { status: 'processing', workerId: 'stale_worker', leaseVersion: 1, lockedUntil: expiredIso, attempts: 1 },
      { merge: true }
    );

    // Lease renewal by stale worker works ONLY if leaseVersion matches; once reclaimed, stale worker fails fencing
    const recovery = await processOutboxBatchPersistent(
      db,
      10,
      async job => ({ success: true, provider: 'resend', providerMessageId: `recovered_${job.id}` }),
      'recovery_worker'
    );
    expect(recovery.claimedCount).toBe(1);
    expect(recovery.acceptedCount).toBe(1);

    // Stale worker wakes up and tries to renew or complete with leaseVersion=1 -> rejected by fencing!
    const staleRenew = await renewOutboxLeasePersistent(db, jobId2, 'stale_worker', 1);
    expect(staleRenew.renewed).toBe(false);
    const staleComplete = await completeClaimedOutboxJobPersistent(db, jobId2, 'stale_worker', 1, {
      status: 'failed',
      lastErrorMessage: 'Stale error should not overwrite',
    });
    expect(staleComplete.updated).toBe(false);
    expect(staleComplete.staleLease).toBe(true);

    const finalJob = (await db.collection(EMAIL_OUTBOX_COLLECTION).doc(jobId2).get()).data();
    expect(finalJob.status).toBe('accepted');
    expect(finalJob.providerMessageId).toBe(`recovered_${jobId2}`);
  });

  it('[P5-04] enforces bounded exponential backoff with Retry-After, max attempts, and permanent vs transient failures', async () => {
    const db = createStatefulFirestoreMock();

    // Verify backoff computation respects Retry-After and caps at MAX_BACKOFF_MS + jitter
    const backoff429 = computeBackoffMs(1, 120, 0);
    expect(backoff429).toBe(120_000);
    const backoffCapped = computeBackoffMs(15, 9999, 0.5);
    expect(backoffCapped).toBeLessThanOrEqual(310_000);

    // Transient failure up to maxAttempts=2 -> retrying on attempt 1, failed on attempt 2
    const enq = await enqueueOutboxJobPersistent(db, {
      idempotencyKey: 'retry_limit_1',
      recipientEmail: 'retry@example.com',
      recipientName: 'Retry User',
      eventType: 'quiz_results_ready',
      subject: 'Retry',
      htmlContent: '<p>Hi</p>',
      textContent: 'Hi',
      maxAttempts: 2,
    });

    const r1 = await processOutboxBatchPersistent(
      db,
      10,
      async () => ({ success: false, isPermanent: false, retryAfterSec: 1, errorCategory: 'rate_limit', error: '429' }),
      'w1'
    );
    expect(r1.retriedCount).toBe(1);
    let stored = (await db.collection(EMAIL_OUTBOX_COLLECTION).doc(enq.job!.id).get()).data();
    expect(stored.status).toBe('retrying');
    expect(stored.errorCategory).toBe('rate_limit');

    // Second attempt in the future hits maxAttempts=2 -> terminal failed
    const r2 = await processOutboxBatchPersistent(
      db,
      10,
      async () => ({ success: false, isPermanent: false, error: '503' }),
      'w1',
      { nowMs: Date.now() + 60_000 }
    );
    expect(r2.failedCount).toBe(1);
    stored = (await db.collection(EMAIL_OUTBOX_COLLECTION).doc(enq.job!.id).get()).data();
    expect(stored.status).toBe('failed');
  });

  it('[P5-05] handles provider timeout ambiguity safely: Resend uses Idempotency-Key; SMTP/Brevo enter ambiguous state', async () => {
    const db = createStatefulFirestoreMock();

    // 1. Resend passes Idempotency-Key header
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_key';
    const origFetch = globalThis.fetch;
    let capturedHeaders: any = null;
    globalThis.fetch = (async (_url: any, init: any) => {
      capturedHeaders = init?.headers;
      return { ok: true, text: async () => JSON.stringify({ id: 'resend_msg_1' }) } as any;
    }) as any;

    const resendRes = await dispatchSingleEmail({
      to: 'alice@example.com',
      recipientName: 'Alice',
      subject: 'Hi',
      html: '<p>Hi</p>',
      transporter: null,
      idempotencyKey: 'scoped_idemp_123',
    });
    expect(resendRes.messageId).toBe('resend_msg_1');
    expect(capturedHeaders['Idempotency-Key']).toBe('scoped_idemp_123');
    globalThis.fetch = origFetch;
    delete process.env.RESEND_API_KEY;

    // 2. SMTP timeout -> marked 'ambiguous', never retried or falsely marked accepted/failed
    const enqSmtp = await enqueueOutboxJobPersistent(db, {
      idempotencyKey: 'smtp_ambig_1',
      recipientEmail: 'bob@example.com',
      recipientName: 'Bob',
      eventType: 'quiz_results_ready',
      subject: 'SMTP Test',
      htmlContent: '<p>Hi</p>',
      textContent: 'Hi',
    });

    process.env.EMAIL_PROVIDER = 'smtp';
    const batch = await processOutboxBatchPersistent(
      db,
      10,
      async job => {
        try {
          await dispatchSingleEmail({
            to: job.recipientEmail,
            recipientName: job.recipientName,
            subject: job.subject,
            html: job.htmlContent,
            transporter: {
              sendMail: async () => {
                const err: any = new Error('Connection timeout');
                err.code = 'ETIMEDOUT';
                throw err;
              },
            } as any,
          });
          return { success: true };
        } catch (err: any) {
          return {
            success: false,
            error: err.message,
            isPermanent: Boolean(err.isPermanent),
            isAmbiguous: Boolean(err.isAmbiguous),
            errorCategory: err.errorCategory,
          };
        }
      },
      'smtp_worker'
    );

    expect(batch.ambiguousCount).toBe(1);
    expect(batch.retriedCount).toBe(0);
    expect(batch.acceptedCount).toBe(0);
    const stored = (await db.collection(EMAIL_OUTBOX_COLLECTION).doc(enqSmtp.job!.id).get()).data();
    expect(stored.status).toBe('ambiguous');
  });

  it('[P5-06] deduplicates Svix webhooks, enforces signature/replay checks, and protects terminal delivery states', async () => {
    const db = createStatefulFirestoreMock();
    const svixSecret = 'whsec_' + Buffer.from('test-webhook-secret-32-bytes-len').toString('base64');
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.WEBHOOK_SECRET = svixSecret;

    const enq = await enqueueOutboxJobPersistent(db, {
      idempotencyKey: 'wh_job_1',
      recipientEmail: 'wh@example.com',
      recipientName: 'WH',
      eventType: 'quiz_results_ready',
      subject: 'WH',
      htmlContent: '<p>WH</p>',
      textContent: 'WH',
    });
    await processOutboxBatchPersistent(
      db,
      10,
      async () => ({ success: true, provider: 'resend', providerMessageId: 're_msg_999' }),
      'w1'
    );

    const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 're_msg_999' } });
    const rawBody = Buffer.from(payload, 'utf8');
    const ts = Math.floor(Date.now() / 1000).toString();
    const svixId = 'msg_svix_event_1';
    const keyBytes = Buffer.from(svixSecret.slice('whsec_'.length), 'base64');
    const sig = crypto.createHmac('sha256', keyBytes).update(`${svixId}.${ts}.${payload}`).digest('base64');

    // 1. Unsigned / tampered webhook rejected (401)
    const badWh = createMockReqRes({
      headers: { 'svix-id': svixId, 'svix-timestamp': ts, 'svix-signature': 'v1,invalid' },
      body: JSON.parse(payload),
      rawBody,
    });
    await handleOutboxWebhook(badWh.req, badWh.res, { adminDb: db });
    expect(badWh.getStatus()).toBe(401);

    // 2. Valid webhook transitions accepted -> delivered
    const goodWh = createMockReqRes({
      headers: { 'svix-id': svixId, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` },
      body: JSON.parse(payload),
      rawBody,
    });
    await handleOutboxWebhook(goodWh.req, goodWh.res, { adminDb: db });
    expect(goodWh.getStatus()).toBe(200);
    expect(goodWh.getData().job.status).toBe('delivered');

    // 3. Duplicate svix-id replay is idempotently ignored
    const dupWh = createMockReqRes({
      headers: { 'svix-id': svixId, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` },
      body: JSON.parse(payload),
      rawBody,
    });
    await handleOutboxWebhook(dupWh.req, dupWh.res, { adminDb: db });
    expect(dupWh.getStatus()).toBe(200);
    expect(dupWh.getData().duplicate).toBe(true);

    // 4. Out-of-order bounce after delivered does not overwrite terminal 'delivered' state
    const outOfOrder = await handleProviderWebhookPersistent(db, {
      eventId: 'msg_svix_late_bounce',
      provider: 'resend',
      messageId: 're_msg_999',
      event: 'bounced',
    });
    expect(outOfOrder.ignoredOutOfOrder).toBe(true);
    expect((await db.collection(EMAIL_OUTBOX_COLLECTION).doc(enq.job!.id).get()).data().status).toBe('delivered');
  });

  it('[P5-07] enforces Phase 4 deletion suppression and routes handleSendResults through durable outbox', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();

    await db
      .collection(ACCOUNT_DELETION_EMAIL_BLOCKS_COLLECTION)
      .doc(hashIdentifier('blocked@example.com'))
      .set({ blockedAt: new Date().toISOString() });

    await db.collection('games').doc('g_durable').set({
      hostId: 'host_1',
      status: 'finished',
      quizTitle: 'Durable Quiz',
      questions: [{ text: 'Q1', points: 1000 }],
    });
    await db.collection('games').doc('g_durable').collection('players').doc('p1').set({
      id: 'p1',
      nickname: 'Blocked',
      email: 'blocked@example.com',
      emailConsent: true,
      score: 1000,
      correctCount: 1,
    });
    await db.collection('games').doc('g_durable').collection('players').doc('p2').set({
      id: 'p2',
      nickname: 'Allowed',
      email: 'allowed@example.com',
      emailConsent: true,
      score: 900,
      correctCount: 1,
    });

    const sentTo: string[] = [];
    const ctx = createMockReqRes({
      headers: { authorization: 'Bearer host1_token' },
      body: { gameId: 'g_durable' },
    });

    process.env.EMAIL_PROVIDER = 'smtp';
    await handleSendResults(ctx.req, ctx.res, {
      adminAuth,
      adminDb: db,
      transporter: {
        sendMail: async (m: any) => {
          sentTo.push(m.to);
          return { messageId: 'smtp_durable_1' };
        },
      } as any,
    });

    expect(ctx.getStatus()).toBe(200);
    expect(sentTo).toEqual(['allowed@example.com']);
    expect(ctx.getData().sentCount).toBe(1);
    expect(ctx.getData().skippedCount).toBe(1);
    // Durable outbox record persisted for allowed@example.com
    const metrics = await getOutboxMetricsPersistent(db);
    expect(metrics.accepted).toBe(1);
  });

  it('[P5-08] protects /api/outbox/metrics and reports accurate maintained counters, oldest age, and expired leases', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();

    // Unauthenticated / non-admin rejected (403)
    const unauth = createMockReqRes({ headers: { authorization: 'Bearer host1_token' } });
    await handleOutboxMetrics(unauth.req, unauth.res, { adminAuth, adminDb: db });
    expect(unauth.getStatus()).toBe(403);

    // Enqueue one pending job and one expired processing job
    await enqueueOutboxJobPersistent(db, {
      idempotencyKey: 'm_1',
      recipientEmail: 'm1@example.com',
      recipientName: 'M1',
      eventType: 'quiz_results_ready',
      subject: 'S1',
      htmlContent: '<p>1</p>',
      textContent: '1',
    });
    const j2 = await enqueueOutboxJobPersistent(db, {
      idempotencyKey: 'm_2',
      recipientEmail: 'm2@example.com',
      recipientName: 'M2',
      eventType: 'quiz_results_ready',
      subject: 'S2',
      htmlContent: '<p>2</p>',
      textContent: '2',
    });
    await db.collection(EMAIL_OUTBOX_COLLECTION).doc(j2.job!.id).set(
      { status: 'processing', lockedUntil: new Date(Date.now() - 10_000).toISOString() },
      { merge: true }
    );
    await db.collection(EMAIL_OUTBOX_METRICS_COLLECTION).doc(EMAIL_OUTBOX_METRICS_DOC_ID).set(
      { pending: 1, processing: 1 },
      { merge: true }
    );

    process.env.OUTBOX_WORKER_SECRET = 'worker_metrics_secret';
    const workerReq = createMockReqRes({ headers: { 'x-worker-secret': 'worker_metrics_secret' } });
    await handleOutboxMetrics(workerReq.req, workerReq.res, { adminAuth, adminDb: db });
    expect(workerReq.getStatus()).toBe(200);
    expect(workerReq.getData().metrics.pending).toBe(1);
    expect(workerReq.getData().metrics.processing).toBe(1);
    expect(workerReq.getData().metrics.expiredLeases).toBe(1);
  });

  it('[P5-09] firestore.rules locks down durable outbox collections to Admin SDK only', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rules).toMatch(/match \/emailOutbox\/\{jobId\}\s*\{\s*allow read, write:\s*if false;/);
    expect(rules).toMatch(/match \/emailOutboxIdempotency\/\{keyHash\}\s*\{\s*allow read, write:\s*if false;/);
    expect(rules).toMatch(/match \/emailWebhookEvents\/\{eventKey\}\s*\{\s*allow read, write:\s*if false;/);
    expect(rules).toMatch(/match \/emailOutboxMetrics\/\{docId\}\s*\{\s*allow read, write:\s*if false;/);
  });

  it('[P6.7-01] firestore.rules denies all client writes to legacy /mail collection while preserving authorized reads', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    const mailMatch = rules.match(/match \/mail\/\{mailId\}\s*\{([\s\S]*?)\}/);
    expect(mailMatch).toBeTruthy();
    const mailBlock = mailMatch![1];
    expect(mailBlock).toContain('allow write: if false;');
    expect(mailBlock).not.toContain('allow create:');
    expect(mailBlock).not.toContain('allow update');
    expect(mailBlock).not.toContain('allow delete');
    expect(mailBlock).toMatch(/allow read:\s*if isNonAnonymous\(\) && isAccountActive\(\)/);
  });

  it('[P5.1-01] emailService.ts has no client-side Firestore mail writes and distinguishes queued, accepted, and delivered', () => {
    const svc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/emailService.ts'), 'utf8');
    expect(svc).not.toContain("collection(db, 'mail')");
    expect(svc).not.toContain('addDoc(');
    expect(svc).toContain("updateOutboxItemStatus(id, 'accepted')");
  });

  it('[P5.1-02] handleSendTestEmail persists to durable emailOutbox, returns accepted, and fails closed in production without adminDb', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();
    process.env.EMAIL_PROVIDER = 'smtp';

    const ctx = createMockReqRes({
      headers: { authorization: 'Bearer host1_token' },
      body: { to: 'host1@example.com', subject: 'Test', htmlContent: '<p>Test</p>' },
    });

    await handleSendTestEmail(ctx.req, ctx.res, {
      adminAuth,
      adminDb: db,
      transporter: { sendMail: async () => ({ messageId: 'smtp_test_1' }) } as any,
    });

    expect(ctx.getStatus()).toBe(200);
    expect(ctx.getData().status).toBe('accepted');
    expect(ctx.getData().jobId).toBeTruthy();
    expect(ctx.getData().messageId).toBe('smtp_test_1');

    const storedJob = (await db.collection(EMAIL_OUTBOX_COLLECTION).doc(ctx.getData().jobId).get()).data();
    expect(storedJob.status).toBe('accepted');
    expect(storedJob.providerMessageId).toBe('smtp_test_1');

    // Production fail-closed when adminDb is unavailable
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const failCtx = createMockReqRes({
      headers: { authorization: 'Bearer host2_token' },
      body: { to: 'host2@example.com' },
    });
    await handleSendTestEmail(failCtx.req, failCtx.res, {
      adminAuth,
      adminDb: undefined,
      transporter: { sendMail: async () => ({ messageId: 'x' }) } as any,
    });
    process.env.NODE_ENV = prevEnv;
    expect(failCtx.getStatus()).toBe(503);
  });

  it('[P5.1-03] handleSendResults populates per-recipient results with jobId/providerMessageId and matching aggregate counts', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();
    process.env.EMAIL_PROVIDER = 'smtp';

    await db
      .collection(ACCOUNT_DELETION_EMAIL_BLOCKS_COLLECTION)
      .doc(hashIdentifier('blocked@example.com'))
      .set({ blockedAt: new Date().toISOString() });

    await db.collection('games').doc('g_res_full').set({
      hostId: 'host_1',
      status: 'finished',
      quizTitle: 'Full Results Quiz',
      questions: [{ text: 'Q1', points: 1000 }],
    });
    await db.collection('games').doc('g_res_full').collection('players').doc('p1').set({
      id: 'p1',
      nickname: 'Blocked',
      email: 'blocked@example.com',
      emailConsent: true,
      score: 1000,
      correctCount: 1,
    });
    await db.collection('games').doc('g_res_full').collection('players').doc('p2').set({
      id: 'p2',
      nickname: 'Allowed',
      email: 'allowed@example.com',
      emailConsent: true,
      score: 900,
      correctCount: 1,
    });

    const ctx = createMockReqRes({
      headers: { authorization: 'Bearer host1_token' },
      body: { gameId: 'g_res_full' },
    });
    await handleSendResults(ctx.req, ctx.res, {
      adminAuth,
      adminDb: db,
      transporter: { sendMail: async () => ({ messageId: 'smtp_res_2' }) } as any,
    });

    expect(ctx.getStatus()).toBe(200);
    const data = ctx.getData();
    expect(data.sentCount).toBe(1);
    expect(data.acceptedCount).toBe(1);
    expect(data.skippedCount).toBe(1);
    expect(data.results).toHaveLength(2);
    const acceptedEntry = data.results.find((r: any) => r.status === 'accepted');
    expect(acceptedEntry).toBeDefined();
    expect(acceptedEntry.jobId).toBeTruthy();
    expect(acceptedEntry.providerMessageId).toBe('smtp_res_2');
  });

  it('[P5.1-04] reconciles outbox metrics across >400 documents and detects concurrent counter updates', async () => {
    const db = createStatefulFirestoreMock();
    for (let i = 0; i < 450; i++) {
      await db.collection(EMAIL_OUTBOX_COLLECTION).doc(`rec_job_${i}`).set({
        id: `rec_job_${i}`,
        status: i < 400 ? 'pending' : 'accepted',
        createdAt: new Date().toISOString(),
      });
    }

    const rec = await reconcileOutboxMetricsPersistent(db);
    expect(rec.reconciled).toBe(true);
    expect(rec.scannedCount).toBe(450);
    expect(rec.metrics?.pending).toBe(400);
    expect(rec.metrics?.accepted).toBe(50);

    // Simulate concurrent counter modification during reconciliation scan -> aborts safely without clobbering
    const origGet = db.collection(EMAIL_OUTBOX_COLLECTION).limit;
    const racingDb = {
      ...db,
      collection: (colPath: string) => {
        const c = db.collection(colPath);
        if (colPath !== EMAIL_OUTBOX_COLLECTION) return c;
        return {
          ...c,
          limit: (n: number) => {
            const q = origGet(n);
            return {
              ...q,
              get: async () => {
                // Concurrent worker updates metrics summary mid-scan
                await db.collection(EMAIL_OUTBOX_METRICS_COLLECTION).doc(EMAIL_OUTBOX_METRICS_DOC_ID).set(
                  { updatedAt: new Date(Date.now() + 5000).toISOString() },
                  { merge: true }
                );
                return q.get();
              },
            };
          },
        };
      },
    };

    const raceRec = await reconcileOutboxMetricsPersistent(racingDb);
    expect(raceRec.reconciled).toBe(false);
    expect(raceRec.concurrentUpdate).toBe(true);
  });

  it('[P5.1-05] eagerly cancels >400 outbox jobs for deleting user without touching others and fences active workers', async () => {
    const db = createStatefulFirestoreMock();
    for (let i = 0; i < 420; i++) {
      await db.collection(EMAIL_OUTBOX_COLLECTION).doc(`del_job_${i}`).set({
        id: `del_job_${i}`,
        ownerId: 'user_del',
        recipientEmail: 'del@example.com',
        recipientName: 'Del User',
        subject: 'Secret',
        htmlContent: '<p>Secret</p>',
        textContent: 'Secret',
        status: i === 0 ? 'processing' : 'pending',
        workerId: i === 0 ? 'active_w' : undefined,
        leaseVersion: i === 0 ? 1 : 0,
        lockedUntil: i === 0 ? new Date(Date.now() + 60_000).toISOString() : undefined,
      });
    }
    await db.collection(EMAIL_OUTBOX_COLLECTION).doc('other_user_job').set({
      id: 'other_user_job',
      ownerId: 'user_keep',
      recipientEmail: 'keep@example.com',
      status: 'pending',
    });

    const res = await cancelOutboxJobsForAccountDeletion(db, {
      uid: 'user_del',
      email: 'del@example.com',
      pseudoId: 'deleted_pseudo_1',
    });
    expect(res.cancelledCount).toBe(420);

    // Unrelated user's job is untouched
    expect((await db.collection(EMAIL_OUTBOX_COLLECTION).doc('other_user_job').get()).data().status).toBe('pending');

    // Active worker with old leaseVersion=1 is fenced and cannot overwrite the cancelled job
    const staleComplete = await completeClaimedOutboxJobPersistent(db, 'del_job_0', 'active_w', 1, {
      status: 'accepted',
      providerMessageId: 'should_not_apply',
    });
    expect(staleComplete.updated).toBe(false);
    expect(staleComplete.staleLease).toBe(true);
    expect((await db.collection(EMAIL_OUTBOX_COLLECTION).doc('del_job_0').get()).data().status).toBe('cancelled');
  });
});

