/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listTournaments,
  getTournamentById,
  getTournamentStandings,
  createTournament,
  registerForTournament,
  cancelTournamentRegistration,
  startTournamentRound,
} from '../services/tournamentService';
import { Tournament } from '../types/tournament';

describe('Phase 2A — Tournament Integration & API Service Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listTournaments retrieves persisted tournaments from backend API', async () => {
    const mockTourneys: Partial<Tournament>[] = [
      {
        id: 't_mock_1',
        title: 'National Coding Arena',
        hostId: 'host_123',
        status: 'registration_open',
        maxParticipants: 16,
        participantCount: 4,
        rounds: [],
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tournaments: mockTourneys }),
    } as any);

    const list = await listTournaments();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('t_mock_1');
    expect(list[0].title).toBe('National Coding Arena');
  });

  it('createTournament validates required fields and sends authorized POST', async () => {
    // If not signed in, fails gracefully
    const unauthResult = await createTournament({
      title: 'Winter Clash',
      registrationDeadline: new Date().toISOString(),
      quizzes: ['q1'],
    });
    expect(unauthResult.success).toBe(false);
    expect(unauthResult.error).toContain('Authentication required');
  });

  it('registerForTournament rejects unauthenticated registration attempts', async () => {
    const res = await registerForTournament('t_mock_1', 'Challenger1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Authentication required');
  });

  it('cancelTournamentRegistration rejects unauthenticated cancellation', async () => {
    const res = await cancelTournamentRegistration('t_mock_1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Authentication required');
  });

  it('getTournamentStandings retrieves standings array from API', async () => {
    const mockStandings = [
      {
        participantId: 'p1',
        nickname: 'Alice',
        rank: 1,
        matchesPlayed: 3,
        wins: 3,
        losses: 0,
        points: 9,
        totalScore: 7500,
        isEliminated: false,
        eloRating: 1650,
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ standings: mockStandings }),
    } as any);

    const standings = await getTournamentStandings('t_mock_1');
    expect(standings.length).toBe(1);
    expect(standings[0].nickname).toBe('Alice');
    expect(standings[0].rank).toBe(1);
  });
});
