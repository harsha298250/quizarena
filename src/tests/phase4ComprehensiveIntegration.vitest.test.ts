/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createHashBlock,
  verifyAuditChain,
  verifyAllPlayerChains,
  GENESIS_HASH,
  AuditBlock,
} from '../lib/integrity.ts';
import {
  handleHostHeartbeat,
  checkHostPresence,
  handleStartGame,
  handleCancelGame,
  handleEndGame,
  handleSessionRecovery,
  ABANDONMENT_GRACE_PERIOD_MS,
} from '../server/gameSessionHandler.ts';
import { handleGetTournamentStandings } from '../server/tournamentHandler.ts';
import { handleListUserCertificates } from '../server/notificationHandler.ts';

function mockReqRes(headers: Record<string, string> = {}, body: any = {}, params: any = {}, query: any = {}) {
  let statusCode = 200;
  let responseData: any = null;
  const req: any = {
    headers: { ...headers },
    body,
    params,
    query,
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' },
  };
  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: any) {
      responseData = data;
      return this;
    },
    setHeader() {
      return this;
    },
  };
  return { req, res, getStatus: () => statusCode, getData: () => responseData };
}

describe('Phase 4 — Comprehensive Integration Suite', () => {

  // =========================================================================
  // 1. Audit-Chain Verifier Corrections (Section 2)
  // =========================================================================
  describe('Audit-Chain Verifier & Multi-Player Branching', () => {
    it('[AC-01] verifies standard Genesis-based chain', async () => {
      const b0 = await createHashBlock(GENESIS_HASH, 0, 'p1', 0, 1000, 1000);
      const b1 = await createHashBlock(b0.hash, 1, 'p1', 1, 950, 2000);
      const b2 = await createHashBlock(b1.hash, 2, 'p1', 2, 800, 3000);

      const res = await verifyAuditChain([b0, b1, b2]);
      expect(res.isValid).toBe(true);
      expect(res.brokenIndex).toBeNull();
      expect(res.message).toContain('All 3 audit entries verified successfully');
    });

    it('[AC-02] verifies non-Genesis initial hash (player branch from legacy game hash)', async () => {
      const legacyGameHash = 'a'.repeat(64);
      const b0 = await createHashBlock(legacyGameHash, 3, 'p1', 3, 1000, 4000);
      const b1 = await createHashBlock(b0.hash, 4, 'p1', 4, 900, 5000);

      const res = await verifyAuditChain([b0, b1], legacyGameHash);
      expect(res.isValid).toBe(true);
      expect(res.brokenIndex).toBeNull();
    });

    it('[AC-03] rejects malformed initialPrevHash or block hashes', async () => {
      const b0 = await createHashBlock(GENESIS_HASH, 0, 'p1', 0, 1000, 1000);

      const invalidStart = await verifyAuditChain([b0], 'not-a-valid-sha256');
      expect(invalidStart.isValid).toBe(false);
      expect(invalidStart.message).toContain('Invalid initialPrevHash');

      const malformedBlock = { ...b0, hash: 'bad-hash' };
      const res = await verifyAuditChain([malformedBlock]);
      expect(res.isValid).toBe(false);
      expect(res.message).toContain('Malformed hash');
    });

    it('[AC-04] detects duplicate question index in a single player chain', async () => {
      const b0 = await createHashBlock(GENESIS_HASH, 0, 'p1', 0, 1000, 1000);
      const b0_dup = await createHashBlock(b0.hash, 0, 'p1', 0, 500, 1500);

      const res = await verifyAuditChain([b0, b0_dup]);
      expect(res.isValid).toBe(false);
      expect(res.message).toContain('Duplicate question submission');
    });

    it('[AC-05] detects out-of-order question index', async () => {
      const b1 = await createHashBlock(GENESIS_HASH, 1, 'p1', 1, 1000, 1000);
      const b0 = await createHashBlock(b1.hash, 0, 'p1', 0, 900, 2000);

      const res = await verifyAuditChain([b1, b0]);
      expect(res.isValid).toBe(false);
      expect(res.message).toContain('Invalid question ordering');
    });

    it('[AC-06] detects tampered payload in block', async () => {
      const b0 = await createHashBlock(GENESIS_HASH, 0, 'p1', 0, 1000, 1000);
      const b1 = await createHashBlock(b0.hash, 1, 'p1', 1, 950, 2000);
      const tampered = { ...b1, points: 999999 };

      const res = await verifyAuditChain([b0, tampered]);
      expect(res.isValid).toBe(false);
      expect(res.brokenIndex).toBe(1);
      expect(res.message).toContain('Tampered payload');
    });

    it('[AC-07] verifies multi-player interleaved records with verifyAllPlayerChains()', async () => {
      // p1 records
      const p1_0 = await createHashBlock(GENESIS_HASH, 0, 'p1', 0, 1000, 1000);
      const p1_1 = await createHashBlock(p1_0.hash, 1, 'p1', 1, 900, 2000);

      // p2 records
      const p2_0 = await createHashBlock(GENESIS_HASH, 0, 'p2', 0, 950, 1050);
      const p2_1 = await createHashBlock(p2_0.hash, 1, 'p2', 1, 850, 2050);

      // Interleaved submissions array
      const interleaved = [p1_0, p2_0, p1_1, p2_1];

      const res = await verifyAllPlayerChains(interleaved);
      expect(res.isValid).toBe(true);
      expect(res.brokenPlayerId).toBeNull();
      expect(res.playerResults['p1'].isValid).toBe(true);
      expect(res.playerResults['p2'].isValid).toBe(true);
    });

    it('[AC-08] verifies legacy trunk with branching player chains', async () => {
      // Trunk (legacy global chain for Q0)
      const trunk0 = await createHashBlock(GENESIS_HASH, 0, 'legacy_game', 0, 0, 1000);
      const legacyTrunk = [trunk0];

      // Player branches branching from trunk0.hash
      const p1_1 = await createHashBlock(trunk0.hash, 1, 'p1', 1, 1000, 2000);
      const p2_1 = await createHashBlock(trunk0.hash, 1, 'p2', 1, 950, 2010);

      const res = await verifyAllPlayerChains([p1_1, p2_1], {
        legacyTrunkChain: legacyTrunk,
      });

      expect(res.isValid).toBe(true);
      expect(res.trunkVerification?.isValid).toBe(true);
      expect(res.playerResults['p1'].isValid).toBe(true);
      expect(res.playerResults['p2'].isValid).toBe(true);
    });
  });

  // =========================================================================
  // 2. Host Lifecycle and Recovery (Section 3)
  // =========================================================================
  describe('Host Lifecycle & Heartbeat Presence', () => {
    it('[LC-01] checkHostPresence distinguishes temporary disconnect from genuine abandonment', () => {
      const now = Date.now();

      // Connected with fresh heartbeat
      const connected = checkHostPresence({ hostStatus: 'connected', hostLastSeenMs: now - 10_000 }, now);
      expect(connected.isConnected).toBe(true);
      expect(connected.status).toBe('connected');

      // Disconnected 2 minutes ago (temporary loss)
      const temporary = checkHostPresence({ hostStatus: 'disconnected', hostLastSeenMs: now - 120_000 }, now);
      expect(temporary.isConnected).toBe(false);
      expect(temporary.status).toBe('temporarily_disconnected');

      // Disconnected 6 minutes ago (> 5m grace period)
      const abandoned = checkHostPresence({ hostStatus: 'disconnected', hostLastSeenMs: now - 360_000 }, now);
      expect(abandoned.isConnected).toBe(false);
      expect(abandoned.status).toBe('abandoned');
    });

    it('[LC-02] handleHostHeartbeat records presence and rejects non-hosts', async () => {
      const store = new Map<string, any>();
      store.set('games/game_100', {
        id: 'game_100',
        hostId: 'host_valid',
        status: 'question_active',
      });

      const adminAuth: any = {
        verifyIdToken: async (t: string) => {
          if (t === 'host_token') return { uid: 'host_valid' };
          if (t === 'other_token') return { uid: 'other_user' };
          throw new Error('Invalid token');
        },
      };

      const adminDb: any = {
        doc: (path: string) => ({
          get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
          update: async (updates: any) => {
            const cur = store.get(path) || {};
            store.set(path, { ...cur, ...updates });
          },
        }),
      };

      // 1. Non-host rejected (403)
      const { req: r1, res: res1, getStatus: s1 } = mockReqRes(
        { authorization: 'Bearer other_token' },
        { gameId: 'game_100' }
      );
      await handleHostHeartbeat(r1, res1, { adminAuth, adminDb });
      expect(s1()).toBe(403);

      // 2. Valid host accepted (200)
      const { req: r2, res: res2, getStatus: s2, getData: d2 } = mockReqRes(
        { authorization: 'Bearer host_token' },
        { gameId: 'game_100' }
      );
      await handleHostHeartbeat(r2, res2, { adminAuth, adminDb });
      expect(s2()).toBe(200);
      expect(d2().hostStatus).toBe('connected');
      expect(store.get('games/game_100').hostStatus).toBe('connected');
    });

    it('[LC-03] repeated lifecycle operations are idempotent', async () => {
      const store = new Map<string, any>();
      store.set('games/game_cancel_test', {
        id: 'game_cancel_test',
        hostId: 'host_valid',
        status: 'cancelled',
      });

      const adminAuth: any = {
        verifyIdToken: async () => ({ uid: 'host_valid' }),
      };

      const adminDb: any = {
        doc: (path: string) => ({
          get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
          update: async (updates: any) => {
            const cur = store.get(path) || {};
            store.set(path, { ...cur, ...updates });
          },
        }),
      };

      // Repeated cancel returns 200 without throwing
      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer host_token' },
        { gameId: 'game_cancel_test' }
      );
      await handleCancelGame(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(200);
      expect(getData().message).toBe('Game already cancelled');
    });
  });

  // =========================================================================
  // 3. Standings & Certificate Pagination Fixes (Sections 6 & 7)
  // =========================================================================
  describe('Standings & Certificate Pagination Correctness', () => {
    it('[PG-01] standings pagination returns empty array with hasMore: false when offset exceeds records', async () => {
      const tournamentId = 'tourney_pag';
      const store = new Map<string, any>();

      // 50 total registrations
      const registrations: any[] = [];
      for (let i = 0; i < 50; i++) {
        registrations.push({
          participantId: `p_${i}`,
          participantNickname: `Player ${i}`,
          status: 'registered',
        });
      }

      store.set(`tournaments/${tournamentId}`, {
        id: tournamentId,
        title: 'Pagination Cup',
        status: 'active',
        maxParticipants: 128,
        rounds: [],
      });

      const adminDb: any = {
        runTransaction: async (fn: any) => fn(),
        collection: (col: string) => ({
          doc: (docId: string) => ({
            get: async () => ({ exists: store.has(`${col}/${docId}`), data: () => store.get(`${col}/${docId}`) }),
            collection: (subCol: string) => ({
              limit: (n: number) => ({
                get: async () => ({ docs: registrations.slice(0, n).map(r => ({ data: () => r })) }),
              }),
              get: async () => ({ docs: registrations.map(r => ({ data: () => r })) }),
            }),
          }),
        }),
      };

      // Request offset 300 (exceeds total records)
      const { req, res, getStatus, getData } = mockReqRes(
        {},
        {},
        { id: tournamentId },
        { limit: 50, offset: 300 }
      );

      await handleGetTournamentStandings(req, res, { adminDb, adminAuth: {} as any });
      expect(getStatus()).toBe(200);
      const data = getData();
      expect(data.standings).toHaveLength(0);
      expect(data.pagination.hasMore).toBe(false); // MUST NOT be true when empty!
    });

    it('[PG-02] certificate pagination safely fetches up to 1001 without premature truncation', async () => {
      const userUid = 'cert_user';
      // Generate 550 certificates
      const mockCerts: any[] = [];
      for (let i = 0; i < 550; i++) {
        mockCerts.push({
          id: `cert_${i}`,
          ownerId: userUid,
          issueDate: new Date(Date.now() - i * 1000).toISOString(),
        });
      }

      const adminAuth: any = {
        verifyIdToken: async () => ({ uid: userUid }),
      };

      let requestedLimit = 0;
      const makeQuery = () => ({
        limit: (fetchBound: number) => {
          requestedLimit = fetchBound;
          return {
            get: async () => ({ docs: mockCerts.slice(0, fetchBound).map(c => ({ data: () => c })) }),
          };
        },
        get: async () => ({ docs: mockCerts.map(c => ({ data: () => c })) }),
        orderBy: () => makeQuery(),
      });

      const adminDb: any = {
        runTransaction: async (fn: any) => fn(),
        collection: () => ({
          where: () => makeQuery(),
        }),
      };

      // Request offset 480, limit 50 (previously truncated at 501 bound)
      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: 'Bearer user_token' },
        {},
        {},
        { limit: 50, offset: 480 }
      );

      await handleListUserCertificates(req, res, { adminAuth, adminDb });
      expect(getStatus()).toBe(200);
      // Confirms fetchBound scaled beyond 501 to cover 480 + 50 + 1 = 531
      expect(requestedLimit).toBeGreaterThan(501);
      const data = getData();
      expect(data.certificates).toHaveLength(50);
      expect(data.pagination.hasMore).toBe(true);
    });
  });
});
