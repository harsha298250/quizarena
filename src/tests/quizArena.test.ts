/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { calculateFairScore, evaluateAnswer } from '../lib/scoring';
import { createHashBlock, verifyAuditChain, AuditBlock } from '../lib/integrity';
import { sanitizeNickname } from '../lib/profanity';
import { runHardenedScoringTests } from './scoringHardening.test';

export async function runSelfTests(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      passed++;
      results.push(`✓ PASS: ${desc}`);
    } else {
      failed++;
      results.push(`✕ FAIL: ${desc}`);
    }
  }

  // 1. Scoring & Latency Compensation Test
  const scoreResult = calculateFairScore({
    basePoints: 1000,
    isCorrect: true,
    timeLimitSeconds: 20,
    rawResponseTimeMs: 4000,
    latencyMs: 150,
    clockOffsetMs: 0,
    currentStreak: 2,
    scoringProfile: 'speed_weighted',
  });
  assert(scoreResult.finalPoints > 0, 'Fair score calculates positive points on correct answer');
  assert(scoreResult.compensatedResponseTimeMs === 3850, 'Latency is accurately subtracted (4000ms - 150ms = 3850ms)');
  assert(scoreResult.newStreak === 3, 'Streak increments from 2 to 3');

  // 2. Incorrect Answer Zero Points
  const wrongResult = calculateFairScore({
    basePoints: 1000,
    isCorrect: false,
    timeLimitSeconds: 20,
    rawResponseTimeMs: 2000,
    latencyMs: 50,
    clockOffsetMs: 0,
    currentStreak: 5,
    scoringProfile: 'speed_weighted',
  });
  assert(wrongResult.finalPoints === 0, 'Incorrect answer produces 0 points');
  assert(wrongResult.newStreak === 0, 'Incorrect answer resets streak to 0');

  // 3. Answer Validation Tests
  assert(evaluateAnswer('multiple_choice', [1], [1]), 'Single choice matches correct option');
  assert(!evaluateAnswer('multiple_choice', [0], [1]), 'Single choice rejects incorrect option');
  assert(evaluateAnswer('multi_select', [0, 2], [0, 2]), 'Multi-select accepts exact set of indices');
  assert(!evaluateAnswer('multi_select', [0], [0, 2]), 'Multi-select rejects partial answer');
  assert(evaluateAnswer('type_answer', [], [], 'Canberra', ['canberra', 'canberra city']), 'Type answer matches case-insensitively');
  assert(evaluateAnswer('ordering', [0, 1, 2], [0, 1, 2]), 'Ordering matches strictly ascending sequence');

  // 4. SHA-256 Hash Chain Integrity Tests
  const genesisPrev = '0000000000000000000000000000000000000000000000000000000000000000';
  const block0 = await createHashBlock(genesisPrev, 0, 'player_1', 0, 950, 1000);
  const block1 = await createHashBlock(block0.hash, 1, 'player_2', 0, 890, 1200);
  const block2 = await createHashBlock(block1.hash, 2, 'player_1', 1, 1000, 2400);

  const validChain: AuditBlock[] = [block0, block1, block2];
  const chainCheck = await verifyAuditChain(validChain);
  assert(chainCheck.isValid, 'Cryptographic hash chain validates uncorrupted sequence');

  // Corrupt block 1 score
  const corruptedChain: AuditBlock[] = [
    block0,
    { ...block1, points: 999999 }, // tampered score
    block2,
  ];
  const tamperedCheck = await verifyAuditChain(corruptedChain);
  assert(!tamperedCheck.isValid, 'Hash chain detects tampered payload in block 1');

  // 5. Profanity & Nickname Sanitizer Test
  const cleanResult = sanitizeNickname('CoolOtter');
  assert(cleanResult.cleanName === 'CoolOtter' && !cleanResult.wasCensored, 'Safe nickname is preserved');

  const dirtyResult = sanitizeNickname('badshit123');
  assert(dirtyResult.wasCensored && dirtyResult.cleanName !== 'badshit123', 'Inappropriate nickname is auto-renamed');

  // 6. Hardened Scoring, Transactional & Anti-Cheat Unit Tests (Task 3)
  const hardeningTests = runHardenedScoringTests();
  passed += hardeningTests.passed;
  failed += hardeningTests.failed;
  results.push(...hardeningTests.results);

  return { passed, failed, results };
}
