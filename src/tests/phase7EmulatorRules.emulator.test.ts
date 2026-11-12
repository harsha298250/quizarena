/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';

const DEMO_PROJECT_ID = 'demo-quizarena-test';

let testEnv: RulesTestEnvironment;

function unauthCtx() {
  return testEnv.unauthenticatedContext();
}

function anonCtx(uid = 'anon_user_1') {
  return testEnv.authenticatedContext(uid, {
    firebase: { sign_in_provider: 'anonymous' },
  } as any);
}

function userCtx(uid: string, email = `${uid}@example.com`) {
  return testEnv.authenticatedContext(uid, {
    email,
    firebase: { sign_in_provider: 'password' },
  } as any);
}

describe('Phase 7.1 — Firebase Emulator Firestore Security Rules Integration Suite', () => {
  beforeAll(async () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: DEMO_PROJECT_ID,
      firestore: {
        rules,
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it('1. enforces authentication and anonymous restrictions across protected collections', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'tournaments/t_pub'), {
        title: 'Public Cup',
        visibility: 'public',
        hostId: 'host_1',
        status: 'registration_open',
      });
      await setDoc(doc(db, 'questionBank/qb_1'), {
        authorId: 'host_1',
        isPublic: false,
        text: 'Private bank question?',
      });
      await setDoc(doc(db, 'accountDeletionJobs/job_anon'), {
        uid: 'anon_user_1',
        status: 'requested',
      });
      await setDoc(doc(db, 'quizzes/q_public'), {
        authorId: 'host_1',
        isPublic: true,
        title: 'Public Quiz',
      });
      await setDoc(doc(db, 'games/g_1'), {
        hostId: 'host_1',
        status: 'lobby',
      });
      await setDoc(doc(db, 'certificates/cert_1'), {
        ownerId: 'host_1',
        issuerId: 'host_1',
        score: 90,
      });
    });

    const unauthDb = unauthCtx().firestore();
    const anonDb = anonCtx('anon_user_1').firestore();
    const teacherDb = userCtx('teacher_1').firestore();

    // Unauthenticated clients denied on public-looking and private collections
    await assertFails(getDoc(doc(unauthDb, 'tournaments/t_pub')));
    await assertFails(getDoc(doc(unauthDb, 'quizzes/q_public')));
    await assertFails(getDoc(doc(unauthDb, 'games/g_1')));
    await assertFails(getDoc(doc(unauthDb, 'certificates/cert_1')));

    // Anonymous denied on tournaments, private questionBank, accountDeletionJobs, quiz creation
    await assertFails(getDoc(doc(anonDb, 'tournaments/t_pub')));
    await assertFails(getDoc(doc(anonDb, 'questionBank/qb_1')));
    await assertFails(getDoc(doc(anonDb, 'accountDeletionJobs/job_anon')));
    await assertFails(
      setDoc(doc(anonDb, 'quizzes/q_anon'), { authorId: 'anon_user_1', title: 'Anon Quiz' })
    );

    // Authenticated non-anonymous user allowed on public tournament & own quiz creation
    await assertSucceeds(getDoc(doc(teacherDb, 'tournaments/t_pub')));
    await assertSucceeds(
      setDoc(doc(teacherDb, 'quizzes/q_teacher'), { authorId: 'teacher_1', title: 'Teacher Quiz' })
    );
    // Still denied on another teacher's private questionBank item
    await assertFails(getDoc(doc(teacherDb, 'questionBank/qb_1')));
  });

  it('2. enforces cross-user isolation for profiles, certificates, deletion jobs, and game answers', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users/user_a'), {
        uid: 'user_a',
        displayName: 'Alice',
        role: 'user',
        status: 'active',
      });
      await setDoc(doc(db, 'certificates/cert_a'), {
        ownerId: 'user_a',
        issuerId: 'host_1',
        recipientName: 'Alice',
      });
      await setDoc(doc(db, 'accountDeletionJobs/job_a'), {
        uid: 'user_a',
        status: 'processing',
      });
      await setDoc(doc(db, 'games/g_1'), {
        hostId: 'host_1',
        status: 'active',
      });
      await setDoc(doc(db, 'games/g_1/players/user_a'), {
        nickname: 'Alice',
        score: 100,
      });
      await setDoc(doc(db, 'games/g_1/players/user_b'), {
        nickname: 'Bob',
        score: 50,
      });
      await setDoc(doc(db, 'games/g_1/answers/ans_a'), {
        playerId: 'user_a',
        selectedIndex: 2,
      });
    });

    const userBDb = userCtx('user_b').firestore();

    await assertFails(getDoc(doc(userBDb, 'users/user_a')));
    await assertFails(updateDoc(doc(userBDb, 'users/user_a'), { displayName: 'Hacked' }));
    await assertFails(getDoc(doc(userBDb, 'certificates/cert_a')));
    await assertFails(getDoc(doc(userBDb, 'accountDeletionJobs/job_a')));
    await assertFails(getDoc(doc(userBDb, 'games/g_1/answers/ans_a')));

    // Owner can read own answer & own profile
    const userADb = userCtx('user_a').firestore();
    await assertSucceeds(getDoc(doc(userADb, 'users/user_a')));
    await assertSucceeds(getDoc(doc(userADb, 'games/g_1/answers/ans_a')));

    // User privilege-escalation and status-tampering protection
    const newUserDb = userCtx('new_user').firestore();
    await assertFails(
      setDoc(doc(newUserDb, 'users/new_user'), { uid: 'new_user', isAdmin: true, role: 'user', status: 'active' })
    );
    await assertFails(
      setDoc(doc(newUserDb, 'users/new_user'), { uid: 'new_user', role: 'admin', isAdmin: false, status: 'active' })
    );
    await assertFails(
      setDoc(doc(newUserDb, 'users/new_user'), { uid: 'new_user', role: 'user', status: 'deletion_pending' })
    );
    await assertSucceeds(
      setDoc(doc(newUserDb, 'users/new_user'), { uid: 'new_user', role: 'user', isAdmin: false, status: 'active' })
    );

    await assertFails(updateDoc(doc(userADb, 'users/user_a'), { role: 'admin' }));
    await assertFails(updateDoc(doc(userADb, 'users/user_a'), { isAdmin: true }));
    await assertFails(updateDoc(doc(userADb, 'users/user_a'), { status: 'deletion_pending' }));
  });

  it('3. enforces legacy /mail read-only ownership rules and blocks all client writes', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users/user_a'), {
        uid: 'user_a',
        status: 'active',
      });
      await setDoc(doc(db, 'users/user_del'), {
        uid: 'user_del',
        status: 'deletion_pending',
      });
      await setDoc(doc(db, 'mail/mail_1'), {
        ownerId: 'user_a',
        to: 'recip@example.com',
        subject: 'Legacy Mail',
      });
      await setDoc(doc(db, 'mail/mail_del'), {
        ownerId: 'user_del',
        to: 'user_del@example.com',
        subject: 'Pending Deletion Mail',
      });
    });

    const anonDb = anonCtx().firestore();
    const ownerDb = userCtx('user_a').firestore();
    const recipDb = userCtx('user_r', 'recip@example.com').firestore();
    const delDb = userCtx('user_del').firestore();

    // Anonymous denied read and write
    await assertFails(getDoc(doc(anonDb, 'mail/mail_1')));
    await assertFails(setDoc(doc(anonDb, 'mail/mail_new'), { ownerId: 'anon_user_1' }));

    // Authenticated non-anonymous denied create, update, delete
    await assertFails(
      setDoc(doc(ownerDb, 'mail/mail_client_create'), { ownerId: 'user_a', to: 'x@example.com' })
    );
    await assertFails(updateDoc(doc(ownerDb, 'mail/mail_1'), { subject: 'Tampered' }));
    await assertFails(deleteDoc(doc(ownerDb, 'mail/mail_1')));

    // Authorized active owner and recipient can read
    await assertSucceeds(getDoc(doc(ownerDb, 'mail/mail_1')));
    await assertSucceeds(getDoc(doc(recipDb, 'mail/mail_1')));

    // Deletion-pending user denied reading own legacy mail
    await assertFails(getDoc(doc(delDb, 'mail/mail_del')));
  });

  it('4. blocks all client reads and writes on server-only collections', async () => {
    const serverOnlyDocs = [
      'emailOutbox/job_1',
      'emailOutboxIdempotency/key_1',
      'emailWebhookEvents/evt_1',
      'emailOutboxMetrics/global',
      'certificateVerification/ver_1',
      'certificateIdempotency/cid_1',
      'accountDeletionLocks/lock_1',
      'accountDeletionEmailBlocks/blk_1',
    ];

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const pathStr of serverOnlyDocs) {
        await setDoc(doc(db, pathStr), { createdBy: 'server' });
      }
    });

    const anonDb = anonCtx().firestore();
    const authDb = userCtx('user_a').firestore();

    for (const pathStr of serverOnlyDocs) {
      await assertFails(getDoc(doc(anonDb, pathStr)));
      await assertFails(setDoc(doc(anonDb, pathStr), { spoofed: true }));
      await assertFails(getDoc(doc(authDb, pathStr)));
      await assertFails(setDoc(doc(authDb, pathStr), { spoofed: true }));
      await assertFails(deleteDoc(doc(authDb, pathStr)));
    }
  });

  it('5. enforces certificate integrity and ownership-scoped reads', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'certificates/cert_1'), {
        ownerId: 'student_1',
        issuerId: 'host_1',
        score: 95,
      });
    });

    const studentDb = userCtx('student_1').firestore();
    const hostDb = userCtx('host_1').firestore();
    const outsiderDb = userCtx('outsider_1').firestore();

    // Owner and issuer can read; outsider cannot
    await assertSucceeds(getDoc(doc(studentDb, 'certificates/cert_1')));
    await assertSucceeds(getDoc(doc(hostDb, 'certificates/cert_1')));
    await assertFails(getDoc(doc(outsiderDb, 'certificates/cert_1')));

    // No client can create, update, or delete certificates
    await assertFails(
      setDoc(doc(studentDb, 'certificates/cert_forged'), { ownerId: 'student_1', score: 100 })
    );
    await assertFails(updateDoc(doc(studentDb, 'certificates/cert_1'), { score: 100 }));
    await assertFails(updateDoc(doc(hostDb, 'certificates/cert_1'), { score: 100 }));
    await assertFails(deleteDoc(doc(hostDb, 'certificates/cert_1')));
  });

  it('6. enforces private tournament isolation, active registration, and host update boundaries', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'tournaments/t_priv'), {
        title: 'Private Finals',
        description: 'Invite only',
        visibility: 'private',
        hostId: 'host_1',
        status: 'in_progress',
      });
      await setDoc(doc(db, 'tournaments/t_priv/registrations/active_p'), {
        status: 'registered',
        seed: 1,
      });
      await setDoc(doc(db, 'tournaments/t_priv/registrations/withdrawn_p'), {
        status: 'withdrawn',
        seed: 2,
      });
      await setDoc(doc(db, 'tournaments/t_priv/matches/m_1'), {
        round: 1,
        winnerId: 'active_p',
      });
      await setDoc(doc(db, 'tournaments/t_priv/results/r_1'), {
        participantId: 'active_p',
        rank: 1,
      });
    });

    const hostDb = userCtx('host_1').firestore();
    const activeDb = userCtx('active_p').firestore();
    const withdrawnDb = userCtx('withdrawn_p').firestore();
    const outsiderDb = userCtx('outsider_1').firestore();

    // Outsider and withdrawn participant cannot read private tournament, matches, or results
    for (const db of [outsiderDb, withdrawnDb]) {
      await assertFails(getDoc(doc(db, 'tournaments/t_priv')));
      await assertFails(getDoc(doc(db, 'tournaments/t_priv/matches/m_1')));
      await assertFails(getDoc(doc(db, 'tournaments/t_priv/results/r_1')));
    }

    // Active participant and host can read private tournament, matches, and results
    for (const db of [activeDb, hostDb]) {
      await assertSucceeds(getDoc(doc(db, 'tournaments/t_priv')));
      await assertSucceeds(getDoc(doc(db, 'tournaments/t_priv/matches/m_1')));
      await assertSucceeds(getDoc(doc(db, 'tournaments/t_priv/results/r_1')));
    }

    // Host can update cosmetic fields only; cannot alter status or bracket, and cannot write subcollections
    await assertSucceeds(updateDoc(doc(hostDb, 'tournaments/t_priv'), { title: 'Updated Title' }));
    await assertFails(updateDoc(doc(hostDb, 'tournaments/t_priv'), { status: 'completed' }));
    await assertFails(
      setDoc(doc(hostDb, 'tournaments/t_priv/matches/m_2'), { round: 2 })
    );
    await assertFails(
      setDoc(doc(activeDb, 'tournaments/t_priv/registrations/active_p'), { status: 'registered', seed: 99 })
    );
    await assertFails(
      setDoc(doc(hostDb, 'tournaments/t_priv/results/r_2'), { rank: 2 })
    );
  });

  it('7. enforces account deletion pending restrictions and deletion job isolation', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users/user_del'), {
        uid: 'user_del',
        status: 'deletion_pending',
      });
      await setDoc(doc(db, 'quizzes/q_del'), {
        authorId: 'user_del',
        title: 'My Old Quiz',
      });
      await setDoc(doc(db, 'accountDeletionJobs/job_del'), {
        uid: 'user_del',
        status: 'processing',
      });
    });

    const delDb = userCtx('user_del').firestore();
    const otherDb = userCtx('user_other').firestore();

    // Deletion-pending user blocked from protected personal/quiz reads and updates
    await assertFails(getDoc(doc(delDb, 'users/user_del')));
    await assertFails(updateDoc(doc(delDb, 'users/user_del'), { displayName: 'New' }));
    await assertFails(getDoc(doc(delDb, 'quizzes/q_del')));

    // Deletion job reads allowed only for owning user; writes blocked for all clients
    await assertSucceeds(getDoc(doc(delDb, 'accountDeletionJobs/job_del')));
    await assertFails(getDoc(doc(otherDb, 'accountDeletionJobs/job_del')));
    await assertFails(
      setDoc(doc(delDb, 'accountDeletionJobs/job_del'), { uid: 'user_del', status: 'completed' })
    );
  });

  it('8. enforces game session integrity, secret isolation, and player score/strike protection', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'games/g_1'), {
        hostId: 'host_1',
        status: 'lobby',
      });
      await setDoc(doc(db, 'games/g_1/secrets/q_0'), {
        correctAnswerIndex: 2,
      });
      await setDoc(doc(db, 'games/g_1/players/p_1'), {
        nickname: 'PlayerOne',
        score: 0,
        strikes: 0,
        status: 'active',
      });
    });

    const playerDb = userCtx('p_1').firestore();
    const player2Db = userCtx('p_2').firestore();
    const hostDb = userCtx('host_1').firestore();

    // Players cannot create/delete games, create/delete player docs, read/write secrets, or tamper with score/strikes/status
    await assertFails(setDoc(doc(playerDb, 'games/g_spoof'), { hostId: 'p_1' }));
    await assertFails(deleteDoc(doc(playerDb, 'games/g_1')));
    await assertFails(setDoc(doc(player2Db, 'games/g_1/players/p_2'), { nickname: 'SpoofJoin', score: 999 }));
    await assertFails(deleteDoc(doc(playerDb, 'games/g_1/players/p_1')));
    await assertFails(getDoc(doc(playerDb, 'games/g_1/secrets/q_0')));
    await assertFails(setDoc(doc(playerDb, 'games/g_1/secrets/q_0'), { correctAnswerIndex: 0 }));
    await assertFails(updateDoc(doc(playerDb, 'games/g_1/players/p_1'), { score: 9999 }));
    await assertFails(updateDoc(doc(playerDb, 'games/g_1/players/p_1'), { strikes: 3, status: 'terminated' }));

    // Oversized avatarConfig (> 12 keys) is rejected
    const oversizedAvatarConfig = Object.fromEntries(
      Array.from({ length: 13 }, (_, i) => [`key_${i}`, i])
    );
    await assertFails(
      updateDoc(doc(playerDb, 'games/g_1/players/p_1'), { avatarConfig: oversizedAvatarConfig })
    );

    // Player allowed to update avatar presentation fields only (<= 12 keys)
    await assertSucceeds(
      updateDoc(doc(playerDb, 'games/g_1/players/p_1'), {
        avatar: 'fox',
        avatarConfig: { color: 'orange' },
      })
    );

    // Host can read/write secrets and update game document
    await assertSucceeds(getDoc(doc(hostDb, 'games/g_1/secrets/q_0')));
    await assertSucceeds(updateDoc(doc(hostDb, 'games/g_1'), { status: 'active' }));
  });
});

