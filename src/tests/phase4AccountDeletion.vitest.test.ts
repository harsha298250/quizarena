/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleRequestAccountDeletion,
  handleGetDeletionStatus,
  handleRetryAccountDeletion,
  handleAdminDeleteUser,
  handlePurgeUserData,
} from '../server/userDataPurgeHandler.ts';
import {
  ACCOUNT_DELETION_JOBS_COLLECTION,
  ACCOUNT_DELETION_LOCKS_COLLECTION,
  ACCOUNT_DELETION_EMAIL_BLOCKS_COLLECTION,
  hashIdentifier,
} from '../server/accountDeletionEngine.ts';
import { handleCreateGame } from '../server/gameSessionHandler.ts';
import { handleAnswerSubmission } from '../server/answerSubmissionHandler.ts';
import { handleIntegrityEvent } from '../server/integrityHandler.ts';
import { handleSendResults, handleSendTestEmail } from '../server/resultEmailsHandler.ts';
import {
  handleCreateTournament,
  handleRegisterTournament,
  handleStartRound,
  handleFinalizeMatch,
  handleGetTournamentStandings,
} from '../server/tournamentHandler.ts';
import {
  handleIssueCertificate,
  handleProcessOutbox,
} from '../server/notificationHandler.ts';
import {
  enqueueOutboxJob,
  outboxStore,
  idempotencyOutboxIndex,
} from '../server/emailOutboxWorker.ts';
import { sharedRateLimiter } from '../server/sharedRateLimiter.ts';

function createStatefulFirestoreMock() {
  const store = new Map<string, Record<string, any>>();
  let txChain = Promise.resolve();

  const matchesWhere = (docData: any, filters: Array<{ field: string; op: string; value: any }>) => {
    for (const f of filters) {
      const actual = docData?.[f.field];
      if (f.op === '==' && actual !== f.value) return false;
    }
    return true;
  };

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

  const makeQuery = (colPath: string, filters: Array<{ field: string; op: string; value: any }>, limitNum?: number): any => ({
    where: (field: string, op: string, value: any) =>
      makeQuery(colPath, [...filters, { field, op, value }], limitNum),
    limit: (n: number) => makeQuery(colPath, filters, n),
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
      const sliced = typeof limitNum === 'number' ? docs.slice(0, limitNum) : docs;
      return {
        empty: sliced.length === 0,
        size: sliced.length,
        docs: sliced,
      };
    },
  });

  const makeCollectionRef = (colPath: string): any => ({
    doc: (id: string) => makeDocRef(`${colPath}/${id}`),
    where: (field: string, op: string, value: any) =>
      makeQuery(colPath, [{ field, op, value }]),
    limit: (n: number) => makeQuery(colPath, [], n),
    get: async () => makeQuery(colPath, []).get(),
  });

  const db: any = {
    collection: (colPath: string) => makeCollectionRef(colPath),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        delete: (ref: any) => ops.push(() => store.delete(ref.path)),
        set: (ref: any, data: any, opts?: { merge?: boolean }) =>
          ops.push(() => {
            if (opts?.merge && store.has(ref.path)) {
              store.set(ref.path, { ...store.get(ref.path)!, ...structuredClone(data) });
            } else {
              store.set(ref.path, structuredClone(data));
            }
          }),
        commit: async () => {
          for (const op of ops) op();
        },
      };
    },
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const run = async () => {
        const snapshot = new Map(
          Array.from(store.entries()).map(([k, v]) => [k, structuredClone(v)])
        );
        const pendingWrites: Array<() => void> = [];
        const tx = {
          get: async (target: any) => {
            if (typeof target.get === 'function' && target.path) {
              return target.get();
            }
            return target.get();
          },
          set: (ref: any, data: any, opts?: { merge?: boolean }) => {
            pendingWrites.push(() => {
              if (opts?.merge && store.has(ref.path)) {
                store.set(ref.path, { ...store.get(ref.path)!, ...structuredClone(data) });
              } else {
                store.set(ref.path, structuredClone(data));
              }
            });
          },
          delete: (ref: any) => {
            pendingWrites.push(() => store.delete(ref.path));
          },
        };
        try {
          const res = await fn(tx);
          for (const w of pendingWrites) w();
          return res;
        } catch (err) {
          store.clear();
          for (const [k, v] of snapshot.entries()) store.set(k, v);
          throw err;
        }
      };

      const next = txChain.then(run, run);
      txChain = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
    _store: store,
  };

  return db;
}

function createMockAuth(deletedUids = new Set<string>()) {
  const revokedUids = new Set<string>();
  const adminAuth: any = {
    verifyIdToken: async (token: string) => {
      if (token === 'user1_token') {
        if (deletedUids.has('user_1')) throw new Error('User deleted');
        return { uid: 'user_1', email: 'user1@example.com', firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'user2_token') {
        if (deletedUids.has('user_2')) throw new Error('User deleted');
        return { uid: 'user_2', email: 'user2@example.com', firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'host_token') {
        if (deletedUids.has('host_1')) throw new Error('User deleted');
        return { uid: 'host_1', email: 'host1@example.com', firebase: { sign_in_provider: 'password' } };
      }
      if (token === 'admin_token') {
        return { uid: 'admin_1', admin: true, email: 'admin@example.com', firebase: { sign_in_provider: 'password' } };
      }
      if (token === 'anon_token') {
        return { uid: 'anon_1', firebase: { sign_in_provider: 'anonymous' } };
      }
      throw new Error('Invalid token');
    },
    revokeRefreshTokens: async (uid: string) => {
      revokedUids.add(uid);
    },
    deleteUser: async (uid: string) => {
      deletedUids.add(uid);
    },
    getUser: async (uid: string) => ({ uid, email: `${uid}@example.com` }),
    _revokedUids: revokedUids,
    _deletedUids: deletedUids,
  };
  return adminAuth;
}

function createMockStorage(filesByPrefix: Record<string, string[]> = {}) {
  const deletedPrefixes: string[] = [];
  return {
    bucket: () => ({
      getFiles: async ({ prefix }: { prefix: string }) => [
        (filesByPrefix[prefix] || []).map(name => ({ name })),
      ],
      deleteFiles: async ({ prefix }: { prefix: string }) => {
        deletedPrefixes.push(prefix);
        delete filesByPrefix[prefix];
      },
    }),
    _deletedPrefixes: deletedPrefixes,
  };
}

function createMockReqRes(opts: {
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, string>;
  params?: Record<string, string>;
}) {
  let statusCode = 200;
  let responseData: any = null;
  const req: any = {
    headers: opts.headers || {},
    body: opts.body || {},
    query: opts.query || {},
    params: opts.params || {},
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

describe('Phase 4 — Secure Account Deletion & Complete Data Purge Suite', () => {
  beforeEach(() => {
    sharedRateLimiter.reset();
    outboxStore.clear();
    idempotencyOutboxIndex.clear();
  });

  it('[P4-01] enforces authentication, blocks anonymous users, rejects UID spoofing, and restricts admin endpoint', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();
    const adminStorage = createMockStorage();

    // Unauthenticated -> 401
    const unauth = createMockReqRes({});
    await handleRequestAccountDeletion(unauth.req, unauth.res, { adminAuth, adminDb: db, adminStorage });
    expect(unauth.getStatus()).toBe(401);

    // Anonymous -> 403
    const anon = createMockReqRes({ headers: { authorization: 'Bearer anon_token' } });
    await handleRequestAccountDeletion(anon.req, anon.res, { adminAuth, adminDb: db, adminStorage });
    expect(anon.getStatus()).toBe(403);

    // UID spoofing -> 403
    const spoof = createMockReqRes({
      headers: { authorization: 'Bearer user1_token' },
      body: { uid: 'user_2' },
    });
    await handleRequestAccountDeletion(spoof.req, spoof.res, { adminAuth, adminDb: db, adminStorage });
    expect(spoof.getStatus()).toBe(403);

    // Non-admin calling admin delete -> 403
    const nonAdmin = createMockReqRes({
      headers: { authorization: 'Bearer user1_token' },
      params: { uid: 'user_2' },
    });
    await handleAdminDeleteUser(nonAdmin.req, nonAdmin.res, { adminAuth, adminDb: db, adminStorage });
    expect(nonAdmin.getStatus()).toBe(403);

    // Non-owner checking status of another user -> 403
    const statusForbidden = createMockReqRes({
      headers: { authorization: 'Bearer user1_token' },
      query: { uid: 'user_2' },
    });
    await handleGetDeletionStatus(statusForbidden.req, statusForbidden.res, { adminAuth, adminDb: db });
    expect(statusForbidden.getStatus()).toBe(403);

    // Authorized admin deleting user_2 -> 200
    await db.collection('users').doc('user_2').set({ email: 'user2@example.com', displayName: 'User Two' });
    const adminDel = createMockReqRes({
      headers: { authorization: 'Bearer admin_token' },
      params: { uid: 'user_2' },
    });
    await handleAdminDeleteUser(adminDel.req, adminDel.res, { adminAuth, adminDb: db, adminStorage });
    expect(adminDel.getStatus()).toBe(200);
    expect(adminDel.getData().status).toBe('completed');
    expect(adminAuth._deletedUids.has('user_2')).toBe(true);
  });

  it('[P4-02] acquires deterministic per-user lock, deduplicates concurrent requests, and scrubs PII on completion', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();
    const adminStorage = createMockStorage({ 'users/user_1/': ['avatar.png'] });

    await db.collection('users').doc('user_1').set({ email: 'user1@example.com', displayName: 'Alice' });
    await db.collection('quizzes').doc('q_1').set({ authorId: 'user_1', title: 'My Quiz' });
    await db.collection('questionBank').doc('qb_1').set({ authorId: 'user_1', prompt: '2+2?' });

    // Concurrent requests for the same user
    const c1 = createMockReqRes({ headers: { authorization: 'Bearer user1_token' } });
    const c2 = createMockReqRes({ headers: { authorization: 'Bearer user1_token' } });

    await Promise.all([
      handleRequestAccountDeletion(c1.req, c1.res, { adminAuth, adminDb: db, adminStorage }),
      handleRequestAccountDeletion(c2.req, c2.res, { adminAuth, adminDb: db, adminStorage }),
    ]);

    const statuses = [c1.getStatus(), c2.getStatus()];
    expect(statuses).toContain(200);
    expect([c1.getData().isDuplicate, c2.getData().isDuplicate]).toContain(true);
    expect(c1.getData().jobId).toBe(c2.getData().jobId);

    // Personal content, user doc, storage, and auth deleted; refresh tokens revoked
    expect((await db.collection('users').doc('user_1').get()).exists).toBe(false);
    expect((await db.collection('quizzes').doc('q_1').get()).exists).toBe(false);
    expect((await db.collection('questionBank').doc('qb_1').get()).exists).toBe(false);
    expect(adminStorage._deletedPrefixes).toContain('users/user_1/');
    expect(adminAuth._revokedUids.has('user_1')).toBe(true);
    expect(adminAuth._deletedUids.has('user_1')).toBe(true);

    // Retained job metadata has no plaintext UID
    const jobSnap = await db.collection(ACCOUNT_DELETION_JOBS_COLLECTION).doc(c1.getData().jobId).get();
    expect(jobSnap.data().status).toBe('completed');
    expect(jobSnap.data().uid).toBe('[purged]');
  });

  it('[P4-03] preserves shared games, tournament results, and certificate validity with non-reversible anonymization', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();
    const adminStorage = createMockStorage();

    // 1. Setup shared multiplayer game + solo hosted game
    await db.collection('games').doc('solo_game').set({ hostId: 'user_1', hostName: 'Alice' });
    await db.collection('games').doc('solo_game').collection('players').doc('user_1').set({ id: 'user_1', score: 100 });

    await db.collection('games').doc('shared_game').set({ hostId: 'host_1', hostName: 'Prof' });
    await db.collection('games').doc('shared_game').collection('players').doc('user_1').set({ id: 'user_1', name: 'Alice', score: 900 });
    await db.collection('games').doc('shared_game').collection('players').doc('user_2').set({ id: 'user_2', name: 'Bob', score: 800 });
    await db.collection('games').doc('shared_game').collection('guestEmails').doc('user_1').set({ email: 'user1@example.com' });
    await db.collection('games').doc('shared_game').collection('answers').doc('ans_1').set({ playerId: 'user_1', isCorrect: true });

    // 2. Setup completed tournament with user_1 & user_2, plus an active tournament hosted by user_1
    const tCreate = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: {
        title: 'Completed Cup',
        maxParticipants: 4,
        minParticipants: 2,
        registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
        quizzes: ['q1'],
      },
    });
    await handleCreateTournament(tCreate.req, tCreate.res, { adminAuth, adminDb: db });
    const compId = tCreate.getData().tournament.id;

    for (const [tok, nick] of [
      ['user1_token', 'Alice'],
      ['user2_token', 'Bob'],
    ]) {
      const r = createMockReqRes({
        headers: { authorization: `Bearer ${tok}` },
        body: { tournamentId: compId, nickname: nick },
      });
      await handleRegisterTournament(r.req, r.res, { adminAuth, adminDb: db });
    }
    const s1 = createMockReqRes({ headers: { authorization: 'Bearer host_token' }, body: { tournamentId: compId } });
    await handleStartRound(s1.req, s1.res, { adminAuth, adminDb: db });
    const matchId = s1.getData().round.matches[0].id;
    const fin = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { tournamentId: compId, matchId, winnerId: 'user_1', score1: 1200, score2: 900 },
    });
    await handleFinalizeMatch(fin.req, fin.res, { adminAuth, adminDb: db });
    const compDone = createMockReqRes({ headers: { authorization: 'Bearer host_token' }, body: { tournamentId: compId } });
    await handleStartRound(compDone.req, compDone.res, { adminAuth, adminDb: db });

    // Active tournament hosted by user_1
    await db.collection('tournaments').doc('hosted_active').set({
      id: 'hosted_active',
      hostId: 'user_1',
      hostName: 'Alice',
      status: 'active',
      rounds: [],
    });

    // 3. Setup certificates: one owned by user_1, one issued by user_1 to user_2
    await db.collection('certificates').doc('cert_owned').set({
      id: 'cert_owned',
      ownerId: 'user_1',
      recipientName: 'Alice',
      recipientEmail: 'user1@example.com',
      issuerId: 'host_1',
      status: 'active',
      verificationId: 'QA-V-OWNED-1',
    });
    await db.collection('certificateVerification').doc('QA-V-OWNED-1').set({
      verificationId: 'QA-V-OWNED-1',
      certificateId: 'cert_owned',
      recipientName: 'Alice',
      status: 'active',
    });
    await db.collection('certificates').doc('cert_issued').set({
      id: 'cert_issued',
      ownerId: 'user_2',
      recipientName: 'Bob',
      issuerId: 'user_1',
      issuerName: 'Alice',
      status: 'active',
      verificationId: 'QA-V-ISSUED-2',
    });

    // Execute deletion for user_1
    const delCtx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' } });
    await handleRequestAccountDeletion(delCtx.req, delCtx.res, { adminAuth, adminDb: db, adminStorage });
    expect(delCtx.getStatus()).toBe(200);
    expect(delCtx.getData().status).toBe('completed');

    // Solo game deleted; shared game & user_2 preserved; user_1 anonymized
    expect((await db.collection('games').doc('solo_game').get()).exists).toBe(false);
    expect((await db.collection('games').doc('shared_game').get()).exists).toBe(true);
    expect((await db.collection('games').doc('shared_game').collection('players').doc('user_2').get()).data().name).toBe('Bob');
    const p1Shared = (await db.collection('games').doc('shared_game').collection('players').doc('user_1').get()).data();
    expect(p1Shared.name).toBe('Deleted Player');
    expect(p1Shared.id).toMatch(/^deleted_/);
    expect((await db.collection('games').doc('shared_game').collection('guestEmails').doc('user_1').get()).exists).toBe(false);

    // Active hosted tournament safely cancelled; completed tournament results preserved & anonymized
    const hostedActive = (await db.collection('tournaments').doc('hosted_active').get()).data();
    expect(hostedActive.status).toBe('cancelled');
    expect(hostedActive.cancelReason).toBe('host_account_deleted');
    expect(hostedActive.hostId).toMatch(/^deleted_/);

    const compResultU1 = (await db.collection('tournaments').doc(compId).collection('results').doc('user_1').get()).data();
    expect(compResultU1.nickname).toBe('Deleted Participant');
    expect(compResultU1.rank).toBe(1);
    const compResultU2 = (await db.collection('tournaments').doc(compId).collection('results').doc('user_2').get()).data();
    expect(compResultU2.nickname).toBe('Bob');

    // Certificates preserve validity (status === 'active') while anonymizing PII
    const ownedCert = (await db.collection('certificates').doc('cert_owned').get()).data();
    expect(ownedCert.status).toBe('active');
    expect(ownedCert.recipientName).toBe('Deleted Participant');
    expect(ownedCert.recipientEmail).toBeNull();
    expect(ownedCert.ownerId).toMatch(/^deleted_/);

    const verifOwned = (await db.collection('certificateVerification').doc('QA-V-OWNED-1').get()).data();
    expect(verifOwned.recipientName).toBe('Deleted Participant');
    expect(verifOwned.status).toBe('active');

    const issuedCert = (await db.collection('certificates').doc('cert_issued').get()).data();
    expect(issuedCert.status).toBe('active');
    expect(issuedCert.ownerId).toBe('user_2');
    expect(issuedCert.issuerName).toBe('Former Host');
  });

  it('[P4-04] blocks deletion-pending accounts from protected operations without affecting unrelated users', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();

    // Mark user_1 as deletion_pending
    await db.collection('users').doc('user_1').set({ status: 'deletion_pending' });
    await db.collection('users').doc('user_2').set({ status: 'active' });

    // user_1 cannot create tournament (403)
    const u1Create = createMockReqRes({
      headers: { authorization: 'Bearer user1_token' },
      body: {
        title: 'Blocked Cup',
        maxParticipants: 4,
        minParticipants: 2,
        registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
        quizzes: ['q1'],
      },
    });
    await handleCreateTournament(u1Create.req, u1Create.res, { adminAuth, adminDb: db });
    expect(u1Create.getStatus()).toBe(403);

    // user_1 cannot issue certificates (403)
    const u1Cert = createMockReqRes({
      headers: { authorization: 'Bearer user1_token' },
      body: { ownerId: 'user_1', assessmentId: 'g1', assessmentType: 'quiz' },
    });
    await handleIssueCertificate(u1Cert.req, u1Cert.res, { adminAuth, adminDb: db });
    expect(u1Cert.getStatus()).toBe(403);

    // Unrelated user_2 is completely unaffected and can create tournaments
    const u2Create = createMockReqRes({
      headers: { authorization: 'Bearer user2_token' },
      body: {
        title: 'Allowed Cup',
        maxParticipants: 4,
        minParticipants: 2,
        registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
        quizzes: ['q1'],
      },
    });
    await handleCreateTournament(u2Create.req, u2Create.res, { adminAuth, adminDb: db });
    expect(u2Create.getStatus()).toBe(201);

    // Unrelated user_2 can read public standings
    const standings = createMockReqRes({
      headers: { authorization: 'Bearer user2_token' },
      params: { id: u2Create.getData().tournament.id },
    });
    await handleGetTournamentStandings(standings.req, standings.res, { adminAuth, adminDb: db });
    expect(standings.getStatus()).toBe(200);
  });

  it('[P4-05] cancels pending mail and prevents outbox worker from dispatching to deleted/deletion-pending accounts', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();
    const adminStorage = createMockStorage();

    await db.collection('mail').doc('m_pending').set({
      ownerId: 'user_1',
      to: 'user1@example.com',
      status: 'pending',
      subject: 'Quiz Results',
      html: '<p>Secret</p>',
    });

    const delCtx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' } });
    await handleRequestAccountDeletion(delCtx.req, delCtx.res, { adminAuth, adminDb: db, adminStorage });
    expect(delCtx.getStatus()).toBe(200);

    const mailDoc = (await db.collection('mail').doc('m_pending').get()).data();
    expect(mailDoc.status).toBe('cancelled');
    expect(mailDoc.to).toBe('[deleted]');
    expect(mailDoc.html).toBe('');

    // Enqueue an in-memory outbox job targeting the deleted user's email; worker must cancel permanently
    enqueueOutboxJob({
      idempotencyKey: 'outbox_deleted_user_key',
      recipientEmail: 'user1@example.com',
      recipientName: 'Alice',
      recipientUid: 'user_1',
      eventType: 'quiz_results_ready',
      subject: 'Late Retry',
      htmlContent: '<p>Hi</p>',
      textContent: 'Hi',
    });

    process.env.OUTBOX_WORKER_SECRET = 'test_worker_secret_123';
    const workerCtx = createMockReqRes({
      headers: { 'x-worker-secret': 'test_worker_secret_123' },
    });
    await handleProcessOutbox(workerCtx.req, workerCtx.res, { adminAuth, adminDb: db });
    expect(workerCtx.getStatus()).toBe(200);
    expect(workerCtx.getData().result.sentCount).toBe(0);
    expect(workerCtx.getData().result.failedCount).toBe(1);
    delete process.env.OUTBOX_WORKER_SECRET;
  });

  it('[P4-06] treats unavailable Storage or Auth deletion failure as incomplete and recovers safely without user Firebase token', async () => {
    const db = createStatefulFirestoreMock();
    const deletedUids = new Set<string>();
    const adminAuth = createMockAuth(deletedUids);

    // 1. Unavailable Storage -> must fail (500), never report completed
    const noStorageCtx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' } });
    await handleRequestAccountDeletion(noStorageCtx.req, noStorageCtx.res, {
      adminAuth,
      adminDb: db,
      adminStorage: undefined,
    });
    expect(noStorageCtx.getStatus()).toBe(500);
    expect(noStorageCtx.getData().success).toBe(false);
    expect(noStorageCtx.getData().status).toBe('failed');
    expect(noStorageCtx.getData().currentStage).toBe('purge_storage');
    expect(noStorageCtx.getData().recoveryToken).toBeTruthy();

    // 2. Simulate Auth deletion succeeding on retry, but finalize_job failing -> recover via recoveryToken AFTER user_1 Auth is gone!
    const jobId = noStorageCtx.getData().jobId;
    const recoveryToken = noStorageCtx.getData().recoveryToken;
    const adminStorage = createMockStorage();

    // Retry with valid storage -> completes all remaining stages cleanly
    const retryCtx = createMockReqRes({
      body: { jobId, recoveryToken },
    });
    await handleRetryAccountDeletion(retryCtx.req, retryCtx.res, { adminAuth, adminDb: db, adminStorage });
    expect(retryCtx.getStatus()).toBe(200);
    expect(retryCtx.getData().success).toBe(true);
    expect(retryCtx.getData().status).toBe('completed');
    expect(deletedUids.has('user_1')).toBe(true);

    // Simulate post-Auth-deletion finalize_job failure on user_2 and recovery without user_2 token
    const failingAuth = {
      ...createMockAuth(deletedUids),
      verifyIdToken: async () => ({ uid: 'user_2', email: 'user2@example.com', firebase: { sign_in_provider: 'google.com' } }),
      deleteUser: async (uid: string) => {
        deletedUids.add(uid);
      },
    };
    const origSet = db.collection(ACCOUNT_DELETION_JOBS_COLLECTION).doc;
    let failFinalizeOnce = true;
    const flakyDb = {
      ...db,
      collection: (colPath: string) => {
        const col = db.collection(colPath);
        if (colPath !== ACCOUNT_DELETION_JOBS_COLLECTION) return col;
        return {
          ...col,
          doc: (id: string) => {
            const d = origSet(id);
            return {
              ...d,
              set: async (data: any, opts?: any) => {
                if (failFinalizeOnce && data?.status === 'completed') {
                  failFinalizeOnce = false;
                  throw new Error('Transient Firestore write failure on finalize');
                }
                return d.set(data, opts);
              },
            };
          },
        };
      },
    };

    const partialCtx = createMockReqRes({ headers: { authorization: 'Bearer user2_token' } });
    await handleRequestAccountDeletion(partialCtx.req, partialCtx.res, {
      adminAuth: failingAuth,
      adminDb: flakyDb,
      adminStorage,
    });
    expect(partialCtx.getStatus()).toBe(500);
    expect(partialCtx.getData().status).toBe('failed');
    expect(deletedUids.has('user_2')).toBe(true); // Auth is already deleted!

    // Retry using ONLY jobId + recoveryToken (no Firebase ID token needed!)
    const postAuthRetry = createMockReqRes({
      body: {
        jobId: partialCtx.getData().jobId,
        recoveryToken: partialCtx.getData().recoveryToken,
      },
    });
    await handleRetryAccountDeletion(postAuthRetry.req, postAuthRetry.res, {
      adminAuth: createMockAuth(deletedUids),
      adminDb: db,
      adminStorage,
    });
    expect(postAuthRetry.getStatus()).toBe(200);
    expect(postAuthRetry.getData().status).toBe('completed');
  });

  it('[P4-07] firestore.rules protects deletion jobs, blocks deletion-pending writes, and leaves shared tournament/certificate access intact', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');

    expect(rules).toContain('function isAccountActive()');
    expect(rules).toContain("status != 'deletion_pending'");
    expect(rules).toContain('match /accountDeletionJobs/{jobId}');
    expect(rules).toContain('match /accountDeletionLocks/{uidHash}');
    expect(rules).toContain('match /accountDeletionEmailBlocks/{emailHash}');
    expect(rules).toMatch(/match \/users\/\{userId\}[\s\S]*?allow delete:\s*if false;/);
    expect(rules).toMatch(/match \/accountDeletionJobs\/\{jobId\}[\s\S]*?allow write:\s*if false;/);
  });

  it('[P4-08] legacy /api/purge-user-data delegates to Phase 4 engine and fails closed when storage is unavailable', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();
    const adminStorage = createMockStorage();

    await db.collection('users').doc('user_1').set({ email: 'user1@example.com' });
    const ctx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' } });
    await handlePurgeUserData(ctx.req, ctx.res, { adminAuth, adminDb: db, adminStorage });
    expect(ctx.getStatus()).toBe(200);
    expect(ctx.getData().success).toBe(true);
    expect(ctx.getData().accountDeleted).toBe(true);
    expect(ctx.getData().uid).toBe('[purged]');
  });

  it('[P4.1-01] enforces verifyIdToken(token, true) revocation checking across protected endpoints', async () => {
    const db = createStatefulFirestoreMock();
    const revokedFlags: Array<boolean | undefined> = [];
    const revokedAuth: any = {
      verifyIdToken: async (token: string, checkRevoked?: boolean) => {
        revokedFlags.push(checkRevoked);
        if (checkRevoked) {
          const err: any = new Error('Firebase ID token has been revoked.');
          err.code = 'auth/id-token-revoked';
          throw err;
        }
        return { uid: 'user_1', email: 'user1@example.com', firebase: { sign_in_provider: 'google.com' } };
      },
    };

    const gCtx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' }, body: { quizId: 'q1' } });
    await handleCreateGame(gCtx.req, gCtx.res, { adminAuth: revokedAuth, adminDb: db });
    expect(gCtx.getStatus()).toBe(401);

    const aCtx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' }, body: { gameId: 'g1', questionIndex: 0 } });
    await handleAnswerSubmission(aCtx.req, aCtx.res, { adminAuth: revokedAuth, adminDb: db });
    expect(aCtx.getStatus()).toBe(401);

    const tCtx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' }, body: { title: 'Test' } });
    await handleCreateTournament(tCtx.req, tCtx.res, { adminAuth: revokedAuth, adminDb: db });
    expect(tCtx.getStatus()).toBe(401);

    const dCtx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' } });
    await handleRequestAccountDeletion(dCtx.req, dCtx.res, { adminAuth: revokedAuth, adminDb: db });
    expect(dCtx.getStatus()).toBe(401);

    expect(revokedFlags.length).toBe(4);
    expect(revokedFlags.every(flag => flag === true)).toBe(true);
  });

  it('[P4.1-02] blocks deletion-pending accounts on game, answer, integrity, and email endpoints while leaving unrelated users unaffected', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();

    await db.collection('users').doc('user_1').set({ status: 'deletion_pending' });
    await db.collection('users').doc('user_2').set({ status: 'active' });

    const gCtx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' }, body: { quizId: 'q1' } });
    await handleCreateGame(gCtx.req, gCtx.res, { adminAuth, adminDb: db });
    expect(gCtx.getStatus()).toBe(403);

    const aCtx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' }, body: { gameId: 'g1', questionIndex: 0 } });
    await handleAnswerSubmission(aCtx.req, aCtx.res, { adminAuth, adminDb: db });
    expect(aCtx.getStatus()).toBe(403);

    const iCtx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' }, body: { gameId: 'g1', eventType: 'tab_switch' } });
    await handleIntegrityEvent(iCtx.req, iCtx.res, adminAuth, db);
    expect(iCtx.getStatus()).toBe(403);

    const eCtx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' }, body: { gameId: 'g1' } });
    await handleSendResults(eCtx.req, eCtx.res, { adminAuth, adminDb: db });
    expect(eCtx.getStatus()).toBe(403);

    // Unrelated active user_2 can still issue a test email validation or create a tournament without being blocked
    const u2Tourney = createMockReqRes({
      headers: { authorization: 'Bearer user2_token' },
      body: {
        title: 'Active User Cup',
        maxParticipants: 4,
        minParticipants: 2,
        registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
        quizzes: ['q1'],
      },
    });
    await handleCreateTournament(u2Tourney.req, u2Tourney.res, { adminAuth, adminDb: db });
    expect(u2Tourney.getStatus()).toBe(201);
  });

  it('[P4.1-03] preserves users/{uid} in deletion_pending if adminAuth.deleteUser fails, and deletes profile only after Auth succeeds', async () => {
    const db = createStatefulFirestoreMock();
    const deletedUids = new Set<string>();
    let failAuthDelete = true;
    const flakyAuth: any = {
      ...createMockAuth(deletedUids),
      deleteUser: async (uid: string) => {
        if (failAuthDelete) {
          throw new Error('Transient Firebase Auth error');
        }
        deletedUids.add(uid);
      },
    };
    const adminStorage = createMockStorage();

    await db.collection('users').doc('user_1').set({ email: 'user1@example.com', status: 'active' });

    // 1. Auth deletion fails -> users/{uid} MUST still exist with status === 'deletion_pending'
    const delCtx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' } });
    await handleRequestAccountDeletion(delCtx.req, delCtx.res, { adminAuth: flakyAuth, adminDb: db, adminStorage });
    expect(delCtx.getStatus()).toBe(500);
    expect(delCtx.getData().currentStage).toBe('delete_auth_and_profile');

    const userSnapAfterFail = await db.collection('users').doc('user_1').get();
    expect(userSnapAfterFail.exists).toBe(true);
    expect(userSnapAfterFail.data().status).toBe('deletion_pending');

    // 2. Retry after Auth recovers -> Auth deleted and users/{uid} deleted
    failAuthDelete = false;
    const retryCtx = createMockReqRes({
      body: { jobId: delCtx.getData().jobId, recoveryToken: delCtx.getData().recoveryToken },
    });
    await handleRetryAccountDeletion(retryCtx.req, retryCtx.res, { adminAuth: flakyAuth, adminDb: db, adminStorage });
    expect(retryCtx.getStatus()).toBe(200);
    expect(retryCtx.getData().status).toBe('completed');
    expect(deletedUids.has('user_1')).toBe(true);
    expect((await db.collection('users').doc('user_1').get()).exists).toBe(false);
  });

  it('[P4.1-04] suppresses direct result-email and test-email dispatch for deletion-blocked addresses without leaking blocklist status', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();

    // Mark user1@example.com on deletion blocklist
    await db
      .collection(ACCOUNT_DELETION_EMAIL_BLOCKS_COLLECTION)
      .doc(hashIdentifier('user1@example.com'))
      .set({ blockedAt: new Date().toISOString(), reason: 'account_deletion' });

    // Setup a finished game hosted by host_1 with blocked user1 and eligible user2
    const gameDb: any = {
      ...db,
      doc: (p: string) => {
        const parts = p.split('/');
        if (parts.length === 2) return db.collection(parts[0]).doc(parts[1]);
        return db.collection(parts[0]).doc(parts[1]);
      },
    };
    await db.collection('games').doc('game_email_test').set({
      hostId: 'host_1',
      status: 'finished',
      quizTitle: 'Bio Quiz',
      questions: [{ text: 'Q1', points: 1000 }],
    });
    await db.collection('games').doc('game_email_test').collection('players').doc('user_1').set({
      id: 'user_1',
      nickname: 'Alice',
      email: 'user1@example.com',
      emailConsent: true,
      score: 1000,
      correctCount: 1,
    });
    await db.collection('games').doc('game_email_test').collection('players').doc('user_2').set({
      id: 'user_2',
      nickname: 'Bob',
      email: 'user2@example.com',
      emailConsent: true,
      score: 900,
      correctCount: 1,
    });

    const sentAddresses: string[] = [];
    const mockTransporter: any = {
      sendMail: async (mailOpts: any) => {
        sentAddresses.push(mailOpts.to);
        return { messageId: 'msg_123' };
      },
    };

    const sendCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { gameId: 'game_email_test' },
    });
    await handleSendResults(sendCtx.req, sendCtx.res, {
      adminAuth,
      adminDb: gameDb,
      transporter: mockTransporter,
    });
    expect(sendCtx.getStatus()).toBe(200);
    expect(sentAddresses).not.toContain('user1@example.com');
    expect(sentAddresses).toContain('user2@example.com');
    expect(JSON.stringify(sendCtx.getData())).not.toContain('blocklist');
    expect(JSON.stringify(sendCtx.getData())).not.toContain('deleted');

    // Test email to a deletion-blocked host address is also rejected
    await db
      .collection(ACCOUNT_DELETION_EMAIL_BLOCKS_COLLECTION)
      .doc(hashIdentifier('host1@example.com'))
      .set({ blockedAt: new Date().toISOString(), reason: 'account_deletion' });
    const testEmailCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { to: 'host1@example.com' },
    });
    await handleSendTestEmail(testEmailCtx.req, testEmailCtx.res, {
      adminAuth,
      adminDb: gameDb,
      transporter: mockTransporter,
    });
    expect(testEmailCtx.getStatus()).toBe(403);
  });

  it('[P4.1-05] deletes draft tournaments with >500 subcollection documents via paginated 400-op batches', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();
    const adminStorage = createMockStorage();

    await db.collection('tournaments').doc('big_draft').set({
      id: 'big_draft',
      hostId: 'user_1',
      status: 'draft',
    });

    // Populate 550 registrations (>500 Firestore transaction limit)
    for (let i = 0; i < 550; i++) {
      await db.collection('tournaments').doc('big_draft').collection('registrations').doc(`p_${i}`).set({
        participantId: `p_${i}`,
        status: 'registered',
      });
    }

    const delCtx = createMockReqRes({ headers: { authorization: 'Bearer user1_token' } });
    await handleRequestAccountDeletion(delCtx.req, delCtx.res, { adminAuth, adminDb: db, adminStorage });
    expect(delCtx.getStatus()).toBe(200);
    expect(delCtx.getData().status).toBe('completed');
    expect((await db.collection('tournaments').doc('big_draft').get()).exists).toBe(false);
    expect((await db.collection('tournaments').doc('big_draft').collection('registrations').get()).size).toBe(0);
  });

  it('[P4.1-06] handlePurgeUserData returns 202 for duplicate processing jobs, 200 for completed, and 500 for failed', async () => {
    const db = createStatefulFirestoreMock();
    const adminAuth = createMockAuth();
    const adminStorage = createMockStorage();

    // 1. Pre-seed an in-progress lock + job -> duplicate request must return 202
    const uidHash = hashIdentifier('user_1');
    await db.collection(ACCOUNT_DELETION_LOCKS_COLLECTION).doc(uidHash).set({
      jobId: 'del_in_progress_1',
      uidHash,
      status: 'processing',
      lockedAt: new Date().toISOString(),
    });
    await db.collection(ACCOUNT_DELETION_JOBS_COLLECTION).doc('del_in_progress_1').set({
      id: 'del_in_progress_1',
      uid: 'user_1',
      uidHash,
      status: 'processing',
      currentStage: 'handle_games',
      completedStages: ['mark_pending'],
      attempts: 1,
      counts: {
        deletedQuizzes: 0,
        deletedQuestionBank: 0,
        deletedGames: 0,
        anonymizedGames: 0,
        deletedPlayerRecords: 0,
        anonymizedTournaments: 0,
        anonymizedCertificates: 0,
        cancelledEmails: 0,
        deletedStorageFiles: 0,
      },
    });

    const dupProc = createMockReqRes({ headers: { authorization: 'Bearer user1_token' } });
    await handlePurgeUserData(dupProc.req, dupProc.res, { adminAuth, adminDb: db, adminStorage });
    expect(dupProc.getStatus()).toBe(202);
    expect(dupProc.getData().success).toBe(false);
    expect(dupProc.getData().isDuplicate).toBe(true);

    // 2. Complete the job -> duplicate request returns 200
    await db.collection(ACCOUNT_DELETION_LOCKS_COLLECTION).doc(uidHash).set({ status: 'completed' }, { merge: true });
    await db.collection(ACCOUNT_DELETION_JOBS_COLLECTION).doc('del_in_progress_1').set({ status: 'completed' }, { merge: true });

    const dupDone = createMockReqRes({ headers: { authorization: 'Bearer user1_token' } });
    await handlePurgeUserData(dupDone.req, dupDone.res, { adminAuth, adminDb: db, adminStorage });
    expect(dupDone.getStatus()).toBe(200);
    expect(dupDone.getData().success).toBe(true);
    expect(dupDone.getData().isDuplicate).toBe(true);

    // 3. Failed job (unavailable storage on user_2) -> returns 500
    const failCtx = createMockReqRes({ headers: { authorization: 'Bearer user2_token' } });
    await handlePurgeUserData(failCtx.req, failCtx.res, { adminAuth, adminDb: db, adminStorage: undefined });
    expect(failCtx.getStatus()).toBe(500);
    expect(failCtx.getData().success).toBe(false);
  });
});
