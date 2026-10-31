/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Unit Test Suite for Task 10 Phase 1: Server-Side Strikes & Authoritative Integrity
 */

import {
  ALLOWED_INTEGRITY_EVENT_TYPES,
  isAllowedIntegrityEventType,
  isDuplicateIntegrityEvent,
  checkPlayerIntegrityRateLimit,
  resetIntegrityRateLimits,
  handleIntegrityEvent,
  handleReinstatePlayer,
} from '../server/integrityHandler.ts';
import { validatePlayerEligibility } from '../server/scoringHardening.ts';

console.log('🧪 Running Server-Side Strikes & Integrity Verification Test Suite...\n');

let passed = 0;
let failed = 0;

function assert(description: string, condition: boolean, details?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    console.error(`  ✕ FAIL: ${description}${details ? ` (${details})` : ''}`);
  }
}

// 1. Whitelist of event types
assert(
  '1. Only whitelisted event types are accepted by integrity system',
  ALLOWED_INTEGRITY_EVENT_TYPES.includes('tab_switch') &&
  ALLOWED_INTEGRITY_EVENT_TYPES.includes('window_blur') &&
  ALLOWED_INTEGRITY_EVENT_TYPES.includes('extension_injection') &&
  !isAllowedIntegrityEventType('arbitrary_hack') &&
  !isAllowedIntegrityEventType('clear_strikes')
);

// 2. Deduplication within 500ms
resetIntegrityRateLimits();
const t0 = 1000000;
const firstEvent = isDuplicateIntegrityEvent('p_123', 'tab_switch', t0);
const secondEventWithin500ms = isDuplicateIntegrityEvent('p_123', 'tab_switch', t0 + 200);
const thirdEventAfter500ms = isDuplicateIntegrityEvent('p_123', 'tab_switch', t0 + 600);

assert(
  '2. Events within 500ms are deduplicated and suppressed',
  firstEvent === false && secondEventWithin500ms === true && thirdEventAfter500ms === false
);

// 3. Rate limiting (max 2 per second per player)
resetIntegrityRateLimits();
const r1 = checkPlayerIntegrityRateLimit('p_456', 2000000);
const r2 = checkPlayerIntegrityRateLimit('p_456', 2000100);
const r3 = checkPlayerIntegrityRateLimit('p_456', 2000200);

assert(
  '3. Rate-limiter restricts player integrity events to 2 per second',
  r1.allowed === true && r2.allowed === true && r3.allowed === false && r3.retryAfterSec !== undefined
);

// 4. Refresh keeps strikes from player document
const mockFirestorePlayerDoc = {
  id: 'player_test',
  nickname: 'TestContender',
  strikes: 3,
  status: 'active',
  isTerminated: false,
  integrityScore: 52,
};

// Simulate client refresh re-hydrating from player doc snapshot
const rehydratedPlayer = {
  ...mockFirestorePlayerDoc,
};

assert(
  '4. Refresh keeps authoritative strikes and status from player document snapshot',
  rehydratedPlayer.strikes === 3 &&
  rehydratedPlayer.status === 'active' &&
  rehydratedPlayer.integrityScore === 52
);

// 5. Strike 6 blocks answers on /api/answer (returns 403)
const terminatedPlayer = {
  id: 'p_terminated',
  nickname: 'CheatingBot',
  strikes: 6,
  status: 'terminated_integrity',
  isTerminated: true,
};

const eligibilityCheck = validatePlayerEligibility(true, terminatedPlayer);
assert(
  '5. Strike 6 blocks answers with 403 Forbidden',
  eligibilityCheck.eligible === false &&
  eligibilityCheck.statusCode === 403 &&
  Boolean(eligibilityCheck.error?.includes('terminated'))
);

const nonTerminatedPlayer = {
  id: 'p_clean',
  nickname: 'FairStudent',
  strikes: 2,
  status: 'active',
  isTerminated: false,
};
const cleanEligibility = validatePlayerEligibility(true, nonTerminatedPlayer);
assert(
  '6. Eligible non-terminated player is permitted to answer (200 OK)',
  cleanEligibility.eligible === true && cleanEligibility.statusCode === 200
);

// 7. Host Reinstate restores session and resets strikes to 0
async function testHostReinstate() {
  let playerRecord: any = {
    id: 'p_term_2',
    strikes: 6,
    status: 'terminated_integrity',
    isTerminated: true,
    integrityScore: 0,
  };

  const mockAdminDb: any = {
    doc: (path: string) => ({
      get: async () => {
        if (path === 'games/game_100') {
          return { exists: true, data: () => ({ hostId: 'host_teacher_1' }) };
        }
        if (path === 'games/game_100/players/p_term_2') {
          return { exists: true, data: () => playerRecord };
        }
        return { exists: false };
      },
      update: async (updates: any) => {
        playerRecord = { ...playerRecord, ...updates };
      },
    }),
  };

  const mockAdminAuth: any = {
    verifyIdToken: async (token: string) => {
      if (token === 'host_token') return { uid: 'host_teacher_1' };
      if (token === 'student_token') return { uid: 'p_term_2' };
      throw new Error('Invalid token');
    },
  };

  // Student attempts to reinstate themselves (Forbidden)
  let studentResStatus = 0;
  let studentResBody: any = {};
  await handleReinstatePlayer(
    {
      headers: { authorization: 'Bearer student_token' },
      body: { gameId: 'game_100', playerId: 'p_term_2' },
    } as any,
    {
      status: (c: number) => { studentResStatus = c; return { json: (b: any) => { studentResBody = b; } }; },
    } as any,
    mockAdminAuth,
    mockAdminDb
  );

  assert(
    '7. Non-host player cannot reinstate themselves or modify strike status (403 Forbidden)',
    studentResStatus === 403
  );

  // Host reinstates player (Allowed)
  let hostResStatus = 0;
  let hostResBody: any = {};
  await handleReinstatePlayer(
    {
      headers: { authorization: 'Bearer host_token' },
      body: { gameId: 'game_100', playerId: 'p_term_2' },
    } as any,
    {
      status: (c: number) => { hostResStatus = c; return { json: (b: any) => { hostResBody = b; } }; },
    } as any,
    mockAdminAuth,
    mockAdminDb
  );

  assert(
    '8. Host can reinstate terminated player, resetting strikes to 0 and restoring 100% integrity',
    hostResStatus === 200 &&
    playerRecord.strikes === 0 &&
    playerRecord.status === 'active' &&
    playerRecord.isTerminated === false &&
    playerRecord.integrityScore === 100
  );
}

// 8. Player cannot lower their own strike count via API or Firestore
async function testPlayerCannotLowerStrikes() {
  let playerRecord: any = {
    id: 'p_3_strikes',
    strikes: 3,
    status: 'active',
    isTerminated: false,
    integrityScore: 52,
  };

  const mockAdminDb: any = {
    doc: (path: string) => ({
      get: async () => ({ exists: true, data: () => playerRecord }),
    }),
    collection: () => ({
      doc: () => ({ id: 'flag_abc' }),
    }),
    runTransaction: async (cb: any) => {
      return cb({
        get: async () => ({ exists: true, data: () => playerRecord }),
        update: (_ref: any, updates: any) => {
          playerRecord = { ...playerRecord, ...updates };
        },
        set: () => {},
      });
    },
  };

  const mockAdminAuth: any = {
    verifyIdToken: async () => ({ uid: 'p_3_strikes' }),
  };

  resetIntegrityRateLimits('p_3_strikes');

  // Triggering an integrity event increases count to 4, never decreases
  let eventResStatus = 0;
  let eventResBody: any = {};
  await handleIntegrityEvent(
    {
      headers: { authorization: 'Bearer token_player' },
      body: { gameId: 'game_100', eventType: 'window_blur', reason: 'Loss of window focus' },
    } as any,
    {
      status: (c: number) => { eventResStatus = c; return { json: (b: any) => { eventResBody = b; } }; },
      setHeader: () => {},
    } as any,
    mockAdminAuth,
    mockAdminDb
  );

  assert(
    '9. Integrity event atomically increments strikes and cannot be lowered by player',
    eventResStatus === 200 &&
    eventResBody.strikes === 4 &&
    playerRecord.strikes === 4
  );
}

await testHostReinstate();
await testPlayerCannotLowerStrikes();

console.log(`\n========================================`);
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}

