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

export interface AccountDeletionResult {
  success: boolean;
  status: 'requested' | 'processing' | 'completed' | 'failed';
  jobId?: string;
  currentStage?: string;
  completedStages?: string[];
  recoveryToken?: string;
  deletedQuizzes: number;
  deletedGames?: number;
  clearedLocalKeys: number;
  accountDeleted: boolean;
  errors?: string[];
  retainedRecords?: string;
}

function clearLocalQuizArenaStorage(): number {
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
  } catch {
    // Ignore storage access errors
  }
  return clearedLocalKeys;
}

/**
 * Phase 4: Server-authoritative account deletion & complete data purge.
 * Never falls back to client-side Firestore deletion or fakes completion.
 */
export async function deleteMyData(user: User | null): Promise<AccountDeletionResult> {
  if (!isFirebaseConfigured || !user) {
    return {
      success: false,
      status: 'failed',
      deletedQuizzes: 0,
      clearedLocalKeys: 0,
      accountDeleted: false,
      errors: ['You must be signed in with a persistent account to delete your account.'],
    };
  }

  let idToken = '';
  try {
    idToken = await user.getIdToken(true);
  } catch {
    return {
      success: false,
      status: 'failed',
      deletedQuizzes: 0,
      clearedLocalKeys: 0,
      accountDeleted: false,
      errors: ['Your session has expired. Please sign in again before deleting your account.'],
    };
  }

  try {
    const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || '';
    const resp = await fetch(`${apiBase}/api/account/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    });

    const data = await resp.json().catch(() => ({}));
    const isCompleted = resp.ok && data.status === 'completed' && data.success === true;

    let clearedLocalKeys = 0;
    if (isCompleted) {
      clearedLocalKeys = clearLocalQuizArenaStorage();
      try {
        await signOut(auth);
      } catch {
        // Account is already deleted on Firebase Auth
      }
    }

    return {
      success: isCompleted,
      status: data.status || (isCompleted ? 'completed' : 'failed'),
      jobId: data.jobId,
      currentStage: data.currentStage,
      completedStages: data.completedStages,
      recoveryToken: data.recoveryToken,
      deletedQuizzes: data.counts?.deletedQuizzes || 0,
      deletedGames: data.counts?.deletedGames || 0,
      clearedLocalKeys,
      accountDeleted: isCompleted,
      errors: data.error ? [data.error] : undefined,
      retainedRecords:
        'Shared tournament history and issued certificates are preserved in a non-reversible anonymized state.',
    };
  } catch {
    return {
      success: false,
      status: 'failed',
      deletedQuizzes: 0,
      clearedLocalKeys: 0,
      accountDeleted: false,
      errors: ['Network error while contacting the account deletion service. Please try again.'],
    };
  }
}

/**
 * Resumes a failed account deletion job without requiring the deleted account's Firebase token.
 */
export async function retryAccountDeletion(
  jobId: string,
  recoveryToken: string
): Promise<AccountDeletionResult> {
  try {
    const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || '';
    const resp = await fetch(`${apiBase}/api/account/delete/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, recoveryToken }),
    });
    const data = await resp.json().catch(() => ({}));
    const isCompleted = resp.ok && data.status === 'completed' && data.success === true;

    let clearedLocalKeys = 0;
    if (isCompleted) {
      clearedLocalKeys = clearLocalQuizArenaStorage();
      try {
        await signOut(auth);
      } catch {
        // Ignore if already signed out / deleted
      }
    }

    return {
      success: isCompleted,
      status: data.status || (isCompleted ? 'completed' : 'failed'),
      jobId: data.jobId || jobId,
      currentStage: data.currentStage,
      completedStages: data.completedStages,
      recoveryToken: data.recoveryToken || recoveryToken,
      deletedQuizzes: data.counts?.deletedQuizzes || 0,
      deletedGames: data.counts?.deletedGames || 0,
      clearedLocalKeys,
      accountDeleted: isCompleted,
      errors: data.error ? [data.error] : undefined,
    };
  } catch {
    return {
      success: false,
      status: 'failed',
      jobId,
      recoveryToken,
      deletedQuizzes: 0,
      clearedLocalKeys: 0,
      accountDeleted: false,
      errors: ['Network error while retrying account deletion.'],
    };
  }
}
