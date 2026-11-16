/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { auth, db, isFirebaseConfigured } from '../lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, orderBy, limit } from 'firebase/firestore';
import {
  Tournament,
  TournamentStanding,
  TournamentRegistration,
} from '../types/tournament';

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) || '';

async function getAuthToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export interface CreateTournamentInput {
  title: string;
  description?: string;
  rules?: string;
  format?: 'single_elimination' | 'points_based';
  visibility?: 'public' | 'private';
  maxParticipants?: number;
  minParticipants?: number;
  registrationDeadline: string;
  scheduledStartTime?: string;
  quizzes: string[];
}

/**
 * Lists all visible tournaments from backend API with fallback to Firestore.
 */
export async function listTournaments(): Promise<Tournament[]> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`${API_BASE}/api/tournaments`, { headers });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.tournaments)) {
        return data.tournaments;
      }
    }
  } catch (err) {
    console.warn('[TournamentService] API listTournaments failed, trying Firestore direct fallback:', err);
  }

  // Client-side Firestore fallback if backend API is unreachable
  if (isFirebaseConfigured && db) {
    try {
      const q = query(collection(db, 'tournaments'), orderBy('createdAt', 'desc'), limit(50));
      const snap = await getDocs(q);
      return snap.docs.map(d => d.data() as Tournament);
    } catch {
      // Index might be absent, query simple collection
      const snap = await getDocs(query(collection(db, 'tournaments'), limit(50)));
      return snap.docs.map(d => d.data() as Tournament);
    }
  }

  return [];
}

/**
 * Fetches tournament details by ID.
 */
export async function getTournamentById(id: string): Promise<Tournament | null> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`${API_BASE}/api/tournaments/${encodeURIComponent(id)}`, { headers });
    if (res.ok) {
      const data = await res.json();
      return data.tournament || null;
    }
  } catch (err) {
    console.warn('[TournamentService] API getTournamentById failed, trying Firestore fallback:', err);
  }

  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(doc(db, 'tournaments', id));
      if (snap.exists()) {
        return snap.data() as Tournament;
      }
    } catch {}
  }

  return null;
}

/**
 * Fetches calculated tournament standings from authoritative backend.
 */
export async function getTournamentStandings(id: string): Promise<TournamentStanding[]> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`${API_BASE}/api/tournaments/${encodeURIComponent(id)}/standings`, { headers });
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data.standings) ? data.standings : [];
    }
  } catch (err) {
    console.warn('[TournamentService] getTournamentStandings failed:', err);
  }

  return [];
}

/**
 * Creates a new tournament via authoritative backend endpoint.
 */
export async function createTournament(input: CreateTournamentInput): Promise<{ success: boolean; tournament?: Tournament; error?: string }> {
  const token = await getAuthToken();
  if (!token) {
    return { success: false, error: 'Authentication required. Please sign in with a verified account.' };
  }

  try {
    const res = await fetch(`${API_BASE}/api/tournaments/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error || `Failed to create tournament (HTTP ${res.status}).` };
    }

    return { success: true, tournament: data.tournament };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error while creating tournament.' };
  }
}

/**
 * Registers the current user for a tournament.
 */
export async function registerForTournament(tournamentId: string, participantNickname: string): Promise<{ success: boolean; error?: string }> {
  const token = await getAuthToken();
  if (!token) {
    return { success: false, error: 'Authentication required to register for tournaments.' };
  }

  try {
    const res = await fetch(`${API_BASE}/api/tournaments/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tournamentId, participantNickname }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error || `Registration failed (HTTP ${res.status}).` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error during registration.' };
  }
}

/**
 * Cancels the current user's registration for a tournament.
 */
export async function cancelTournamentRegistration(tournamentId: string): Promise<{ success: boolean; error?: string }> {
  const token = await getAuthToken();
  if (!token) {
    return { success: false, error: 'Authentication required to withdraw from tournaments.' };
  }

  try {
    const res = await fetch(`${API_BASE}/api/tournaments/cancel-registration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tournamentId }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error || `Withdrawal failed (HTTP ${res.status}).` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error during withdrawal.' };
  }
}

/**
 * Starts a round in the tournament (Host only).
 */
export async function startTournamentRound(tournamentId: string, roundNumber: number): Promise<{ success: boolean; round?: any; error?: string }> {
  const token = await getAuthToken();
  if (!token) {
    return { success: false, error: 'Authentication required.' };
  }

  try {
    const res = await fetch(`${API_BASE}/api/tournaments/start-round`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tournamentId, roundNumber }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error || `Failed to advance round (HTTP ${res.status}).` };
    }

    return { success: true, round: data.round };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error advancing round.' };
  }
}

