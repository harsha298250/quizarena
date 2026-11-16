/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  handleJoinGame,
  handleLeaveGame,
  MAX_GAME_CAPACITY,
} from '../server/gameSessionHandler.ts';

function createMockBackend() {
  const store = new Map<string, any>();

  const adminAuth = {
    verifyIdToken: async (token: string) => {
      if (token === 'player_token_1') {
        return { uid: 'player_001', email: 'alice@school.edu', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'player_token_2') {
        return { uid: 'player_002', email: 'bob@school.edu', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'player_token_3') {
        return { uid: 'player_003', email: 'charlie@school.edu', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'kicked_token') {
        return { uid: 'player_kicked', email: 'kicked@school.edu', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
      }
      if (token === 'terminated_token') {
        return { uid: 'player_terminated', email: 'term@school.edu', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
      }
      throw new Error('Invalid Firebase ID token');
    },
  };

  const adminDb: any = {
    doc: (docPath: string) => ({
      get: async () => ({
        exists: store.has(docPath),
        data: () => store.get(docPath),
      }),
      set: async (data: any) => {
        store.set(docPath, data);
      },
      update: async (data: any) => {
        const cur = store.get(docPath) || {};
        store.set(docPath, { ...cur, ...data });
      },
    }),
    collection: (colPath: string) => ({
      get: async () => {
        const docs: any[] = [];
        for (const [key, val] of store.entries()) {
          if (key.startsWith(colPath + '/')) {
            docs.push({
              id: key.replace(colPath + '/', ''),
              data: () => val,
            });
          }
        }
        return {
          forEach: (cb: (doc: any) => void) => docs.forEach(cb),
          docs,
          size: docs.length,
        };
      },
    }),
    runTransaction: async (updateFunction: (tx: any) => Promise<any>) => {
      const tx = {
        get: async (docRef: any) => docRef.get(),
        set: (docRef: any, data: any) => docRef.set(data),
        update: (docRef: any, data: any) => docRef.update(data),
      };
      return updateFunction(tx);
    },
    _store: store,
  };

  return { adminAuth, adminDb, store };
}

function mockReqRes(headers: Record<string, string> = {}, body: any = {}) {
  let statusCode = 200;
  let responseData: any = null;

  const req: any = {
    headers: { ...headers },
    body: { ...body },
  };

  const res: any = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      responseData = data;
      return res;
    },
    setHeader: () => res,
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
  };
}

describe('Phase 4A — Room and Player Reliability Suite', () => {
  // =========================================================================
  // 1. Terminal State Join Guards
  // =========================================================================
  describe('Terminal State Join Guards', () => {
    it('[4A-01] rejects new players attempting to join a finished game with HTTP 400 even if allowLateJoin is true', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '123456';
      store.set(`games/game_${pin}`, {
        id: `game_${pin}`,
        pin,
        status: 'finished',
        playerCount: 5,
        settings: { allowLateJoin: true },
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { pin, nickname: 'Alice' }
      );

      await handleJoinGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(400);
      expect(getData().error).toContain('This game has already finished or been cancelled');
      expect(store.has(`games/game_${pin}/players/player_001`)).toBe(false);
      expect(store.get(`games/game_${pin}`).playerCount).toBe(5);
    });

    it('[4A-02] rejects new players attempting to join a cancelled game with HTTP 400', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '654321';
      store.set(`games/game_${pin}`, {
        id: `game_${pin}`,
        pin,
        status: 'cancelled',
        playerCount: 2,
        settings: { allowLateJoin: true },
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_2' },
        { pin, nickname: 'Bob' }
      );

      await handleJoinGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(400);
      expect(getData().error).toContain('This game has already finished or been cancelled');
      expect(store.has(`games/game_${pin}/players/player_002`)).toBe(false);
    });
  });

  // =========================================================================
  // 2. Legitimate Reconnection Functionality
  // =========================================================================
  describe('Legitimate Reconnection Functionality', () => {
    it('[4A-03] permits enrolled active player to reconnect to active game without incrementing capacity', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '222222';
      store.set(`games/game_${pin}`, {
        id: `game_${pin}`,
        pin,
        status: 'question_active',
        playerCount: 1,
        settings: { allowLateJoin: false },
      });
      store.set(`games/game_${pin}/players/player_001`, {
        id: 'player_001',
        nickname: 'Alice',
        score: 500,
        streak: 2,
        status: 'active',
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { pin, nickname: 'Alice' }
      );

      await handleJoinGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(200);
      expect(getData().reconnected).toBe(true);
      expect(getData().player.score).toBe(500);
      expect(getData().player.streak).toBe(2);
      // Capacity must remain 1
      expect(store.get(`games/game_${pin}`).playerCount).toBe(1);
    });

    it('[4A-04] permits enrolled player to reconnect to finished game to view final results/podium', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '333333';
      store.set(`games/game_${pin}`, {
        id: `game_${pin}`,
        pin,
        status: 'finished',
        playerCount: 3,
        settings: { allowLateJoin: false },
      });
      store.set(`games/game_${pin}/players/player_001`, {
        id: 'player_001',
        nickname: 'Alice',
        score: 1500,
        status: 'active',
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { pin, nickname: 'Alice' }
      );

      await handleJoinGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(200);
      expect(getData().reconnected).toBe(true);
      expect(getData().player.score).toBe(1500);
      expect(store.get(`games/game_${pin}`).playerCount).toBe(3);
    });
  });

  // =========================================================================
  // 3. Rejoining After Leaving
  // =========================================================================
  describe('Rejoining After Leaving', () => {
    it('[4A-05] player who left can rejoin an active room: increments playerCount and reactivates status', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '444444';
      store.set(`games/game_${pin}`, {
        id: `game_${pin}`,
        pin,
        status: 'lobby',
        playerCount: 1, // Alice left previously, leaving 1 other player
        settings: { allowLateJoin: true },
      });
      store.set(`games/game_${pin}/players/player_001`, {
        id: 'player_001',
        nickname: 'Alice',
        score: 200,
        status: 'left',
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { pin, nickname: 'Alice' }
      );

      await handleJoinGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(200);
      expect(getData().reconnected).toBe(true);
      expect(getData().player.status).toBe('active');
      // Capacity must increment from 1 to 2
      expect(store.get(`games/game_${pin}`).playerCount).toBe(2);
      expect(store.get(`games/game_${pin}/players/player_001`).status).toBe('active');
    });

    it('[4A-06] player who left cannot rejoin a finished or cancelled game', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '555555';
      store.set(`games/game_${pin}`, {
        id: `game_${pin}`,
        pin,
        status: 'finished',
        playerCount: 0,
        settings: { allowLateJoin: true },
      });
      store.set(`games/game_${pin}/players/player_001`, {
        id: 'player_001',
        nickname: 'Alice',
        status: 'left',
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { pin, nickname: 'Alice' }
      );

      await handleJoinGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(400);
      expect(getData().error).toContain('This game has already finished or been cancelled');
      expect(store.get(`games/game_${pin}`).playerCount).toBe(0);
    });

    it('[4A-07] player who left cannot rejoin when lobby is locked', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '777777';
      store.set(`games/game_${pin}`, {
        id: `game_${pin}`,
        pin,
        status: 'lobby',
        isLocked: true,
        playerCount: 5,
      });
      store.set(`games/game_${pin}/players/player_001`, {
        id: 'player_001',
        nickname: 'Alice',
        status: 'left',
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { pin, nickname: 'Alice' }
      );

      await handleJoinGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(403);
      expect(getData().error).toContain('locked by the host');
      expect(store.get(`games/game_${pin}`).playerCount).toBe(5);
    });

    it('[4A-08] player who left cannot rejoin when room is at max capacity (300)', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '888888';
      store.set(`games/game_${pin}`, {
        id: `game_${pin}`,
        pin,
        status: 'lobby',
        playerCount: MAX_GAME_CAPACITY,
      });
      store.set(`games/game_${pin}/players/player_001`, {
        id: 'player_001',
        nickname: 'Alice',
        status: 'left',
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { pin, nickname: 'Alice' }
      );

      await handleJoinGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(403);
      expect(getData().error).toContain('Game lobby is full');
      expect(store.get(`games/game_${pin}`).playerCount).toBe(MAX_GAME_CAPACITY);
    });
  });

  // =========================================================================
  // 4. Late-Join Setting & Room Capacity
  // =========================================================================
  describe('Late-Join Setting & Room Capacity', () => {
    it('[4A-09] enforces atomic capacity limit: rejects 301st player when at MAX_GAME_CAPACITY (300)', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '999991';
      store.set(`games/game_${pin}`, {
        id: `game_${pin}`,
        pin,
        status: 'lobby',
        playerCount: 300,
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { pin, nickname: 'NewStudent' }
      );

      await handleJoinGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(403);
      expect(getData().error).toContain('Game lobby is full');
      expect(store.has(`games/game_${pin}/players/player_001`)).toBe(false);
    });

    it('[4A-10] rejects new player joining an ongoing game when allowLateJoin is false', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '999992';
      store.set(`games/game_${pin}`, {
        id: `game_${pin}`,
        pin,
        status: 'question_active',
        playerCount: 10,
        settings: { allowLateJoin: false },
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { pin, nickname: 'LateJoiner' }
      );

      await handleJoinGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(403);
      expect(getData().error).toContain('late joining is disabled');
      expect(store.get(`games/game_${pin}`).playerCount).toBe(10);
    });

    it('[4A-11] permits new player joining an ongoing game when allowLateJoin is true', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '999993';
      store.set(`games/game_${pin}`, {
        id: `game_${pin}`,
        pin,
        status: 'question_active',
        playerCount: 10,
        settings: { allowLateJoin: true },
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { pin, nickname: 'LateJoiner' }
      );

      await handleJoinGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(200);
      expect(getData().success).toBe(true);
      expect(store.get(`games/game_${pin}`).playerCount).toBe(11);
      expect(store.has(`games/game_${pin}/players/player_001`)).toBe(true);
    });
  });

  // =========================================================================
  // 5. Kicked and Terminated Player Guards
  // =========================================================================
  describe('Kicked and Terminated Player Guards', () => {
    it('[4A-12] rejects kicked player from joining via subcollection check (HTTP 403)', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '999994';
      store.set(`games/game_${pin}`, {
        id: `game_${pin}`,
        pin,
        status: 'lobby',
        playerCount: 2,
      });
      store.set(`games/game_${pin}/kickedPlayers/player_kicked`, {
        playerId: 'player_kicked',
        reason: 'Inappropriate conduct',
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer kicked_token' },
        { pin, nickname: 'BadActor' }
      );

      await handleJoinGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(403);
      expect(getData().error).toContain('You have been removed from this game and cannot rejoin');
      expect(store.get(`games/game_${pin}`).playerCount).toBe(2);
    });

    it('[4A-13] rejects player whose record has 6 strikes or terminated status (HTTP 403)', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '999995';
      store.set(`games/game_${pin}`, {
        id: `game_${pin}`,
        pin,
        status: 'lobby',
        playerCount: 2,
      });
      store.set(`games/game_${pin}/players/player_terminated`, {
        id: 'player_terminated',
        nickname: 'Cheater',
        strikes: 6,
        isTerminated: true,
        status: 'terminated_integrity',
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer terminated_token' },
        { pin, nickname: 'Cheater' }
      );

      await handleJoinGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(403);
      expect(getData().error).toContain('Your session was terminated for integrity policy violations');
      expect(store.get(`games/game_${pin}`).playerCount).toBe(2);
    });
  });

  // =========================================================================
  // 6. Controlled Leave Idempotency
  // =========================================================================
  describe('Controlled Leave Idempotency', () => {
    it('[4A-14] handleLeaveGame marks status as left and decrements playerCount', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const pin = '999996';
      const gameId = `game_${pin}`;
      store.set(`games/${gameId}`, {
        id: gameId,
        pin,
        status: 'lobby',
        playerCount: 3,
      });
      store.set(`games/${gameId}/players/player_001`, {
        id: 'player_001',
        nickname: 'Alice',
        score: 100,
        strikes: 1,
        status: 'active',
      });

      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { gameId }
      );

      await handleLeaveGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(200);
      expect(getData().success).toBe(true);
      expect(store.get(`games/${gameId}`).playerCount).toBe(2);
      const playerDoc = store.get(`games/${gameId}/players/player_001`);
      expect(playerDoc.status).toBe('left');
      // Preserves score and strikes history
      expect(playerDoc.score).toBe(100);
      expect(playerDoc.strikes).toBe(1);
    });

    it('[4A-15] repeated handleLeaveGame calls do not double-decrement playerCount', async () => {
      const { adminAuth, adminDb, store } = createMockBackend();
      const gameId = 'game_999997';
      store.set(`games/${gameId}`, {
        id: gameId,
        playerCount: 5,
      });
      store.set(`games/${gameId}/players/player_001`, {
        id: 'player_001',
        status: 'left', // already left
      });

      const { req, res, getStatus } = mockReqRes(
        { authorization: 'Bearer player_token_1' },
        { gameId }
      );

      await handleLeaveGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(200);
      // Capacity must remain 5, not decremented again
      expect(store.get(`games/${gameId}`).playerCount).toBe(5);
    });
  });
});

