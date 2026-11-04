/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { db, isFirebaseConfigured, notifyFirestoreError, auth, signOut } from '../lib/firebase';
import { deleteUser, User } from 'firebase/auth';
import { Quiz } from '../types/quiz';
import { SAMPLE_QUIZZES } from '../data/sampleQuizzes';

/** Returns a per-user localStorage key to prevent cross-user data bleed. */
function localStorageKey(authorId: string): string {
  if (!authorId) return 'quizarena_quizzes_anonymous';
  // Sanitise the UID so it is safe as a key suffix (UIDs are alphanumeric, but guard anyway)
  return `quizarena_quizzes_${authorId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/**
 * Saves a quiz to Firestore under the teacher's UID and updates localStorage as cache.
 */
export async function saveQuiz(quiz: Quiz, authorId: string): Promise<Quiz> {
  const quizWithAuthor: Quiz = {
    ...quiz,
    authorId,
    updatedAt: new Date().toISOString(),
  };

  // Guard: allow placeholder authorIds to be claimed by the active teacher without throwing ownership mismatch
  const placeholderIds = new Set(['host_active', 'user_active', 'guest_teacher', 'Instructor AI', '']);
  if (quiz.authorId && !placeholderIds.has(quiz.authorId) && quiz.authorId !== authorId) {
    throw new Error(`Ownership mismatch: quiz belongs to ${quiz.authorId}, cannot overwrite as ${authorId}.`);
  }

  // 1. Update per-author localStorage cache (scoped by UID to prevent cross-user bleed)
  const cacheKey = localStorageKey(authorId);
  try {
    const cached: Quiz[] = JSON.parse(localStorage.getItem(cacheKey) || '[]');
    const idx = cached.findIndex(q => q.id === quiz.id);
    let updated: Quiz[];
    if (idx >= 0) {
      updated = [...cached];
      updated[idx] = quizWithAuthor;
    } else {
      updated = [quizWithAuthor, ...cached];
    }
    localStorage.setItem(cacheKey, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to update local quiz cache:', e);
  }

  // Also sync global quiz cache so initial loads and studio navigations reflect the new quiz immediately
  try {
    const globalCached: Quiz[] = JSON.parse(localStorage.getItem('quizarena_quizzes') || '[]');
    const gIdx = globalCached.findIndex(q => q.id === quiz.id);
    let gUpdated: Quiz[];
    if (gIdx >= 0) {
      gUpdated = [...globalCached];
      gUpdated[gIdx] = quizWithAuthor;
    } else {
      gUpdated = [quizWithAuthor, ...globalCached];
    }
    localStorage.setItem('quizarena_quizzes', JSON.stringify(gUpdated));
  } catch (e) {
    console.warn('Failed to update global quiz cache:', e);
  }

  // 2. Persist to Firestore quizzes collection under teacher's UID
  if (isFirebaseConfigured && authorId) {
    try {
      await setDoc(doc(db, 'quizzes', quiz.id), {
        ...quizWithAuthor,
        authorId,
        serverUpdatedAt: serverTimestamp(),
      });
    } catch (e) {
      notifyFirestoreError(`Failed to save quiz "${quiz.title}" to Firestore`, e);
      throw e;
    }
  }

  return quizWithAuthor;
}

/**
 * Loads user quizzes from Firestore after login, merging with sample quizzes and caching in localStorage.
 */
export async function loadUserQuizzes(authorId: string): Promise<Quiz[]> {
  let firestoreQuizzes: Quiz[] = [];

  if (isFirebaseConfigured && authorId) {
    try {
      const q = query(collection(db, 'quizzes'), where('authorId', '==', authorId));
      const snap = await getDocs(q);
      snap.forEach(d => {
        firestoreQuizzes.push(d.data() as Quiz);
      });
    } catch (e) {
      console.warn('Could not fetch quizzes from Firestore, falling back to cache:', e);
    }
  }

  // Load from per-author local storage cache (prevents cross-user bleed)
  const cacheKey = localStorageKey(authorId);
  let cachedQuizzes: Quiz[] = [];
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      cachedQuizzes = (JSON.parse(raw) as Quiz[]).filter(q => q.authorId === authorId || !q.authorId);
    }
  } catch (e) {}

  // Merge Firestore quizzes with cached and sample quizzes (Firestore takes precedence)
  const quizMap = new Map<string, Quiz>();

  // Add default sample quizzes first
  SAMPLE_QUIZZES.forEach(q => quizMap.set(q.id, q));

  // Overlay cached quizzes
  cachedQuizzes.forEach(q => quizMap.set(q.id, q));

  // Overlay authoritative Firestore quizzes
  firestoreQuizzes.forEach(q => quizMap.set(q.id, q));

  const merged = Array.from(quizMap.values());

  // Refresh per-author localStorage cache with merged list
  try {
    localStorage.setItem(cacheKey, JSON.stringify(merged));
  } catch (e) {}

  return merged;
}

/**
 * Permanently deletes a single quiz from Firestore and localStorage cache.
 * authorId is used to scope the correct localStorage key.
 */
export async function deleteQuiz(quizId: string, authorId?: string): Promise<void> {
  // 1. Delete from Firestore
  if (isFirebaseConfigured) {
    try {
      await deleteDoc(doc(db, 'quizzes', quizId));
    } catch (e) {
      notifyFirestoreError(`Failed to delete quiz ${quizId} from Firestore`, e);
    }
  }

  // 2. Delete from per-author localStorage cache
  const cacheKey = authorId ? localStorageKey(authorId) : 'quizarena_quizzes_anonymous';
  try {
    const cached: Quiz[] = JSON.parse(localStorage.getItem(cacheKey) || '[]');
    const filtered = cached.filter(q => q.id !== quizId);
    localStorage.setItem(cacheKey, JSON.stringify(filtered));
  } catch (e) {}
}

/**
 * "Delete my data" GDPR/Privacy feature:
 * Server-authoritative purge of all user records from Firestore, subcollections,
 * Storage uploads, and Firebase Auth, followed by local storage cleanup.
 */
export async function deleteMyData(user: User | null): Promise<{
  success: boolean;
  deletedQuizzes: number;
  deletedGames?: number;
  clearedLocalKeys: number;
  accountDeleted: boolean;
  errors?: string[];
  retainedRecords?: string;
}> {
  let deletedQuizzes = 0;
  let deletedGames = 0;
  let accountDeleted = false;
  let serverErrors: string[] | undefined = undefined;
  let retainedRecords: string | undefined = undefined;

  const uid = user?.uid;
  const idToken = uid ? await user?.getIdToken().catch(() => '') : '';

  // 1. Attempt server-authoritative purge via Admin SDK endpoint
  if (isFirebaseConfigured && idToken) {
    try {
      const resp = await fetch('/api/purge-user-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (resp.ok || resp.status === 207) {
        const data = await resp.json().catch(() => ({}));
        deletedQuizzes = data.deletedQuizzes || 0;
        deletedGames = data.deletedGames || 0;
        accountDeleted = Boolean(data.accountDeleted);
        serverErrors = data.errors;
        retainedRecords = data.retainedRecords;
      }
    } catch (apiErr: any) {
      console.warn('Server purge endpoint failed, falling back to client-side cleanup:', apiErr);
    }
  }

  // 2. Client-side fallback cleanup if server did not handle everything
  if (isFirebaseConfigured && uid && !accountDeleted) {
    try {
      const q = query(collection(db, 'quizzes'), where('authorId', '==', uid));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        await deleteDoc(d.ref);
        deletedQuizzes++;
      }
    } catch (e) {
      console.warn('Error deleting user quizzes in Firestore:', e);
    }

    try {
      await deleteDoc(doc(db, 'users', uid));
    } catch (e) {}

    try {
      const qbQuery = query(collection(db, 'questionBank'), where('authorId', '==', uid));
      const qbSnap = await getDocs(qbQuery);
      for (const d of qbSnap.docs) {
        await deleteDoc(d.ref);
      }
    } catch (e) {}
  }

  // 3. Clear all QuizArena local and session storage records
  let clearedLocalKeys = 0;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('quizarena_')) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => {
      localStorage.removeItem(k);
      clearedLocalKeys++;
    });

    sessionStorage.removeItem('quizarena_active_session');
  } catch (e) {}

  // 4. Client-side signOut if user is still signed in
  if (user) {
    try {
      await signOut(auth);
      if (!accountDeleted) accountDeleted = true;
    } catch (so) {}
  }

  return {
    success: accountDeleted && (!serverErrors || serverErrors.length === 0),
    deletedQuizzes,
    deletedGames,
    clearedLocalKeys,
    accountDeleted,
    errors: serverErrors,
    retainedRecords,
  };
}
