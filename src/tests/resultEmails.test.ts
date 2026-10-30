/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert';
import {
  checkHostEmailRateLimit,
  resetHostEmailRateLimit,
  validateAndCapRecipients,
  filterEligibleRecipients,
  handleSendResults,
  handleSendTestEmail,
  handleSmtpHealth,
  resetTestEmailRateLimit,
  MAX_HOST_EMAIL_REQUESTS_PER_MIN,
  MAX_RECIPIENTS_PER_GAME,
} from '../server/resultEmailsHandler.ts';
import {
  generateStudentEmailHtml,
  generateTeacherReportHtml,
  QuestionBreakdownItem,
} from '../services/emailService.ts';

console.log('🧪 Running Task 8 Result Emails & Security Hardening Test Suite...\n');

let passedTests = 0;
let failedTests = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res
        .then(() => {
          console.log(`  ✓ ${name}`);
          passedTests++;
        })
        .catch(err => {
          console.error(`  ✕ ${name}`);
          console.error(`    ${err instanceof Error ? err.message : String(err)}`);
          failedTests++;
        });
    } else {
      console.log(`  ✓ ${name}`);
      passedTests++;
    }
  } catch (err) {
    console.error(`  ✕ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failedTests++;
  }
}

async function runAllTests() {
  // Test 1: filterEligibleRecipients respects emailConsent and opt-outs
  test('1. filterEligibleRecipients respects emailConsent === false and invalid emails', () => {
    const players = [
      { id: 'p1', nickname: 'Alice', email: 'alice@example.com', emailConsent: true },
      { id: 'p2', nickname: 'Bob', email: 'bob@example.com', emailConsent: false }, // opted out
      { id: 'p3', nickname: 'Charlie', email: 'invalid-email', emailConsent: true }, // invalid
      { id: 'p4', nickname: 'Dave' }, // no email directly
    ];

    const guestEmails = [
      { playerId: 'p4', email: 'dave@guest.com', emailConsent: true }, // guest consented
      { playerId: 'p5', email: 'eve@guest.com', emailConsent: false }, // guest opted out
    ];

    const eligible = filterEligibleRecipients(players, guestEmails);

    assert.strictEqual(eligible.length, 2, 'Should only return 2 eligible consented recipients');
    assert.strictEqual(eligible[0].email, 'alice@example.com');
    assert.strictEqual(eligible[1].email, 'dave@guest.com');
  });

  // Test 2: generateStudentEmailHtml includes all required fields
  test('2. generateStudentEmailHtml includes score, rank, accuracy, weak topics, and per-question breakdown with explanations', () => {
    const breakdown: QuestionBreakdownItem[] = [
      {
        questionNumber: 1,
        questionText: 'What is the capital of France?',
        userAnswer: 'Paris',
        isCorrect: true,
        explanation: 'Paris is the capital and most populous city of France.',
        topicTag: 'Geography',
        pointsEarned: 1000,
      },
      {
        questionNumber: 2,
        questionText: 'What is the speed of light?',
        userAnswer: '3000 km/s',
        isCorrect: false,
        explanation: 'The speed of light in vacuum is approximately 299,792 km/s.',
        topicTag: 'Physics',
        pointsEarned: 0,
      },
    ];

    const html = generateStudentEmailHtml({
      studentName: 'Alex',
      quizTitle: 'General Knowledge Arena',
      score: 1000,
      rank: 2,
      totalPlayers: 5,
      accuracy: 0.5,
      streak: 1,
      weakTopics: ['Physics'],
      totalQuestions: 2,
      questionBreakdown: breakdown,
    });

    assert.ok(html.includes('Great effort, Alex!'), 'Should include student greeting');
    assert.ok(html.includes('#2'), 'Should display rank #2');
    assert.ok(html.includes('1,000'), 'Should display formatted total score');
    assert.ok(html.includes('50%'), 'Should display 50% accuracy');
    assert.ok(html.includes('Physics'), 'Should list Physics as weak topic');
    assert.ok(html.includes('Paris is the capital'), 'Should include Question 1 explanation');
    assert.ok(html.includes('299,792 km/s'), 'Should include Question 2 explanation');
    assert.ok(html.includes('✅ Correct (+1000)'), 'Should mark Q1 as correct');
    assert.ok(html.includes('❌ Incorrect'), 'Should mark Q2 as incorrect');
  });

  // Test 3: generateTeacherReportHtml includes cohort metrics and top performers
  test('3. generateTeacherReportHtml includes cohort statistics and leaderboard', () => {
    const html = generateTeacherReportHtml({
      teacherName: 'Prof. Turing',
      quizTitle: 'Algorithms 101',
      gameId: 'game_alg_456',
      totalParticipants: 25,
      averageScore: 7850,
      averageAccuracy: 0.82,
      topPerformers: [
        { rank: 1, nickname: 'Ada', score: 9900 },
        { rank: 2, nickname: 'Grace', score: 9500 },
      ],
      toughQuestions: [
        { questionNumber: 3, text: 'Quicksort average time complexity', correctPercentage: 45 },
      ],
    });

    assert.ok(html.includes('Prof. Turing'), 'Should display teacher name');
    assert.ok(html.includes('25'), 'Should display 25 participants');
    assert.ok(html.includes('7,850'), 'Should display average score 7,850');
    assert.ok(html.includes('82%'), 'Should display 82% accuracy');
    assert.ok(html.includes('Ada'), 'Should display top performer Ada');
    assert.ok(html.includes('45% passed'), 'Should display tough question pass percentage');
  });

  // Test 4: Rate limit per host UID
  test('4. checkHostEmailRateLimit allows up to 5 requests per minute and rejects the 6th', () => {
    resetHostEmailRateLimit();
    const hostId = 'host_teacher_123';
    const now = 1000000;

    for (let i = 1; i <= MAX_HOST_EMAIL_REQUESTS_PER_MIN; i++) {
      const allowed = checkHostEmailRateLimit(hostId, now);
      assert.strictEqual(allowed, true, `Request ${i} should be allowed`);
    }

    // 6th request within same minute must be rejected
    const blocked = checkHostEmailRateLimit(hostId, now);
    assert.strictEqual(blocked, false, '6th request must be rate-limited');

    // After 60 seconds (1 minute), rate limit should reset
    const allowedAfterReset = checkHostEmailRateLimit(hostId, now + 60001);
    assert.strictEqual(allowedAfterReset, true, 'Request after reset window must be allowed');
  });

  // Test 5: Recipient capping per game
  test('5. validateAndCapRecipients caps email lists exceeding MAX_RECIPIENTS_PER_GAME (100)', () => {
    const smallList = Array.from({ length: 25 }, (_, i) => ({ email: `student${i}@test.com` }));
    const smallResult = validateAndCapRecipients(smallList, MAX_RECIPIENTS_PER_GAME);
    assert.strictEqual(smallResult.capped, false);
    assert.strictEqual(smallResult.recipients.length, 25);

    const largeList = Array.from({ length: 150 }, (_, i) => ({ email: `student${i}@test.com` }));
    const largeResult = validateAndCapRecipients(largeList, MAX_RECIPIENTS_PER_GAME);
    assert.strictEqual(largeResult.capped, true);
    assert.strictEqual(largeResult.recipients.length, 100);
    assert.strictEqual(largeResult.originalCount, 150);
  });

  // Helper for mock response
  function createMockResponse() {
    let statusCode = 200;
    let responseBody: any = null;
    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      setHeader: (_name: string, _value: string) => {
        return res;
      },
      json: (data: any) => {
        responseBody = data;
        return res;
      },
    };
    return {
      res,
      getStatusCode: () => statusCode,
      getBody: () => responseBody,
    };
  }

  // Test 6 (Task 8a & 8g): A "mock_token_" bearer gets a 401 Unauthorized
  await test('6. A "mock_token_" bearer gets a 401 Unauthorized (only real verifyIdToken may authenticate)', async () => {
    resetHostEmailRateLimit();
    const mockAdminAuth = {
      verifyIdToken: async (token: string) => {
        if (token === 'real_verified_token') {
          return { uid: 'teacher_1' };
        }
        throw new Error('Firebase ID token has invalid signature or is a mock token');
      },
    };

    const { res, getStatusCode, getBody } = createMockResponse();

    const mockReq = {
      headers: { authorization: 'Bearer mock_token_hacker_uid' },
      body: { gameId: 'game_123' },
    } as any;

    await handleSendResults(mockReq, res, { adminAuth: mockAdminAuth });

    assert.strictEqual(getStatusCode(), 401, 'Should reject mock_token_ with 401');
    assert.ok(getBody().error.includes('Invalid Firebase ID token'));
  });

  // Test 7 (Task 8b & 8g): A non-host cannot send results (403 Forbidden)
  await test('7. A non-host cannot send results (gameData.hostId !== verified uid returns 403)', async () => {
    resetHostEmailRateLimit();
    const mockAdminAuth = {
      verifyIdToken: async (token: string) => {
        if (token === 'teacher_impostor_token') {
          return { uid: 'impostor_uid' };
        }
        throw new Error('Invalid token');
      },
    };

    const mockAdminDb = {
      doc: (path: string) => ({
        get: async () => ({
          exists: true,
          data: () => ({
            hostId: 'actual_teacher_host',
            status: 'finished',
            settings: { autoEmailResults: true },
          }),
        }),
      }),
    };

    const { res, getStatusCode, getBody } = createMockResponse();

    const mockReq = {
      headers: { authorization: 'Bearer teacher_impostor_token' },
      body: { gameId: 'game_secret_456' },
    } as any;

    await handleSendResults(mockReq, res, { adminAuth: mockAdminAuth, adminDb: mockAdminDb });

    assert.strictEqual(getStatusCode(), 403, 'Should return 403 Forbidden for non-host');
    assert.ok(getBody().error.includes('only the game host'));
  });

  // Test 8 (Task 8b): Missing game returns 404
  await test('8. Missing game returns 404 Not Found', async () => {
    resetHostEmailRateLimit();
    const mockAdminAuth = {
      verifyIdToken: async () => ({ uid: 'teacher_1' }),
    };

    const mockAdminDb = {
      doc: () => ({
        get: async () => ({ exists: false }),
      }),
    };

    const { res, getStatusCode, getBody } = createMockResponse();

    const mockReq = {
      headers: { authorization: 'Bearer valid_token' },
      body: { gameId: 'nonexistent_game_999' },
    } as any;

    await handleSendResults(mockReq, res, { adminAuth: mockAdminAuth, adminDb: mockAdminDb });

    assert.strictEqual(getStatusCode(), 404, 'Should return 404 for missing game');
    assert.ok(getBody().error.includes('Game not found'));
  });

  // Test 9 (Task 8b): Unfinished game returns 400 Bad Request
  await test('9. Unfinished game (status !== finished) returns 400 Bad Request', async () => {
    resetHostEmailRateLimit();
    const mockAdminAuth = {
      verifyIdToken: async () => ({ uid: 'teacher_1' }),
    };

    const mockAdminDb = {
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({
            hostId: 'teacher_1',
            status: 'active', // Not finished!
          }),
        }),
      }),
    };

    const { res, getStatusCode, getBody } = createMockResponse();

    const mockReq = {
      headers: { authorization: 'Bearer valid_token' },
      body: { gameId: 'game_in_progress' },
    } as any;

    await handleSendResults(mockReq, res, { adminAuth: mockAdminAuth, adminDb: mockAdminDb });

    assert.strictEqual(getStatusCode(), 400, 'Should return 400 for unfinished game');
    assert.ok(getBody().error.includes('status is finished'));
  });

  // Test 10 (Task 8c): Build recipient list server-side from players and guestEmails only where emailConsent === true
  await test('10. Do not trust client: build recipient list server-side only where emailConsent is true', async () => {
    resetHostEmailRateLimit();
    const sentMails: any[] = [];
    const mockTransporter = {
      sendMail: async (opts: any) => {
        sentMails.push(opts);
        return { messageId: 'msg_test' };
      },
    } as any;

    const mockAdminAuth = {
      verifyIdToken: async () => ({ uid: 'teacher_host_1' }),
    };

    const mockAdminDb = {
      doc: (path: string) => ({
        get: async () => ({
          exists: true,
          data: () => ({
            hostId: 'teacher_host_1',
            status: 'finished',
            quizTitle: 'Server-Side Security Quiz',
            questions: [
              { text: 'Is input sanitized?', points: 1000, explanation: 'Always validate server-side.' },
            ],
          }),
        }),
      }),
      collection: (colPath: string) => {
        if (colPath.endsWith('/players')) {
          return {
            get: async () => ({
              docs: [
                { id: 'p1', data: () => ({ nickname: 'Alice', email: 'alice@test.com', emailConsent: true, score: 1000, correctCount: 1 }) },
                { id: 'p2', data: () => ({ nickname: 'Bob', email: 'bob@test.com', emailConsent: false, score: 500, correctCount: 0 }) }, // opted out!
                { id: 'p3', data: () => ({ nickname: 'Charlie', score: 800, correctCount: 1 }) }, // no email on player doc
              ],
            }),
          };
        }
        if (colPath.endsWith('/guestEmails')) {
          return {
            get: async () => ({
              docs: [
                { id: 'p3', data: () => ({ playerId: 'p3', email: 'charlie_guest@test.com', emailConsent: true }) }, // guest consented!
              ],
            }),
          };
        }
        return { get: async () => ({ docs: [] }) };
      },
    };

    const { res, getStatusCode, getBody } = createMockResponse();

    // Client passes malicious/fake recipients that MUST BE IGNORED
    const mockReq = {
      headers: { authorization: 'Bearer valid_token' },
      body: {
        gameId: 'game_secure_test',
        isAutomatic: false,
        emails: [
          { to: 'hacker_target@spam.com', htmlContent: '<script>alert(1)</script>' },
        ],
      },
    } as any;

    await handleSendResults(mockReq, res, {
      adminAuth: mockAdminAuth,
      adminDb: mockAdminDb,
      transporter: mockTransporter,
    });

    assert.strictEqual(getStatusCode(), 200);
    assert.strictEqual(getBody().success, true);
    // Alice (consented player) + Charlie (consented guest) = exactly 2 emails sent
    assert.strictEqual(sentMails.length, 2, 'Should send exactly 2 emails built from Firestore');
    assert.strictEqual(sentMails[0].to, 'alice@test.com');
    assert.strictEqual(sentMails[1].to, 'charlie_guest@test.com');
    assert.ok(sentMails[0].html.includes('Great effort, Alice!'), 'HTML generated server-side for Alice');
    assert.ok(!sentMails.some(m => m.to === 'hacker_target@spam.com'), 'Malicious client recipient completely ignored');
    assert.ok(!sentMails.some(m => m.to === 'bob@test.com'), 'Opted out student Bob was not emailed');
  });

  await test('11. POST /api/send-test-email sends ONLY to host verified email, rejects other targets', async () => {
    resetTestEmailRateLimit();
    const mockAdminAuth = {
      verifyIdToken: async (tok: string) => {
        if (tok === 'host_token') return { uid: 'host_123', email: 'verified_host@school.edu' };
        throw new Error('Invalid token');
      },
    };

    let sentMail: any = null;
    const mockTransporter = {
      sendMail: async (opts: any) => {
        sentMail = opts;
        return { messageId: 'msg_test_123' };
      },
    } as any;

    // A) Attempt to send to third party email -> 403 Forbidden
    const { res: resForbidden, getStatusCode: getForbiddenCode, getBody: getForbiddenBody } = createMockResponse();
    const reqForbidden = {
      headers: { authorization: 'Bearer host_token' },
      body: { to: 'victim@external.com', htmlContent: '<p>test</p>' },
    } as any;

    await handleSendTestEmail(reqForbidden, resForbidden, {
      adminAuth: mockAdminAuth,
      transporter: mockTransporter,
    });
    assert.strictEqual(getForbiddenCode(), 403, 'Must reject sending test email to non-host address');
    assert.ok(getForbiddenBody().error.includes('ONLY be sent to the signed-in host'), 'Clear forbidden explanation');

    // B) Send to host's own verified email -> 200 OK
    const { res: resOk, getStatusCode: getOkCode, getBody: getOkBody } = createMockResponse();
    const reqOk = {
      headers: { authorization: 'Bearer host_token' },
      body: { to: 'verified_host@school.edu', htmlContent: '<p>Host Preview</p>' },
    } as any;

    await handleSendTestEmail(reqOk, resOk, {
      adminAuth: mockAdminAuth,
      transporter: mockTransporter,
    });
    assert.strictEqual(getOkCode(), 200, 'Must succeed when sending to host verified email');
    assert.strictEqual(getOkBody().success, true);
    assert.strictEqual(sentMail?.to, 'verified_host@school.edu');
  });

  await test('12. POST /api/send-test-email rate limits to 3 per hour per host', async () => {
    resetTestEmailRateLimit('host_rate_test');
    const mockAdminAuth = {
      verifyIdToken: async () => ({ uid: 'host_rate_test', email: 'rate_host@school.edu' }),
    };
    const mockTransporter = {
      sendMail: async () => ({ messageId: 'msg_ok' }),
    } as any;

    const req = {
      headers: { authorization: 'Bearer valid_token' },
      body: { to: 'rate_host@school.edu', htmlContent: '<p>Test</p>' },
    } as any;

    // Requests 1, 2, 3 succeed
    for (let i = 0; i < 3; i++) {
      const { res, getStatusCode } = createMockResponse();
      await handleSendTestEmail(req, res, { adminAuth: mockAdminAuth, transporter: mockTransporter });
      assert.strictEqual(getStatusCode(), 200, `Request ${i + 1} must succeed`);
    }

    // Request 4 is rate limited (429)
    const { res: res429, getStatusCode: getCode429, getBody: getBody429 } = createMockResponse();
    await handleSendTestEmail(req, res429, { adminAuth: mockAdminAuth, transporter: mockTransporter });
    assert.strictEqual(getCode429(), 429, '4th request within hour must be rate limited to 429');
    assert.ok(getBody429().error.includes('Rate limit exceeded'), 'Clear rate limit error message');
  });

  await test('13. POST /api/send-test-email returns exact SMTP error on transporter failure', async () => {
    resetTestEmailRateLimit('host_smtp_fail');
    const mockAdminAuth = {
      verifyIdToken: async () => ({ uid: 'host_smtp_fail', email: 'fail_host@school.edu' }),
    };
    const failingTransporter = {
      sendMail: async () => {
        throw new Error('535 5.7.8 Username and Password not accepted');
      },
    } as any;

    const req = {
      headers: { authorization: 'Bearer valid_token' },
      body: { to: 'fail_host@school.edu', htmlContent: '<p>Test</p>' },
    } as any;

    const { res, getStatusCode, getBody } = createMockResponse();
    await handleSendTestEmail(req, res, { adminAuth: mockAdminAuth, transporter: failingTransporter });
    assert.strictEqual(getStatusCode(), 502, 'Failed SMTP connection must return 502 Bad Gateway');
    assert.strictEqual(getBody().success, false);
    assert.ok(getBody().error.includes('Username and Password not accepted'), 'Must return exact SMTP error');
  });

  await test('14. GET /api/smtp-health verifies transporter and returns Connected/Failed status', async () => {
    const mockAdminAuth = {
      verifyIdToken: async () => ({ uid: 'host_health_test' }),
    };

    // A) Transporter verify succeeds
    const healthyTransporter = {
      verify: async () => true,
    } as any;

    const { res: resHealthy, getBody: getBodyHealthy } = createMockResponse();
    await handleSmtpHealth({ headers: { authorization: 'Bearer token' } } as any, resHealthy, {
      adminAuth: mockAdminAuth,
      transporter: healthyTransporter,
    });
    assert.strictEqual(getBodyHealthy().connected, true, 'Healthy SMTP must report connected: true');

    // B) Transporter verify fails
    const brokenTransporter = {
      verify: async () => {
        throw new Error('getaddrinfo ENOTFOUND smtp.invalidhost.com');
      },
    } as any;

    const { res: resBroken, getBody: getBodyBroken } = createMockResponse();
    await handleSmtpHealth({ headers: { authorization: 'Bearer token' } } as any, resBroken, {
      adminAuth: mockAdminAuth,
      transporter: brokenTransporter,
    });
    assert.strictEqual(getBodyBroken().connected, false, 'Broken SMTP must report connected: false');
    assert.ok(getBodyBroken().error.includes('ENOTFOUND smtp.invalidhost.com'), 'Must report exact failure reason');
  });

  console.log(`\n========================================`);
  console.log(`Summary: ${passedTests} passed, ${failedTests} failed.`);
  console.log(`========================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests();
