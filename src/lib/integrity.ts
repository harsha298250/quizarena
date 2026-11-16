/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Cryptographic SHA-256 hash chaining and tamper-evident audit log

export async function computeSha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface AuditBlock {
  id: string;
  index: number;
  playerId: string;
  questionIndex: number;
  points: number;
  timestamp: number;
  prevHash: string;
  hash: string;
}

/**
 * Creates a cryptographically linked hash block
 */
export async function createHashBlock(
  prevHash: string,
  index: number,
  playerId: string,
  questionIndex: number,
  points: number,
  timestamp: number
): Promise<AuditBlock> {
  const payload = `${prevHash}|${index}|${playerId}|${questionIndex}|${points}|${timestamp}`;
  const hash = await computeSha256(payload);
  return {
    id: `block-${index}-${playerId}`,
    index,
    playerId,
    questionIndex,
    points,
    timestamp,
    prevHash,
    hash,
  };
}

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

const HASH_REGEX = /^[a-f0-9]{64}$/i;

function isValidHash(hash: unknown): boolean {
  return typeof hash === 'string' && HASH_REGEX.test(hash);
}

/**
 * Verifies the integrity of an entire chain of audit blocks.
 * Supports Genesis-based chains as well as player branch chains
 * starting from a non-Genesis initialPrevHash (e.g. historical game migration).
 */
export async function verifyAuditChain(
  chain: AuditBlock[],
  initialPrevHash = GENESIS_HASH
): Promise<{
  isValid: boolean;
  brokenIndex: number | null;
  message: string;
}> {
  if (chain.length === 0) {
    return { isValid: true, brokenIndex: null, message: 'Chain is empty (valid).' };
  }

  if (!isValidHash(initialPrevHash)) {
    return {
      isValid: false,
      brokenIndex: 0,
      message: `Invalid initialPrevHash: must be a 64-character hex string. Received: ${String(initialPrevHash)}`,
    };
  }

  let expectedPrevHash = initialPrevHash;
  const seenQuestionIndices = new Set<number>();
  let lastQuestionIndex = -1;

  for (let i = 0; i < chain.length; i++) {
    const block = chain[i];

    // Structural validation
    if (!block || typeof block !== 'object') {
      return {
        isValid: false,
        brokenIndex: i,
        message: `Invalid audit record at index ${i}: not an object.`,
      };
    }

    if (!isValidHash(block.hash)) {
      return {
        isValid: false,
        brokenIndex: i,
        message: `Malformed hash at block ${i}: expected 64-character hex, got '${block.hash}'`,
      };
    }

    if (!isValidHash(block.prevHash)) {
      return {
        isValid: false,
        brokenIndex: i,
        message: `Malformed prevHash at block ${i}: expected 64-character hex, got '${block.prevHash}'`,
      };
    }

    if (typeof block.points !== 'number' || isNaN(block.points) || block.points < 0) {
      return {
        isValid: false,
        brokenIndex: i,
        message: `Invalid points at block ${i}: expected non-negative number, got ${block.points}`,
      };
    }

    if (typeof block.timestamp !== 'number' || isNaN(block.timestamp) || block.timestamp <= 0) {
      return {
        isValid: false,
        brokenIndex: i,
        message: `Invalid timestamp at block ${i}: expected positive number, got ${block.timestamp}`,
      };
    }

    // Duplicate question index check within a single player's chain
    if (seenQuestionIndices.has(block.questionIndex)) {
      return {
        isValid: false,
        brokenIndex: i,
        message: `Duplicate question submission at block ${i}: questionIndex ${block.questionIndex} already submitted.`,
      };
    }
    seenQuestionIndices.add(block.questionIndex);

    // Monotonic question ordering check
    if (block.questionIndex < lastQuestionIndex) {
      return {
        isValid: false,
        brokenIndex: i,
        message: `Invalid question ordering at block ${i}: questionIndex ${block.questionIndex} comes after ${lastQuestionIndex}.`,
      };
    }
    lastQuestionIndex = block.questionIndex;

    // Cryptographic link check
    if (block.prevHash !== expectedPrevHash) {
      return {
        isValid: false,
        brokenIndex: i,
        message: `Broken link at block ${i}: expected prevHash ${expectedPrevHash.slice(0, 8)}... but found ${block.prevHash.slice(0, 8)}...`,
      };
    }

    // Payload integrity re-calculation
    const payload = `${block.prevHash}|${block.index}|${block.playerId}|${block.questionIndex}|${block.points}|${block.timestamp}`;
    const recalculated = await computeSha256(payload);

    if (recalculated !== block.hash) {
      return {
        isValid: false,
        brokenIndex: i,
        message: `Tampered payload at block ${i}: hash mismatch! Expected ${recalculated.slice(0, 8)}... found ${block.hash.slice(0, 8)}...`,
      };
    }

    expectedPrevHash = block.hash;
  }

  return { isValid: true, brokenIndex: null, message: `All ${chain.length} audit entries verified successfully.` };
}

export interface VerifyAllPlayerChainsOptions {
  initialPrevHashByPlayer?: Record<string, string>;
  defaultInitialPrevHash?: string;
  legacyTrunkChain?: AuditBlock[];
}

/**
 * Verifies multi-player audit records independently.
 * Groups records by playerId, sorts them deterministically,
 * verifies optional legacy trunk, and verifies each player branch.
 */
export async function verifyAllPlayerChains(
  answers: AuditBlock[],
  options: VerifyAllPlayerChainsOptions = {}
): Promise<{
  isValid: boolean;
  brokenPlayerId: string | null;
  message: string;
  trunkVerification?: { isValid: boolean; message: string };
  playerResults: Record<string, { isValid: boolean; message: string; brokenIndex: number | null }>;
}> {
  let trunkHeadHash: string | undefined = undefined;
  let trunkVerification: { isValid: boolean; message: string } | undefined = undefined;

  // 1. Verify legacy global trunk if present
  if (options.legacyTrunkChain && options.legacyTrunkChain.length > 0) {
    const trunkRes = await verifyAuditChain(options.legacyTrunkChain, GENESIS_HASH);
    trunkVerification = { isValid: trunkRes.isValid, message: trunkRes.message };
    if (!trunkRes.isValid) {
      return {
        isValid: false,
        brokenPlayerId: null,
        message: `Legacy global trunk verification failed: ${trunkRes.message}`,
        trunkVerification,
        playerResults: {},
      };
    }
    trunkHeadHash = options.legacyTrunkChain[options.legacyTrunkChain.length - 1].hash;
  }

  // 2. Group answers by playerId
  const playerGroups = new Map<string, AuditBlock[]>();
  for (let i = 0; i < answers.length; i++) {
    const record = answers[i];
    if (!record || typeof record !== 'object' || !record.playerId) {
      return {
        isValid: false,
        brokenPlayerId: null,
        message: `Invalid audit record at index ${i}: missing playerId.`,
        trunkVerification,
        playerResults: {},
      };
    }
    const list = playerGroups.get(record.playerId) || [];
    list.push(record);
    playerGroups.set(record.playerId, list);
  }

  // 3. Verify each player's chain independently
  const playerResults: Record<string, { isValid: boolean; message: string; brokenIndex: number | null }> = {};
  let overallValid = true;
  let firstBrokenPlayerId: string | null = null;
  let firstErrorMessage = '';

  for (const [pId, pRecords] of playerGroups.entries()) {
    // Deterministic sort: questionIndex ascending, then timestamp
    const sortedChain = [...pRecords].sort((a, b) => {
      const qDiff = a.questionIndex - b.questionIndex;
      if (qDiff !== 0) return qDiff;
      return a.timestamp - b.timestamp;
    });

    // Determine initial prevHash: player-specific override > trunk head > default > Genesis
    const initialHash =
      options.initialPrevHashByPlayer?.[pId] ||
      trunkHeadHash ||
      options.defaultInitialPrevHash ||
      GENESIS_HASH;

    const res = await verifyAuditChain(sortedChain, initialHash);
    playerResults[pId] = res;

    if (!res.isValid && overallValid) {
      overallValid = false;
      firstBrokenPlayerId = pId;
      firstErrorMessage = `Player ${pId} audit chain broken: ${res.message}`;
    }
  }

  return {
    isValid: overallValid,
    brokenPlayerId: firstBrokenPlayerId,
    message: overallValid
      ? `Successfully verified audit chains for ${playerGroups.size} player(s).`
      : firstErrorMessage,
    trunkVerification,
    playerResults,
  };
}

/**
 * Lightweight browser device fingerprinting
 */
export function getDeviceFingerprint(): string {
  if (typeof window === 'undefined') return 'server';
  const nav = window.navigator;
  const screen = window.screen;
  const raw = `${nav.userAgent}|${screen.width}x${screen.height}|${nav.language}|${screen.colorDepth}`;
  // Simple non-cryptographic hash for quick identification
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `fp_${Math.abs(hash).toString(16)}`;
}
