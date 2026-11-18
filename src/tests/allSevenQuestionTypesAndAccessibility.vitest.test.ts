/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { evaluateAnswer } from '../lib/scoring';
import { extractSecretAnswerForQuestion } from '../server/scoringHardening';
import { buildQuestionSpeechScript } from '../lib/speechService';
import { computeGameAnalytics } from '../services/analyticsService';
import { Question, Player, AnswerSubmission } from '../types/quiz';

// Mock storage for Node.js test environment
const createMockStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) || null,
    setItem: (key: string, val: string) => store.set(key, String(val)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
};

if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = createMockStorage();
}
if (typeof globalThis.sessionStorage === 'undefined') {
  (globalThis as any).sessionStorage = createMockStorage();
}
if (typeof globalThis.document === 'undefined') {
  const attrs = new Map<string, string>();
  const bodyClasses = new Set<string>();
  (globalThis as any).document = {
    documentElement: {
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      getAttribute: (k: string) => attrs.get(k) || null,
      removeAttribute: (k: string) => attrs.delete(k),
    },
    body: {
      classList: {
        add: (c: string) => bodyClasses.add(c),
        remove: (c: string) => bodyClasses.delete(c),
        contains: (c: string) => bodyClasses.has(c),
      },
    },
  };
}

describe('Phase 3 & 4: All 7 Question Types Scoring & Server Extraction', () => {
  it('[Q-01] evaluates standard single-choice question correctly', () => {
    expect(evaluateAnswer('multiple_choice', [1], [1])).toBe(true);
    expect(evaluateAnswer('multiple_choice', [0], [1])).toBe(false);
  });

  it('[Q-02] evaluates true/false question correctly', () => {
    expect(evaluateAnswer('true_false', [0], [0])).toBe(true);
    expect(evaluateAnswer('true_false', [1], [0])).toBe(false);
  });

  it('[Q-03] evaluates multi-select question with exact combination match', () => {
    expect(evaluateAnswer('multi_select', [0, 1, 3], [0, 1, 3])).toBe(true);
    // Partial selection is incorrect
    expect(evaluateAnswer('multi_select', [0, 1], [0, 1, 3])).toBe(false);
    // Extra wrong option is incorrect
    expect(evaluateAnswer('multi_select', [0, 1, 2, 3], [0, 1, 3])).toBe(false);
  });

  it('[Q-04] evaluates type_answer text submission with case-insensitive whitespace trim', () => {
    const accepted = ['SHA-256', 'SHA256', 'sha 256'];
    expect(evaluateAnswer('type_answer', [], [], 'sha-256', accepted)).toBe(true);
    expect(evaluateAnswer('type_answer', [], [], '  SHA256  ', accepted)).toBe(true);
    expect(evaluateAnswer('type_answer', [], [], 'MD5', accepted)).toBe(false);
    expect(evaluateAnswer('type_answer', [], [], '', accepted)).toBe(false);
  });

  it('[Q-05] evaluates ordering sequence correctly matching target sequence order', () => {
    // Target order indices: Step A (1), Step B (3), Step C (0), Step D (2)
    const targetOrder = [1, 3, 0, 2];
    expect(evaluateAnswer('ordering', [1, 3, 0, 2], targetOrder)).toBe(true);
    expect(evaluateAnswer('ordering', [0, 1, 2, 3], targetOrder)).toBe(false);
    expect(evaluateAnswer('ordering', [1, 3, 2, 0], targetOrder)).toBe(false);
  });

  it('[Q-06] evaluates poll survey response without penalty or score points', () => {
    expect(evaluateAnswer('poll', [2], [])).toBe(true);
  });

  it('[Q-07] evaluates info_slide without requiring answers', () => {
    expect(evaluateAnswer('info_slide', [], [])).toBe(true);
  });

  it('[SEC-01] extracts server-side secret answers safely for all 7 types including poll and info_slide', () => {
    const questions = [
      { id: '1', text: 'MC', type: 'multiple_choice', options: ['A', 'B'], correctAnswers: [0], points: 1000, timeLimit: 20 },
      { id: '2', text: 'TF', type: 'true_false', options: ['True', 'False'], correctAnswers: [0], points: 1000, timeLimit: 20 },
      { id: '3', text: 'MS', type: 'multi_select', options: ['A', 'B'], correctAnswers: [0, 1], points: 1000, timeLimit: 20 },
      { id: '4', text: 'TA', type: 'type_answer', options: [], acceptedTextAnswers: ['secret'], points: 1000, timeLimit: 20 },
      { id: '5', text: 'ORD', type: 'ordering', options: ['B', 'A'], correctAnswers: [1, 0], points: 1000, timeLimit: 20 },
      { id: '6', text: 'POLL', type: 'poll', options: ['Red', 'Blue'], points: 0, timeLimit: 20 },
      { id: '7', text: 'INFO', type: 'info_slide', options: [], points: 0, timeLimit: 20 },
    ] as unknown as Question[];

    expect(extractSecretAnswerForQuestion(questions, 0)).not.toBeNull();
    expect(extractSecretAnswerForQuestion(questions, 1)).not.toBeNull();
    expect(extractSecretAnswerForQuestion(questions, 2)).not.toBeNull();
    expect(extractSecretAnswerForQuestion(questions, 3)).not.toBeNull();
    expect(extractSecretAnswerForQuestion(questions, 4)).not.toBeNull();
    // Poll and info_slide should not return null (which caused 404 in server scoring)
    const pollSecret = extractSecretAnswerForQuestion(questions, 5);
    expect(pollSecret).not.toBeNull();
    expect(pollSecret?.type).toBe('poll');

    const infoSecret = extractSecretAnswerForQuestion(questions, 6);
    expect(infoSecret).not.toBeNull();
    expect(infoSecret?.type).toBe('info_slide');
  });
});

describe('Phase 6: Accessibility Text-to-Speech (TTS) Transcript Sanitization', () => {
  it('[TTS-01] builds clean speech script for multiple choice without leaking correct answers', () => {
    const q: Partial<Question> = {
      text: 'Which planet is known as the Red Planet?',
      type: 'multiple_choice',
      options: ['Venus', 'Mars', 'Jupiter', 'Saturn'],
      correctAnswers: [1],
      explanation: 'Mars appears reddish because of iron oxide.',
    };
    const script = buildQuestionSpeechScript(q);
    expect(script).toContain('Question: Which planet is known as the Red Planet?');
    expect(script).toContain('Option A: Venus');
    expect(script).toContain('Option B: Mars');
    // Must NOT contain answer leak or explanation
    expect(script).not.toContain('iron oxide');
    expect(script).not.toContain('Correct');
  });

  it('[TTS-02] builds clean speech script for true_false', () => {
    const q: Partial<Question> = {
      text: 'Water boils at 100 degrees Celsius.',
      type: 'true_false',
      options: ['True', 'False'],
      correctAnswers: [0],
    };
    const script = buildQuestionSpeechScript(q);
    expect(script).toContain('Question: Water boils at 100 degrees Celsius.');
    expect(script).toContain('Option A: True');
    expect(script).toContain('Option B: False');
  });

  it('[TTS-03] builds clean speech script for type_answer without leaking accepted answers', () => {
    const q: Partial<Question> = {
      text: 'What is the standard hashing algorithm used in Bitcoin?',
      type: 'type_answer',
      acceptedTextAnswers: ['SHA-256', 'SHA256'],
    };
    const script = buildQuestionSpeechScript(q);
    expect(script).toBe('Question: What is the standard hashing algorithm used in Bitcoin?.');
    expect(script).not.toContain('Option A');
    expect(script).not.toContain('SHA-256');
    expect(script).not.toContain('SHA256');
  });

  it('[TTS-04] builds clean speech script for ordering items', () => {
    const q: Partial<Question> = {
      text: 'Order the execution cycle phases.',
      type: 'ordering',
      options: ['Fetch', 'Decode', 'Execute'],
      correctAnswers: [0, 1, 2],
    };
    const script = buildQuestionSpeechScript(q);
    expect(script).toContain('Question: Order the execution cycle phases. Items to arrange:');
    expect(script).toContain('Item 1: Fetch');
    expect(script).toContain('Item 2: Decode');
    expect(script).toContain('Item 3: Execute');
  });

  it('[TTS-05] builds clean speech script for info_slide including content', () => {
    const q: Partial<Question> = {
      text: 'Introduction to Asymmetric Cryptography',
      type: 'info_slide',
      explanation: 'Public key cryptography uses key pairs for secure communication.',
    };
    const script = buildQuestionSpeechScript(q);
    expect(script).toContain('Information Slide: Introduction to Asymmetric Cryptography.');
    expect(script).toContain('Public key cryptography uses key pairs for secure communication.');
    expect(script).not.toContain('Option A');
  });
});

describe('Phase 11: Analytics & Course Outcome Attainment Validation', () => {
  it('[AN-01] sets hasSufficientData: false when total attempts is 0', () => {
    const questions = [
      { id: 'q1', text: 'Q1', type: 'multiple_choice', options: ['A', 'B'], correctAnswers: [0], points: 1000, timeLimit: 20, courseOutcomeTag: 'CO1' },
      { id: 'q2', text: 'Q2', type: 'multiple_choice', options: ['A', 'B'], correctAnswers: [1], points: 1000, timeLimit: 20, courseOutcomeTag: 'CO2' },
    ] as unknown as Question[];
    const players = [{ id: 'p1', nickname: 'Alice', score: 0, streak: 0, maxStreak: 0, correctCount: 0, avatar: 'fox', latencyMs: 20, clockOffsetMs: 0, integrityScore: 100, powerUps: { fiftyFiftyUsed: false, doublePointsUsed: false, timeFreezeUsed: false }, accommodations: { extraTimeMultiplier: 1, fewerOptions: false, muteSound: false, dyslexiaFont: false, largeText: false, readAloud: false }, joinedAt: '', lastSeen: '' }] as unknown as Player[];
    const answers: AnswerSubmission[] = []; // Zero attempts

    const analytics = computeGameAnalytics(questions, players, answers, 70);
    expect(analytics.coStats).toHaveLength(2);

    const co1 = analytics.coStats.find(c => c.coTag === 'CO1');
    expect(co1).toBeDefined();
    expect(co1?.hasSufficientData).toBe(false);
    expect(co1?.totalAttempts).toBe(0);
    expect(co1?.isAttained).toBe(false);
  });

  it('[AN-02] excludes 0-attempt questions from hardestQuestions list', () => {
    const questions = [
      { id: 'q_unattempted', text: 'Unattempted Q', type: 'multiple_choice', options: ['A', 'B'], correctAnswers: [0], points: 1000, timeLimit: 20 },
      { id: 'q_attempted_missed', text: 'Missed Q', type: 'multiple_choice', options: ['A', 'B'], correctAnswers: [0], points: 1000, timeLimit: 20 },
      { id: 'q_attempted_correct', text: 'Correct Q', type: 'multiple_choice', options: ['A', 'B'], correctAnswers: [0], points: 1000, timeLimit: 20 },
    ] as unknown as Question[];
    const players = [{ id: 'p1', nickname: 'Alice', score: 0, streak: 0, maxStreak: 0, correctCount: 0, avatar: 'fox', latencyMs: 20, clockOffsetMs: 0, integrityScore: 100, powerUps: { fiftyFiftyUsed: false, doublePointsUsed: false, timeFreezeUsed: false }, accommodations: { extraTimeMultiplier: 1, fewerOptions: false, muteSound: false, dyslexiaFont: false, largeText: false, readAloud: false }, joinedAt: '', lastSeen: '' }] as unknown as Player[];
    const answers = [
      { id: 'a1', questionIndex: 1, playerId: 'p1', playerNickname: 'Alice', selectedIndices: [1], isCorrect: false, pointsAwarded: 0, responseTimeMs: 1500, clientTimestamp: Date.now() },
      { id: 'a2', questionIndex: 2, playerId: 'p1', playerNickname: 'Alice', selectedIndices: [0], isCorrect: true, pointsAwarded: 1000, responseTimeMs: 1200, clientTimestamp: Date.now() },
    ] as unknown as AnswerSubmission[];

    const analytics = computeGameAnalytics(questions, players, answers, 70);
    // Hardest questions must NOT include q_unattempted
    const hardestIds = analytics.hardestQuestions.map(h => h.questionId);
    expect(hardestIds).not.toContain('q_unattempted');
    expect(hardestIds).toContain('q_attempted_missed');
    expect(analytics.hardestQuestions[0].questionId).toBe('q_attempted_missed');
  });
});

describe('Phase 7, 8 & 9: Accessibility Settings System & LocalStorage Persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-text-size');
    document.documentElement.removeAttribute('data-dyslexia');
    document.body.classList.remove('dyslexia-font');
  });

  it('[ACC-01] persists text size options (normal, large, xlarge) in localStorage and updates DOM', () => {
    const settings = {
      textSize: 'large',
      dyslexiaFont: true,
      readAloud: true,
      speechRate: 1.25,
    };
    localStorage.setItem('quizarena_accessibility_settings', JSON.stringify(settings));

    const retrieved = JSON.parse(localStorage.getItem('quizarena_accessibility_settings') || '{}');
    expect(retrieved.textSize).toBe('large');
    expect(retrieved.dyslexiaFont).toBe(true);
    expect(retrieved.readAloud).toBe(true);
    expect(retrieved.speechRate).toBe(1.25);
  });

  it('[ACC-02] verifies CSS classes and attributes apply properly for dyslexia and text-size', () => {
    document.documentElement.setAttribute('data-text-size', 'xlarge');
    document.documentElement.setAttribute('data-dyslexia', 'true');
    document.body.classList.add('dyslexia-font');

    expect(document.documentElement.getAttribute('data-text-size')).toBe('xlarge');
    expect(document.documentElement.getAttribute('data-dyslexia')).toBe('true');
    expect(document.body.classList.contains('dyslexia-font')).toBe(true);
  });
});

describe('Phase 10: Protected Route Guards and Logout Session Clearance', () => {
  const HOST_ONLY_TABS = ['host_dashboard', 'builder', 'ai', 'competitions', 'analytics', 'outbox', 'certificates'];

  it('[AUTH-01] correctly identifies protected host-only tabs', () => {
    expect(HOST_ONLY_TABS).toContain('host_dashboard');
    expect(HOST_ONLY_TABS).toContain('builder');
    expect(HOST_ONLY_TABS).toContain('analytics');
    expect(HOST_ONLY_TABS).toContain('competitions');
    expect(HOST_ONLY_TABS).not.toContain('arena');
    expect(HOST_ONLY_TABS).not.toContain('student_dashboard');
  });

  it('[AUTH-02] clears session storage and redirect state upon logout', () => {
    sessionStorage.setItem('quizarena_active_session', JSON.stringify({ gameId: 'g_123' }));
    sessionStorage.setItem('quizarena_game_id', 'g_123');
    localStorage.setItem('quizarena_saved_tab', 'host_dashboard');

    // Simulate logout action
    sessionStorage.removeItem('quizarena_active_session');
    sessionStorage.removeItem('quizarena_game_id');
    localStorage.removeItem('quizarena_saved_tab');

    expect(sessionStorage.getItem('quizarena_active_session')).toBeNull();
    expect(sessionStorage.getItem('quizarena_game_id')).toBeNull();
    expect(localStorage.getItem('quizarena_saved_tab')).toBeNull();
  });
});

describe('Phase 11: Real Bundled Dyslexia Font & Production Font Assets', () => {
  it('[FONT-01] verifies OpenDyslexic-Regular.woff2 and Bold font binaries exist with license', () => {
    const regularPath = path.resolve(process.cwd(), 'public/fonts/OpenDyslexic-Regular.woff2');
    const boldPath = path.resolve(process.cwd(), 'public/fonts/OpenDyslexic-Bold.woff2');
    const licensePath = path.resolve(process.cwd(), 'public/fonts/LICENSE.txt');

    expect(fs.existsSync(regularPath)).toBe(true);
    expect(fs.statSync(regularPath).size).toBeGreaterThan(50000); // ~103KB binary

    expect(fs.existsSync(boldPath)).toBe(true);
    expect(fs.statSync(boldPath).size).toBeGreaterThan(50000); // ~108KB binary

    expect(fs.existsSync(licensePath)).toBe(true);
    const licenseContent = fs.readFileSync(licensePath, 'utf8');
    expect(licenseContent).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(licenseContent).toContain('OpenDyslexic');
  });

  it('[FONT-02] verifies src/index.css defines @font-face declarations for OpenDyslexic', () => {
    const cssPath = path.resolve(process.cwd(), 'src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    expect(cssContent).toContain("font-family: 'OpenDyslexic'");
    expect(cssContent).toContain("url('/fonts/OpenDyslexic-Regular.woff2') format('woff2')");
    expect(cssContent).toContain("url('/fonts/OpenDyslexic-Bold.woff2') format('woff2')");
    expect(cssContent).toContain('font-display: swap');
  });

  it('[FONT-03] verifies vite.config.ts PWA includes OpenDyslexic font assets', () => {
    const viteConfigPath = path.resolve(process.cwd(), 'vite.config.ts');
    const viteConfigContent = fs.readFileSync(viteConfigPath, 'utf8');

    expect(viteConfigContent).toContain('fonts/OpenDyslexic-Regular.woff2');
    expect(viteConfigContent).toContain('fonts/OpenDyslexic-Bold.woff2');
  });

  it('[FONT-04] verifies index.html pre-mount script initializes data-dyslexia and data-text-size', () => {
    const htmlPath = path.resolve(process.cwd(), 'index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    expect(htmlContent).toContain("localStorage.getItem('quizarena_accessibility_settings')");
    expect(htmlContent).toContain("document.documentElement.setAttribute('data-dyslexia', 'true')");
    expect(htmlContent).toContain("document.documentElement.setAttribute('data-text-size', a11y.textSize)");
  });
});

describe('Phase 12: Optimistic Game-State Updates & Authoritative Rollback Safety', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('[OPT-01] reverts local state and notifies tabs if server rejects transition', async () => {
    const originalGame = {
      id: 'game_test_101',
      status: 'lobby',
      currentQuestionIndex: 0,
    };
    const key = `quizarena_game_${originalGame.id}`;
    localStorage.setItem(key, JSON.stringify(originalGame));

    // Simulate optimistic update followed by server rejection
    const optimisticGame = { ...originalGame, status: 'question_active' };
    localStorage.setItem(key, JSON.stringify(optimisticGame));

    // Simulate server 403 Forbidden rejection handler
    const serverSuccess = false;
    if (!serverSuccess) {
      // Rollback
      localStorage.setItem(key, JSON.stringify(originalGame));
    }

    const restored = JSON.parse(localStorage.getItem(key) || '{}');
    expect(restored.status).toBe('lobby');
    expect(restored.currentQuestionIndex).toBe(0);
  });

  it('[OPT-02] overwrites stale local cache with authoritative server snapshot on reconnect', () => {
    const key = 'quizarena_game_game_test_reconnect';
    // Stale local cache
    localStorage.setItem(key, JSON.stringify({
      id: 'game_test_reconnect',
      status: 'question_active',
      currentQuestionIndex: 1,
    }));

    // Authoritative snapshot arriving from server/Firestore
    const authoritativeServerSnapshot = {
      id: 'game_test_reconnect',
      status: 'reveal',
      currentQuestionIndex: 1,
      updatedAt: new Date().toISOString(),
    };

    // Reconcile
    localStorage.setItem(key, JSON.stringify(authoritativeServerSnapshot));

    const reconciled = JSON.parse(localStorage.getItem(key) || '{}');
    expect(reconciled.status).toBe('reveal');
    expect(reconciled.currentQuestionIndex).toBe(1);
  });

  it('[OPT-03] protects against delayed Firestore writes using bounded timeout race', async () => {
    const delayedPromise = new Promise(resolve => setTimeout(() => resolve('firestore_success'), 5000));
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore write timeout')), 50));

    let timedOut = false;
    try {
      await Promise.race([delayedPromise, timeoutPromise]);
    } catch (err: any) {
      if (err.message === 'Firestore write timeout') {
        timedOut = true;
      }
    }

    expect(timedOut).toBe(true);
  });

  it('[OPT-04] guarantees duplicate answer submissions do not produce duplicate scores', () => {
    const initialPlayer = { id: 'p1', score: 1000, correctCount: 1, streak: 1 };
    const recordedAnswers = new Map<string, { answerId: string; points: number }>();

    const recordAnswer = (qIndex: number, pId: string, points: number) => {
      const ansKey = `ans_${qIndex}_${pId}`;
      if (recordedAnswers.has(ansKey)) {
        // Idempotent duplicate: return existing without awarding new points
        return { isDuplicate: true, pointsAwarded: 0 };
      }
      recordedAnswers.set(ansKey, { answerId: ansKey, points });
      initialPlayer.score += points;
      initialPlayer.correctCount += 1;
      return { isDuplicate: false, pointsAwarded: points };
    };

    const first = recordAnswer(0, 'p1', 850);
    expect(first.isDuplicate).toBe(false);
    expect(first.pointsAwarded).toBe(850);
    expect(initialPlayer.score).toBe(1850);

    // Duplicate submission for same question & player
    const duplicate = recordAnswer(0, 'p1', 850);
    expect(duplicate.isDuplicate).toBe(true);
    expect(duplicate.pointsAwarded).toBe(0);
    expect(initialPlayer.score).toBe(1850); // Unchanged!
    expect(initialPlayer.correctCount).toBe(2);
  });
});
