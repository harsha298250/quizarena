/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Phase 1 — Secure Hosting and Valid Quizzes Test Suite
 * Validates authentication barriers, email verification, quiz structure validation,
 * and host ownership invariants across API and domain layers.
 */

import { describe, it, expect } from 'vitest';
import { handleCreateGame, handleStartGame, handleAdvanceQuestion } from '../server/gameSessionHandler.ts';
import { validateQuizForHosting, DEFAULT_UNTITLED_QUIZ_TITLE } from '../lib/quizValidation.ts';
import type { Quiz } from '../types/quiz.ts';

function createMockBackend() {
  const store = new Map<string, any>();

  const adminAuth = {
    verifyIdToken: async (token: string) => {
      if (token === 'bearer_anonymous') {
        return { uid: 'anon_123', email: 'anon@example.com', isAnonymous: true, email_verified: false };
      }
      if (token === 'bearer_unverified') {
        return { uid: 'teacher_unverified', email: 'teacher@school.edu', isAnonymous: false, email_verified: false };
      }
      if (token === 'bearer_verified_host') {
        return { uid: 'host_verified_99', email: 'verified.prof@university.edu', isAnonymous: false, email_verified: true };
      }
      if (token === 'bearer_other_user') {
        return { uid: 'other_user_404', email: 'other@example.com', isAnonymous: false, email_verified: true };
      }
      throw new Error('Invalid token');
    },
  };

  const adminDb = {
    doc: (p: string) => {
      return {
        path: p,
        get: async () => {
          const data = store.get(p);
          return {
            exists: !!data,
            data: () => data,
          };
        },
        update: async (fields: any) => {
          const current = store.get(p) || {};
          store.set(p, { ...current, ...fields });
        },
        set: async (val: any) => {
          store.set(p, val);
        },
      };
    },
    runTransaction: async (fn: any) => {
      const transaction = {
        get: async (docRef: any) => {
          const data = store.get(docRef.path);
          return {
            exists: !!data,
            data: () => data,
          };
        },
        set: (docRef: any, val: any) => {
          store.set(docRef.path, val);
        },
        update: (docRef: any, val: any) => {
          const current = store.get(docRef.path) || {};
          store.set(docRef.path, { ...current, ...val });
        },
      };
      return fn(transaction);
    },
  };

  return { adminAuth, adminDb, store };
}

function createMockReqRes(body: any, token?: string) {
  const headers: Record<string, string> = {};
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }
  const req: any = {
    body,
    headers,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
  let responseData: any = null;
  let statusCode = 200;
  const res: any = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      responseData = data;
      return res;
    },
  };
  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
  };
}

const VALID_TEST_QUIZ: Quiz = {
  id: 'valid_quiz_1',
  title: 'Advanced Computer Networks',
  description: 'Valid test quiz for hosting',
  authorId: 'host_verified_99',
  isPublic: true,
  gameMode: 'classic',
  tags: ['Networking'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  questions: [
    {
      id: 'q1',
      type: 'multiple_choice',
      text: 'Which transport layer protocol provides reliable, connection-oriented byte streams?',
      options: ['TCP', 'UDP', 'ICMP', 'IP'],
      correctAnswers: [0],
      explanation: 'TCP guarantees delivery and order.',
      timeLimit: 20,
      points: 1000,
      topicTag: 'Transport',
      bloomLevel: 'understand',
      courseOutcomeTag: 'CO1',
    },
  ],
};

describe('Phase 1 — Secure Hosting and Quiz Validation', () => {
  it('1. Blocks signed-out user from creating a game session (401)', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus, getData } = createMockReqRes({ quiz: VALID_TEST_QUIZ });

    await handleCreateGame(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(401);
    expect(getData()?.error).toMatch(/Unauthorized/i);
  });

  it('2. Blocks anonymous user from creating/hosting games (403)', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus, getData } = createMockReqRes({ quiz: VALID_TEST_QUIZ }, 'bearer_anonymous');

    await handleCreateGame(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(403);
    expect(getData()?.error).toMatch(/Anonymous accounts cannot create or host games/i);
  });

  it('3. Blocks unverified email user from creating/hosting games (403)', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus, getData } = createMockReqRes({ quiz: VALID_TEST_QUIZ }, 'bearer_unverified');

    await handleCreateGame(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(403);
    expect(getData()?.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('4. Allows valid, authenticated, email-verified user to host a game (201)', async () => {
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus, getData } = createMockReqRes(
      { quiz: VALID_TEST_QUIZ, hostName: 'Prof. Turing' },
      'bearer_verified_host'
    );

    await handleCreateGame(req, res, { adminAuth, adminDb, generatePin: () => '112233' });
    expect(getStatus()).toBe(201);
    expect(getData()?.success).toBe(true);
    expect(getData()?.game?.pin).toBe('112233');
    expect(getData()?.game?.hostId).toBe('host_verified_99');
  });

  it('5. Quiz Validation Engine: Rejects empty title, default title, and empty questions in domain & API', async () => {
    // A. Empty Title
    const emptyTitleRes = validateQuizForHosting({ ...VALID_TEST_QUIZ, title: '   ' });
    expect(emptyTitleRes.valid).toBe(false);
    expect(emptyTitleRes.errors.some(e => e.includes('title is required'))).toBe(true);

    // B. Default Title
    const defaultTitleRes = validateQuizForHosting({ ...VALID_TEST_QUIZ, title: DEFAULT_UNTITLED_QUIZ_TITLE });
    expect(defaultTitleRes.valid).toBe(false);
    expect(defaultTitleRes.errors.some(e => e.includes('cannot be hosted'))).toBe(true);

    // C. Empty Questions Array
    const emptyQRes = validateQuizForHosting({ ...VALID_TEST_QUIZ, questions: [] });
    expect(emptyQRes.valid).toBe(false);
    expect(emptyQRes.errors.some(e => e.includes('at least one question'))).toBe(true);

    // API level rejection (HTTP 400)
    const { adminAuth, adminDb } = createMockBackend();
    const { req, res, getStatus, getData } = createMockReqRes(
      { quiz: { ...VALID_TEST_QUIZ, title: DEFAULT_UNTITLED_QUIZ_TITLE } },
      'bearer_verified_host'
    );

    await handleCreateGame(req, res, { adminAuth, adminDb });
    expect(getStatus()).toBe(400);
    expect(getData()?.error).toMatch(/Invalid quiz payload/i);
  });

  it('6. Quiz Validation Engine: Rejects missing options, missing correct answers, and invalid timeLimits', () => {
    // Missing prompt text
    const noTextRes = validateQuizForHosting({
      ...VALID_TEST_QUIZ,
      questions: [{ ...VALID_TEST_QUIZ.questions[0], text: '' }],
    });
    expect(noTextRes.valid).toBe(false);
    expect(noTextRes.errors.some(e => e.includes('missing question prompt text'))).toBe(true);

    // Fewer than 2 options
    const singleOptRes = validateQuizForHosting({
      ...VALID_TEST_QUIZ,
      questions: [{ ...VALID_TEST_QUIZ.questions[0], options: ['Only One Option'] }],
    });
    expect(singleOptRes.valid).toBe(false);
    expect(singleOptRes.errors.some(e => e.includes('at least 2 answer options'))).toBe(true);

    // No correct answer marked
    const noAnswerRes = validateQuizForHosting({
      ...VALID_TEST_QUIZ,
      questions: [{ ...VALID_TEST_QUIZ.questions[0], correctAnswers: [] }],
    });
    expect(noAnswerRes.valid).toBe(false);
    expect(noAnswerRes.errors.some(e => e.includes('at least one correct answer'))).toBe(true);

    // Time limit less than 5s
    const fastTimeRes = validateQuizForHosting({
      ...VALID_TEST_QUIZ,
      questions: [{ ...VALID_TEST_QUIZ.questions[0], timeLimit: 2 }],
    });
    expect(fastTimeRes.valid).toBe(false);
    expect(fastTimeRes.errors.some(e => e.includes('at least 5 seconds'))).toBe(true);
  });

  it('7. Enforces host ownership on game state mutations (403 if not host)', async () => {
    const { adminAuth, adminDb, store } = createMockBackend();
    // Seed a valid game owned by host_verified_99
    store.set('games/game_112233', {
      id: 'game_112233',
      pin: '112233',
      hostId: 'host_verified_99',
      status: 'lobby',
      currentQuestionIndex: 0,
      questions: VALID_TEST_QUIZ.questions,
    });

    // Attacker attempts to start or advance the game with bearer_other_user
    const { req: startReq, res: startRes, getStatus: getStartStatus, getData: getStartData } = createMockReqRes(
      { gameId: 'game_112233' },
      'bearer_other_user'
    );

    await handleStartGame(startReq, startRes, { adminAuth, adminDb });
    expect(getStartStatus()).toBe(403);
    expect(getStartData()?.error).toMatch(/Forbidden|Only the game host/i);

    const { req: advReq, res: advRes, getStatus: getAdvStatus, getData: getAdvData } = createMockReqRes(
      { gameId: 'game_112233', targetQuestionIndex: 1 },
      'bearer_other_user'
    );

    await handleAdvanceQuestion(advReq, advRes, { adminAuth, adminDb });
    expect(getAdvStatus()).toBe(403);
    expect(getAdvData()?.error).toMatch(/Forbidden|Only the game host/i);
  });
});
