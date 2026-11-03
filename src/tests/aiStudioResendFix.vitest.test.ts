/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Automated Test Suite: AI Quiz Studio Integration & Resend Email Delivery Fix
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    setDoc: vi.fn().mockResolvedValue(undefined),
  };
});

import { validateQuestion, validateQuiz } from '../lib/questionValidation';
import { saveQuiz } from '../services/quizService';
import {
  getResolvedEmailProvider,
  getResolvedFromAddress,
  dispatchSingleEmail,
  handleSendTestEmail,
  handleSmtpHealth,
  resetTestEmailRateLimit,
} from '../server/resultEmailsHandler';
import {
  outboxStore,
  idempotencyOutboxIndex,
  enqueueOutboxJob,
  processOutboxBatch,
} from '../server/emailOutboxWorker';
import type { Question, Quiz } from '../types/quiz';

const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageMap.get(key) || null,
  setItem: (key: string, value: string) => { storageMap.set(key, String(value)); },
  removeItem: (key: string) => { storageMap.delete(key); },
  clear: () => { storageMap.clear(); },
  key: (index: number) => Array.from(storageMap.keys())[index] || null,
  get length() { return storageMap.size; },
};

if (typeof global.localStorage === 'undefined') {
  (global as any).localStorage = localStorageMock;
}

function makeTestQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    type: 'multiple_choice',
    text: 'What is the role of an Operating System semaphore?',
    options: [
      'Process synchronization and resource protection',
      'Displaying graphics on screen',
      'Formatting disk partitions',
      'Compiling source code to binary',
    ],
    correctAnswers: [0],
    explanation: 'Semaphores provide synchronization primitives for concurrent processes.',
    timeLimit: 25,
    points: 1000,
    difficulty: 'medium',
    bloomLevel: 'apply',
    topicTag: 'Concurrency',
    courseOutcomeTag: 'CO2',
    sourceQuote: 'Semaphores synchronize concurrent processes to avoid race conditions.',
    sourcePage: 42,
    ...overrides,
  };
}

function makeTestQuiz(overrides: Partial<Quiz> = {}): Quiz {
  return {
    id: `quiz_${Date.now()}`,
    title: 'Operating Systems Arena',
    description: 'Core concepts of concurrency and scheduling',
    authorId: 'teacher_123',
    authorName: 'Prof. Ada Lovelace',
    isPublic: true,
    gameMode: 'classic',
    tags: ['OS', 'Concurrency'],
    coverColor: '#FF5A36',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questions: [makeTestQuestion()],
    ...overrides,
  };
}

describe('AI Quiz Studio Integration Tests (Issue A)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('[AI-01] Add to Studio (New Quiz) creates a valid quiz containing only selected questions', () => {
    const q1 = makeTestQuestion({ id: 'q_gen_1', text: 'First AI generated question' });
    const q2 = makeTestQuestion({ id: 'q_gen_2', text: 'Second AI generated question' });
    const q3 = makeTestQuestion({ id: 'q_gen_3', text: 'Third AI generated question' });

    const generated = [q1, q2, q3];
    const acceptedIds = new Set(['q_gen_1', 'q_gen_3']); // Only 1 and 3 selected

    const selectedQuestions = generated.filter(q => acceptedIds.has(q.id));
    expect(selectedQuestions).toHaveLength(2);

    const newQuizId = `ai_quiz_${Date.now()}_test`;
    const newQuiz: Quiz = {
      id: newQuizId,
      title: 'Concurrency Mastery Quiz',
      description: 'Generated from lecture notes targeting CO2.',
      authorId: 'teacher_123',
      authorName: 'Instructor AI',
      isPublic: true,
      gameMode: 'classic',
      tags: ['AI Generated', 'CO2'],
      coverColor: '#FF5A36',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: selectedQuestions.map((q, idx) => ({
        ...q,
        id: `${newQuizId}_q_${idx + 1}`,
      })),
    };

    const validation = validateQuiz(newQuiz);
    expect(validation.valid).toBe(true);
    expect(newQuiz.questions).toHaveLength(2);
    expect(newQuiz.questions[0].text).toBe('First AI generated question');
    expect(newQuiz.questions[1].text).toBe('Third AI generated question');
    expect(newQuiz.questions.some(q => q.text === 'Second AI generated question')).toBe(false);
  });

  it('[AI-02] Append to Quiz appends to existing quiz questions without overwriting existing questions', () => {
    const existingQ1 = makeTestQuestion({ id: 'orig_1', text: 'Original existing question #1' });
    const existingQ2 = makeTestQuestion({ id: 'orig_2', text: 'Original existing question #2' });

    const targetQuiz = makeTestQuiz({
      id: 'target_quiz_42',
      title: 'Target Existing Quiz',
      questions: [existingQ1, existingQ2],
    });

    const aiQ1 = makeTestQuestion({ id: 'ai_new_1', text: 'Appended AI question #1' });
    const aiQ2 = makeTestQuestion({ id: 'ai_new_2', text: 'Appended AI question #2' });

    const selectedToAppend = [aiQ1, aiQ2];
    const stampedQuestions: Question[] = selectedToAppend.map((q, idx) => ({
      ...q,
      id: `${targetQuiz.id}_q_ai_${Date.now()}_${idx + 1}`,
    }));

    const updatedQuiz: Quiz = {
      ...targetQuiz,
      questions: [...targetQuiz.questions, ...stampedQuestions],
      updatedAt: new Date().toISOString(),
    };

    expect(updatedQuiz.questions).toHaveLength(4);
    // Original questions are preserved unchanged at indices 0 and 1
    expect(updatedQuiz.questions[0].id).toBe('orig_1');
    expect(updatedQuiz.questions[1].id).toBe('orig_2');
    // Appended questions are added at indices 2 and 3
    expect(updatedQuiz.questions[2].text).toBe('Appended AI question #1');
    expect(updatedQuiz.questions[3].text).toBe('Appended AI question #2');
    expect(updatedQuiz.questions[2].id).toContain('target_quiz_42_q_ai_');
  });

  it('[AI-03] All question fields are preserved across AI -> Studio transition', () => {
    const richQuestion = makeTestQuestion({
      type: 'multiple_choice',
      text: 'Detailed test question prompt',
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correctAnswers: [0],
      explanation: 'Exhaustive pedagogical explanation for students',
      timeLimit: 30,
      points: 1500,
      bloomLevel: 'analyze',
      courseOutcomeTag: 'CO3',
      topicTag: 'Deadlock Detection',
      sourceQuote: 'A cycle in a resource allocation graph indicates deadlock.',
      sourcePage: 88,
    });

    const stamped: Question = {
      ...richQuestion,
      id: 'stamped_id_123',
    };

    expect(stamped.type).toBe('multiple_choice');
    expect(stamped.text).toBe(richQuestion.text);
    expect(stamped.options).toEqual(richQuestion.options);
    expect(stamped.correctAnswers).toEqual([0]);
    expect(stamped.explanation).toBe(richQuestion.explanation);
    expect(stamped.timeLimit).toBe(30);
    expect(stamped.points).toBe(1500);
    expect(stamped.bloomLevel).toBe('analyze');
    expect(stamped.courseOutcomeTag).toBe('CO3');
    expect(stamped.topicTag).toBe('Deadlock Detection');
    expect(stamped.sourceQuote).toBe('A cycle in a resource allocation graph indicates deadlock.');
    expect(stamped.sourcePage).toBe(88);
  });

  it('[AI-04] Empty question selection is rejected', () => {
    const generated = [makeTestQuestion()];
    const acceptedIds = new Set<string>(); // none accepted

    const selectedQuestions = generated.filter(q => acceptedIds.has(q.id));
    expect(selectedQuestions.length === 0).toBe(true);

    const emptyQuiz = makeTestQuiz({ questions: selectedQuestions });
    const val = validateQuiz(emptyQuiz);
    expect(val.valid).toBe(false);
    expect(val.errors).toContain('Quiz must contain at least one question.');
  });

  it('[AI-05] Invalid question data is properly caught by validation', () => {
    const invalidQ = makeTestQuestion({
      text: '', // Empty text
      options: ['Only one option'], // Invalid option count
      correctAnswers: [99], // Out of bounds
    });

    const res = validateQuestion(invalidQ);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors.some(e => e.includes('empty'))).toBe(true);
  });

  it('[AI-06] User ownership is preserved and placeholder IDs are claimed safely by saveQuiz', async () => {
    // 1. Quiz with placeholder authorId 'host_active' is safely saved by active teacher
    const placeholderQuiz = makeTestQuiz({
      id: 'quiz_from_ai_1',
      authorId: 'host_active',
      authorName: 'Instructor AI',
    });

    const saved = await saveQuiz(placeholderQuiz, 'teacher_real_uid_999');
    expect(saved.authorId).toBe('teacher_real_uid_999');

    // 2. Overwrite attempt by unauthorized user on someone else's quiz throws Ownership mismatch
    const protectedQuiz = makeTestQuiz({
      id: 'quiz_protected_2',
      authorId: 'original_teacher_uid',
    });

    await expect(saveQuiz(protectedQuiz, 'intruder_uid')).rejects.toThrow(/Ownership mismatch/);
  });

  it('[AI-07] Both author-scoped cache and global quiz cache are synchronized', async () => {
    const qz = makeTestQuiz({ id: 'sync_test_quiz', authorId: 'teacher_abc' });
    await saveQuiz(qz, 'teacher_abc');

    const globalCached = JSON.parse(localStorage.getItem('quizarena_quizzes') || '[]');
    expect(globalCached.some((q: Quiz) => q.id === 'sync_test_quiz')).toBe(true);

    const authorCached = JSON.parse(localStorage.getItem('quizarena_quizzes_teacher_abc') || '[]');
    expect(authorCached.some((q: Quiz) => q.id === 'sync_test_quiz')).toBe(true);
  });
});

describe('Resend Email Delivery Fix Tests (Issue B)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    outboxStore.clear();
    idempotencyOutboxIndex.clear();
    resetTestEmailRateLimit();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('[EM-01] Provider resolution respects EMAIL_PROVIDER=resend and auto-detects from RESEND_API_KEY', () => {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    delete process.env.BREVO_API_KEY;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_HOST;

    // No credentials -> none
    expect(getResolvedEmailProvider()).toBe('none');

    // Auto-detect from RESEND_API_KEY
    process.env.RESEND_API_KEY = 're_test_key_123';
    expect(getResolvedEmailProvider()).toBe('resend');

    // Explicit override EMAIL_PROVIDER=smtp
    process.env.EMAIL_PROVIDER = 'smtp';
    expect(getResolvedEmailProvider()).toBe('smtp');

    // Explicit EMAIL_PROVIDER=resend
    process.env.EMAIL_PROVIDER = 'resend';
    expect(getResolvedEmailProvider()).toBe('resend');

    // Explicit EMAIL_PROVIDER=none
    process.env.EMAIL_PROVIDER = 'none';
    expect(getResolvedEmailProvider()).toBe('none');
  });

  it('[EM-02] Resend sender address defaults to onboarding@resend.dev and NEVER uses SMTP_USER / @gmail.com', () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_key_123';
    process.env.SMTP_USER = 'teacher@gmail.com'; // Gmail address must NOT bleed into Resend!
    process.env.SMTP_FROM = 'QuizArena <teacher@gmail.com>';
    delete process.env.EMAIL_FROM;
    delete process.env.RESEND_FROM;

    const fromResend = getResolvedFromAddress('resend');
    expect(fromResend).toBe('QuizArena <onboarding@resend.dev>');
    expect(fromResend.includes('gmail.com')).toBe(false);

    // If explicit EMAIL_FROM is configured with verified domain, use it
    process.env.EMAIL_FROM = 'QuizArena <noreply@quizarena.io>';
    expect(getResolvedFromAddress('resend')).toBe('QuizArena <noreply@quizarena.io>');
  });

  it('[EM-03] Valid recipient email accepted and dispatched over Resend HTTPS API', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_live_test_key';
    delete process.env.EMAIL_FROM;
    delete process.env.RESEND_FROM;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 're_msg_abc123' }),
      json: async () => ({ id: 're_msg_abc123' }),
    });
    global.fetch = mockFetch;

    const result = await dispatchSingleEmail({
      to: 'delivered@resend.dev',
      recipientName: 'Student Alex',
      subject: 'Quiz Results',
      html: '<p>You scored 9200 pts</p>',
      transporter: null,
    });

    expect(result.status).toBe('sent');
    expect(result.messageId).toBe('re_msg_abc123');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_live_test_key');

    const body = JSON.parse(init.body);
    expect(body.from).toBe('QuizArena <onboarding@resend.dev>');
    expect(body.to).toEqual(['delivered@resend.dev']);
    expect(body.subject).toBe('Quiz Results');
  });

  it('[EM-04] HTTP 403 (domain not verified) produces diagnostic message and is marked permanent failure', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_key';

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({
        statusCode: 403,
        message: 'Domain not verified. You can only send testing emails from onboarding@resend.dev',
        name: 'validation_error',
      }),
    });

    await expect(
      dispatchSingleEmail({
        to: 'student@example.com',
        recipientName: 'Student',
        subject: 'Report',
        html: '<p>Report</p>',
        transporter: null,
      })
    ).rejects.toThrow(/Resend API HTTP 403/);

    try {
      await dispatchSingleEmail({
        to: 'student@example.com',
        recipientName: 'Student',
        subject: 'Report',
        html: '<p>Report</p>',
        transporter: null,
      });
    } catch (err: any) {
      expect(err.status).toBe(403);
      expect(err.isPermanent).toBe(true);
      expect(err.message).toContain('onboarding@resend.dev');
      expect(err.message).toContain('resend.com/domains');
    }
  });

  it('[EM-05] HTTP 429 rate limit is classified as transient with retry-after header', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_key';

    const headers = new Map();
    headers.set('retry-after', '45');

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (k: string) => headers.get(k.toLowerCase()) },
      text: async () => JSON.stringify({ message: 'Rate limit exceeded' }),
    });

    try {
      await dispatchSingleEmail({
        to: 'delivered@resend.dev',
        recipientName: 'Test',
        subject: 'Test',
        html: '<p>Test</p>',
        transporter: null,
      });
      expect.fail('Should have thrown HTTP 429');
    } catch (err: any) {
      expect(err.status).toBe(429);
      expect(err.isPermanent).toBe(false);
      expect(err.retryAfter).toBe(45);
    }
  });

  it('[EM-06] HTTP 5xx server error is marked transient for retry with backoff', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_key';

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Resend service temporarily unavailable',
    });

    try {
      await dispatchSingleEmail({
        to: 'delivered@resend.dev',
        recipientName: 'Test',
        subject: 'Test',
        html: '<p>Test</p>',
        transporter: null,
      });
      expect.fail('Should have thrown HTTP 503');
    } catch (err: any) {
      expect(err.status).toBe(503);
      expect(err.isPermanent).toBe(false);
    }
  });

  it('[EM-07] Email outbox processor permanently marks 403 errors and prevents infinite retries', async () => {
    const enqueueRes = enqueueOutboxJob({
      recipientEmail: 'unverified@external.com',
      recipientName: 'External Student',
      eventType: 'quiz_results_ready',
      subject: 'Results',
      htmlContent: '<p>Results</p>',
      textContent: 'Results',
      idempotencyKey: 'job_403_test',
    });

    expect(enqueueRes.success).toBe(true);

    const mockFailingSender = vi.fn().mockResolvedValue({
      success: false,
      error: 'Resend API HTTP 403 (Forbidden): Domain not verified.',
      isPermanent: true,
    });

    const batchRes = await processOutboxBatch(5, mockFailingSender, 'test_worker');
    expect(batchRes.claimedCount).toBe(1);
    expect(batchRes.failedCount).toBe(1);
    expect(batchRes.retriedCount).toBe(0);

    const job = outboxStore.get(enqueueRes.job!.id);
    expect(job?.status).toBe('failed');
    expect(job?.errorCategory).toBe('permanent');
  });

  it('[EM-08] Resend deliverability sink delivered@resend.dev is allowed by handleSendTestEmail', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_key';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 're_sink_msg_123' }),
      json: async () => ({ id: 're_sink_msg_123' }),
    });

    const req: any = {
      headers: { authorization: 'Bearer mock_valid_host_token' },
      body: {
        to: 'delivered@resend.dev',
        subject: 'Deliverability Verification',
        htmlContent: '<p>Test Resend sink</p>',
      },
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
      setHeader: () => {},
    };

    const mockAdminAuth: any = {
      verifyIdToken: vi.fn().mockResolvedValue({ uid: 'host_owner_1', email: 'owner@quizarena.io' }),
    };

    await handleSendTestEmail(req, res, { adminAuth: mockAdminAuth });
    expect(statusCode).toBe(200);
    expect(responseData?.success).toBe(true);
    expect(responseData?.to).toBe('delivered@resend.dev');
    expect(responseData?.provider).toBe('resend');
    expect(responseData?.fromAddress).toBe('QuizArena <onboarding@resend.dev>');
  });

  it('[EM-09] Health check returns provider-aware status and does not report false positive SMTP Connected', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_valid_key';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '[]',
    });

    const req: any = {
      headers: { authorization: 'Bearer host_token' },
    };

    let responseData: any = null;
    const res: any = {
      status: () => res,
      json: (data: any) => {
        responseData = data;
        return res;
      },
    };

    const mockAdminAuth: any = {
      verifyIdToken: vi.fn().mockResolvedValue({ uid: 'host_1' }),
    };

    await handleSmtpHealth(req, res, { adminAuth: mockAdminAuth });
    expect(responseData?.connected).toBe(true);
    expect(responseData?.provider).toBe('resend');
    expect(responseData?.host).toContain('Resend API (HTTPS Port 443)');
    expect(responseData?.fromAddress).toBe('QuizArena <onboarding@resend.dev>');
  });

  it('[EM-10] API keys and secrets are never exposed in responses or logs', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_super_secret_key_xyz987';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '[]',
    });

    const req: any = {
      headers: { authorization: 'Bearer host_token' },
    };

    let responseData: any = null;
    const res: any = {
      status: () => res,
      json: (data: any) => {
        responseData = data;
        return res;
      },
    };

    const mockAdminAuth: any = {
      verifyIdToken: vi.fn().mockResolvedValue({ uid: 'host_1' }),
    };

    await handleSmtpHealth(req, res, { adminAuth: mockAdminAuth });
    const stringified = JSON.stringify(responseData);
    expect(stringified.includes('re_super_secret_key_xyz987')).toBe(false);
  });
});
