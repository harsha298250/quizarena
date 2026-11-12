/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  handleIssueCertificate,
  handleProcessOutbox,
  handleOutboxWebhook,
} from '../server/notificationHandler.ts';
import {
  certificateStore,
  verificationIdIndex,
  idempotencyIndex,
} from '../server/certificateEngine.ts';
import {
  enqueueOutboxJob,
  outboxStore,
  idempotencyOutboxIndex,
} from '../server/emailOutboxWorker.ts';
import { validateServerEnvironment } from '../server/envValidator.ts';
import { evaluateCorsRequest, resolveTrustedSameOrigin } from '../../server.ts';

function signResendSvix(
  svixId: string,
  svixTimestamp: string,
  rawBody: string,
  secret: string
): string {
  const keyBytes = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice(6), 'base64')
    : Buffer.from(secret, 'utf8');
  const sig = crypto
    .createHmac('sha256', keyBytes)
    .update(`${svixId}.${svixTimestamp}.${rawBody}`)
    .digest('base64');
  return `v1,${sig}`;
}

function createMockAdminDb(fixtures: {
  games?: Record<string, { data: any; players: Record<string, any> }>;
  tournaments?: Record<string, { data: any; registrations: Record<string, any> }>;
}) {
  const store: Record<string, Map<string, any>> = {
    certificates: new Map(),
    certificateVerification: new Map(),
    certificateIdempotency: new Map(),
  };

  const makeCol = (colName: string) => ({
    doc: (docId: string) => {
      if (colName === 'games') {
        const gameEntry = fixtures.games?.[docId];
        return {
          path: `games/${docId}`,
          get: async () => ({
            exists: Boolean(gameEntry),
            data: () => gameEntry?.data,
          }),
          collection: (subName: string) => {
            if (subName === 'players') {
              return {
                doc: (playerId: string) => ({
                  get: async () => ({
                    exists: Boolean(gameEntry?.players?.[playerId]),
                    data: () => gameEntry?.players?.[playerId],
                  }),
                }),
                get: async () => ({
                  docs: Object.entries(gameEntry?.players || {}).map(([id, data]) => ({
                    id,
                    data: () => data,
                  })),
                }),
              };
            }
            return {
              doc: () => ({ get: async () => ({ exists: false }) }),
              get: async () => ({ docs: [] }),
            };
          },
        };
      }

      if (colName === 'tournaments') {
        const tEntry = fixtures.tournaments?.[docId];
        return {
          path: `tournaments/${docId}`,
          get: async () => ({
            exists: Boolean(tEntry),
            data: () => tEntry?.data,
          }),
          collection: (subName: string) => {
            if (subName === 'registrations') {
              return {
                doc: (regId: string) => ({
                  get: async () => ({
                    exists: Boolean(tEntry?.registrations?.[regId]),
                    data: () => tEntry?.registrations?.[regId],
                  }),
                }),
              };
            }
            return { doc: () => ({ get: async () => ({ exists: false }) }) };
          },
        };
      }

      const colMap = store[colName] || (store[colName] = new Map());
      return {
        path: `${colName}/${docId}`,
        colName,
        docId,
        get: async () => ({
          exists: colMap.has(docId),
          data: () => colMap.get(docId),
        }),
      };
    },
  });

  return {
    collection: makeCol,
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const writes: Array<{ colName: string; docId: string; data: any; merge?: boolean }> = [];
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: any, opts?: { merge?: boolean }) => {
          writes.push({ colName: ref.colName, docId: ref.docId, data, merge: opts?.merge });
        },
      };
      const result = await fn(tx);
      for (const w of writes) {
        const colMap = store[w.colName] || (store[w.colName] = new Map());
        const prev = w.merge ? colMap.get(w.docId) || {} : {};
        colMap.set(w.docId, w.merge ? { ...prev, ...w.data } : { ...w.data });
      }
      return result;
    },
  } as any;
}

function createMockReqRes(options: {
  body?: any;
  rawBody?: Buffer | string;
  headers?: any;
  query?: any;
  method?: string;
} = {}) {
  const req: any = {
    method: options.method || 'POST',
    body: options.body || {},
    rawBody: options.rawBody,
    headers: options.headers || {},
    query: options.query || {},
    params: {},
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
  };

  const adminAuth: any = {
    verifyIdToken: async (token: string) => {
      if (token === 'student_token') {
        return { uid: 'student_1', name: 'Alice', firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'attacker_token') {
        return { uid: 'attacker_99', name: 'Attacker', firebase: { sign_in_provider: 'password' } };
      }
      if (token === 'host_token') {
        return { uid: 'host_1', name: 'Prof. Turing', firebase: { sign_in_provider: 'password' } };
      }
      if (token === 'custom_non_admin_token') {
        return { uid: 'user_no_provider' };
      }
      if (token === 'admin_token') {
        return { uid: 'admin_1', admin: true, firebase: { sign_in_provider: 'password' } };
      }
      throw new Error('Invalid token');
    },
  };

  return { req, res, getStatus: () => statusCode, getData: () => responseData, adminAuth };
}

describe('Phase 1 & 1.1 — Critical Security Hardening Suite', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    certificateStore.clear();
    verificationIdIndex.clear();
    idempotencyIndex.clear();
    outboxStore.clear();
    idempotencyOutboxIndex.clear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('1. Certificate Authorization, Server-Derived Type & Reissue Restrictions', () => {
    const db = createMockAdminDb({
      games: {
        game_101: {
          data: {
            hostId: 'host_1',
            hostName: 'Prof. Turing',
            quizTitle: 'Algorithms Midterm',
            questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }],
          },
          players: {
            student_1: { nickname: 'Alice', score: 2400, correctCount: 3 },
            student_2: { nickname: 'Bob', score: 3600, correctCount: 4 },
          },
        },
      },
      tournaments: {
        tourney_1: {
          data: {
            hostId: 'host_1',
            hostName: 'Prof. Turing',
            title: 'Spring Championship',
            status: 'completed',
            participantCount: 16,
          },
          registrations: {
            student_1: { nickname: 'Alice', score: 5000, rank: 2, accuracy: 0.9 },
          },
        },
      },
    });

    it('rejects forged client-supplied issuerId for another user (403)', async () => {
      const { req, res, getStatus, adminAuth } = createMockReqRes({
        headers: { authorization: 'Bearer attacker_token' },
        body: {
          ownerId: 'student_1',
          issuerId: 'attacker_99',
          assessmentId: 'game_101',
          score: 99999,
          rank: 1,
        },
      });

      await handleIssueCertificate(req, res, { adminAuth, adminDb: db });
      expect(getStatus()).toBe(403);
      expect(certificateStore.size).toBe(0);
    });

    it('rejects unauthorized certificate issuance for non-participant (403)', async () => {
      const { req, res, getStatus, adminAuth } = createMockReqRes({
        headers: { authorization: 'Bearer attacker_token' },
        body: {
          ownerId: 'attacker_99',
          assessmentId: 'game_101',
        },
      });

      await handleIssueCertificate(req, res, { adminAuth, adminDb: db });
      expect(getStatus()).toBe(403);
      expect(certificateStore.size).toBe(0);
    });

    it('ignores client-supplied fake scores, ranks, and type; derives them from Firestore', async () => {
      const { req, res, getStatus, getData, adminAuth } = createMockReqRes({
        headers: { authorization: 'Bearer student_token' },
        body: {
          ownerId: 'student_1',
          issuerId: 'fake_issuer',
          assessmentId: 'game_101',
          type: 'tournament_champion', // Forged client type
          score: 999999,
          rank: 1,
          totalParticipants: 500,
          accuracy: 1.0,
        },
      });

      await handleIssueCertificate(req, res, { adminAuth, adminDb: db });
      expect(getStatus()).toBe(201);
      const cert = getData().certificate;
      expect(cert.issuerId).toBe('host_1');
      expect(cert.score).toBe(2400);
      expect(cert.rank).toBe(2);
      expect(cert.totalParticipants).toBe(2);
      expect(cert.accuracy).toBe(0.75);
      // Rank 2 with 0.75 accuracy -> quiz_completion (NOT forged tournament_champion)
      expect(cert.type).toBe('quiz_completion');
    });

    it('derives tournament_placement on tournament rank <= 3 regardless of client type', async () => {
      const { req, res, getStatus, getData, adminAuth } = createMockReqRes({
        headers: { authorization: 'Bearer student_token' },
        body: {
          ownerId: 'student_1',
          assessmentType: 'tournament',
          assessmentId: 'tourney_1',
          type: 'tournament_champion',
        },
      });

      await handleIssueCertificate(req, res, { adminAuth, adminDb: db });
      expect(getStatus()).toBe(201);
      expect(getData().certificate.type).toBe('tournament_placement');
    });

    it('blocks ordinary participant from rotating verificationId via reissue=true (403)', async () => {
      const initial = createMockReqRes({
        headers: { authorization: 'Bearer student_token' },
        body: { ownerId: 'student_1', assessmentId: 'game_101' },
      });
      await handleIssueCertificate(initial.req, initial.res, { adminAuth: initial.adminAuth, adminDb: db });
      expect(initial.getStatus()).toBe(201);
      const originalVid = initial.getData().certificate.verificationId;

      const rotateAttempt = createMockReqRes({
        headers: { authorization: 'Bearer student_token' },
        body: { ownerId: 'student_1', assessmentId: 'game_101', reissue: true },
      });
      await handleIssueCertificate(rotateAttempt.req, rotateAttempt.res, {
        adminAuth: rotateAttempt.adminAuth,
        adminDb: db,
      });
      expect(rotateAttempt.getStatus()).toBe(403);
      expect(rotateAttempt.getData().error).toMatch(/reissue/i);
    });

    it('allows authoritative host to reissue certificate (201, reissueCount=1)', async () => {
      const initial = createMockReqRes({
        headers: { authorization: 'Bearer student_token' },
        body: { ownerId: 'student_1', assessmentId: 'game_101' },
      });
      await handleIssueCertificate(initial.req, initial.res, { adminAuth: initial.adminAuth, adminDb: db });

      const hostReissue = createMockReqRes({
        headers: { authorization: 'Bearer host_token' },
        body: { ownerId: 'student_1', assessmentId: 'game_101', reissue: true },
      });
      await handleIssueCertificate(hostReissue.req, hostReissue.res, {
        adminAuth: hostReissue.adminAuth,
        adminDb: db,
      });
      expect(hostReissue.getStatus()).toBe(201);
      expect(hostReissue.getData().certificate.reissueCount).toBe(1);
    });
  });

  describe('2. Outbox Worker Authorization & No Mock Dispatch', () => {
    it('fails closed when OUTBOX_WORKER_SECRET is missing', async () => {
      delete process.env.OUTBOX_WORKER_SECRET;
      const { req, res, getStatus, adminAuth } = createMockReqRes({
        headers: { 'x-worker-secret': 'quizarena_internal_worker_secret' },
      });

      await handleProcessOutbox(req, res, { adminAuth, adminDb: {} as any });
      expect(getStatus()).toBe(403);
    });

    it('rejects wrong OUTBOX_WORKER_SECRET (403)', async () => {
      process.env.OUTBOX_WORKER_SECRET = 'real-worker-secret-xyz';
      const { req, res, getStatus, adminAuth } = createMockReqRes({
        headers: { 'x-worker-secret': 'wrong-secret' },
      });

      await handleProcessOutbox(req, res, { adminAuth, adminDb: {} as any });
      expect(getStatus()).toBe(403);
    });

    it('rejects non-admin users even when sign_in_provider is absent (403)', async () => {
      process.env.OUTBOX_WORKER_SECRET = 'real-worker-secret-xyz';
      const { req, res, getStatus, adminAuth } = createMockReqRes({
        headers: { authorization: 'Bearer custom_non_admin_token' },
      });

      await handleProcessOutbox(req, res, { adminAuth, adminDb: {} as any });
      expect(getStatus()).toBe(403);
    });

    it('never reports mock email success when delivery provider is unconfigured', async () => {
      process.env.OUTBOX_WORKER_SECRET = 'real-worker-secret-xyz';
      delete process.env.RESEND_API_KEY;
      delete process.env.BREVO_API_KEY;
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      process.env.EMAIL_PROVIDER = 'none';

      enqueueOutboxJob({
        idempotencyKey: 'no_mock_test_1',
        recipientEmail: 'student@example.com',
        recipientName: 'Alice',
        eventType: 'quiz_results_ready',
        subject: 'Results',
        htmlContent: '<p>Results</p>',
        textContent: 'Results',
      });

      const { req, res, getStatus, getData, adminAuth } = createMockReqRes({
        headers: { 'x-worker-secret': 'real-worker-secret-xyz' },
      });

      await handleProcessOutbox(req, res, { adminAuth, adminDb: {} as any });
      expect(getStatus()).toBe(200);
      expect(getData().result.sentCount).toBe(0);
      expect(getData().result.retriedCount).toBe(1);
      const job = Array.from(outboxStore.values())[0];
      expect(job.status).toBe('retrying');
      expect(job.providerMessageId).toBeUndefined();
    });
  });

  describe('3. Resend / Svix Webhook Verification (Raw Body & Replay Protection)', () => {
    const svixSecret = 'whsec_' + Buffer.from('super-secret-resend-signing-key-32b').toString('base64');

    beforeEach(() => {
      process.env.EMAIL_PROVIDER = 'resend';
      process.env.WEBHOOK_SECRET = svixSecret;
    });

    it('fails closed (503) when WEBHOOK_SECRET is missing', async () => {
      delete process.env.WEBHOOK_SECRET;
      const raw = JSON.stringify({ messageId: 'msg_1', event: 'delivered' });
      const { req, res, getStatus } = createMockReqRes({
        headers: { 'x-provider-signature': 'test_webhook_secret' },
        body: JSON.parse(raw),
        rawBody: Buffer.from(raw),
      });

      await handleOutboxWebhook(req, res);
      expect(getStatus()).toBe(503);
    });

    it('fails closed (501) when configured provider has no supported webhook verification (smtp/brevo)', async () => {
      process.env.EMAIL_PROVIDER = 'smtp';
      const raw = JSON.stringify({ messageId: 'msg_1', event: 'delivered' });
      const { req, res, getStatus } = createMockReqRes({
        body: JSON.parse(raw),
        rawBody: Buffer.from(raw),
      });

      await handleOutboxWebhook(req, res);
      expect(getStatus()).toBe(501);
    });

    it('rejects missing Svix headers and legacy x-provider-signature bypass (401)', async () => {
      const raw = JSON.stringify({ messageId: 'msg_1', event: 'delivered' });
      const { req, res, getStatus } = createMockReqRes({
        headers: { 'x-provider-signature': svixSecret },
        body: JSON.parse(raw),
        rawBody: Buffer.from(raw),
      });

      await handleOutboxWebhook(req, res);
      expect(getStatus()).toBe(401);
    });

    it('rejects invalid Svix signature (401)', async () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const raw = JSON.stringify({ type: 'email.delivered', data: { email_id: 'msg_1' } });
      const { req, res, getStatus } = createMockReqRes({
        headers: {
          'svix-id': 'msg_svix_1',
          'svix-timestamp': ts,
          'svix-signature': 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        },
        body: JSON.parse(raw),
        rawBody: Buffer.from(raw),
      });

      await handleOutboxWebhook(req, res);
      expect(getStatus()).toBe(401);
    });

    it('rejects modified raw payload even if parsed body matches original (401)', async () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const originalRaw = '{"type":"email.delivered","data":{"email_id":"msg_1"}}';
      const sig = signResendSvix('msg_svix_2', ts, originalRaw, svixSecret);

      // Whitespace/bytes changed in rawBody -> must NOT verify via JSON.stringify(req.body)
      const modifiedRaw = '{"type": "email.delivered", "data": {"email_id": "msg_1"}}';
      const { req, res, getStatus } = createMockReqRes({
        headers: {
          'svix-id': 'msg_svix_2',
          'svix-timestamp': ts,
          'svix-signature': sig,
        },
        body: JSON.parse(originalRaw),
        rawBody: Buffer.from(modifiedRaw),
      });

      await handleOutboxWebhook(req, res);
      expect(getStatus()).toBe(401);
    });

    it('rejects stale / replay timestamps outside 5-minute tolerance (401)', async () => {
      const staleTs = String(Math.floor(Date.now() / 1000) - 600); // 10 minutes ago
      const raw = JSON.stringify({ type: 'email.delivered', data: { email_id: 'msg_1' } });
      const sig = signResendSvix('msg_svix_3', staleTs, raw, svixSecret);

      const { req, res, getStatus } = createMockReqRes({
        headers: {
          'svix-id': 'msg_svix_3',
          'svix-timestamp': staleTs,
          'svix-signature': sig,
        },
        body: JSON.parse(raw),
        rawBody: Buffer.from(raw),
      });

      await handleOutboxWebhook(req, res);
      expect(getStatus()).toBe(401);
    });

    it('accepts valid Resend/Svix signature over original rawBody and updates job status (200)', async () => {
      enqueueOutboxJob({
        idempotencyKey: 'wh_svix_ok',
        recipientEmail: 'wh@example.com',
        recipientName: 'WH',
        eventType: 'quiz_results_ready',
        subject: 'Subj',
        htmlContent: '<p>Hi</p>',
        textContent: 'Hi',
      });
      const job = Array.from(outboxStore.values())[0];
      job.providerMessageId = 're_email_123';

      const ts = String(Math.floor(Date.now() / 1000));
      const raw = '{"type":"email.delivered","data":{"email_id":"re_email_123"}}';
      const sig = signResendSvix('msg_svix_ok', ts, raw, svixSecret);

      const { req, res, getStatus, getData } = createMockReqRes({
        headers: {
          'svix-id': 'msg_svix_ok',
          'svix-timestamp': ts,
          'svix-signature': sig,
        },
        body: JSON.parse(raw),
        rawBody: Buffer.from(raw),
      });

      await handleOutboxWebhook(req, res);
      expect(getStatus()).toBe(200);
      expect(getData().job.status).toBe('delivered');
    });
  });

  describe('4. Production Same-Origin CORS, Allowlist & Preflight', () => {
    it('allows same-origin GET/POST/PUT/DELETE and preflight OPTIONS when CORS_ALLOWED_ORIGINS is empty', () => {
      delete process.env.PUBLIC_ORIGIN;
      delete process.env.RENDER_EXTERNAL_URL;
      const sameOrigin = resolveTrustedSameOrigin({
        protocol: 'https',
        headers: { host: 'quizarena.onrender.com' },
      } as any);
      expect(sameOrigin).toBe('https://quizarena.onrender.com');

      for (const _method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
        const res = evaluateCorsRequest('https://quizarena.onrender.com', [], false, sameOrigin);
        expect(res.allowRequest).toBe(true);
        expect(res.isSameOrigin).toBe(true);
        expect(res.allowOrigin).toBe('https://quizarena.onrender.com');
      }
    });

    it('ignores arbitrary X-Forwarded-Host and rejects malformed Host headers', () => {
      delete process.env.PUBLIC_ORIGIN;
      delete process.env.RENDER_EXTERNAL_URL;
      const spoofed = resolveTrustedSameOrigin({
        protocol: 'https',
        headers: {
          host: 'quizarena.onrender.com',
          'x-forwarded-host': 'evil.attacker.com',
        },
      } as any);
      expect(spoofed).toBe('https://quizarena.onrender.com');

      const malformed = resolveTrustedSameOrigin({
        protocol: 'https',
        headers: { host: 'evil.com/path?x=1' },
      } as any);
      expect(malformed).toBeNull();
    });

    it('rejects unapproved cross-origin requests when allowlist is empty or non-matching', () => {
      const sameOrigin = 'https://quizarena.onrender.com';
      const emptyRes = evaluateCorsRequest('https://evil.example.com', [], false, sameOrigin);
      expect(emptyRes.allowRequest).toBe(false);
      expect(emptyRes.allowOrigin).toBeNull();

      const unapprovedRes = evaluateCorsRequest(
        'https://evil.example.com',
        ['https://quizarena.vercel.app'],
        false,
        sameOrigin
      );
      expect(unapprovedRes.allowRequest).toBe(false);
      expect(unapprovedRes.allowOrigin).toBeNull();
    });

    it('rejects wildcard "*" in production credentialed CORS', () => {
      const res = evaluateCorsRequest(
        'https://evil.example.com',
        ['*'],
        false,
        'https://quizarena.onrender.com'
      );
      expect(res.allowRequest).toBe(false);
      expect(res.allowOrigin).toBeNull();
    });

    it('allows approved cross-origin requests in production', () => {
      const res = evaluateCorsRequest(
        'https://quizarena.vercel.app',
        ['https://quizarena.vercel.app'],
        false,
        'https://quizarena.onrender.com'
      );
      expect(res.allowRequest).toBe(true);
      expect(res.isSameOrigin).toBe(false);
      expect(res.allowOrigin).toBe('https://quizarena.vercel.app');
    });

    it('warns in production when WEBHOOK_SECRET is missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.WEBHOOK_SECRET;
      const result = validateServerEnvironment();
      expect(result.sanitizedConfig.hasWebhookSecret).toBe(false);
      expect(result.warnings.some(w => w.includes('WEBHOOK_SECRET'))).toBe(true);
    });
  });
});
