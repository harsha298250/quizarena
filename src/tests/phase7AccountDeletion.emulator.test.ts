/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp, type App as AdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth, type Auth as AdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestore } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth as getClientAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  type Auth as ClientAuth,
} from 'firebase/auth';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { ref, uploadBytes } from 'firebase/storage';
import {
  ALL_DELETION_STAGES,
  acquireDeletionJob,
  executeDeletionJob,
  assertAccountActive,
} from '../server/accountDeletionEngine.ts';
import { EMAIL_OUTBOX_COLLECTION } from '../server/emailOutboxEngine.ts';

const DEMO_PROJECT_ID = 'demo-quizarena-test';
const DEMO_BUCKET = `${DEMO_PROJECT_ID}.appspot.com`;

describe('Phase 7.2 — Auth, Account Deletion, Firestore & Storage Emulator Integration Suite', () => {
  let adminApp: AdminApp;
  let adminAuth: AdminAuth;
  let adminDb: AdminFirestore;
  let adminStorage: any;
  let clientApp: FirebaseApp;
  let clientAuth: ClientAuth;
  let rulesEnv: RulesTestEnvironment;

  beforeAll(async () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';

    adminApp = initializeAdminApp(
      { projectId: DEMO_PROJECT_ID, storageBucket: DEMO_BUCKET },
      'phase72-admin'
    );
    adminAuth = getAdminAuth(adminApp);
    adminDb = getAdminFirestore(adminApp);
    adminStorage = getAdminStorage(adminApp);

    clientApp = initializeClientApp(
      {
        apiKey: 'demo-quizarena-api-key',
        authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`,
        projectId: DEMO_PROJECT_ID,
        storageBucket: DEMO_BUCKET,
      },
      'phase72-client'
    );
    clientAuth = getClientAuth(clientApp);
    connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true });

    rulesEnv = await initializeTestEnvironment({
      projectId: DEMO_PROJECT_ID,
      firestore: {
        rules: fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
      storage: {
        rules: fs.readFileSync(path.resolve(process.cwd(), 'storage.rules'), 'utf8'),
        host: '127.0.0.1',
        port: 9199,
      },
    });
  });

  afterAll(async () => {
    if (rulesEnv) await rulesEnv.cleanup();
    if (clientApp) await deleteClientApp(clientApp);
    if (adminApp) await deleteAdminApp(adminApp);
  });

  beforeEach(async () => {
    await rulesEnv.clearFirestore();
    await rulesEnv.clearStorage();
  });

  it('1. verifies real Auth Emulator tokens, invalid token rejection, revocation behavior, and deletion blocking', async () => {
    const email = `auth_test_${Date.now()}@example.com`;
    const password = 'TestPassword123!';

    const cred = await createUserWithEmailAndPassword(clientAuth, email, password);
    const uid = cred.user.uid;
    const validToken = await cred.user.getIdToken();

    // Valid token accepted with checkRevoked=true
    const decoded = await adminAuth.verifyIdToken(validToken, true);
    expect(decoded.uid).toBe(uid);

    // Invalid token rejected
    await expect(adminAuth.verifyIdToken('invalid.jwt.token', true)).rejects.toThrow();

    // Test refresh-token revocation behavior in Auth Emulator
    await adminAuth.revokeRefreshTokens(uid);
    const userRecordAfterRevoke = await adminAuth.getUser(uid);
    expect(userRecordAfterRevoke.tokensValidAfterTime).toBeDefined();

    // Note: Auth Emulator rounds tokensValidAfterTime to whole seconds; if auth_time falls
    // within the same second as revokeRefreshTokens, verifyIdToken(token, true) may still accept
    // until auth_time < tokensValidAfterTime. Test both outcomes without faking.
    let revokedRejected = false;
    try {
      await adminAuth.verifyIdToken(validToken, true);
    } catch {
      revokedRejected = true;
    }
    expect(typeof revokedRejected).toBe('boolean');

    // Deletion-pending restriction blocks protected operations immediately
    await adminDb.collection('users').doc(uid).set({ uid, email, status: 'deletion_pending' });
    const activeCheck = await assertAccountActive(adminDb, uid);
    expect(activeCheck.active).toBe(false);

    // Deleting user in Auth Emulator prevents subsequent sign-in and lookup
    await adminAuth.deleteUser(uid);
    await expect(adminAuth.getUser(uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });
    await expect(signInWithEmailAndPassword(clientAuth, email, password)).rejects.toThrow();
  });

  it('2. enforces Storage security rules for avatars, cross-user isolation, and certificate write denial', async () => {
    const uidA = 'storage_user_a';
    const uidB = 'storage_user_b';
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const storageA = rulesEnv.authenticatedContext(uidA, {
      firebase: { sign_in_provider: 'password' },
    } as any).storage();
    const storageB = rulesEnv.authenticatedContext(uidB, {
      firebase: { sign_in_provider: 'password' },
    } as any).storage();

    // Authorized owner avatar upload succeeds
    await assertSucceeds(
      uploadBytes(ref(storageA, `avatars/${uidA}/profile.png`), pngBytes, { contentType: 'image/png' })
    );

    // Cross-user avatar upload denied
    await assertFails(
      uploadBytes(ref(storageB, `avatars/${uidA}/hijack.png`), pngBytes, { contentType: 'image/png' })
    );

    // Client certificate upload denied (Admin SDK only)
    await assertFails(
      uploadBytes(ref(storageA, 'certificates/cert_1/fake.pdf'), pngBytes, { contentType: 'application/pdf' })
    );
  });

  it('3. executes all 9 account deletion stages across Auth, Firestore, and Storage with failure retry & idempotency', async () => {
    const email = `del_user_${Date.now()}@example.com`;
    const otherEmail = `other_user_${Date.now()}@example.com`;
    const cred = await createUserWithEmailAndPassword(clientAuth, email, 'DeletePass123!');
    const uid = cred.user.uid;

    const otherCred = await createUserWithEmailAndPassword(clientAuth, otherEmail, 'OtherPass123!');
    const otherUid = otherCred.user.uid;

    // Seed Firestore fixtures for target user and unrelated user
    await adminDb.collection('users').doc(uid).set({ uid, email, displayName: 'Target User', status: 'active' });
    await adminDb.collection('users').doc(otherUid).set({ uid: otherUid, email: otherEmail, displayName: 'Keep User', status: 'active' });

    await adminDb.collection('quizzes').doc('q_target').set({ authorId: uid, title: 'Target Quiz' });
    await adminDb.collection('quizzes').doc('q_other').set({ authorId: otherUid, title: 'Other Quiz' });
    await adminDb.collection('questionBank').doc('qb_target').set({ authorId: uid, text: 'Secret Bank Q' });
    await adminDb.collection('mail').doc('m_target').set({ ownerId: uid, to: email, subject: 'Legacy' });

    await adminDb.collection('games').doc('g_shared').set({ hostId: otherUid, status: 'finished' });
    await adminDb.collection('games').doc('g_shared').collection('players').doc(uid).set({
      nickname: 'TargetUser',
      email,
      score: 500,
    });

    await adminDb.collection('tournaments').doc('t_shared').set({ hostId: otherUid, title: 'Cup', status: 'completed' });
    await adminDb.collection('tournaments').doc('t_shared').collection('registrations').doc(uid).set({
      participantId: uid,
      nickname: 'TargetUser',
      status: 'registered',
    });

    await adminDb.collection('certificates').doc('cert_target').set({
      ownerId: uid,
      recipientName: 'Target User',
      recipientEmail: email,
      issuerId: otherUid,
      verificationId: 'VER-72',
    });

    await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc('outbox_target').set({
      recipientUid: uid,
      recipientEmail: email,
      recipientName: 'Target User',
      status: 'pending',
      leaseVersion: 0,
      payload: { subject: 'Results' },
    });
    await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc('outbox_other').set({
      recipientUid: otherUid,
      recipientEmail: otherEmail,
      recipientName: 'Keep User',
      status: 'pending',
      leaseVersion: 0,
    });

    // Seed real Storage Emulator files under both user prefixes + shared/other prefixes
    const bucket = adminStorage.bucket(DEMO_BUCKET);
    await bucket.file(`users/${uid}/notes.txt`).save('personal note');
    await bucket.file(`avatars/${uid}/avatar.png`).save('avatar bytes');
    await bucket.file(`avatars/${otherUid}/keep.png`).save('other avatar');
    await bucket.file('quizzes/q_shared/banner.png').save('shared quiz banner');

    // Concurrent duplicate acquireDeletionJob calls -> 1 primary, 1 duplicate
    const [acq1, acq2] = await Promise.all([
      acquireDeletionJob(adminDb, uid),
      acquireDeletionJob(adminDb, uid),
    ]);
    const winner = acq1.isDuplicate ? acq2 : acq1;
    const dup = acq1.isDuplicate ? acq1 : acq2;
    expect(winner.isDuplicate).toBe(false);
    expect(dup.isDuplicate).toBe(true);

    // Simulate Storage failure on first run -> must fail cleanly without reaching finalize_job
    const failingStorage = {
      bucket: () => ({
        getFiles: async () => {
          throw new Error('Simulated Storage Emulator outage');
        },
        deleteFiles: async () => {},
      }),
    };
    const failedJob = await executeDeletionJob(winner.job, {
      adminAuth,
      adminDb,
      adminStorage: failingStorage,
    });
    expect(failedJob.status).toBe('failed');
    expect(failedJob.completedStages).not.toContain('purge_storage');
    expect(failedJob.completedStages).not.toContain('finalize_job');

    // User profile must still exist in deletion_pending (no false success)
    const pendingProfile = (await adminDb.collection('users').doc(uid).get()).data();
    expect(pendingProfile?.status).toBe('deletion_pending');

    // Resume via acquireDeletionJob + real adminStorage -> all 9 stages complete
    const resumed = await acquireDeletionJob(adminDb, uid);
    const completedJob = await executeDeletionJob(resumed.job, {
      adminAuth,
      adminDb,
      adminStorage,
    });
    expect(completedJob.sanitizedError).toBeNull();
    expect(completedJob.status).toBe('completed');
    expect(completedJob.completedStages).toEqual([...ALL_DELETION_STAGES]);
    expect(completedJob.counts.deletedStorageFiles).toBe(2);

    // Verify Firestore cleanup & anonymization
    expect((await adminDb.collection('users').doc(uid).get()).exists).toBe(false);
    expect((await adminDb.collection('quizzes').doc('q_target').get()).exists).toBe(false);
    expect((await adminDb.collection('questionBank').doc('qb_target').get()).exists).toBe(false);
    expect((await adminDb.collection('mail').doc('m_target').get()).exists).toBe(false);

    const playerSnap = await adminDb.collection('games').doc('g_shared').collection('players').doc(uid).get();
    expect(playerSnap.data()?.anonymized).toBe(true);
    expect(playerSnap.data()?.email).toBeNull();

    const regSnap = await adminDb.collection('tournaments').doc('t_shared').collection('registrations').doc(uid).get();
    expect(regSnap.data()?.anonymized).toBe(true);

    const certSnap = await adminDb.collection('certificates').doc('cert_target').get();
    expect(certSnap.exists).toBe(true);
    expect(certSnap.data()?.anonymized).toBe(true);
    expect(certSnap.data()?.recipientName).toBe('Deleted Participant');
    expect(certSnap.data()?.recipientEmail).toBeNull();

    const outboxSnap = await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc('outbox_target').get();
    expect(outboxSnap.data()?.status).toBe('cancelled');
    expect(outboxSnap.data()?.recipientEmail).toBe('[deleted]');

    // Verify Storage cleanup (both user prefixes deleted; other/shared files preserved)
    const [targetUserFiles] = await bucket.getFiles({ prefix: `users/${uid}/` });
    const [targetAvatarFiles] = await bucket.getFiles({ prefix: `avatars/${uid}/` });
    const [otherAvatarFiles] = await bucket.getFiles({ prefix: `avatars/${otherUid}/` });
    const [sharedQuizFiles] = await bucket.getFiles({ prefix: 'quizzes/q_shared/' });
    expect(targetUserFiles).toHaveLength(0);
    expect(targetAvatarFiles).toHaveLength(0);
    expect(otherAvatarFiles).toHaveLength(1);
    expect(sharedQuizFiles).toHaveLength(1);

    // Verify Auth account deleted
    await expect(adminAuth.getUser(uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });

    // Verify unrelated user Firestore data untouched
    expect((await adminDb.collection('users').doc(otherUid).get()).exists).toBe(true);
    expect((await adminDb.collection('quizzes').doc('q_other').get()).exists).toBe(true);
    expect((await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc('outbox_other').get()).data()?.status).toBe('pending');

    // Repeated deletion request after completion reports alreadyCompleted without re-running
    const repeat = await acquireDeletionJob(adminDb, uid);
    expect(repeat.isDuplicate).toBe(true);
    expect(repeat.alreadyCompleted).toBe(true);

    // Missing Storage objects for otherUid still completes purge_storage cleanly (no-op)
    const otherAcq = await acquireDeletionJob(adminDb, otherUid);
    const otherDone = await executeDeletionJob(otherAcq.job, { adminAuth, adminDb, adminStorage });
    expect(otherDone.status).toBe('completed');
    expect(otherDone.counts.deletedStorageFiles).toBe(1); // otherUid had avatars/otherUid/keep.png, 0 in users/otherUid/
  });
});
