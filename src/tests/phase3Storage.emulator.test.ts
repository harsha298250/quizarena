/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { ref, uploadBytes, deleteObject } from 'firebase/storage';

const DEMO_PROJECT_ID = 'demo-quizarena-test';

describe('Phase 3A — Firebase Storage Security Rules Emulator Integration Suite', () => {
  let rulesEnv: RulesTestEnvironment;

  const teacherUid = 'teacher_alice';
  const otherTeacherUid = 'teacher_bob';
  const hostUid = 'host_charlie';
  const otherHostUid = 'host_david';
  const studentUid = 'student_eve';

  const validPngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const oversizedImageBytes = new Uint8Array(11 * 1024 * 1024); // 11MB (> 10MB limit)
  const oversizedAvatarBytes = new Uint8Array(6 * 1024 * 1024); // 6MB (> 5MB limit)

  beforeAll(async () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';

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
  });

  beforeEach(async () => {
    await rulesEnv.clearFirestore();
    await rulesEnv.clearStorage();

    // Seed test documents authoritatively via withSecurityRulesDisabled
    await rulesEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      // Seed Quiz documents
      await db.doc('quizzes/quiz_valid').set({
        title: 'Biology 101',
        authorId: teacherUid,
        isPublic: true,
        createdAt: new Date().toISOString(),
      });

      await db.doc('quizzes/quiz_other').set({
        title: 'Chemistry 101',
        authorId: otherTeacherUid,
        isPublic: false,
        createdAt: new Date().toISOString(),
      });

      // Seed Tournament documents
      await db.doc('tournaments/tourney_valid').set({
        title: 'Science Olympiad',
        hostId: hostUid,
        visibility: 'public',
        createdAt: new Date().toISOString(),
      });

      await db.doc('tournaments/tourney_other').set({
        title: 'Math Derby',
        hostId: otherHostUid,
        visibility: 'private',
        createdAt: new Date().toISOString(),
      });
    });
  });

  // ==========================================
  // 1. Quizzes Storage Rules (/quizzes/{quizId}/{fileName})
  // ==========================================
  describe('1. Quiz Media Storage Rules (/quizzes/{quizId}/{fileName})', () => {
    it('allows quiz author to upload a valid image banner (< 10MB)', async () => {
      const storageTeacher = rulesEnv.authenticatedContext(teacherUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const imageRef = ref(storageTeacher, 'quizzes/quiz_valid/banner.png');
      await assertSucceeds(
        uploadBytes(imageRef, validPngBytes, { contentType: 'image/png' })
      );
    });

    it('allows quiz author to overwrite existing image banner', async () => {
      const storageTeacher = rulesEnv.authenticatedContext(teacherUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const imageRef = ref(storageTeacher, 'quizzes/quiz_valid/banner.png');
      await assertSucceeds(
        uploadBytes(imageRef, validPngBytes, { contentType: 'image/png' })
      );

      // Overwrite
      const updatedBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
      await assertSucceeds(
        uploadBytes(imageRef, updatedBytes, { contentType: 'image/png' })
      );
    });

    it('allows quiz author to delete their quiz image banner', async () => {
      const storageTeacher = rulesEnv.authenticatedContext(teacherUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const imageRef = ref(storageTeacher, 'quizzes/quiz_valid/banner.png');
      await assertSucceeds(
        uploadBytes(imageRef, validPngBytes, { contentType: 'image/png' })
      );

      await assertSucceeds(deleteObject(imageRef));
    });

    it('denies non-author teacher from uploading to another teacher quiz', async () => {
      const storageOther = rulesEnv.authenticatedContext(otherTeacherUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const imageRef = ref(storageOther, 'quizzes/quiz_valid/hijack.png');
      await assertFails(
        uploadBytes(imageRef, validPngBytes, { contentType: 'image/png' })
      );
    });

    it('denies non-author teacher from deleting another teacher quiz banner', async () => {
      // Seed banner first with security rules disabled
      await rulesEnv.withSecurityRulesDisabled(async (context) => {
        const s = context.storage();
        await uploadBytes(ref(s, 'quizzes/quiz_valid/banner.png'), validPngBytes, { contentType: 'image/png' });
      });

      const storageOther = rulesEnv.authenticatedContext(otherTeacherUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const imageRef = ref(storageOther, 'quizzes/quiz_valid/banner.png');
      await assertFails(deleteObject(imageRef));
    });

    it('denies anonymous user from uploading to quiz storage', async () => {
      const storageAnon = rulesEnv.authenticatedContext('anon_user', {
        firebase: { sign_in_provider: 'anonymous' },
      } as any).storage();

      const imageRef = ref(storageAnon, 'quizzes/quiz_valid/banner.png');
      await assertFails(
        uploadBytes(imageRef, validPngBytes, { contentType: 'image/png' })
      );
    });

    it('denies unauthenticated client from uploading to quiz storage', async () => {
      const storageUnauth = rulesEnv.unauthenticatedContext().storage();
      const imageRef = ref(storageUnauth, 'quizzes/quiz_valid/banner.png');
      await assertFails(
        uploadBytes(imageRef, validPngBytes, { contentType: 'image/png' })
      );
    });

    it('denies upload when referenced quiz document does not exist in Firestore', async () => {
      const storageTeacher = rulesEnv.authenticatedContext(teacherUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const imageRef = ref(storageTeacher, 'quizzes/nonexistent_quiz_123/banner.png');
      await assertFails(
        uploadBytes(imageRef, validPngBytes, { contentType: 'image/png' })
      );
    });

    it('denies upload when file is oversized (> 10MB)', async () => {
      const storageTeacher = rulesEnv.authenticatedContext(teacherUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const imageRef = ref(storageTeacher, 'quizzes/quiz_valid/huge.png');
      await assertFails(
        uploadBytes(imageRef, oversizedImageBytes, { contentType: 'image/png' })
      );
    });

    it('denies upload with invalid MIME type (e.g. text/html, application/pdf)', async () => {
      const storageTeacher = rulesEnv.authenticatedContext(teacherUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const xssRef = ref(storageTeacher, 'quizzes/quiz_valid/exploit.html');
      await assertFails(
        uploadBytes(xssRef, validPngBytes, { contentType: 'text/html' })
      );

      const pdfRef = ref(storageTeacher, 'quizzes/quiz_valid/doc.pdf');
      await assertFails(
        uploadBytes(pdfRef, validPngBytes, { contentType: 'application/pdf' })
      );
    });
  });

  // ==========================================
  // 2. Tournaments Storage Rules (/tournaments/{tournamentId}/{fileName})
  // ==========================================
  describe('2. Tournament Media Storage Rules (/tournaments/{tournamentId}/{fileName})', () => {
    it('allows tournament host to upload a valid image banner', async () => {
      const storageHost = rulesEnv.authenticatedContext(hostUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const bannerRef = ref(storageHost, 'tournaments/tourney_valid/banner.jpg');
      await assertSucceeds(
        uploadBytes(bannerRef, validPngBytes, { contentType: 'image/jpeg' })
      );
    });

    it('allows tournament host to overwrite their tournament banner', async () => {
      const storageHost = rulesEnv.authenticatedContext(hostUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const bannerRef = ref(storageHost, 'tournaments/tourney_valid/banner.jpg');
      await assertSucceeds(
        uploadBytes(bannerRef, validPngBytes, { contentType: 'image/jpeg' })
      );

      const newBytes = new Uint8Array([1, 2, 3]);
      await assertSucceeds(
        uploadBytes(bannerRef, newBytes, { contentType: 'image/jpeg' })
      );
    });

    it('allows tournament host to delete their tournament banner', async () => {
      const storageHost = rulesEnv.authenticatedContext(hostUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const bannerRef = ref(storageHost, 'tournaments/tourney_valid/banner.jpg');
      await assertSucceeds(
        uploadBytes(bannerRef, validPngBytes, { contentType: 'image/jpeg' })
      );

      await assertSucceeds(deleteObject(bannerRef));
    });

    it('denies non-host from uploading to tournament storage', async () => {
      const storageOther = rulesEnv.authenticatedContext(otherHostUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const bannerRef = ref(storageOther, 'tournaments/tourney_valid/hijack.jpg');
      await assertFails(
        uploadBytes(bannerRef, validPngBytes, { contentType: 'image/jpeg' })
      );
    });

    it('denies anonymous user from uploading to tournament storage', async () => {
      const storageAnon = rulesEnv.authenticatedContext('anon_user', {
        firebase: { sign_in_provider: 'anonymous' },
      } as any).storage();

      const bannerRef = ref(storageAnon, 'tournaments/tourney_valid/banner.jpg');
      await assertFails(
        uploadBytes(bannerRef, validPngBytes, { contentType: 'image/jpeg' })
      );
    });

    it('denies upload when referenced tournament document does not exist in Firestore', async () => {
      const storageHost = rulesEnv.authenticatedContext(hostUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const bannerRef = ref(storageHost, 'tournaments/nonexistent_tourney_404/banner.jpg');
      await assertFails(
        uploadBytes(bannerRef, validPngBytes, { contentType: 'image/jpeg' })
      );
    });
  });

  // ==========================================
  // 3. User Avatars & Certificates Invariants
  // ==========================================
  describe('3. Avatars and Certificates Storage Invariants', () => {
    it('allows user to upload their own avatar image (< 5MB)', async () => {
      const storageStudent = rulesEnv.authenticatedContext(studentUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const avatarRef = ref(storageStudent, `avatars/${studentUid}/profile.png`);
      await assertSucceeds(
        uploadBytes(avatarRef, validPngBytes, { contentType: 'image/png' })
      );
    });

    it('denies user from uploading avatar to another user folder', async () => {
      const storageStudent = rulesEnv.authenticatedContext(studentUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const avatarRef = ref(storageStudent, `avatars/${teacherUid}/hijack.png`);
      await assertFails(
        uploadBytes(avatarRef, validPngBytes, { contentType: 'image/png' })
      );
    });

    it('denies oversized avatar upload (> 5MB)', async () => {
      const storageStudent = rulesEnv.authenticatedContext(studentUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const avatarRef = ref(storageStudent, `avatars/${studentUid}/oversized.png`);
      await assertFails(
        uploadBytes(avatarRef, oversizedAvatarBytes, { contentType: 'image/png' })
      );
    });

    it('strictly denies client-side writes and deletes to certificates (Admin SDK only)', async () => {
      const storageTeacher = rulesEnv.authenticatedContext(teacherUid, {
        firebase: { sign_in_provider: 'password' },
      } as any).storage();

      const certRef = ref(storageTeacher, 'certificates/cert_123/forged.pdf');
      await assertFails(
        uploadBytes(certRef, validPngBytes, { contentType: 'application/pdf' })
      );

      // Seed a certificate via securityRulesDisabled
      await rulesEnv.withSecurityRulesDisabled(async (context) => {
        const s = context.storage();
        await uploadBytes(ref(s, 'certificates/cert_123/official.pdf'), validPngBytes, { contentType: 'application/pdf' });
      });

      // Client deletion denied
      await assertFails(
        deleteObject(ref(storageTeacher, 'certificates/cert_123/official.pdf'))
      );
    });
  });

});

