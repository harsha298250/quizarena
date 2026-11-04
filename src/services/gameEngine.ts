/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  doc,
  collection,
  setDoc,
  updateDoc,
  onSnapshot,
  getDocs,
  getDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore';
import {
  db,
  auth,
  ensureAnonymousAuth,
  handleFirestoreError,
  notifyFirestoreError,
  isFirebaseConfigured,
  OperationType,
} from '../lib/firebase';
import {
  GameSession,
  Player,
  AnswerSubmission,
  IntegrityFlag,
  LiveQAQuestion,
  Quiz,
  GameSettings,
  Question,
} from '../types/quiz';
import { calculateFairScore, evaluateAnswer } from '../lib/scoring';
import { createHashBlock } from '../lib/integrity';
import { getDeterministicAvatar } from '../types/avatar';

// BroadcastChannel for instant local cross-tab real-time demo synchronization
const broadcastChannel =
  typeof window !== 'undefined' && 'BroadcastChannel' in window
    ? new BroadcastChannel('quizarena_multiplayer_sync')
    : null;

export class GameEngine {
  // Generates 6-digit numeric PIN
  public static generatePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Create game session
  public static async createGame(quiz: Quiz, hostId: string, hostName: string): Promise<GameSession> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';

    // Requirement 1 & 5: Server-side game creation with verified host ownership
    if (isFirebaseConfigured && idToken) {
      try {
        const res = await fetch('/api/create-game', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            quiz,
            hostName,
          }),
        });

        if (res.ok) {
          const resData = await res.json();
          const createdGame = resData.game;
          // Keep full question keys in host local storage
          const hostSession: GameSession = {
            ...createdGame,
            questions: quiz.questions,
          };
          localStorage.setItem(`quizarena_game_${createdGame.id}`, JSON.stringify(hostSession));
          return hostSession;
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
      } catch (e) {
        if (isFirebaseConfigured) {
          notifyFirestoreError('Failed to initialize game session on server', e);
          throw e;
        }
      }
    }

    // Offline / Demo fallback
    const pin = this.generatePin();
    const gameId = `game_${pin}`;

    const defaultSettings: GameSettings = {
      shuffleQuestions: false,
      shuffleOptions: false,
      allowLateJoin: true,
      enablePowerUps: true,
      antiCheatDetection: true,
      showLeaderboardBetween: true,
      autoEmailResults: true,
      scoringProfile: quiz.gameMode === 'accuracy' ? 'accuracy_only' : 'speed_weighted',
      requireApprovalToJoin: false,
      teamMode: quiz.gameMode === 'team',
    };

    const sanitizedQuestions = quiz.questions.map(q => {
      const { correctAnswers, acceptedTextAnswers, ...rest } = q;
      return rest as any;
    });

    const session: GameSession = {
      id: gameId,
      pin,
      hostId,
      hostName,
      quizId: quiz.id,
      quizTitle: quiz.title,
      status: 'lobby',
      gameMode: quiz.gameMode,
      currentQuestionIndex: 0,
      questionStartTime: null,
      timeLimit: quiz.questions[0]?.timeLimit || 20,
      isPaused: false,
      settings: defaultSettings,
      questions: sanitizedQuestions,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const hostSession: GameSession = {
      ...session,
      questions: quiz.questions,
    };
    localStorage.setItem(`quizarena_game_${gameId}`, JSON.stringify(hostSession));
    broadcastChannel?.postMessage({ type: 'GAME_CREATED', session });

    return hostSession;
  }

  // Subscribe to live game session state
  public static subscribeToGame(gameId: string, onUpdate: (game: GameSession | null) => void): () => void {
    // 1. Listen via Firestore snapshot
    let unsubFirestore = () => {};
    try {
      unsubFirestore = onSnapshot(
        doc(db, 'games', gameId),
        snap => {
          if (snap.exists()) {
            onUpdate(snap.data() as GameSession);
          }
        },
        error => {
          if (isFirebaseConfigured) {
            notifyFirestoreError(`Lost real-time sync with game session ${gameId}`, error);
          } else {
            console.warn('Firestore onSnapshot error, falling back to BroadcastChannel:', error);
          }
        }
      );
    } catch (e) {
      if (isFirebaseConfigured) {
        notifyFirestoreError(`Unable to subscribe to game session ${gameId}`, e);
      } else {
        console.warn('Firestore subscription unavailable:', e);
      }
    }

    // 2. Listen via BroadcastChannel for instant local updates
    const handleBroadcast = (evt: MessageEvent) => {
      const { type, session, targetGameId } = evt.data || {};
      if (
        (type === 'GAME_UPDATED' || type === 'GAME_CREATED') &&
        (session?.id === gameId || targetGameId === gameId)
      ) {
        onUpdate(session);
      }
    };

    broadcastChannel?.addEventListener('message', handleBroadcast);

    // Initial check from localStorage (only as offline cache)
    const saved = localStorage.getItem(`quizarena_game_${gameId}`);
    if (saved && !isFirebaseConfigured) {
      try {
        onUpdate(JSON.parse(saved));
      } catch (e) {}
    }

    return () => {
      unsubFirestore();
      broadcastChannel?.removeEventListener('message', handleBroadcast);
    };
  }

  // Subscribe to players list in a game
  public static subscribeToPlayers(gameId: string, onUpdate: (players: Player[]) => void): () => void {
    let unsubFirestore = () => {};
    try {
      unsubFirestore = onSnapshot(
        collection(db, 'games', gameId, 'players'),
        snapshot => {
          const players: Player[] = [];
          snapshot.forEach(d => players.push(d.data() as Player));
          onUpdate(players);
        },
        err => {
          if (isFirebaseConfigured) {
            notifyFirestoreError(`Failed to sync player list for game ${gameId}`, err);
          } else {
            console.warn('Players onSnapshot warning:', err);
          }
        }
      );
    } catch (e) {
      if (isFirebaseConfigured) {
        notifyFirestoreError(`Unable to subscribe to players for ${gameId}`, e);
      }
    }

    const handleBroadcast = (evt: MessageEvent) => {
      if (evt.data?.type === 'PLAYERS_UPDATED' && evt.data?.gameId === gameId) {
        onUpdate(evt.data.players);
      }
    };
    broadcastChannel?.addEventListener('message', handleBroadcast);

    // LocalStorage fallback for demo mode
    const localPlayersKey = `quizarena_players_${gameId}`;
    const saved = localStorage.getItem(localPlayersKey);
    if (saved && !isFirebaseConfigured) {
      try {
        onUpdate(JSON.parse(saved));
      } catch (e) {}
    }

    return () => {
      unsubFirestore();
      broadcastChannel?.removeEventListener('message', handleBroadcast);
    };
  }

  // Join Game as a Player via secure server-controlled endpoint POST /api/join
  public static async joinGame(
    gameId: string,
    player: Player
  ): Promise<{ game?: GameSession; player: Player }> {
    const pin = gameId.replace(/^game_/, '');
    const user = auth.currentUser || (await ensureAnonymousAuth());
    const idToken = (await user?.getIdToken()) || '';

    if (isFirebaseConfigured && idToken) {
      try {
        const res = await fetch('/api/join', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            pin,
            nickname: player.nickname,
            avatarConfig: player.avatarConfig,
            email: player.email,
            emailConsent: player.emailConsent,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to join game (HTTP ${res.status})`);
        }

        const data = await res.json();
        return {
          game: data.game,
          player: data.player,
        };
      } catch (e) {
        if (isFirebaseConfigured) {
          notifyFirestoreError(`Failed to join game session ${gameId}`, e);
          throw e;
        }
      }
    }

    // Offline / Demo fallback
    if (user && player.id !== user.uid) {
      player.id = user.uid;
    }
    const localPlayersKey = `quizarena_players_${gameId}`;
    let players: Player[] = [];
    try {
      players = JSON.parse(localStorage.getItem(localPlayersKey) || '[]');
    } catch (e) {}
    const filtered = players.filter(p => p.id !== player.id);
    filtered.push(player);
    localStorage.setItem(localPlayersKey, JSON.stringify(filtered));

    broadcastChannel?.postMessage({
      type: 'PLAYERS_UPDATED',
      gameId,
      players: filtered,
    });

    return { player };
  }

  // Host kicks a player via server-controlled endpoint POST /api/kick-player
  public static async kickPlayer(
    gameId: string,
    playerId: string,
    reason: string = 'Kicked by host'
  ): Promise<boolean> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';

    if (isFirebaseConfigured && idToken) {
      try {
        const res = await fetch('/api/kick-player', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            gameId,
            playerId,
            reason,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to kick player');
        }
      } catch (err) {
        console.warn('POST /api/kick-player error:', err);
        throw err;
      }
    }

    // Update local cache and broadcast
    const localPlayersKey = `quizarena_players_${gameId}`;
    try {
      const players: Player[] = JSON.parse(localStorage.getItem(localPlayersKey) || '[]');
      const updated = players.filter(p => p.id !== playerId);
      localStorage.setItem(localPlayersKey, JSON.stringify(updated));
      broadcastChannel?.postMessage({
        type: 'PLAYERS_UPDATED',
        gameId,
        players: updated,
      });
    } catch {}

    return true;
  }

  // Player leaves game via server-controlled endpoint POST /api/leave
  public static async leaveGame(gameId: string): Promise<boolean> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';

    if (isFirebaseConfigured && idToken) {
      try {
        const res = await fetch('/api/leave', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ gameId }),
        });
        return res.ok;
      } catch (err) {
        console.warn('POST /api/leave error:', err);
      }
    }
    return true;
  }

  // Host locks or unlocks lobby via POST /api/lock-lobby
  public static async lockLobby(gameId: string, isLocked: boolean): Promise<boolean> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';

    if (isFirebaseConfigured && idToken) {
      try {
        const res = await fetch('/api/lock-lobby', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ gameId, isLocked }),
        });
        return res.ok;
      } catch (err) {
        console.warn('POST /api/lock-lobby error:', err);
      }
    }
    return true;
  }

  // Host retrieves guest emails from host-only subcollection games/{id}/guestEmails
  public static async getGuestEmails(gameId: string): Promise<Array<{
    playerId: string;
    playerNickname: string;
    email: string;
    emailConsent: boolean;
  }>> {
    try {
      const snap = await getDocs(collection(db, 'games', gameId, 'guestEmails'));
      const results: Array<{
        playerId: string;
        playerNickname: string;
        email: string;
        emailConsent: boolean;
      }> = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.email) {
          results.push({
            playerId: data.playerId || d.id,
            playerNickname: data.playerNickname || '',
            email: data.email,
            emailConsent: Boolean(data.emailConsent),
          });
        }
      });
      if (results.length > 0) return results;
    } catch (e) {
      console.warn('Could not read guest emails from Firestore:', e);
    }

    // Local fallback for demo mode
    try {
      const localKey = `quizarena_guest_emails_${gameId}`;
      return JSON.parse(localStorage.getItem(localKey) || '[]');
    } catch {
      return [];
    }
  }

  // Host updates game settings (e.g. progressionMode, timeLimit) without changing game status or starting match
  public static async updateGameSettings(
    gameId: string,
    settings: Partial<GameSettings>
  ): Promise<void> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';

    if (isFirebaseConfigured && idToken) {
      try {
        await updateDoc(doc(db, 'games', gameId), {
          ...Object.entries(settings).reduce((acc: any, [k, v]) => {
            acc[`settings.${k}`] = v;
            return acc;
          }, {}),
          updatedAt: serverTimestamp(),
        });
      } catch (err: any) {
        console.warn('Failed to update game settings in Firestore:', err);
      }
    }

    // Update local storage and broadcast
    try {
      const localKey = `quizarena_game_${gameId}`;
      const saved = localStorage.getItem(localKey);
      if (saved) {
        const game = JSON.parse(saved);
        const updated = {
          ...game,
          settings: { ...game.settings, ...settings },
          updatedAt: new Date().toISOString(),
        };
        localStorage.setItem(localKey, JSON.stringify(updated));
        broadcastChannel?.postMessage({ type: 'GAME_UPDATED', session: updated });
      }
    } catch {}
  }

  // Host updates game status via authoritative server endpoints
  public static async updateGameStatus(
    game: GameSession,
    newStatus: GameSession['status'],
    questionIndex?: number
  ): Promise<void> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';

    if (isFirebaseConfigured && idToken) {
      try {
        let endpoint = '';
        let body: any = { gameId: game.id };

        if (newStatus === 'question_active') {
          if (game.status === 'lobby') {
            endpoint = '/api/start-game';
          } else {
            endpoint = '/api/advance-question';
            body.targetQuestionIndex = questionIndex !== undefined ? questionIndex : (game.currentQuestionIndex + 1);
            body.timeLimit = questionIndex !== undefined ? game.questions[questionIndex]?.timeLimit : game.timeLimit;
          }
        } else if (newStatus === 'reveal') {
          endpoint = '/api/reveal-answer';
        } else if (newStatus === 'leaderboard') {
          endpoint = '/api/show-leaderboard';
        } else if (newStatus === 'finished') {
          endpoint = '/api/end-game';
        } else if (newStatus === 'cancelled') {
          endpoint = '/api/cancel-game';
        } else {
          // If status did not change or unrecognized status (e.g. 'lobby'), do not hit advance-question!
          return;
        }

        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || `Server rejected transition to ${newStatus}`);
        }
      } catch (err: any) {
        if (isFirebaseConfigured) {
          notifyFirestoreError(`Failed to update game status to "${newStatus}"`, err);
          throw err;
        }
      }
    }

    // Offline / Demo fallback
    const updated: GameSession = {
      ...game,
      status: newStatus,
      currentQuestionIndex: questionIndex !== undefined ? questionIndex : game.currentQuestionIndex,
      questionStartTime: newStatus === 'question_active' ? Date.now() : game.questionStartTime,
      timeLimit:
        newStatus === 'question_active' && questionIndex !== undefined
          ? game.questions[questionIndex]?.timeLimit || 20
          : game.timeLimit,
      updatedAt: new Date().toISOString(),
    };

    if (!isFirebaseConfigured) {
      localStorage.setItem(`quizarena_game_${game.id}`, JSON.stringify(updated));
      broadcastChannel?.postMessage({ type: 'GAME_UPDATED', session: updated });
    }
  }

  // Host starts the game from lobby
  public static async startGame(gameId: string): Promise<boolean> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';
    if (isFirebaseConfigured && idToken) {
      const res = await fetch('/api/start-game', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ gameId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to start game');
      }
      return true;
    }
    return false;
  }

  // Host pauses active round
  public static async pauseGame(gameId: string): Promise<boolean> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';
    if (isFirebaseConfigured && idToken) {
      const res = await fetch('/api/pause-game', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ gameId }),
      });
      return res.ok;
    }
    return true;
  }

  // Host resumes active round
  public static async resumeGame(gameId: string): Promise<boolean> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';
    if (isFirebaseConfigured && idToken) {
      const res = await fetch('/api/resume-game', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ gameId }),
      });
      return res.ok;
    }
    return true;
  }

  // Host ends game session
  public static async endGame(gameId: string): Promise<boolean> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';
    if (isFirebaseConfigured && idToken) {
      const res = await fetch('/api/end-game', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ gameId }),
      });
      return res.ok;
    }
    return true;
  }

  // Host cancels game session
  public static async cancelGame(gameId: string): Promise<boolean> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';
    if (isFirebaseConfigured && idToken) {
      const res = await fetch('/api/cancel-game', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ gameId }),
      });
      return res.ok;
    }
    return true;
  }

  // Recover session on page refresh or reconnect
  public static async recoverSession(gameId: string): Promise<{
    role: 'host' | 'player';
    game: GameSession;
    player?: Player;
  } | null> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';
    if (isFirebaseConfigured && idToken) {
      try {
        const res = await fetch('/api/session-recovery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ gameId }),
        });

        if (res.ok) {
          const data = await res.json();
          return data;
        } else {
          return null;
        }
      } catch {
        return null;
      }
    }

    // LocalStorage fallback for demo
    try {
      const saved = localStorage.getItem(`quizarena_game_${gameId}`);
      if (saved) {
        return { role: 'player', game: JSON.parse(saved) };
      }
    } catch {}
    return null;
  }

  // Host reconciles player count
  public static async reconcilePlayerCount(gameId: string): Promise<number | null> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';
    if (isFirebaseConfigured && idToken) {
      const res = await fetch('/api/reconcile-player-count', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ gameId }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.reconciledCount;
      }
    }
    return null;
  }

  // Submit player answer (Server-side scoring via POST /api/answer)
  public static async submitAnswer(
    gameId: string,
    player: Player,
    questionIndex: number,
    selectedIndices: number[],
    textAnswer: string | undefined,
    question: any,
    settings: GameSettings,
    rawResponseTimeMs: number,
    prevHash: string = '0000000000000000000000000000000000000000000000000000000000000000',
    powerUps?: { doublePoints?: boolean }
  ): Promise<AnswerSubmission> {
    const user = auth.currentUser || (await ensureAnonymousAuth());
    let idToken = '';
    try {
      idToken = (await user?.getIdToken()) || '';
    } catch (tokenErr) {
      console.warn('Could not retrieve Firebase ID token:', tokenErr);
    }

    let submission: AnswerSubmission | null = null;
    let updatedPlayerInfo: any = null;

    try {
      const response = await fetch('/api/answer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          gameId,
          questionIndex,
          selectedIndices,
          textAnswer,
          prevHash,
          rawResponseTimeMs,
          clientTimestamp: Date.now(),
          powerUps,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${response.status}`);
      }

      const resData = await response.json();
      submission = resData.submission;
      updatedPlayerInfo = resData.updatedPlayer;
    } catch (apiError) {
      console.warn('POST /api/answer error or network unavailable:', apiError);
      if (isFirebaseConfigured) {
        notifyFirestoreError('Server answer scoring failed or network rejected request', apiError);
        throw apiError;
      }
      // Fallback submission for offline sandbox only
      submission = {
        id: `ans_${questionIndex}_${player.id}`,
        playerId: player.id,
        playerNickname: player.nickname,
        questionIndex,
        selectedIndices,
        textAnswer,
        isCorrect: false,
        pointsAwarded: 0,
        responseTimeMs: rawResponseTimeMs,
        clientTimestamp: Date.now(),
        serverTimestamp: Date.now(),
        prevHash,
        hash: 'offline_submission',
      };
    }

    if (updatedPlayerInfo) {
      const updatedPlayer: Player = {
        ...player,
        score: updatedPlayerInfo.score,
        streak: updatedPlayerInfo.streak,
        maxStreak: updatedPlayerInfo.maxStreak,
        correctCount: updatedPlayerInfo.correctCount,
        lastSeen: new Date().toISOString(),
      };

      // Update local storage players list
      const localPlayersKey = `quizarena_players_${gameId}`;
      try {
        const players: Player[] = JSON.parse(localStorage.getItem(localPlayersKey) || '[]');
        const updatedList = players.map(p => (p.id === player.id ? updatedPlayer : p));
        localStorage.setItem(localPlayersKey, JSON.stringify(updatedList));
        broadcastChannel?.postMessage({
          type: 'PLAYERS_UPDATED',
          gameId,
          players: updatedList,
        });
      } catch (e) {}
    }

    // Cache submission in all-answers list for participant audits
    if (submission) {
      try {
        const allKey = `quizarena_all_answers_${gameId}`;
        const allAns: AnswerSubmission[] = JSON.parse(localStorage.getItem(allKey) || '[]');
        const filtered = allAns.filter(a => !(a.playerId === player.id && a.questionIndex === questionIndex));
        filtered.push(submission);
        localStorage.setItem(allKey, JSON.stringify(filtered));
        broadcastChannel?.postMessage({
          type: 'ALL_ANSWERS_UPDATED',
          gameId,
          answers: filtered,
        });
      } catch (e) {}
    }

    return submission!;
  }

  // Subscribe to answers for active question
  public static subscribeToAnswers(
    gameId: string,
    questionIndex: number,
    onUpdate: (answers: AnswerSubmission[]) => void
  ): () => void {
    let unsubFirestore = () => {};
    try {
      unsubFirestore = onSnapshot(collection(db, 'games', gameId, 'answers'), snap => {
        const answers: AnswerSubmission[] = [];
        snap.forEach(d => {
          const a = d.data() as AnswerSubmission;
          if (a.questionIndex === questionIndex) {
            answers.push(a);
          }
        });
        onUpdate(answers);
      });
    } catch (e) {}

    return () => unsubFirestore();
  }

  // Subscribe to all answers submitted throughout the game session
  public static subscribeToAllAnswers(
    gameId: string,
    onUpdate: (answers: AnswerSubmission[]) => void
  ): () => void {
    let unsubFirestore = () => {};
    try {
      unsubFirestore = onSnapshot(collection(db, 'games', gameId, 'answers'), snap => {
        const answers: AnswerSubmission[] = [];
        snap.forEach(d => {
          answers.push(d.data() as AnswerSubmission);
        });
        onUpdate(answers);
      });
    } catch (e) {}

    // Local storage & BroadcastChannel fallback for demo / test environments
    const handleBroadcast = (evt: MessageEvent) => {
      if (evt.data?.type === 'ALL_ANSWERS_UPDATED' && evt.data?.gameId === gameId) {
        onUpdate(evt.data.answers);
      }
    };
    broadcastChannel?.addEventListener('message', handleBroadcast);

    try {
      const cached = localStorage.getItem(`quizarena_all_answers_${gameId}`);
      if (cached) onUpdate(JSON.parse(cached));
    } catch {}

    return () => {
      unsubFirestore();
      broadcastChannel?.removeEventListener('message', handleBroadcast);
    };
  }

  // Simulate players tool (Host-only developer tool: 20-200 players)
  public static async simulatePlayers(gameId: string, count: number = 25): Promise<Player[]> {
    const avatars = ['fox', 'owl', 'tiger', 'bear', 'robot'];
    const sampleNames = [
      'Alex', 'Jordan', 'Sam', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Avery', 'Peyton', 'Quinn',
      'Dakota', 'Reese', 'Skyler', 'Cameron', 'Rowan', 'Kendall', 'Emerson', 'Finley', 'Hayden', 'Harper',
      'Amara', 'Dev', 'Priya', 'Kavya', 'Rohan', 'Arjun', 'Ananya', 'Sneha', 'Vikram', 'Meera'
    ];

    const simulated: Player[] = [];
    for (let i = 0; i < count; i++) {
      const name = `${sampleNames[i % sampleNames.length]}_Sim${Math.floor(i / sampleNames.length) + 1}`;
      const avConfig = getDeterministicAvatar(name);
      const simPlayer: Player = {
        id: `sim_player_${i + 1}`,
        nickname: name,
        avatar: JSON.stringify(avConfig),
        avatarConfig: avConfig,
        score: Math.floor(Math.random() * 2000),
        streak: Math.floor(Math.random() * 4),
        maxStreak: Math.floor(Math.random() * 5),
        correctCount: Math.floor(Math.random() * 3),
        latencyMs: Math.floor(25 + Math.random() * 60),
        clockOffsetMs: 0,
        integrityScore: 100,
        powerUps: { fiftyFiftyUsed: false, doublePointsUsed: false, timeFreezeUsed: false },
        accommodations: {
          extraTimeMultiplier: 1,
          fewerOptions: false,
          muteSound: false,
          dyslexiaFont: false,
          largeText: false,
          readAloud: false,
        },
        joinedAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      };
      simulated.push(simPlayer);
    }

    // Write to local cache and broadcast
    const localPlayersKey = `quizarena_players_${gameId}`;
    localStorage.setItem(localPlayersKey, JSON.stringify(simulated));
    broadcastChannel?.postMessage({
      type: 'PLAYERS_UPDATED',
      gameId,
      players: simulated,
    });

    return simulated;
  }

  // Record an advisory anti-cheat integrity flag
  public static async recordFlag(gameId: string, flag: IntegrityFlag): Promise<void> {
    try {
      await setDoc(doc(db, 'games', gameId, 'flags', flag.id), {
        ...flag,
        serverCreatedAt: serverTimestamp(),
      });
    } catch (e) {
      if (isFirebaseConfigured) {
        notifyFirestoreError('Failed to record integrity alert in Firestore', e);
      } else {
        console.warn('Firestore flag write fallback:', e);
      }
    }

    if (!isFirebaseConfigured) {
      // Local storage & BroadcastChannel fallback for multi-tab
      const localFlagsKey = `quizarena_flags_${gameId}`;
      try {
        const flags: IntegrityFlag[] = JSON.parse(localStorage.getItem(localFlagsKey) || '[]');
        flags.unshift(flag);
        localStorage.setItem(localFlagsKey, JSON.stringify(flags.slice(0, 100)));
        broadcastChannel?.postMessage({
          type: 'FLAGS_UPDATED',
          gameId,
          flags,
        });
      } catch (e) {}
    }
  }

  // Subscribe to live integrity flags for the host panel
  public static subscribeToFlags(gameId: string, onUpdate: (flags: IntegrityFlag[]) => void): () => void {
    let unsubFirestore = () => {};
    try {
      unsubFirestore = onSnapshot(collection(db, 'games', gameId, 'flags'), snap => {
        const flags: IntegrityFlag[] = [];
        snap.forEach(d => flags.push(d.data() as IntegrityFlag));
        flags.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        onUpdate(flags);
      });
    } catch (e) {}

    const handleBroadcast = (evt: MessageEvent) => {
      if (evt.data?.type === 'FLAGS_UPDATED' && evt.data?.gameId === gameId) {
        onUpdate(evt.data.flags);
      }
    };
    broadcastChannel?.addEventListener('message', handleBroadcast);

    const localFlagsKey = `quizarena_flags_${gameId}`;
    try {
      const saved = localStorage.getItem(localFlagsKey);
      if (saved) onUpdate(JSON.parse(saved));
    } catch (e) {}

    return () => {
      unsubFirestore();
      broadcastChannel?.removeEventListener('message', handleBroadcast);
    };
  }

  /**
   * Authoritative server-side strike recording.
   * Calls POST /api/integrity-event which updates Firestore in an atomic transaction.
   * Prevents client-side tampering and adheres strictly to Firestore security rules.
   */
  public static async sendIntegrityEvent(
    gameId: string,
    eventType: string,
    reason: string,
    questionIndex?: number
  ): Promise<{ strikes: number; status: string; isTerminated: boolean; integrityScore: number } | null> {
    const user = auth.currentUser || (await ensureAnonymousAuth());
    const idToken = (await user?.getIdToken()) || '';

    try {
      const res = await fetch('/api/integrity-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          gameId,
          eventType,
          reason,
          questionIndex,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Update local cache & broadcast channel
        const localKey = `quizarena_players_${gameId}`;
        try {
          const players: Player[] = JSON.parse(localStorage.getItem(localKey) || '[]');
          const updated = players.map(p =>
            p.id === user?.uid
              ? {
                  ...p,
                  strikes: data.strikes,
                  status: data.status,
                  isTerminated: data.isTerminated,
                  integrityScore: data.integrityScore,
                  lastEvent: eventType,
                }
              : p
          );
          localStorage.setItem(localKey, JSON.stringify(updated));
          broadcastChannel?.postMessage({
            type: 'PLAYERS_UPDATED',
            gameId,
            players: updated,
          });
        } catch (e) {}

        return data;
      } else {
        const errJson = await res.json().catch(() => ({}));
        console.warn('[GameEngine] /api/integrity-event returned error:', errJson);
      }
    } catch (err) {
      console.warn('[GameEngine] Failed to send integrity event to server:', err);
    }
    return null;
  }

  // Update player strike count via authoritative server endpoint
  public static async updatePlayerStrikes(
    gameId: string,
    playerId: string,
    strikes: number,
    lastEvent?: string,
    isTerminated: boolean = false
  ): Promise<void> {
    // Forward to authoritative endpoint
    await this.sendIntegrityEvent(gameId, lastEvent || 'tab_switch', `Strike ${strikes}`);
  }

  // Host reinstates a terminated player via POST /api/reinstate-player
  public static async reinstatePlayer(gameId: string, playerId: string): Promise<boolean> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';

    try {
      const res = await fetch('/api/reinstate-player', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ gameId, playerId }),
      });

      if (res.ok) {
        const localKey = `quizarena_players_${gameId}`;
        try {
          const players: Player[] = JSON.parse(localStorage.getItem(localKey) || '[]');
          const updated = players.map(p =>
            p.id === playerId
              ? {
                  ...p,
                  strikes: 0,
                  status: 'active',
                  isTerminated: false,
                  integrityScore: 100,
                }
              : p
          );
          localStorage.setItem(localKey, JSON.stringify(updated));
          broadcastChannel?.postMessage({
            type: 'PLAYERS_UPDATED',
            gameId,
            players: updated,
          });
        } catch (e) {}
        return true;
      }
    } catch (err) {
      console.warn('[GameEngine] Failed to reinstate player on server:', err);
    }
    return false;
  }

  // Host approves or revokes accessible DOM text mode & extra time accommodations via secure backend
  public static async updatePlayerAccessibleApproval(
    gameId: string,
    playerId: string,
    accessibleApproved: boolean,
    extraTimeMultiplier?: number
  ): Promise<boolean> {
    const user = auth.currentUser;
    const idToken = (await user?.getIdToken()) || '';

    try {
      const res = await fetch('/api/approve-accommodation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          gameId,
          playerId,
          accessibleApproved,
          extraTimeMultiplier,
        }),
      });
      if (res.ok) {
        return true;
      }
    } catch (e) {
      console.warn('POST /api/approve-accommodation failed:', e);
    }

    if (isFirebaseConfigured && db) {
      try {
        await updateDoc(doc(db, 'games', gameId, 'players', playerId), {
          accessibleApproved,
          updatedAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('Failed to update accessible approval in Firestore:', e);
      }
    }
    const localKey = `quizarena_players_${gameId}`;
    try {
      const players: Player[] = JSON.parse(localStorage.getItem(localKey) || '[]');
      const updated = players.map(p =>
        p.id === playerId ? { ...p, accessibleApproved } : p
      );
      localStorage.setItem(localKey, JSON.stringify(updated));
      broadcastChannel?.postMessage({
        type: 'PLAYERS_UPDATED',
        gameId,
        players: updated,
      });
    } catch (e) {}
    return true;
  }

  // Activate single-use power-up via trusted server endpoint POST /api/use-powerup
  public static async usePowerUp(
    gameId: string,
    powerUp: 'fiftyFifty' | 'timeFreeze' | 'doublePoints',
    questionIndex: number
  ): Promise<{ success: boolean; hiddenOptionIndices?: number[]; addedTimeMs?: number; error?: string }> {
    const user = auth.currentUser || (await ensureAnonymousAuth());
    const idToken = (await user?.getIdToken()) || '';

    try {
      const response = await fetch('/api/use-powerup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          gameId,
          powerUp,
          questionIndex,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        return { success: false, error: errJson.error || `HTTP ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        hiddenOptionIndices: data.hiddenOptionIndices,
        addedTimeMs: data.addedTimeMs,
      };
    } catch (err: any) {
      console.warn('POST /api/use-powerup error:', err);
      return { success: false, error: err.message || 'Network error activating power-up' };
    }
  }

  // Get single player from Firestore with local fallback
  public static async getPlayer(gameId: string, playerId: string): Promise<Player | null> {
    try {
      const snap = await getDoc(doc(db, 'games', gameId, 'players', playerId));
      if (snap.exists()) {
        return snap.data() as Player;
      }
    } catch (e) {
      console.warn('Could not get player from Firestore:', e);
    }
    const localKey = `quizarena_players_${gameId}`;
    try {
      const players: Player[] = JSON.parse(localStorage.getItem(localKey) || '[]');
      return players.find(p => p.id === playerId) || null;
    } catch {
      return null;
    }
  }

  // Get single game from Firestore with local fallback
  public static async getGame(gameId: string): Promise<GameSession | null> {
    try {
      const snap = await getDoc(doc(db, 'games', gameId));
      if (snap.exists()) {
        return snap.data() as GameSession;
      }
    } catch (e) {
      console.warn('Could not get game from Firestore:', e);
    }
    try {
      const saved = localStorage.getItem(`quizarena_game_${gameId}`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  }
}

