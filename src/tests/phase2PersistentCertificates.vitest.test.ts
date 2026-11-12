/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  issueCertificatePersistent,
  verifyCertificatePublicPersistent,
  revokeCertificatePersistent,
  getIssuedCertificatesByOwnerPersistent,
  certificateStore,
  verificationIdIndex,
  idempotencyIndex,
  CERTIFICATES_COLLECTION,
  CERTIFICATE_VERIFICATION_COLLECTION,
  CERTIFICATE_IDEMPOTENCY_COLLECTION,
} from '../server/certificateEngine.ts';
import {
  handleIssueCertificate,
  handleVerifyCertificate,
  handleRevokeCertificate,
} from '../server/notificationHandler.ts';

/**
 * In-memory Firestore transaction simulator with serialized transaction queue
 * to verify atomic writes, rollbacks, and restart isolation (ignoring process Maps).
 */
function createStatefulFirestoreMock(options: { failOnTransaction?: boolean } = {}) {
  const collections: Record<string, Map<string, any>> = {
    games: new Map(),
    tournaments: new Map(),
    [CERTIFICATES_COLLECTION]: new Map(),
    [CERTIFICATE_VERIFICATION_COLLECTION]: new Map(),
    [CERTIFICATE_IDEMPOTENCY_COLLECTION]: new Map(),
  };
  const subcollections = new Map<string, Map<string, any>>();
  let txLock = Promise.resolve();

  const getSubMap = (path: string) => {
    if (!subcollections.has(path)) subcollections.set(path, new Map());
    return subcollections.get(path)!;
  };

  const makeDocRef = (colName: string, docId: string, subRoot?: string) => {
    const map = subRoot ? getSubMap(`${subRoot}/${colName}`) : (collections[colName] || (collections[colName] = new Map()));
    return {
      colName,
      docId,
      subRoot,
      get: async () => ({
        exists: map.has(docId),
        id: docId,
        data: () => (map.has(docId) ? structuredClone(map.get(docId)) : undefined),
      }),
      set: async (data: any, opts?: { merge?: boolean }) => {
        const prev = opts?.merge ? map.get(docId) || {} : {};
        map.set(docId, opts?.merge ? { ...prev, ...structuredClone(data) } : structuredClone(data));
      },
      collection: (subName: string) => makeCollectionRef(subName, `${subRoot ? `${subRoot}/` : ''}${colName}/${docId}`),
    };
  };

  const makeCollectionRef = (colName: string, subRoot?: string) => {
    const map = subRoot ? getSubMap(`${subRoot}/${colName}`) : (collections[colName] || (collections[colName] = new Map()));
    return {
      doc: (docId: string) => makeDocRef(colName, docId, subRoot),
      get: async () => ({
        empty: map.size === 0,
        size: map.size,
        docs: Array.from(map.entries()).map(([id, data]) => ({
          id,
          data: () => structuredClone(data),
        })),
      }),
      where: (field: string, _op: string, value: any) => ({
        limit: (n: number) => ({
          get: async () => {
            const matched = Array.from(map.entries())
              .filter(([, d]) => d?.[field] === value)
              .slice(0, n)
              .map(([id, data]) => ({ id, data: () => structuredClone(data) }));
            return { empty: matched.length === 0, size: matched.length, docs: matched };
          },
        }),
        get: async () => {
          const matched = Array.from(map.entries())
            .filter(([, d]) => d?.[field] === value)
            .map(([id, data]) => ({ id, data: () => structuredClone(data) }));
          return { empty: matched.length === 0, size: matched.length, docs: matched };
        },
      }),
    };
  };

  const db: any = {
    collection: (name: string) => makeCollectionRef(name),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const run = async () => {
        if (options.failOnTransaction) {
          throw new Error('Simulated Firestore transaction failure');
        }
        const pendingWrites: Array<{ ref: any; data: any; merge?: boolean }> = [];
        const tx = {
          get: async (ref: any) => ref.get(),
          set: (ref: any, data: any, opts?: { merge?: boolean }) => {
            pendingWrites.push({ ref, data, merge: opts?.merge });
          },
        };
        const result = await fn(tx);
        for (const w of pendingWrites) {
          await w.ref.set(w.data, { merge: w.merge });
        }
        return result;
      };
      const next = txLock.then(run, run);
      txLock = next.catch(() => {});
      return next;
    },
    _collections: collections,
    _subcollections: subcollections,
  };

  return db;
}

function createMockReqRes(options: { body?: any; params?: any; headers?: any } = {}) {
  const req: any = {
    body: options.body || {},
    params: options.params || {},
    headers: options.headers || {},
  };
  let statusCode = 200;
  let data: any = null;
  const res: any = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (payload: any) => {
      data = payload;
      return res;
    },
  };
  const adminAuth: any = {
    verifyIdToken: async (token: string) => {
      if (token === 'host_token') return { uid: 'host_1', firebase: { sign_in_provider: 'password' } };
      if (token === 'student_token') return { uid: 'student_1', firebase: { sign_in_provider: 'google.com' } };
      if (token === 'intruder_token') return { uid: 'intruder_1', firebase: { sign_in_provider: 'password' } };
      if (token === 'admin_token') return { uid: 'admin_1', admin: true, firebase: { sign_in_provider: 'password' } };
      throw new Error('Invalid token');
    },
  };
  return { req, res, getStatus: () => statusCode, getData: () => data, adminAuth };
}

describe('Phase 2 — Persistent Certificate System (Firestore Transactional Store)', () => {
  beforeEach(() => {
    certificateStore.clear();
    verificationIdIndex.clear();
    idempotencyIndex.clear();
  });

  it('[P2-01] persists issued certificates across simulated server restarts (in-memory Maps remain empty)', async () => {
    const db = createStatefulFirestoreMock();
    await db.collection('games').doc('game_1').set({
      hostId: 'host_1',
      hostName: 'Prof. Turing',
      quizTitle: 'Distributed Systems',
      questions: [{ id: 'q1' }, { id: 'q2' }],
    });
    await db.collection('games').doc('game_1').collection('players').doc('student_1').set({
      nickname: 'Alice',
      score: 1900,
      correctCount: 2,
    });

    const issueCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { ownerId: 'student_1', assessmentId: 'game_1' },
    });
    await handleIssueCertificate(issueCtx.req, issueCtx.res, { adminAuth: issueCtx.adminAuth, adminDb: db });
    expect(issueCtx.getStatus()).toBe(201);
    const cert = issueCtx.getData().certificate;
    expect(cert.verificationId).toMatch(/^QA-V-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);

    // Simulate server restart: in-memory legacy Maps are completely empty
    expect(certificateStore.size).toBe(0);
    expect(verificationIdIndex.size).toBe(0);
    expect(idempotencyIndex.size).toBe(0);

    // Public verification still succeeds from Firestore and omits PII
    const verifyCtx = createMockReqRes({ params: { verificationId: cert.verificationId } });
    await handleVerifyCertificate(verifyCtx.req, verifyCtx.res, { adminDb: db });
    expect(verifyCtx.getStatus()).toBe(200);
    const pub = verifyCtx.getData();
    expect(pub.valid).toBe(true);
    expect(pub.recipientName).toBe('Alice');
    expect(pub.ownerId).toBeUndefined();
    expect(pub.score).toBeUndefined();
    expect(pub.email).toBeUndefined();

    // Owner listing reads from Firestore
    const owned = await getIssuedCertificatesByOwnerPersistent(db, 'student_1');
    expect(owned).toHaveLength(1);
    expect(owned[0].id).toBe(cert.id);
  });

  it('[P2-02] concurrent issuance with same idempotency key produces exactly one certificate', async () => {
    const db = createStatefulFirestoreMock();
    const params = {
      ownerId: 'student_1',
      recipientName: 'Alice',
      assessmentType: 'quiz' as const,
      assessmentId: 'game_concurrent',
      assessmentTitle: 'Concurrency 101',
      type: 'quiz_excellence' as const,
      score: 2000,
      rank: 1,
      totalParticipants: 10,
      accuracy: 1,
      issuerId: 'host_1',
      issuerName: 'Prof. Turing',
    };

    const results = await Promise.all([
      issueCertificatePersistent(db, params, false),
      issueCertificatePersistent(db, params, false),
      issueCertificatePersistent(db, params, false),
    ]);

    expect(results.every(r => r.success)).toBe(true);
    const ids = new Set(results.map(r => r.certificate?.id));
    const vids = new Set(results.map(r => r.certificate?.verificationId));
    expect(ids.size).toBe(1);
    expect(vids.size).toBe(1);
    expect(db._collections[CERTIFICATES_COLLECTION].size).toBe(1);
    expect(db._collections[CERTIFICATE_VERIFICATION_COLLECTION].size).toBe(1);
    expect(db._collections[CERTIFICATE_IDEMPOTENCY_COLLECTION].size).toBe(1);
  });

  it('[P2-03] handles verification ID collisions safely without overwriting existing records', async () => {
    const db = createStatefulFirestoreMock();
    await db.collection(CERTIFICATE_VERIFICATION_COLLECTION).doc('QA-V-COLL-1111-1111').set({
      verificationId: 'QA-V-COLL-1111-1111',
      certificateId: 'cert_existing_other',
      status: 'valid',
    });

    let calls = 0;
    const collisionThenUnique = () => {
      calls++;
      return calls === 1 ? 'QA-V-COLL-1111-1111' : 'QA-V-UNIQ-2222-2222';
    };

    const res = await issueCertificatePersistent(
      db,
      {
        ownerId: 'student_1',
        recipientName: 'Alice',
        assessmentType: 'quiz',
        assessmentId: 'game_coll',
        assessmentTitle: 'Collision Test',
        type: 'quiz_completion',
        score: 500,
        rank: 2,
        totalParticipants: 5,
        accuracy: 0.5,
        issuerId: 'host_1',
        issuerName: 'Host',
      },
      false,
      collisionThenUnique
    );

    expect(res.success).toBe(true);
    expect(res.certificate?.verificationId).toBe('QA-V-UNIQ-2222-2222');
    // Original verification record was NOT overwritten
    const existing = await db.collection(CERTIFICATE_VERIFICATION_COLLECTION).doc('QA-V-COLL-1111-1111').get();
    expect(existing.data().certificateId).toBe('cert_existing_other');
  });

  it('[P2-04] revocation persists across restarts, is idempotent, and rejects unauthorized callers', async () => {
    const db = createStatefulFirestoreMock();
    const issued = await issueCertificatePersistent(db, {
      ownerId: 'student_1',
      recipientName: 'Alice',
      assessmentType: 'quiz',
      assessmentId: 'game_rev',
      assessmentTitle: 'Ethics Exam',
      type: 'quiz_completion',
      score: 900,
      rank: 1,
      totalParticipants: 5,
      accuracy: 0.9,
      issuerId: 'host_1',
      issuerName: 'Host',
    });
    const cert = issued.certificate!;

    // Unauthorized student/intruder cannot revoke
    const badRevoke = createMockReqRes({
      headers: { authorization: 'Bearer student_token' },
      body: { certificateId: cert.id, reason: 'Self revoke' },
    });
    await handleRevokeCertificate(badRevoke.req, badRevoke.res, { adminAuth: badRevoke.adminAuth, adminDb: db });
    expect(badRevoke.getStatus()).toBe(403);

    // Authorized host revokes
    const okRevoke = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { certificateId: cert.id, reason: 'Integrity breach' },
    });
    await handleRevokeCertificate(okRevoke.req, okRevoke.res, { adminAuth: okRevoke.adminAuth, adminDb: db });
    expect(okRevoke.getStatus()).toBe(200);
    expect(okRevoke.getData().certificate.status).toBe('revoked');

    // Concurrent/repeated revocation is idempotent
    const [r1, r2] = await Promise.all([
      revokeCertificatePersistent(db, cert.id, 'host_1', 'Duplicate reason'),
      revokeCertificatePersistent(db, cert.id, 'admin_1', 'Admin duplicate', true),
    ]);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // Public verification reports revoked
    const verifyCtx = createMockReqRes({ params: { verificationId: cert.verificationId } });
    await handleVerifyCertificate(verifyCtx.req, verifyCtx.res, { adminDb: db });
    expect(verifyCtx.getStatus()).toBe(200);
    expect(verifyCtx.getData().valid).toBe(false);
    expect(verifyCtx.getData().status).toBe('revoked');
    expect(verifyCtx.getData().revocationReason).toBe('Integrity breach');
  });

  it('[P2-05] reissue supersedes previous verificationId so old verification ID returns not_found', async () => {
    const db = createStatefulFirestoreMock();
    const first = await issueCertificatePersistent(db, {
      ownerId: 'student_1',
      recipientName: 'Alice',
      assessmentType: 'quiz',
      assessmentId: 'game_reissue',
      assessmentTitle: 'Reissue Quiz',
      type: 'quiz_completion',
      score: 1000,
      rank: 2,
      totalParticipants: 4,
      accuracy: 0.75,
      issuerId: 'host_1',
      issuerName: 'Host',
    });
    const oldVid = first.certificate!.verificationId;

    const reissued = await issueCertificatePersistent(
      db,
      {
        ownerId: 'student_1',
        recipientName: 'Alice',
        assessmentType: 'quiz',
        assessmentId: 'game_reissue',
        assessmentTitle: 'Reissue Quiz',
        type: 'quiz_completion',
        score: 1000,
        rank: 2,
        totalParticipants: 4,
        accuracy: 0.75,
        issuerId: 'host_1',
        issuerName: 'Host',
      },
      true
    );
    expect(reissued.success).toBe(true);
    expect(reissued.certificate?.reissueCount).toBe(1);
    const newVid = reissued.certificate!.verificationId;
    expect(newVid).not.toBe(oldVid);

    const oldCheck = await verifyCertificatePublicPersistent(db, oldVid);
    expect(oldCheck.valid).toBe(false);
    expect(oldCheck.status).toBe('not_found');

    const newCheck = await verifyCertificatePublicPersistent(db, newVid);
    expect(newCheck.valid).toBe(true);
    expect(newCheck.status).toBe('valid');
  });

  it('[P2-06] supports legacy certificate records stored directly in certificates collection', async () => {
    const db = createStatefulFirestoreMock();
    await db.collection(CERTIFICATES_COLLECTION).doc('legacy_cert_1').set({
      id: 'legacy_cert_1',
      verificationId: 'QA-V-LEGA-CY00-0001',
      ownerId: 'student_legacy',
      recipientName: 'Legacy Student',
      assessmentType: 'quiz',
      assessmentId: 'game_legacy',
      assessmentTitle: 'Legacy Quiz',
      type: 'quiz_completion',
      score: 800,
      rank: 3,
      totalParticipants: 10,
      accuracy: 0.8,
      issuerId: 'host_1',
      issuerName: 'Legacy Host',
      issueDate: '2026-01-01T00:00:00.000Z',
      status: 'valid',
      reissueCount: 0,
    });

    const check = await verifyCertificatePublicPersistent(db, 'QA-V-LEGA-CY00-0001');
    expect(check.valid).toBe(true);
    expect(check.recipientName).toBe('Legacy Student');
    expect((check as any).ownerId).toBeUndefined();
  });

  it('[P2-07] Firestore transaction failure returns HTTP 500 without false success or partial writes', async () => {
    const failingDb = createStatefulFirestoreMock({ failOnTransaction: true });
    await failingDb.collection('games').doc('game_fail').set({
      hostId: 'host_1',
      hostName: 'Host',
      quizTitle: 'Fail Test',
      questions: [{ id: 'q1' }],
    });
    await failingDb.collection('games').doc('game_fail').collection('players').doc('student_1').set({
      nickname: 'Alice',
      score: 1000,
      correctCount: 1,
    });

    const issueCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { ownerId: 'student_1', assessmentId: 'game_fail' },
    });
    await handleIssueCertificate(issueCtx.req, issueCtx.res, {
      adminAuth: issueCtx.adminAuth,
      adminDb: failingDb,
    });
    expect(issueCtx.getStatus()).toBe(500);
    expect(failingDb._collections[CERTIFICATES_COLLECTION].size).toBe(0);
    expect(failingDb._collections[CERTIFICATE_VERIFICATION_COLLECTION].size).toBe(0);
    expect(failingDb._collections[CERTIFICATE_IDEMPOTENCY_COLLECTION].size).toBe(0);

    const revokeCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { certificateId: 'cert_1', reason: 'Test' },
    });
    await handleRevokeCertificate(revokeCtx.req, revokeCtx.res, {
      adminAuth: revokeCtx.adminAuth,
      adminDb: failingDb,
    });
    expect(revokeCtx.getStatus()).toBe(500);
  });

  it('[P2-08] rejects reissuance of a revoked certificate (409) and keeps certificate & verification revoked', async () => {
    const db = createStatefulFirestoreMock();
    await db.collection('games').doc('game_rev_reissue').set({
      hostId: 'host_1',
      hostName: 'Prof. Turing',
      quizTitle: 'Security Exam',
      questions: [{ id: 'q1' }],
    });
    await db.collection('games').doc('game_rev_reissue').collection('players').doc('student_1').set({
      nickname: 'Alice',
      score: 1000,
      correctCount: 1,
    });

    // 1. Issue certificate
    const issueCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { ownerId: 'student_1', assessmentId: 'game_rev_reissue' },
    });
    await handleIssueCertificate(issueCtx.req, issueCtx.res, { adminAuth: issueCtx.adminAuth, adminDb: db });
    expect(issueCtx.getStatus()).toBe(201);
    const cert = issueCtx.getData().certificate;

    // 2. Revoke certificate
    const revokeRes = await revokeCertificatePersistent(db, cert.id, 'host_1', 'Cheating confirmed');
    expect(revokeRes.success).toBe(true);

    // 3. Attempt to reissue the revoked certificate -> must fail with 409 Conflict
    const reissueCtx = createMockReqRes({
      headers: { authorization: 'Bearer host_token' },
      body: { ownerId: 'student_1', assessmentId: 'game_rev_reissue', reissue: true },
    });
    await handleIssueCertificate(reissueCtx.req, reissueCtx.res, {
      adminAuth: reissueCtx.adminAuth,
      adminDb: db,
    });
    expect(reissueCtx.getStatus()).toBe(409);
    expect(reissueCtx.getData().error).toMatch(/revoked/i);

    // 4. Certificate and verification record remain revoked
    const storedCert = await db.collection(CERTIFICATES_COLLECTION).doc(cert.id).get();
    expect(storedCert.data().status).toBe('revoked');

    const storedVerif = await db.collection(CERTIFICATE_VERIFICATION_COLLECTION).doc(cert.verificationId).get();
    expect(storedVerif.data().status).toBe('revoked');

    const publicVerify = await verifyCertificatePublicPersistent(db, cert.verificationId);
    expect(publicVerify.valid).toBe(false);
    expect(publicVerify.status).toBe('revoked');
  });

  it('[P2-09] rejects literal UID "admin_root" in revokeCertificatePersistent without verified isAdmin or issuer ownership', async () => {
    const db = createStatefulFirestoreMock();
    const issued = await issueCertificatePersistent(db, {
      ownerId: 'student_1',
      recipientName: 'Alice',
      assessmentType: 'quiz',
      assessmentId: 'game_admin_literal',
      assessmentTitle: 'Auth Test',
      type: 'quiz_completion',
      score: 1000,
      rank: 1,
      totalParticipants: 5,
      accuracy: 1,
      issuerId: 'host_1',
      issuerName: 'Host',
    });
    const cert = issued.certificate!;

    // User with literal UID "admin_root" and isAdmin=false must be rejected (403)
    const spoofedAttempt = await revokeCertificatePersistent(db, cert.id, 'admin_root', 'Spoof attempt', false);
    expect(spoofedAttempt.success).toBe(false);
    expect(spoofedAttempt.statusCode).toBe(403);

    // Certificate remains valid
    const check = await verifyCertificatePublicPersistent(db, cert.verificationId);
    expect(check.valid).toBe(true);
    expect(check.status).toBe('valid');
  });
});
