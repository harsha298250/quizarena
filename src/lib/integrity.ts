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

/**
 * Verifies the integrity of an entire chain of audit blocks
 */
export async function verifyAuditChain(chain: AuditBlock[]): Promise<{
  isValid: boolean;
  brokenIndex: number | null;
  message: string;
}> {
  if (chain.length === 0) {
    return { isValid: true, brokenIndex: null, message: 'Chain is empty (valid).' };
  }

  let expectedPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';

  for (let i = 0; i < chain.length; i++) {
    const block = chain[i];
    if (block.prevHash !== expectedPrevHash) {
      return {
        isValid: false,
        brokenIndex: i,
        message: `Broken link at block ${i}: expected prevHash ${expectedPrevHash.slice(0, 8)}... but found ${block.prevHash.slice(0, 8)}...`,
      };
    }

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
