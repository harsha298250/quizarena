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

    // (a) Remove correct answers from public questions for players
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

    try {
      // 1. Write public game document WITHOUT correct answers
      await setDoc(doc(db, 'games', gameId), {
        ...session,
        serverCreatedAt: serverTimestamp(),
      });

      // 2. Write correct answers to host-only subcollection games/{id}/secrets/answerKey
      await setDoc(doc(db, 'games', gameId, 'secrets', 'answerKey'), {
        gameId,
        hostId,
        createdAt: serverTimestamp(),
        answers: quiz.questions.map((q, idx) => ({
          questionIndex: idx,
          id: q.id,
          type: q.type,
          correctAnswers: q.correctAnswers || [],
          acceptedTextAnswers: q.acceptedTextAnswers || [],
          explanation: q.explanation || '',
          points: q.points || 1000,
          timeLimit: q.timeLimit || 20,
        })),
      });
    } catch (e) {
      if (isFirebaseConfigured) {
        notifyFirestoreError('Failed to initialize game session in Firestore', e);
        throw e;
      } else {
        console.warn('Firestore createGame fallback to local state:', e);
      }
    }

    // Save full questions for host in local storage
    const hostSession: GameSession = {
      ...session,
      questions: quiz.questions,
    };
    if (!isFirebaseConfigured) {
      localStorage.setItem(`quizarena_game_${gameId}`, JSON.stringify(hostSession));
      // Broadcast public session
      broadcastChannel?.postMessage({ type: 'GAME_CREATED', session });
    }

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

  // Join Game as a Player
  public static async joinGame(gameId: string, player: Player): Promise<void> {
    const user = auth.currentUser || (await ensureAnonymousAuth());
    if (user && player.id !== user.uid) {
      player.id = user.uid;
    }

    const { email, emailConsent, ...publicPlayer } = player;

    try {
      // 1. Write public player doc WITHOUT email or emailConsent
      await setDoc(doc(db, 'games', gameId, 'players', player.id), {
        ...publicPlayer,
        score: 0,
        streak: 0,
        maxStreak: 0,
        correctCount: 0,
        serverJoinedAt: serverTimestamp(),
      });

      // 2. Move guest email into host-only subcollection games/{id}/guestEmails/{playerId}
      if (email) {
        await setDoc(doc(db, 'games', gameId, 'guestEmails', player.id), {
          playerId: player.id,
          playerNickname: player.nickname,
          email,
          emailConsent: Boolean(emailConsent),
          createdAt: serverTimestamp(),
        });
      }
    } catch (e) {
      if (isFirebaseConfigured) {
        notifyFirestoreError(`Failed to register player in Firestore for game ${gameId}`, e);
        throw e;
      } else {
        console.warn('Firestore player join fallback:', e);
      }
    }

    if (!isFirebaseConfigured) {
      // Update local cache only in demo mode
      const localPlayersKey = `quizarena_players_${gameId}`;
      let players: Player[] = [];
      try {
        players = JSON.parse(localStorage.getItem(localPlayersKey) || '[]');
      } catch (e) {}
      const filtered = players.filter(p => p.id !== player.id);
      filtered.push(player);
      localStorage.setItem(localPlayersKey, JSON.stringify(filtered));

      if (email) {
        try {
          const localKey = `quizarena_guest_emails_${gameId}`;
          const current: Array<{
            playerId: string;
            playerNickname: string;
            email: string;
            emailConsent: boolean;
          }> = JSON.parse(localStorage.getItem(localKey) || '[]');
          current.push({
            playerId: player.id,
            playerNickname: player.nickname,
            email,
            emailConsent: Boolean(emailConsent),
          });
          localStorage.setItem(localKey, JSON.stringify(current));
        } catch {}
      }

      broadcastChannel?.postMessage({
        type: 'PLAYERS_UPDATED',
        gameId,
        players: filtered,
      });
    }
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

  // Host updates game status (State Machine: lobby -> question_active -> reveal -> leaderboard -> finished)
  public static async updateGameStatus(
    game: GameSession,
    newStatus: GameSession['status'],
    questionIndex?: number
  ): Promise<void> {
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

    if (newStatus === 'question_active') {
      try {
        const user = auth.currentUser || (await ensureAnonymousAuth());
        const idToken = (await user?.getIdToken()) || '';
        const resp = await fetch('/api/advance-question', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            gameId: game.id,
            questionIndex: updated.currentQuestionIndex,
            timeLimit: updated.timeLimit,
          }),
        });

        if (resp.ok) {
          const resData = await resp.json();
          if (resData.questionStartTimeMs) {
            updated.questionStartTime = resData.questionStartTimeMs;
          }
        } else {
          // Direct Firestore write fallback
          await updateDoc(doc(db, 'games', game.id), {
            status: newStatus,
            currentQuestionIndex: updated.currentQuestionIndex,
            questionStartTime: serverTimestamp(),
            timeLimit: updated.timeLimit,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        if (isFirebaseConfigured) {
          notifyFirestoreError(`Failed to advance question in game ${game.id}`, err);
          throw err;
        } else {
          console.warn('Firestore advance question fallback:', err);
        }
      }
    } else {
      try {
        await updateDoc(doc(db, 'games', game.id), {
          status: newStatus,
          currentQuestionIndex: updated.currentQuestionIndex,
          timeLimit: updated.timeLimit,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        if (isFirebaseConfigured) {
          notifyFirestoreError(`Failed to update game status to "${newStatus}" in Firestore`, e);
          throw e;
        } else {
          console.warn('Firestore update status fallback:', e);
        }
      }
    }

    if (!isFirebaseConfigured) {
      localStorage.setItem(`quizarena_game_${game.id}`, JSON.stringify(updated));
      broadcastChannel?.postMessage({ type: 'GAME_UPDATED', session: updated });
    }
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

  // Update player strike count and termination status on server so refresh cannot wipe it
  public static async updatePlayerStrikes(
    gameId: string,
    playerId: string,
    strikes: number,
    lastEvent?: string,
    isTerminated: boolean = false
  ): Promise<void> {
    const integrityScore = Math.max(0, 100 - strikes * 16 - (isTerminated ? 100 : 0));
    const updateData: Record<string, any> = {
      strikes,
      lastEvent: lastEvent || '',
      lastEventTime: new Date().toISOString(),
      isTerminated,
      status: isTerminated ? 'terminated_integrity' : 'active',
      integrityScore,
    };

    if (isFirebaseConfigured && db) {
      try {
        await updateDoc(doc(db, 'games', gameId, 'players', playerId), updateData);
      } catch (e) {
        console.warn('Failed to update player strikes in Firestore:', e);
      }
    }

    // Local storage & BroadcastChannel fallback
    const localKey = `quizarena_players_${gameId}`;
    try {
      const players: Player[] = JSON.parse(localStorage.getItem(localKey) || '[]');
      const updated = players.map(p =>
        p.id === playerId ? { ...p, ...updateData } : p
      );
      localStorage.setItem(localKey, JSON.stringify(updated));
      broadcastChannel?.postMessage({
        type: 'PLAYERS_UPDATED',
        gameId,
        players: updated,
      });
    } catch (e) {}
  }

  // Host reinstates a terminated player
  public static async reinstatePlayer(gameId: string, playerId: string): Promise<void> {
    await this.updatePlayerStrikes(gameId, playerId, 0, 'Reinstated by Host', false);
  }
}

