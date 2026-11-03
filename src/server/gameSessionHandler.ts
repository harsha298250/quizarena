/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { sanitizeNickname } from '../lib/profanity.ts';
import type { GameSession, Player, Quiz, GameSettings } from '../types/quiz.ts';

export const MAX_GAME_CAPACITY = 300;

export interface GameSessionHandlerOptions {
  adminAuth?: any;
  adminDb?: any;
}

/**
 * Extracts and verifies the Firebase ID token from Authorization header.
 */
export async function authenticateToken(
  req: Request,
  adminAuth: any
): Promise<{ uid: string; email?: string; isAnonymous: boolean } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const idToken = authHeader.split('Bearer ')[1].trim();
  if (!idToken) return null;

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    if (!decoded || !decoded.uid) return null;

    const isAnonymous =
      decoded.firebase?.sign_in_provider === 'anonymous' ||
      decoded.provider_id === 'anonymous';

    return {
      uid: decoded.uid,
      email: decoded.email,
      isAnonymous: Boolean(isAnonymous),
    };
  } catch (err) {
    return null;
  }
}

/**
 * Generates a random 6-digit numeric game PIN.
 */
export function generateGamePin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * POST /api/create-game
 * Requirement 1: Secure game creation and host ownership.
 * Derives hostId exclusively from verified Firebase ID token.
 * Requirement 5: Anonymous Firebase users must not gain host privileges.
 */
export async function handleCreateGame(
  req: Request,
  res: Response,
  options: GameSessionHandlerOptions = {}
): Promise<void> {
  const adminAuth = options.adminAuth;
  const adminDb = options.adminDb;

  if (!adminAuth || !adminDb) {
    res.status(500).json({ error: 'Backend auth or database service unavailable' });
    return;
  }

  const authUser = await authenticateToken(req, adminAuth);
  if (!authUser) {
    res.status(401).json({ error: 'Unauthorized: Valid Firebase ID token required' });
    return;
  }

  // Requirement 5: Anonymous users CANNOT host games
  if (authUser.isAnonymous) {
    res.status(403).json({ error: 'Forbidden: Anonymous accounts cannot create or host games' });
    return;
  }

  const { quiz, hostName = 'Host', customSettings = {} } = req.body || {};
  if (!quiz || !quiz.title || !Array.isArray(quiz.questions)) {
    res.status(400).json({ error: 'Invalid quiz payload provided' });
    return;
  }

  // Derive host identity authoritatively from verified token
  const hostId = authUser.uid;
  const pin = generateGamePin();
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
    ...customSettings,
  };

  // Strip correct answers from public questions
  const sanitizedQuestions = quiz.questions.map((q: any) => {
    const { correctAnswers, acceptedTextAnswers, ...rest } = q;
    return rest;
  });

  const session: GameSession = {
    id: gameId,
    pin,
    hostId,
    hostName: String(hostName).substring(0, 50),
    quizId: quiz.id || `quiz_${Date.now()}`,
    quizTitle: quiz.title,
    status: 'lobby',
    gameMode: quiz.gameMode || 'classic',
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
    const gameDocRef = adminDb.doc(`games/${gameId}`);
    const secretsDocRef = adminDb.doc(`games/${gameId}/secrets/answerKey`);

    await gameDocRef.set({
      ...session,
      playerCount: 0,
      isLocked: false,
      serverCreatedAt: FieldValue.serverTimestamp(),
    });

    // Write protected answer key to host-only secrets subcollection
    const answerKeyMap = quiz.questions.reduce((acc: any, q: any, idx: number) => {
      acc[idx] = {
        correctAnswers: q.correctAnswers || [],
        acceptedTextAnswers: q.acceptedTextAnswers || [],
      };
      return acc;
    }, {});

    await secretsDocRef.set({
      answers: answerKeyMap,
      hostId,
      createdAt: FieldValue.serverTimestamp(),
    });

    res.status(201).json({
      success: true,
      game: session,
    });
  } catch (err) {
    console.error('Error creating game session:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create game session' });
  }
}

/**
 * POST /api/join
 * Requirements 2, 3:
 * - Verifies token, derives playerId = decoded.uid
 * - Validates PIN, lobby lock, and late-join setting
 * - Validates nickname (length, profanity, HTML)
 * - Atomic capacity check (max 300) in Firestore transaction
 * - Scalable kickedPlayers check
 * - Prevents terminated players from rejoining
 */
export async function handleJoinGame(
  req: Request,
  res: Response,
  options: GameSessionHandlerOptions = {}
): Promise<void> {
  const adminAuth = options.adminAuth;
  const adminDb = options.adminDb;

  if (!adminAuth || !adminDb) {
    res.status(500).json({ error: 'Backend auth or database service unavailable' });
    return;
  }

  const authUser = await authenticateToken(req, adminAuth);
  if (!authUser) {
    res.status(401).json({ error: 'Unauthorized: Valid Firebase ID token required to join' });
    return;
  }

  const playerId = authUser.uid;
  const { pin, nickname, avatarConfig, email, emailConsent } = req.body || {};

  if (!pin || typeof pin !== 'string') {
    res.status(400).json({ error: 'Missing or invalid game PIN' });
    return;
  }

  const cleanPin = pin.trim();
  if (!cleanPin || cleanPin.length < 4 || cleanPin.length > 8) {
    res.status(400).json({ error: 'Invalid game PIN format (expected 4-8 digits)' });
    return;
  }

  const rawNickname = typeof nickname === 'string' ? nickname.trim() : '';
  // Strip HTML tags before length checking to prevent injection or padding bypass
  const strippedNickname = rawNickname.replace(/<[^>]*>?/gm, '').trim();
  if (!strippedNickname || strippedNickname.length === 0) {
    res.status(400).json({ error: 'Nickname cannot be empty' });
    return;
  }
  if (strippedNickname.length > 25) {
    res.status(400).json({ error: 'Nickname cannot exceed 25 characters' });
    return;
  }

  // Sanitize profanity
  const { cleanName } = sanitizeNickname(strippedNickname);

  const gameId = `game_${cleanPin}`;
  const gameDocRef = adminDb.doc(`games/${gameId}`);
  const playerDocRef = adminDb.doc(`games/${gameId}/players/${playerId}`);
  const kickedDocRef = adminDb.doc(`games/${gameId}/kickedPlayers/${playerId}`);

  try {
    const result = await adminDb.runTransaction(async (transaction: any) => {
      // 1. Check if game exists
      const gameSnap = await transaction.get(gameDocRef);
      if (!gameSnap.exists) {
        throw new Error('GAME_NOT_FOUND');
      }

      const gameData = gameSnap.data();

      // 2. Check if player was kicked (Scalable subcollection check)
      const kickedSnap = await transaction.get(kickedDocRef);
      if (kickedSnap.exists) {
        throw new Error('PLAYER_KICKED');
      }

      // 3. Check existing player document state
      const playerSnap = await transaction.get(playerDocRef);
      if (playerSnap.exists) {
        const existingData = playerSnap.data();
        if (existingData.isKicked === true || existingData.status === 'kicked') {
          throw new Error('PLAYER_KICKED');
        }
        if (
          existingData.isTerminated === true ||
          existingData.status === 'terminated_integrity' ||
          (existingData.strikes || 0) >= 6
        ) {
          throw new Error('PLAYER_TERMINATED');
        }

        // Reconnect / refresh: return existing player state without incrementing count
        return {
          player: existingData as Player,
          game: gameData as GameSession,
          reconnected: true,
        };
      }

      // 4. New player joining: Verify Lobby Lock
      if (gameData.isLocked === true || gameData.settings?.isLocked === true) {
        throw new Error('LOBBY_LOCKED');
      }

      // 5. Verify Late-Join Setting
      if (gameData.status !== 'lobby' && gameData.settings?.allowLateJoin === false) {
        throw new Error('LATE_JOIN_DISABLED');
      }

      // 6. Enforce 300 Capacity atomically
      const currentCount = Number(gameData.playerCount || 0);
      if (currentCount >= MAX_GAME_CAPACITY) {
        throw new Error('GAME_CAPACITY_FULL');
      }

      // 7. Atomically increment capacity
      transaction.update(gameDocRef, {
        playerCount: currentCount + 1,
        updatedAt: new Date().toISOString(),
      });

      // 8. Assign safe server-controlled initial values
      const initialPlayer: Player = {
        id: playerId,
        nickname: cleanName,
        avatar: JSON.stringify(avatarConfig || { id: 'fox' }),
        avatarConfig: avatarConfig || { id: 'fox' },
        score: 0,
        streak: 0,
        maxStreak: 0,
        correctCount: 0,
        latencyMs: 0,
        clockOffsetMs: 0,
        integrityScore: 100,
        strikes: 0,
        status: 'active',
        isTerminated: false,
        accessibleApproved: false,
        powerUps: {
          fiftyFiftyUsed: false,
          doublePointsUsed: false,
          timeFreezeUsed: false,
        },
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

      transaction.set(playerDocRef, {
        ...initialPlayer,
        serverJoinedAt: FieldValue.serverTimestamp(),
      });

      // 9. Store guest email if provided
      if (email && typeof email === 'string' && email.includes('@')) {
        const guestEmailDocRef = adminDb.doc(`games/${gameId}/guestEmails/${playerId}`);
        transaction.set(guestEmailDocRef, {
          playerId,
          playerNickname: cleanName,
          email: email.trim(),
          emailConsent: Boolean(emailConsent),
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      return {
        player: initialPlayer,
        game: gameData as GameSession,
        reconnected: false,
      };
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    const code = err.message || '';
    if (code === 'GAME_NOT_FOUND') {
      res.status(404).json({ error: 'Game session not found. Please check your PIN.' });
      return;
    }
    if (code === 'LOBBY_LOCKED') {
      res.status(403).json({ error: 'This lobby is currently locked by the host.' });
      return;
    }
    if (code === 'LATE_JOIN_DISABLED') {
      res.status(403).json({ error: 'This game has already started and late joining is disabled.' });
      return;
    }
    if (code === 'GAME_CAPACITY_FULL') {
      res.status(403).json({ error: `Game lobby is full (maximum ${MAX_GAME_CAPACITY} players allowed).` });
      return;
    }
    if (code === 'PLAYER_KICKED') {
      res.status(403).json({ error: 'You have been removed from this game and cannot rejoin.' });
      return;
    }
    if (code === 'PLAYER_TERMINATED') {
      res.status(403).json({ error: 'Your session was terminated for integrity policy violations.' });
      return;
    }

    console.error('Error joining game session:', err);
    res.status(500).json({ error: err.message || 'Internal error joining game session' });
  }
}

/**
 * POST /api/kick-player
 * Requirements 3, 4:
 * - Authenticates host
 * - Verifies host ownership of game
 * - Scalable kickedPlayers subcollection record
 * - Permanently prevents UID from rejoining
 */
export async function handleKickPlayer(
  req: Request,
  res: Response,
  options: GameSessionHandlerOptions = {}
): Promise<void> {
  const adminAuth = options.adminAuth;
  const adminDb = options.adminDb;

  if (!adminAuth || !adminDb) {
    res.status(500).json({ error: 'Backend auth or database service unavailable' });
    return;
  }

  const authUser = await authenticateToken(req, adminAuth);
  if (!authUser) {
    res.status(401).json({ error: 'Unauthorized: Valid Firebase ID token required' });
    return;
  }

  const hostUid = authUser.uid;
  const { gameId, playerId, reason = 'Kicked by host' } = req.body || {};

  if (!gameId || !playerId) {
    res.status(400).json({ error: 'Missing gameId or playerId parameter' });
    return;
  }

  const gameDocRef = adminDb.doc(`games/${gameId}`);
  const playerDocRef = adminDb.doc(`games/${gameId}/players/${playerId}`);
  const kickedDocRef = adminDb.doc(`games/${gameId}/kickedPlayers/${playerId}`);

  try {
    await adminDb.runTransaction(async (transaction: any) => {
      const gameSnap = await transaction.get(gameDocRef);
      if (!gameSnap.exists) {
        throw new Error('GAME_NOT_FOUND');
      }

      const gameData = gameSnap.data();
      if (gameData.hostId !== hostUid) {
        throw new Error('FORBIDDEN_HOST');
      }

      const playerSnap = await transaction.get(playerDocRef);
      if (!playerSnap.exists) {
        throw new Error('PLAYER_NOT_FOUND');
      }

      // Update player doc to kicked (DO NOT delete doc, preserve history)
      transaction.update(playerDocRef, {
        status: 'kicked',
        isKicked: true,
        kickedAt: FieldValue.serverTimestamp(),
        lastSeen: new Date().toISOString(),
      });

      // Scalable kicked subcollection
      transaction.set(kickedDocRef, {
        playerId,
        hostId: hostUid,
        reason: String(reason).substring(0, 100),
        kickedAt: FieldValue.serverTimestamp(),
      });

      // Decrement capacity
      const newCount = Math.max(0, (gameData.playerCount || 1) - 1);
      transaction.update(gameDocRef, {
        playerCount: newCount,
        updatedAt: new Date().toISOString(),
      });
    });

    res.status(200).json({
      success: true,
      message: `Player ${playerId} kicked successfully`,
    });
  } catch (err: any) {
    const code = err.message || '';
    if (code === 'GAME_NOT_FOUND') {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    if (code === 'FORBIDDEN_HOST') {
      res.status(403).json({ error: 'Forbidden: Only the game host can kick players' });
      return;
    }
    if (code === 'PLAYER_NOT_FOUND') {
      res.status(404).json({ error: 'Player does not exist in this game' });
      return;
    }

    console.error('Error kicking player:', err);
    res.status(500).json({ error: err.message || 'Internal error kicking player' });
  }
}

/**
 * POST /api/leave
 * Requirement 7:
 * - Controlled leave operation
 * - Preserves integrity history and strikes (does NOT delete document)
 * - Decrements playerCount
 */
export async function handleLeaveGame(
  req: Request,
  res: Response,
  options: GameSessionHandlerOptions = {}
): Promise<void> {
  const adminAuth = options.adminAuth;
  const adminDb = options.adminDb;

  if (!adminAuth || !adminDb) {
    res.status(500).json({ error: 'Backend auth or database service unavailable' });
    return;
  }

  const authUser = await authenticateToken(req, adminAuth);
  if (!authUser) {
    res.status(401).json({ error: 'Unauthorized: Valid Firebase ID token required' });
    return;
  }

  const playerId = authUser.uid;
  const { gameId } = req.body || {};

  if (!gameId) {
    res.status(400).json({ error: 'Missing gameId parameter' });
    return;
  }

  const gameDocRef = adminDb.doc(`games/${gameId}`);
  const playerDocRef = adminDb.doc(`games/${gameId}/players/${playerId}`);

  try {
    await adminDb.runTransaction(async (transaction: any) => {
      const gameSnap = await transaction.get(gameDocRef);
      if (!gameSnap.exists) {
        return; // Game may already be finished or deleted
      }

      const playerSnap = await transaction.get(playerDocRef);
      if (!playerSnap.exists) {
        return;
      }

      // Mark status as 'left', preserving strike records and integrity telemetry
      transaction.update(playerDocRef, {
        status: 'left',
        leftAt: FieldValue.serverTimestamp(),
        lastSeen: new Date().toISOString(),
      });

      const gameData = gameSnap.data();
      const newCount = Math.max(0, (gameData.playerCount || 1) - 1);
      transaction.update(gameDocRef, {
        playerCount: newCount,
        updatedAt: new Date().toISOString(),
      });
    });

    res.status(200).json({
      success: true,
      message: 'Player left game successfully',
    });
  } catch (err: any) {
    console.error('Error leaving game:', err);
    res.status(500).json({ error: err.message || 'Internal error leaving game' });
  }
}

/**
 * POST /api/lock-lobby
 * Host toggles isLocked on game session.
 */
export async function handleLockLobby(
  req: Request,
  res: Response,
  options: GameSessionHandlerOptions = {}
): Promise<void> {
  const adminAuth = options.adminAuth;
  const adminDb = options.adminDb;

  if (!adminAuth || !adminDb) {
    res.status(500).json({ error: 'Backend auth or database service unavailable' });
    return;
  }

  const authUser = await authenticateToken(req, adminAuth);
  if (!authUser) {
    res.status(401).json({ error: 'Unauthorized: Valid Firebase ID token required' });
    return;
  }

  const hostUid = authUser.uid;
  const { gameId, isLocked = true } = req.body || {};

  if (!gameId) {
    res.status(400).json({ error: 'Missing gameId parameter' });
    return;
  }

  const gameDocRef = adminDb.doc(`games/${gameId}`);
  try {
    const snap = await gameDocRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    if (snap.data()?.hostId !== hostUid) {
      res.status(403).json({ error: 'Forbidden: Only the game host can toggle lobby lock' });
      return;
    }

    await gameDocRef.update({
      isLocked: Boolean(isLocked),
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.status(200).json({
      success: true,
      isLocked: Boolean(isLocked),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update lobby lock' });
  }
}
