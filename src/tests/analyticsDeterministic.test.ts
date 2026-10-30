/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert';
import { computeGameAnalytics } from '../services/analyticsService.ts';
import { Question, Player, AnswerSubmission } from '../types/quiz.ts';

console.log('🧪 Running Phase 3 Deterministic Analytics Test Suite...\n');

const mockQuestions: Question[] = [
  {
    id: 'q1',
    text: 'What is ACID in database systems?',
    type: 'multiple_choice',
    options: ['Atomicity, Consistency, Isolation, Durability', 'Access, Control, Identification, Data', 'Asynchronous, Concurrent, Indexed, Distributed', 'None of the above'],
    correctAnswers: [0],
    points: 1000,
    timeLimit: 20,
    bloomLevel: 'remember',
    courseOutcomeTag: 'CO1',
    topicTag: 'Databases',
    explanation: 'ACID stands for Atomicity, Consistency, Isolation, Durability.',
  },
  {
    id: 'q2',
    text: 'How does Raft consensus elect a leader?',
    type: 'multiple_choice',
    options: ['Random timeout & heartbeat majority', 'Highest IP address', 'Proof of Work', 'Round Robin'],
    correctAnswers: [0],
    points: 1000,
    timeLimit: 30,
    bloomLevel: 'analyze',
    courseOutcomeTag: 'CO2',
    topicTag: 'Distributed Systems',
    explanation: 'Raft uses randomized election timeouts and heartbeat majorities.',
  },
  {
    id: 'q3',
    text: 'Which data structure offers O(1) amortized lookup?',
    type: 'multiple_choice',
    options: ['Hash Map', 'Red-Black Tree', 'Linked List', 'B-Tree'],
    correctAnswers: [0],
    points: 1000,
    timeLimit: 15,
    bloomLevel: 'understand',
    courseOutcomeTag: 'CO1',
    topicTag: 'Data Structures',
    explanation: 'Hash maps provide O(1) amortized lookup on average.',
  },
];

const mockPlayers: Player[] = [
  { id: 'p_top1', nickname: 'Top Alice', score: 3000, streak: 3, maxStreak: 3, correctCount: 3, avatar: 'fox', latencyMs: 20, clockOffsetMs: 0, integrityScore: 100, powerUps: { fiftyFiftyUsed: false, doublePointsUsed: false, timeFreezeUsed: false }, accommodations: { extraTimeMultiplier: 1, fewerOptions: false, muteSound: false, dyslexiaFont: false, largeText: false, readAloud: false }, joinedAt: '', lastSeen: '' },
  { id: 'p_top2', nickname: 'Top Bob', score: 2800, streak: 3, maxStreak: 3, correctCount: 3, avatar: 'owl', latencyMs: 25, clockOffsetMs: 0, integrityScore: 100, powerUps: { fiftyFiftyUsed: false, doublePointsUsed: false, timeFreezeUsed: false }, accommodations: { extraTimeMultiplier: 1, fewerOptions: false, muteSound: false, dyslexiaFont: false, largeText: false, readAloud: false }, joinedAt: '', lastSeen: '' },
  { id: 'p_mid', nickname: 'Mid Charlie', score: 1800, streak: 1, maxStreak: 1, correctCount: 2, avatar: 'tiger', latencyMs: 30, clockOffsetMs: 0, integrityScore: 100, powerUps: { fiftyFiftyUsed: false, doublePointsUsed: false, timeFreezeUsed: false }, accommodations: { extraTimeMultiplier: 1, fewerOptions: false, muteSound: false, dyslexiaFont: false, largeText: false, readAloud: false }, joinedAt: '', lastSeen: '' },
  { id: 'p_low1', nickname: 'Low David', score: 500, streak: 0, maxStreak: 0, correctCount: 0, avatar: 'bear', latencyMs: 50, clockOffsetMs: 0, integrityScore: 100, powerUps: { fiftyFiftyUsed: false, doublePointsUsed: false, timeFreezeUsed: false }, accommodations: { extraTimeMultiplier: 1, fewerOptions: false, muteSound: false, dyslexiaFont: false, largeText: false, readAloud: false }, joinedAt: '', lastSeen: '' },
  { id: 'p_low2', nickname: 'Low Eve', score: 200, streak: 0, maxStreak: 0, correctCount: 0, avatar: 'robot', latencyMs: 60, clockOffsetMs: 0, integrityScore: 100, powerUps: { fiftyFiftyUsed: false, doublePointsUsed: false, timeFreezeUsed: false }, accommodations: { extraTimeMultiplier: 1, fewerOptions: false, muteSound: false, dyslexiaFont: false, largeText: false, readAloud: false }, joinedAt: '', lastSeen: '' },
];

const mockAnswers: AnswerSubmission[] = [
  // Q0 (ACID): Alice correct (0), Bob correct (0), Charlie correct (0), David wrong (1), Eve wrong (1)
  { id: 'a1', playerId: 'p_top1', playerNickname: 'Top Alice', questionIndex: 0, selectedIndices: [0], isCorrect: true, responseTimeMs: 4000, pointsAwarded: 950, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },
  { id: 'a2', playerId: 'p_top2', playerNickname: 'Top Bob', questionIndex: 0, selectedIndices: [0], isCorrect: true, responseTimeMs: 5000, pointsAwarded: 920, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },
  { id: 'a3', playerId: 'p_mid', playerNickname: 'Mid Charlie', questionIndex: 0, selectedIndices: [0], isCorrect: true, responseTimeMs: 8000, pointsAwarded: 800, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },
  { id: 'a4', playerId: 'p_low1', playerNickname: 'Low David', questionIndex: 0, selectedIndices: [1], isCorrect: false, responseTimeMs: 12000, pointsAwarded: 0, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },
  { id: 'a5', playerId: 'p_low2', playerNickname: 'Low Eve', questionIndex: 0, selectedIndices: [1], isCorrect: false, responseTimeMs: 15000, pointsAwarded: 0, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },

  // Q1 (Raft): Alice correct (0), Bob correct (0), Charlie wrong (3), David wrong (2), Eve wrong (3)
  { id: 'a6', playerId: 'p_top1', playerNickname: 'Top Alice', questionIndex: 1, selectedIndices: [0], isCorrect: true, responseTimeMs: 6000, pointsAwarded: 900, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },
  { id: 'a7', playerId: 'p_top2', playerNickname: 'Top Bob', questionIndex: 1, selectedIndices: [0], isCorrect: true, responseTimeMs: 7000, pointsAwarded: 880, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },
  { id: 'a8', playerId: 'p_mid', playerNickname: 'Mid Charlie', questionIndex: 1, selectedIndices: [3], isCorrect: false, responseTimeMs: 14000, pointsAwarded: 0, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },
  { id: 'a9', playerId: 'p_low1', playerNickname: 'Low David', questionIndex: 1, selectedIndices: [2], isCorrect: false, responseTimeMs: 16000, pointsAwarded: 0, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },
  { id: 'a10', playerId: 'p_low2', playerNickname: 'Low Eve', questionIndex: 1, selectedIndices: [3], isCorrect: false, responseTimeMs: 18000, pointsAwarded: 0, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },

  // Q2 (Hash Map): Everyone correct
  { id: 'a11', playerId: 'p_top1', playerNickname: 'Top Alice', questionIndex: 2, selectedIndices: [0], isCorrect: true, responseTimeMs: 3000, pointsAwarded: 980, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },
  { id: 'a12', playerId: 'p_top2', playerNickname: 'Top Bob', questionIndex: 2, selectedIndices: [0], isCorrect: true, responseTimeMs: 3500, pointsAwarded: 960, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },
  { id: 'a13', playerId: 'p_mid', playerNickname: 'Mid Charlie', questionIndex: 2, selectedIndices: [0], isCorrect: true, responseTimeMs: 4000, pointsAwarded: 940, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },
  { id: 'a14', playerId: 'p_low1', playerNickname: 'Low David', questionIndex: 2, selectedIndices: [0], isCorrect: true, responseTimeMs: 6000, pointsAwarded: 850, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },
  { id: 'a15', playerId: 'p_low2', playerNickname: 'Low Eve', questionIndex: 2, selectedIndices: [0], isCorrect: true, responseTimeMs: 7000, pointsAwarded: 800, clientTimestamp: 0, serverTimestamp: 0, prevHash: '', hash: '' },
];

function runTests() {
  console.log('1. Determinism verification: Two sequential runs on identical data must match bit-for-bit');
  const metadata = { gameId: 'test_game', quizTitle: 'Fixed Quiz', finishedAt: '2026-10-30T00:00:00.000Z' };
  const runA = computeGameAnalytics(mockQuestions, mockPlayers, mockAnswers, 60, metadata);
  const runB = computeGameAnalytics(mockQuestions, mockPlayers, mockAnswers, 60, metadata);
  assert.deepStrictEqual(runA, runB, 'Analytics computation MUST be completely deterministic without Math.random');
  console.log('  ✓ Run A and Run B match 100%');

  console.log('\n2. Question accuracy & average response time calculations');
  // Q0: 3 correct out of 5 = 60%
  assert.strictEqual(runA.questionStats[0].accuracy, 60);
  // Q0 avg time: (4 + 5 + 8 + 12 + 15) / 5 = 44 / 5 = 8.8s
  assert.strictEqual(runA.questionStats[0].avgTimeSec, 8.8);
  // Q1: 2 correct out of 5 = 40%
  assert.strictEqual(runA.questionStats[1].accuracy, 40);
  // Q2: 5 correct out of 5 = 100%
  assert.strictEqual(runA.questionStats[2].accuracy, 100);
  console.log('  ✓ Per-question accuracy and avg time match exact mathematical formulas');

  console.log('\n3. Option distribution and most-chosen wrong distractor');
  // Q0: option 0 chosen 3 times, option 1 chosen 2 times
  assert.strictEqual(runA.questionStats[0].optionDistribution[0], 3);
  assert.strictEqual(runA.questionStats[0].optionDistribution[1], 2);
  assert.strictEqual(runA.questionStats[0].mostChosenWrongOption?.optionIndex, 1);
  assert.strictEqual(runA.questionStats[0].mostChosenWrongOption?.count, 2);
  assert.strictEqual(runA.questionStats[0].mostChosenWrongOption?.percentage, 40);

  // Q1: option 3 chosen 2 times (by mid and low2), option 2 chosen 1 time
  assert.strictEqual(runA.questionStats[1].mostChosenWrongOption?.optionIndex, 3);
  assert.strictEqual(runA.questionStats[1].mostChosenWrongOption?.count, 2);
  console.log('  ✓ Option distribution and most-chosen wrong option accurately identified');

  console.log('\n4. Psychometric Discrimination Index (D)');
  // Top tier (Alice & Bob, 2 players): Q0 both correct (1.0). Lower tier (David & Eve, 2 players): Q0 both wrong (0.0).
  // D = 1.0 - 0.0 = +1.0
  assert.strictEqual(runA.questionStats[0].discriminationIndex, 1.0);
  // Q1: Top tier both correct (1.0). Lower tier both wrong (0.0). D = +1.0
  assert.strictEqual(runA.questionStats[1].discriminationIndex, 1.0);
  // Q2: Top tier both correct (1.0). Lower tier both correct (1.0). D = 1.0 - 1.0 = 0.0
  assert.strictEqual(runA.questionStats[2].discriminationIndex, 0.0);
  console.log('  ✓ Discrimination Index (D) mathematically verified on upper/lower score cohorts');

  console.log('\n5. Hardest questions ranked by lowest accuracy');
  // Order should be: Q1 (40%), Q0 (60%), Q2 (100%)
  assert.strictEqual(runA.hardestQuestions[0].questionIndex, 1);
  assert.strictEqual(runA.hardestQuestions[1].questionIndex, 0);
  assert.strictEqual(runA.hardestQuestions[2].questionIndex, 2);
  console.log('  ✓ Hardest questions correctly ordered: Q2 (40%) -> Q1 (60%) -> Q3 (100%)');

  console.log('\n6. Course Outcome (CO) Attainment vs 60% threshold');
  // CO1 has Q0 (3/5) and Q2 (5/5) -> total attempts = 10, correct = 8 -> 80% >= 60% -> Attained
  const co1 = runA.coStats.find(c => c.coTag === 'CO1');
  assert.ok(co1);
  assert.strictEqual(co1.accuracyRate, 0.8);
  assert.strictEqual(co1.isAttained, true);

  // CO2 has Q1 (2/5) -> total attempts = 5, correct = 2 -> 40% < 60% -> NOT Attained
  const co2 = runA.coStats.find(c => c.coTag === 'CO2');
  assert.ok(co2);
  assert.strictEqual(co2.accuracyRate, 0.4);
  assert.strictEqual(co2.isAttained, false);
  console.log('  ✓ Course Outcome thresholds accurately evaluated (CO1 Attained, CO2 Gaps Detected)');

  console.log('\n7. Empty data handling');
  const emptyRun = computeGameAnalytics(mockQuestions, [], []);
  assert.strictEqual(emptyRun.totalPlayers, 0);
  assert.strictEqual(emptyRun.overallAccuracy, 0);
  assert.strictEqual(emptyRun.averageScore, 0);
  assert.strictEqual(emptyRun.questionStats[0].accuracy, 0);
  assert.strictEqual(emptyRun.questionStats[0].discriminationIndex, 0);
  console.log('  ✓ Empty answers handled safely with zero runtime errors');

  console.log('\n========================================');
  console.log('✅ ALL PHASE 3 DETERMINISTIC ANALYTICS TESTS PASSED!');
  console.log('========================================\n');
}

runTests();
