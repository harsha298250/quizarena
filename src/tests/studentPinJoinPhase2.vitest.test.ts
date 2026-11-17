import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameEngine } from '../services/gameEngine';
import { Player, GameSession } from '../types/quiz';

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

describe('Phase 2: Student PIN Joining & Session Integrity', () => {
  beforeEach(() => {
    mockLocal.clear();
    mockSession.clear();
    vi.restoreAllMocks();
  });

  it('rejects joining an invalid PIN when no session exists, returning "Game session not found"', async () => {
    const invalidPlayer: Player = {
      id: 'player_test_1',
      nickname: 'TestStudent',
      avatar: '{}',
      score: 0,
      streak: 0,
      maxStreak: 0,
      correctCount: 0,
      latencyMs: 20,
      clockOffsetMs: 0,
      integrityScore: 100,
      powerUps: { fiftyFiftyUsed: false, doublePointsUsed: false, timeFreezeUsed: false },
      accommodations: { extraTimeMultiplier: 1, fewerOptions: false, muteSound: false, dyslexiaFont: false, largeText: false, readAloud: false },
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };

    // When no game session is stored in localStorage or Firestore
    await expect(GameEngine.joinGame('game_999999', invalidPlayer)).rejects.toThrow(
      /Game session not found|not found/i
    );

    // Verify NO ghost session was created in localStorage
    expect(localStorage.getItem('quizarena_game_game_999999')).toBeNull();
  });

  it('joins an existing session successfully and does not duplicate players on repeated join', async () => {
    const testGame: GameSession = {
      id: 'game_123456',
      pin: '123456',
      hostId: 'teacher_123',
      hostName: 'Teacher Jane',
      quizId: 'quiz_123',
      quizTitle: 'Valid Biology Quiz',
      status: 'lobby',
      gameMode: 'classic',
      currentQuestionIndex: 0,
      questionStartTime: null,
      timeLimit: 20,
      isPaused: false,
      settings: {
        shuffleQuestions: false,
        shuffleOptions: false,
        allowLateJoin: true,
        enablePowerUps: true,
        antiCheatDetection: true,
        showLeaderboardBetween: true,
        autoEmailResults: true,
        scoringProfile: 'speed_weighted',
        requireApprovalToJoin: false,
        teamMode: false,
      },
      questions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Store existing game
    localStorage.setItem('quizarena_game_game_123456', JSON.stringify(testGame));

    const player: Player = {
      id: 'student_456',
      nickname: 'Alex',
      avatar: '{}',
      score: 0,
      streak: 0,
      maxStreak: 0,
      correctCount: 0,
      latencyMs: 15,
      clockOffsetMs: 0,
      integrityScore: 100,
      powerUps: { fiftyFiftyUsed: false, doublePointsUsed: false, timeFreezeUsed: false },
      accommodations: { extraTimeMultiplier: 1, fewerOptions: false, muteSound: false, dyslexiaFont: false, largeText: false, readAloud: false },
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };

    const res1 = await GameEngine.joinGame('game_123456', player);
    expect(res1.game).toBeDefined();
    expect(res1.game?.id).toBe('game_123456');
    expect(res1.player.id).toBe('student_456');

    // Repeated join with same playerId
    const res2 = await GameEngine.joinGame('game_123456', player);
    expect(res2.player.id).toBe('student_456');

    // Verify player list contains exactly 1 entry for this player
    const storedPlayers = JSON.parse(localStorage.getItem('quizarena_players_game_123456') || '[]');
    expect(storedPlayers.length).toBe(1);
    expect(storedPlayers[0].id).toBe('student_456');
  });

  it('propagates server rejection HTTP 404 without falling back to local ghost sessions', async () => {
    // Mock global fetch to return 404 from /api/join
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Game session not found. Please check your PIN.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const player: Player = {
      id: 'student_test',
      nickname: 'Jordan',
      avatar: '{}',
      score: 0,
      streak: 0,
      maxStreak: 0,
      correctCount: 0,
      latencyMs: 15,
      clockOffsetMs: 0,
      integrityScore: 100,
      powerUps: { fiftyFiftyUsed: false, doublePointsUsed: false, timeFreezeUsed: false },
      accommodations: { extraTimeMultiplier: 1, fewerOptions: false, muteSound: false, dyslexiaFont: false, largeText: false, readAloud: false },
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };

    // Even if isFirebaseConfigured were true with token, joinGame should reject
    await expect(GameEngine.joinGame('game_000000', player)).rejects.toThrow(
      /Game session not found/i
    );

    // Verify no ghost session with host_auto or SAMPLE_QUIZZES was saved
    expect(localStorage.getItem('quizarena_game_game_000000')).toBeNull();
  });
});
