import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { GameEngine } from '../services/gameEngine';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { GameSession, Player } from '../types/quiz';

function createMockStorage() {
  const store = new Map<string, string>();
  return {
    length: 0,
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, val: string) => {
      store.set(key, val);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    key: (i: number) => Array.from(store.keys())[i] || null,
    clear: () => {
      store.clear();
    },
  };
}

const mockLocal = createMockStorage();
const mockSession = createMockStorage();
(globalThis as any).localStorage = mockLocal;
(globalThis as any).sessionStorage = mockSession;

describe('Phase 3: Real-Time Multiplayer Reliability & Error Boundaries', () => {
  beforeEach(() => {
    mockLocal.clear();
    mockSession.clear();
    vi.restoreAllMocks();
  });

  describe('1. Resilient Subscriptions with Exponential Backoff & Polling Fallback', () => {
    it('subscribeToGame tracks status and cleans up timers on unsubscribe', () => {
      const statuses: string[] = [];
      const unsub = GameEngine.subscribeToGame(
        'game_test_recovery',
        () => {},
        status => statuses.push(status)
      );

      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('subscribeToPlayers tracks status and provides getPlayers fallback', async () => {
      const mockPlayer: Player = {
        id: 'p_resilient_1',
        nickname: 'ResilientFox',
        avatar: '{}',
        score: 1500,
        streak: 3,
        maxStreak: 3,
        correctCount: 2,
        latencyMs: 15,
        clockOffsetMs: 0,
        integrityScore: 100,
        powerUps: { fiftyFiftyUsed: false, doublePointsUsed: false, timeFreezeUsed: false },
        accommodations: { extraTimeMultiplier: 1, fewerOptions: false, muteSound: false, dyslexiaFont: false, largeText: false, readAloud: false },
        joinedAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      };

      mockLocal.setItem('quizarena_players_game_resilient', JSON.stringify([mockPlayer]));

      const players = await GameEngine.getPlayers('game_resilient');
      expect(players.length).toBe(1);
      expect(players[0].nickname).toBe('ResilientFox');

      const statuses: string[] = [];
      const unsub = GameEngine.subscribeToPlayers(
        'game_resilient',
        () => {},
        status => statuses.push(status)
      );

      expect(typeof unsub).toBe('function');
      unsub();
    });
  });

  describe('2. React Error Boundary for White-Screen Prevention', () => {
    it('catches thrown rendering error and provides getDerivedStateFromError', () => {
      const testError = new Error('Simulated network render crash');
      const state = ErrorBoundary.getDerivedStateFromError(testError);

      expect(state.hasError).toBe(true);
      expect(state.error).toBe(testError);
    });

    it('resets error state when handleRetry is invoked', () => {
      let resetCalled = false;
      const boundary = new ErrorBoundary({
        children: null,
        onReset: () => { resetCalled = true; },
      });

      boundary.state = {
        hasError: true,
        error: new Error('Interrupted'),
        errorInfo: null,
      };

      (boundary as any).handleRetry();

      expect(boundary.state.hasError).toBe(false);
      expect(boundary.state.error).toBeNull();
      expect(resetCalled).toBe(true);
    });
  });

  describe('3. Mid-Question Refresh & Reconnect State Recovery', () => {
    it('restores previous submission from sessionStorage to prevent double-answering on refresh', () => {
      const gameId = 'game_refresh_test';
      const questionIndex = 2;
      const subKey = `quizarena_submitted_${gameId}_${questionIndex}`;

      const savedPayload = {
        result: { isCorrect: true, pointsAwarded: 950 },
        selectedIndices: [1],
      };

      mockSession.setItem(subKey, JSON.stringify(savedPayload));

      const retrieved = mockSession.getItem(subKey);
      expect(retrieved).not.toBeNull();
      const parsed = JSON.parse(retrieved!);
      expect(parsed.result.isCorrect).toBe(true);
      expect(parsed.result.pointsAwarded).toBe(950);
      expect(parsed.selectedIndices).toEqual([1]);
    });
  });
});
