/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { sanitizeEmailHtml, sanitizeInlineCss, EMAIL_PREVIEW_PURIFY_CONFIG } from '../lib/emailSanitizer';
import { sanitizeNickname, generatePlayfulNickname } from '../lib/profanity';
import {
  generateGamePin,
  handleCreateGame,
  handleJoinGame,
  handleEndGame,
  assertEmailVerified,
} from '../server/gameSessionHandler';
import {
  handleCreateTournament,
  handleRegisterTournament,
  handleFinalizeMatch,
  handleGetTournamentStandings,
  handleListTournaments,
  handleGetTournament,
} from '../server/tournamentHandler';
import {
  handleOutboxEnqueue,
  handleListUserCertificates,
  handleVerifyCertificate,
} from '../server/notificationHandler';
import {
  issueLatencyNonce,
  validateAndConsumeNonce,
  cleanupExpiredNonces,
  getPendingNonceCount,
  getUserPendingNonceCount,
  clearAllNonces,
  MAX_PENDING_NONCES_PER_USER,
  MAX_GLOBAL_PENDING_NONCES,
} from '../server/timeNonceManager';
import { handleRequestAccountDeletion } from '../server/userDataPurgeHandler';
import {
  checkGameJoinIpRateLimit,
  resetGameJoinIpRateLimit,
  sharedRateLimiter,
} from '../server/sharedRateLimiter';

// Initialize global window for JSDOM in test environment
beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    (globalThis as any).window = dom.window;
    (globalThis as any).document = dom.window.document;
    (globalThis as any).Node = dom.window.Node;
  }
});

describe('Phase 3A Security Hardening Suite', () => {

  // ==========================================
  // SEC-01: Email Preview XSS Sanitization & Fail-Closed Behavior
  // ==========================================
  describe('SEC-01 — Email Preview XSS Mitigation (DOMPurify)', () => {
    it('strips <script> tags and active JavaScript payloads completely', () => {
      const maliciousPayloads = [
        '<script>alert("XSS")</script><p>Hello Teacher</p>',
        '<script src="https://evil.attacker.com/steal-session.js"></script><p>Clean Text</p>',
        '<SCRIPT/XSS SRC="http://evil.com/xss.js"></SCRIPT>',
        '<<SCRIPT>alert("nested");//<</SCRIPT>',
      ];

      for (const payload of maliciousPayloads) {
        const cleaned = sanitizeEmailHtml(payload);
        expect(cleaned).not.toContain('<script');
        expect(cleaned).not.toContain('alert');
        expect(cleaned).not.toContain('evil.attacker.com');
      }
    });

    it('strips inline event handlers (onerror, onload, onclick, onmouseover)', () => {
      const maliciousPayloads = [
        '<img src="invalid-image.png" onerror="alert(document.cookie)" />',
        '<body onload="alert(1)">Hello</body>',
        '<a href="#" onclick="fetch(\'/api/purge\')">Click here</a>',
        '<div onmouseover="alert(\'hover\')">Hover me</div>',
        '<input type="image" src="x" onerror="alert(1)" />',
      ];

      for (const payload of maliciousPayloads) {
        const cleaned = sanitizeEmailHtml(payload);
        expect(cleaned).not.toMatch(/onerror/i);
        expect(cleaned).not.toMatch(/onload/i);
        expect(cleaned).not.toMatch(/onclick/i);
        expect(cleaned).not.toMatch(/onmouseover/i);
        expect(cleaned).not.toContain('alert');
      }
    });

    it('strips SVG and MathML payloads completely', () => {
      const svgPayloads = [
        '<svg><script>alert(1)</script></svg>',
        '<svg onload="alert(1)"></svg>',
        '<math><mtext><table><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=alert(1) src=1>"></path></svg></mglyph></table></mtext></math>',
        '<svg><circle r="10" cx="10" cy="10" fill="red" /><script>alert(2)</script></svg>',
      ];

      for (const payload of svgPayloads) {
        const cleaned = sanitizeEmailHtml(payload);
        expect(cleaned).not.toContain('<svg');
        expect(cleaned).not.toContain('<math');
        expect(cleaned).not.toContain('alert');
      }
    });

    it('disarms malformed, unclosed, or nested HTML attack patterns', () => {
      const malformedPayloads = [
        '<img src=x onerror=alert(1)//>',
        '<a href="javascript:alert(1)">Click<b>me',
        '<<script>alert(1);//<</script>',
        '<div style="background-image: url(&#1;javascript:alert(1))">Test</div>',
        '<img src="x" onerror="&#97;&#108;&#101;&#114;&#116;&#40;&#49;&#41;">',
      ];

      for (const payload of malformedPayloads) {
        const cleaned = sanitizeEmailHtml(payload);
        expect(cleaned).not.toContain('<script');
        expect(cleaned).not.toContain('onerror');
        expect(cleaned).not.not.toBe(undefined);
        expect(cleaned).not.toMatch(/href=["']?\s*javascript:/i);
      }
    });

    it('strips dangerous URI schemes (javascript:, data: for execution, vbscript:)', () => {
      const dangerousUrls = [
        '<a href="javascript:alert(1)">Click for prize</a>',
        '<a href="JAVASCRIPT:alert(document.domain)">Claim Certificate</a>',
        '<a href="jav&#09;ascript:alert(1)">Obfuscated JavaScript Link</a>',
        '<a href="vbscript:msgbox(1)">VBScript link</a>',
        '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Data link</a>',
      ];

      for (const payload of dangerousUrls) {
        const cleaned = sanitizeEmailHtml(payload);
        expect(cleaned).not.toMatch(/href=["']?\s*javascript:/i);
        expect(cleaned).not.toMatch(/href=["']?\s*vbscript:/i);
        expect(cleaned).not.toMatch(/href=["']?\s*data:/i);
        expect(cleaned).not.toContain('alert(');
      }
    });

    it('forbids iframe, embed, object, form, meta, and dialog tags', () => {
      const dangerousTags = [
        '<iframe src="https://phishing-site.example.com"></iframe>',
        '<object data="exploit.swf"></object>',
        '<embed src="flash.swf">',
        '<form action="https://evil.com/login"><input name="pass"/></form>',
        '<meta http-equiv="refresh" content="0;url=https://evil.com">',
        '<dialog open>Phishing modal</dialog>',
      ];

      for (const payload of dangerousTags) {
        const cleaned = sanitizeEmailHtml(payload);
        expect(cleaned).not.toContain('<iframe');
        expect(cleaned).not.toContain('<object');
        expect(cleaned).not.toContain('<embed');
        expect(cleaned).not.toContain('<form');
        expect(cleaned).not.toContain('<meta');
        expect(cleaned).not.toContain('<dialog');
      }
    });

    it('strictly sanitizes inline styles and disallows clickjacking/CSS exploits', () => {
      // 1. Position fixed/absolute clickjacking
      const clickjackHtml = '<div style="color: red; position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 99999;">Clickjack overlay</div>';
      const cleanClickjack = sanitizeEmailHtml(clickjackHtml);
      expect(cleanClickjack).not.toContain('position');
      expect(cleanClickjack).not.toContain('fixed');
      expect(cleanClickjack).not.toContain('z-index');
      expect(cleanClickjack).toContain('color: red');

      // 2. CSS expressions / javascript
      const exprHtml = '<div style="background-image: url(javascript:alert(1)); width: expression(alert(2)); font-size: 14px;">Exploit</div>';
      const cleanExpr = sanitizeEmailHtml(exprHtml);
      expect(cleanExpr).not.toContain('expression');
      expect(cleanExpr).not.toContain('javascript');
      expect(cleanExpr).not.toContain('background-image');
      expect(cleanExpr).toContain('font-size: 14px');

      // 3. sanitizeInlineCss unit behavior
      expect(sanitizeInlineCss('position: absolute; color: blue;')).toBe('color: blue');
      expect(sanitizeInlineCss('behavior: url(xss.htc); font-weight: bold;')).toBe('font-weight: bold');
      expect(sanitizeInlineCss('@import url("evil.css"); padding: 10px;')).toBe('padding: 10px');
    });

    it('fails closed when sanitizer is unavailable or throws', () => {
      // Empty / invalid input fails closed
      expect(sanitizeEmailHtml('')).toBe('');
      expect(sanitizeEmailHtml(null as any)).toBe('');
      expect(sanitizeEmailHtml(undefined as any)).toBe('');

      // Temporarily mock DOMPurify.sanitize to throw
      const origSanitize = (window as any).DOMPurify?.sanitize;
      if (origSanitize) {
        (window as any).DOMPurify.sanitize = () => {
          throw new Error('Simulated DOMPurify crash');
        };
        const res = sanitizeEmailHtml('<p>Safe content</p>');
        expect(res).toBe(''); // Fails closed to empty string, NEVER returns unescaped HTML
        (window as any).DOMPurify.sanitize = origSanitize;
      }
    });

    it('preserves legitimate rich email markup, layouts, and styles safely', () => {
      const validEmailHtml = `
        <div style="font-family: sans-serif; background-color: #f9f9f9; padding: 20px;">
          <h1 style="color: #4f46e5;">Congratulations Alice!</h1>
          <p>You achieved <strong>Rank #1</strong> in <em>Science Bowl 2026</em>.</p>
          <table border="1" cellpadding="5" style="border-collapse: collapse;">
            <thead>
              <tr style="background-color: #eee;">
                <th>Round</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Finals</td>
                <td>9,450 pts</td>
              </tr>
            </tbody>
          </table>
          <hr />
          <p>View verified results: <a href="https://quizarena.app/podium" target="_blank">Podium Link</a></p>
        </div>
      `;

      const cleaned = sanitizeEmailHtml(validEmailHtml);
      expect(cleaned).toContain('Congratulations Alice!');
      expect(cleaned).toContain('Rank #1');
      expect(cleaned).toContain('Science Bowl 2026');
      expect(cleaned).toContain('<table');
      expect(cleaned).toContain('<th>Round</th>');
      expect(cleaned).toContain('<td>9,450 pts</td>');
      expect(cleaned).toContain('href="https://quizarena.app/podium"');
      expect(cleaned).toContain('background-color: #f9f9f9');
      expect(cleaned).toContain('border-collapse: collapse');
    });
  });

  // ==========================================
  // SEC-04: Firebase Storage Security Rules
  // ==========================================
  describe('SEC-04 — Firebase Storage Ownership & Type Boundaries (storage.rules)', () => {
    const storageRulesContent = fs.readFileSync(path.resolve(process.cwd(), 'storage.rules'), 'utf-8');

    it('contains isQuizAuthor helper referencing firestore quiz document authorId', () => {
      expect(storageRulesContent).toContain('function isQuizAuthor(quizId)');
      expect(storageRulesContent).toContain('firestore.exists(/databases/(default)/documents/quizzes/$(quizId))');
      expect(storageRulesContent).toContain('firestore.get(/databases/(default)/documents/quizzes/$(quizId)).data.authorId == request.auth.uid');
    });

    it('contains isTournamentHost helper referencing firestore tournament document hostId', () => {
      expect(storageRulesContent).toContain('function isTournamentHost(tournamentId)');
      expect(storageRulesContent).toContain('firestore.exists(/databases/(default)/documents/tournaments/$(tournamentId))');
      expect(storageRulesContent).toContain('firestore.get(/databases/(default)/documents/tournaments/$(tournamentId)).data.hostId == request.auth.uid');
    });

    it('restricts /quizzes/{quizId}/{fileName} write and delete to isQuizAuthor and valid image', () => {
      const quizMatchRegex = /match\s+\/quizzes\/\{quizId\}\/\{fileName\}\s*\{([\s\S]*?)\}/;
      const match = storageRulesContent.match(quizMatchRegex);
      expect(match).toBeTruthy();
      const block = match![1];
      expect(block).toContain('allow write: if isQuizAuthor(quizId) && isValidImage();');
      expect(block).toContain('allow delete: if isQuizAuthor(quizId);');
      expect(block).not.toContain('allow write: if isSignedIn() && isValidImage();');
    });

    it('restricts /tournaments/{tournamentId}/{fileName} write and delete to isTournamentHost and valid image', () => {
      const tourneyMatchRegex = /match\s+\/tournaments\/\{tournamentId\}\/\{fileName\}\s*\{([\s\S]*?)\}/;
      const match = storageRulesContent.match(tourneyMatchRegex);
      expect(match).toBeTruthy();
      const block = match![1];
      expect(block).toContain('allow write: if isTournamentHost(tournamentId) && isValidImage();');
      expect(block).toContain('allow delete: if isTournamentHost(tournamentId);');
      expect(block).not.toContain('allow write: if isSignedIn() && isValidImage();');
    });

    it('preserves strict server-authoritative denial on certificates (client write and delete blocked)', () => {
      const certMatchRegex = /match\s+\/certificates\/\{certificateId\}\/\{fileName\}\s*\{([\s\S]*?)\}/;
      const match = storageRulesContent.match(certMatchRegex);
      expect(match).toBeTruthy();
      const block = match![1];
      expect(block).toContain('allow read: if true;');
      expect(block).toContain('allow write, delete: if false;');
    });

    it('preserves user avatar write isolation to profile owner with max 5MB cap', () => {
      const avatarMatchRegex = /match\s+\/avatars\/\{userId\}\/\{fileName\}\s*\{([\s\S]*?)\}/;
      const match = storageRulesContent.match(avatarMatchRegex);
      expect(match).toBeTruthy();
      const block = match![1];
      expect(block).toContain('allow write: if isOwner(userId) && isValidImage() && request.resource.size < 5 * 1024 * 1024;');
    });
  });

  // ==========================================
  // SEC-09: Nickname Defense-in-Depth & Unicode Handling
  // ==========================================
  describe('SEC-09 — Nickname Defense-in-Depth & Normalization', () => {
    it('normalizes Unicode characters (NFKC) without breaking legitimate non-Latin scripts', () => {
      // Hindi Devanagari
      const hindiName = 'रोहन';
      const hindiRes = sanitizeNickname(hindiName);
      expect(hindiRes.cleanName).toBe('रोहन');
      expect(hindiRes.wasCensored).toBe(false);

      // Tamil
      const tamilName = 'கார்த்திக்';
      const tamilRes = sanitizeNickname(tamilName);
      expect(tamilRes.cleanName).toBe('கார்த்திக்');
      expect(tamilRes.wasCensored).toBe(false);

      // Japanese
      const jpName = 'タロウ';
      const jpRes = sanitizeNickname(jpName);
      expect(jpRes.cleanName).toBe('タロウ');
      expect(jpRes.wasCensored).toBe(false);
    });

    it('accurately distinguishes NFKC compatibility normalization from universal homoglyph detection', () => {
      // NFKC normalizes full-width Latin to standard ASCII
      const fullWidthName = 'Ａｌｉｃｅ';
      expect(sanitizeNickname(fullWidthName).cleanName).toBe('Alice');

      // NFKC normalizes circled numbers
      const circledName = 'Player①';
      expect(sanitizeNickname(circledName).cleanName).toBe('Player1');

      // Cross-script visual lookalikes (Cyrillic vs Latin) remain distinct under NFKC
      const cyrillicA = '\u0430'; // Cyrillic Small Letter A ('а')
      const latinA = 'a';         // Latin Small Letter A ('a')
      expect(cyrillicA).not.toBe(latinA);
      expect(sanitizeNickname(cyrillicA).cleanName).toBe(cyrillicA); // NFKC does NOT convert Cyrillic to Latin
    });

    it('clamps length cleanly based on Unicode code points (25 code point max)', () => {
      const longName = 'A'.repeat(30);
      const res = sanitizeNickname(longName);
      expect(res.cleanName.length).toBe(25);

      // Multi-byte Unicode code points (emojis)
      const longEmojiName = '🚀'.repeat(30);
      const emojiRes = sanitizeNickname(longEmojiName);
      expect(Array.from(emojiRes.cleanName).length).toBe(25);
    });

    it('replaces profanity with playful auto-generated nicknames', () => {
      const dirtyNames = ['fuck_you_all', 'badshit123', 'asshole_player', 'pornstar99'];
      for (const name of dirtyNames) {
        const res = sanitizeNickname(name);
        expect(res.wasCensored).toBe(true);
        expect(res.cleanName).not.toContain('fuck');
        expect(res.cleanName).not.toContain('shit');
        expect(res.cleanName).not.toContain('asshole');
        expect(res.cleanName).not.toContain('porn');
        expect(res.cleanName).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+[0-9]{2}$/);
      }
    });

    it('preserves clean names and harmless characters without distortion', () => {
      const validNames = ['CoolOtter', 'QuantumFox_42', 'Dr. Strange', 'User-99'];
      for (const name of validNames) {
        const res = sanitizeNickname(name);
        expect(res.cleanName).toBe(name);
        expect(res.wasCensored).toBe(false);
      }
    });

    it('generates a playful nickname for empty or whitespace-only inputs', () => {
      const emptyRes = sanitizeNickname('   ');
      expect(emptyRes.wasCensored).toBe(false);
      expect(emptyRes.cleanName.length).toBeGreaterThan(5);
    });
  });

  // ==========================================
  // PHASE 3B: IDENTITY & GAME ACCESS SECURITY
  // ==========================================
  describe('Phase 3B — Identity & Game Access Security Suite', () => {
    function createPhase3bMockDb() {
      const store = new Map<string, any>();

      const makeDocRef = (docPath: string): any => ({
        path: docPath,
        id: docPath.split('/').pop(),
        get: async () => ({
          exists: store.has(docPath),
          data: () => store.get(docPath),
          id: docPath.split('/').pop(),
        }),
        set: async (data: any, opts?: { merge?: boolean }) => {
          if (opts?.merge && store.has(docPath)) {
            store.set(docPath, { ...store.get(docPath), ...data });
          } else {
            store.set(docPath, data);
          }
        },
        update: async (data: any) => {
          const cur = store.get(docPath) || {};
          store.set(docPath, { ...cur, ...data });
        },
        delete: async () => {
          store.delete(docPath);
        },
      });

      const makeQuery = (colPath: string, filters: Array<{ field: string; op: string; value: any }> = [], limitVal?: number): any => ({
        where: (field: string, op: string, value: any) => makeQuery(colPath, [...filters, { field, op, value }], limitVal),
        orderBy: (field: string, dir?: string) => makeQuery(colPath, filters, limitVal),
        limit: (n: number) => makeQuery(colPath, filters, n),
        get: async () => {
          const docs: any[] = [];
          for (const [key, val] of store.entries()) {
            if (key.startsWith(colPath + '/') && key.split('/').length === colPath.split('/').length + 1) {
              let match = true;
              for (const f of filters) {
                if (f.op === '==' && val?.[f.field] !== f.value) match = false;
                if (f.op === '<=' && !(val?.[f.field] <= f.value)) match = false;
              }
              if (match) {
                docs.push({
                  id: key.replace(colPath + '/', ''),
                  path: key,
                  data: () => val,
                  exists: true,
                });
              }
            }
          }
          const sliced = typeof limitVal === 'number' ? docs.slice(0, limitVal) : docs;
          return {
            forEach: (cb: (doc: any) => void) => sliced.forEach(cb),
            docs: sliced,
            size: sliced.length,
            empty: sliced.length === 0,
          };
        },
      });

      const db: any = {
        doc: (docPath: string) => makeDocRef(docPath),
        collection: (colPath: string) => ({
          doc: (id: string) => makeDocRef(`${colPath}/${id}`),
          where: (f: string, op: string, v: any) => makeQuery(colPath, [{ field: f, op, value: v }]),
          orderBy: (f: string, dir?: string) => makeQuery(colPath, []),
          limit: (n: number) => makeQuery(colPath, [], n),
          get: async () => makeQuery(colPath, []).get(),
          add: async (data: any) => {
            const id = `auto_${Date.now()}_${Math.random()}`;
            const p = `${colPath}/${id}`;
            store.set(p, data);
            return { id, ...makeDocRef(p) };
          },
        }),
        batch: () => {
          const ops: Array<() => void> = [];
          return {
            delete: (ref: any) => ops.push(() => store.delete(ref.path || ref)),
            set: (ref: any, data: any, opts?: { merge?: boolean }) => ops.push(() => {
              const p = ref.path || ref;
              if (opts?.merge && store.has(p)) {
                store.set(p, { ...store.get(p), ...data });
              } else {
                store.set(p, data);
              }
            }),
            update: (ref: any, data: any) => ops.push(() => {
              const p = ref.path || ref;
              const cur = store.get(p) || {};
              store.set(p, { ...cur, ...data });
            }),
            commit: async () => {
              for (const op of ops) op();
            },
          };
        },
        runTransaction: async (updateFunction: (tx: any) => Promise<any>) => {
          // Transaction isolation: stage writes so that on error, no writes are applied
          const pendingWrites: Array<() => void> = [];
          const tx = {
            get: async (docRef: any) => docRef.get(),
            set: (docRef: any, data: any, opts?: { merge?: boolean }) => {
              pendingWrites.push(() => {
                const p = docRef.path || docRef;
                if (opts?.merge && store.has(p)) {
                  store.set(p, { ...store.get(p), ...data });
                } else {
                  store.set(p, data);
                }
              });
            },
            update: (docRef: any, data: any) => {
              pendingWrites.push(() => {
                const p = docRef.path || docRef;
                const cur = store.get(p) || {};
                store.set(p, { ...cur, ...data });
              });
            },
          };
          const result = await updateFunction(tx);
          for (const write of pendingWrites) {
            await write();
          }
          return result;
        },
        _store: store,
      };
      return { db, store };
    }

    function createMockReqRes(opts: {
      headers?: Record<string, string>;
      body?: any;
      ip?: string;
      socket?: { remoteAddress?: string };
    }) {
      let statusCode = 200;
      let responseData: any = null;
      const headers: Record<string, string> = {};

      const req: any = {
        headers: opts.headers || {},
        body: opts.body || {},
        ip: opts.ip || '127.0.0.1',
        socket: opts.socket || { remoteAddress: '127.0.0.1' },
      };

      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (data: any) => {
          responseData = data;
          return res;
        },
        setHeader: (name: string, value: string) => {
          headers[name.toLowerCase()] = value;
          return res;
        },
      };

      return {
        req,
        res,
        getStatus: () => statusCode,
        getData: () => responseData,
        getHeader: (name: string) => headers[name.toLowerCase()],
      };
    }

    const sampleQuiz = {
      id: 'quiz_security_101',
      title: 'Security Hardening Quiz',
      gameMode: 'classic',
      questions: [
        {
          id: 'q1',
          question: 'What is a CSPRNG?',
          options: ['Cryptographically Secure PRNG', 'Cascading Style Sheet', 'Central Processing Unit', 'None'],
          correctAnswers: [0],
          timeLimit: 20,
        },
      ],
    };

    // ==========================================
    // SEC-02: Secure Game PIN Generation & Atomic Transaction
    // ==========================================
    describe('SEC-02 — Cryptographic Game PIN Generation & Atomic Room Reservation', () => {
      it('generates 6-digit numeric game PINs within [100000, 999999] using CSPRNG', () => {
        const pins = new Set<string>();
        for (let i = 0; i < 100; i++) {
          const pin = generateGamePin();
          expect(pin).toMatch(/^\d{6}$/);
          const num = parseInt(pin, 10);
          expect(num).toBeGreaterThanOrEqual(100000);
          expect(num).toBeLessThan(1000000);
          pins.add(pin);
        }
        // At least 95 unique PINs in 100 samples
        expect(pins.size).toBeGreaterThanOrEqual(95);
      });

      it('atomically creates both game document and secrets/answerKey document in a single transaction', async () => {
        const { db, store } = createPhase3bMockDb();
        const adminAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: 'host_verified_1',
            email: 'host@university.edu',
            email_verified: true,
            firebase: { sign_in_provider: 'password' },
          }),
        };

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer valid_token' },
          body: { quiz: sampleQuiz, hostName: 'Prof. Turing' },
        });

        await handleCreateGame(ctx.req, ctx.res, { adminAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(201);
        const data = ctx.getData();
        expect(data.success).toBe(true);
        expect(data.game.pin).toMatch(/^\d{6}$/);

        const gameId = data.game.id;
        expect(store.has(`games/${gameId}`)).toBe(true);
        expect(store.has(`games/${gameId}/secrets/answerKey`)).toBe(true);

        const gameRecord = store.get(`games/${gameId}`);
        expect(gameRecord.hostId).toBe('host_verified_1');
        expect(gameRecord.pin).toBe(data.game.pin);

        const secretsRecord = store.get(`games/${gameId}/secrets/answerKey`);
        expect(secretsRecord.hostId).toBe('host_verified_1');
        expect(secretsRecord.answers[0].correctAnswers).toEqual([0]);
      });

      it('detects existing historical game document and successfully retries with fresh PIN', async () => {
        const { db, store } = createPhase3bMockDb();
        const adminAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: 'host_verified_2',
            email: 'host2@university.edu',
            email_verified: true,
            firebase: { sign_in_provider: 'password' },
          }),
        };

        // Seed a historical completed game
        const historicalPin = '123456';
        const historicalGameId = `game_${historicalPin}`;
        store.set(`games/${historicalGameId}`, {
          id: historicalGameId,
          pin: historicalPin,
          hostId: 'historical_host_999',
          status: 'finished',
          createdAt: '2025-01-01T00:00:00Z',
        });
        store.set(`games/${historicalGameId}/secrets/answerKey`, {
          answers: { 0: { correctAnswers: [1] } },
          hostId: 'historical_host_999',
        });

        // Mock generatePin to return collision on first attempt, then fresh PIN on second
        let pinAttempt = 0;
        const generatePin = () => {
          pinAttempt++;
          if (pinAttempt === 1) return '123456'; // collides with historical game
          return '654321'; // fresh PIN
        };

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer valid_token' },
          body: { quiz: sampleQuiz, hostName: 'Host Two' },
        });

        await handleCreateGame(ctx.req, ctx.res, { adminAuth, adminDb: db, generatePin });

        expect(ctx.getStatus()).toBe(201);
        const data = ctx.getData();
        expect(data.game.pin).toBe('654321');

        // Historical game was NEVER overwritten
        const historicalDoc = store.get(`games/${historicalGameId}`);
        expect(historicalDoc.hostId).toBe('historical_host_999');
        expect(historicalDoc.status).toBe('finished');

        // New game was created cleanly under new PIN
        expect(store.has('games/game_654321')).toBe(true);
        expect(store.has('games/game_654321/secrets/answerKey')).toBe(true);
      });

      it('returns HTTP 503 PIN_ALLOCATION_FAILED if all 5 allocation attempts collide', async () => {
        const { db, store } = createPhase3bMockDb();
        const adminAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: 'host_verified_3',
            email: 'host3@university.edu',
            email_verified: true,
            firebase: { sign_in_provider: 'password' },
          }),
        };

        // Seed collision for PIN 777777
        store.set('games/game_777777', { id: 'game_777777', status: 'finished' });

        const generatePin = () => '777777';

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer valid_token' },
          body: { quiz: sampleQuiz },
        });

        await handleCreateGame(ctx.req, ctx.res, { adminAuth, adminDb: db, generatePin });

        expect(ctx.getStatus()).toBe(503);
        const data = ctx.getData();
        expect(data.code).toBe('PIN_ALLOCATION_FAILED');
        expect(data.error).toContain('Failed to allocate a unique game PIN');
      });

      it('leaves zero orphaned game or secrets documents when transaction fails', async () => {
        const { db, store } = createPhase3bMockDb();
        const initialSize = store.size;

        const adminAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: 'host_verified_4',
            email: 'host4@university.edu',
            email_verified: true,
            firebase: { sign_in_provider: 'password' },
          }),
        };

        // Simulate database transaction failure (e.g. network partition or contention)
        const failingDb = {
          ...db,
          runTransaction: vi.fn().mockRejectedValue(new Error('TRANSACTION_ABORTED_DUE_TO_CONTENTION')),
        };

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer valid_token' },
          body: { quiz: sampleQuiz },
        });

        await handleCreateGame(ctx.req, ctx.res, { adminAuth, adminDb: failingDb });
        expect(ctx.getStatus()).toBe(500);

        // Store must not have any new partial records
        expect(store.size).toBe(initialSize);
      });
    });

    // ==========================================
    // SEC-03: Layered Join Rate Limiting
    // ==========================================
    describe('SEC-03 — Layered Join Rate Limiting & NAT/Classroom Support', () => {
      beforeEach(() => {
        sharedRateLimiter.reset();
      });

      it('enforces 150 req/min per IP rate limit for game joins', () => {
        const testIp = '192.0.2.100';
        resetGameJoinIpRateLimit(testIp);

        // First 150 requests are permitted
        for (let i = 1; i <= 150; i++) {
          const res = checkGameJoinIpRateLimit(testIp);
          expect(res.allowed).toBe(true);
        }

        // 151st request is blocked
        const blocked = checkGameJoinIpRateLimit(testIp);
        expect(blocked.allowed).toBe(false);
        expect(blocked.retryAfterSec).toBeGreaterThan(0);
      });

      it('classroom simulation: 50 concurrent students on same NAT IP can all join successfully', async () => {
        const { db, store } = createPhase3bMockDb();
        const classroomIp = '198.51.100.24';
        resetGameJoinIpRateLimit(classroomIp);

        // Create a game in lobby state
        const pin = '444555';
        const gameId = `game_${pin}`;
        store.set(`games/${gameId}`, {
          id: gameId,
          pin,
          status: 'lobby',
          playerCount: 0,
          settings: { allowLateJoin: true, requireApprovalToJoin: false },
        });

        // 50 distinct students join from the same classroom NAT IP
        for (let i = 1; i <= 50; i++) {
          const studentUid = `student_${i}`;
          const adminAuth: any = {
            verifyIdToken: vi.fn().mockResolvedValue({
              uid: studentUid,
              email: `${studentUid}@school.edu`,
              email_verified: false, // Students do not need email_verified
              firebase: { sign_in_provider: 'anonymous' },
            }),
          };

          const joinCtx = createMockReqRes({
            headers: { authorization: 'Bearer student_token' },
            body: { pin, nickname: `Student_${i}` },
            ip: classroomIp,
          });

          await handleJoinGame(joinCtx.req, joinCtx.res, { adminAuth, adminDb: db });
          expect(joinCtx.getStatus()).toBe(200);
          expect(joinCtx.getData().success).toBe(true);
        }

        // All 50 players are registered under the game
        expect(store.get(`games/${gameId}`).playerCount).toBe(50);
      });

      it('rejects with HTTP 429 and Retry-After header when IP join limit is exceeded', async () => {
        const { db, store } = createPhase3bMockDb();
        const spamIp = '203.0.113.88';
        resetGameJoinIpRateLimit(spamIp);

        const pin = '555666';
        const gameId = `game_${pin}`;
        store.set(`games/${gameId}`, {
          id: gameId,
          pin,
          status: 'lobby',
          playerCount: 0,
          settings: { allowLateJoin: true },
        });

        // Exhaust IP join rate limit (150 requests)
        for (let i = 0; i < 150; i++) {
          checkGameJoinIpRateLimit(spamIp);
        }

        const adminAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: 'spam_bot_1',
            firebase: { sign_in_provider: 'anonymous' },
          }),
        };

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer bot_token' },
          body: { pin, nickname: 'SpamBot' },
          ip: spamIp,
        });

        await handleJoinGame(ctx.req, ctx.res, { adminAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(429);
        expect(ctx.getHeader('retry-after')).toBeDefined();
        expect(ctx.getData().error).toContain('Too many join requests from this IP address');
      });
    });

    // ==========================================
    // SEC-05: Server-Side Email Verification
    // ==========================================
    describe('SEC-05 — Server-Side Email Verification for Privileged Operations', () => {
      it('assertEmailVerified helper accurately validates email_verified claim', () => {
        expect(assertEmailVerified({ email_verified: true }).verified).toBe(true);
        expect(assertEmailVerified({ email_verified: false }).verified).toBe(false);
        expect(assertEmailVerified({} as any).verified).toBe(false);
        expect(assertEmailVerified(null).verified).toBe(false);
        expect(assertEmailVerified(undefined).verified).toBe(false);
      });

      it('handleCreateGame rejects unverified user with HTTP 403 EMAIL_NOT_VERIFIED', async () => {
        const { db } = createPhase3bMockDb();
        const adminAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: 'unverified_teacher',
            email: 'unverified@school.edu',
            email_verified: false,
            firebase: { sign_in_provider: 'password' },
          }),
        };

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer token' },
          body: { quiz: sampleQuiz },
        });

        await handleCreateGame(ctx.req, ctx.res, { adminAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(403);
        const data = ctx.getData();
        expect(data.code).toBe('EMAIL_NOT_VERIFIED');
        expect(data.error).toContain('Email verification required to create or host games');
      });

      it('handleCreateTournament rejects unverified user with HTTP 403 EMAIL_NOT_VERIFIED', async () => {
        const { db } = createPhase3bMockDb();
        const adminAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: 'unverified_host',
            email: 'unverified_host@school.edu',
            email_verified: false,
            firebase: { sign_in_provider: 'password' },
          }),
        };

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer token' },
          body: {
            title: 'Spring Tournament',
            registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
            scheduledStartTime: new Date(Date.now() + 172800000).toISOString(),
          },
        });

        await handleCreateTournament(ctx.req, ctx.res, { adminAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(403);
        const data = ctx.getData();
        expect(data.code).toBe('EMAIL_NOT_VERIFIED');
        expect(data.error).toContain('Email verification required to host tournaments');
      });

      it('handleOutboxEnqueue rejects unverified user with HTTP 403 EMAIL_NOT_VERIFIED', async () => {
        const { db } = createPhase3bMockDb();
        const adminAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: 'unverified_emailer',
            email: 'unverified_emailer@school.edu',
            email_verified: false,
            firebase: { sign_in_provider: 'password' },
          }),
        };

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer token' },
          body: {
            idempotencyKey: 'idemp_key_1',
            recipientEmail: 'student@school.edu',
            subject: 'Quiz Results',
            htmlContent: '<p>Your results</p>',
          },
        });

        await handleOutboxEnqueue(ctx.req, ctx.res, { adminAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(403);
        const data = ctx.getData();
        expect(data.code).toBe('EMAIL_NOT_VERIFIED');
        expect(data.error).toContain('Email verification required to enqueue email notifications');
      });

      it('normal student gameplay (/api/join) remains accessible to unverified users', async () => {
        const { db, store } = createPhase3bMockDb();
        const pin = '999888';
        store.set(`games/game_${pin}`, {
          id: `game_${pin}`,
          pin,
          status: 'lobby',
          playerCount: 0,
          settings: { allowLateJoin: true },
        });

        const adminAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: 'unverified_student',
            email: 'student@example.com',
            email_verified: false,
            firebase: { sign_in_provider: 'password' },
          }),
        };

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer student_token' },
          body: { pin, nickname: 'UnverifiedStudent' },
        });

        await handleJoinGame(ctx.req, ctx.res, { adminAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(200);
        expect(ctx.getData().success).toBe(true);
      });

      it('account deletion remains exempt from email_verified to prevent privacy lockouts', async () => {
        const { db, store } = createPhase3bMockDb();
        const unverifiedUid = 'user_to_delete_unverified';
        store.set(`users/${unverifiedUid}`, {
          uid: unverifiedUid,
          email: 'unverified@example.com',
          displayName: 'Unverified User',
        });

        const adminAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: unverifiedUid,
            email: 'unverified@example.com',
            email_verified: false, // NOT verified
            firebase: { sign_in_provider: 'password' },
          }),
          deleteUser: vi.fn().mockResolvedValue(undefined),
        };

        const adminStorage: any = {
          bucket: () => ({
            getFiles: async () => [[]],
            deleteFiles: vi.fn().mockResolvedValue(undefined),
          }),
        };

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer user_token' },
          body: { confirmEmail: 'unverified@example.com' },
        });

        await handleRequestAccountDeletion(ctx.req, ctx.res, { adminAuth, adminDb: db, adminStorage });
        // Request must NOT be rejected with EMAIL_NOT_VERIFIED (403)
        expect(ctx.getStatus()).not.toBe(403);
        expect([200, 202]).toContain(ctx.getStatus());
      });

      it('verified user with email_verified: true successfully creates games, tournaments, and enqueues outbox mail', async () => {
        const { db, store } = createPhase3bMockDb();
        const verifiedAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: 'fully_verified_host',
            email: 'host@verified.edu',
            email_verified: true,
            firebase: { sign_in_provider: 'google.com' },
          }),
        };

        // 1. Create Game
        const gCtx = createMockReqRes({
          headers: { authorization: 'Bearer tok' },
          body: { quiz: sampleQuiz, hostName: 'Verified Host' },
        });
        await handleCreateGame(gCtx.req, gCtx.res, { adminAuth: verifiedAuth, adminDb: db });
        expect(gCtx.getStatus()).toBe(201);
        expect(gCtx.getData().success).toBe(true);

        // 2. Create Tournament
        const tCtx = createMockReqRes({
          headers: { authorization: 'Bearer tok' },
          body: {
            title: 'Verified Championship',
            registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
            scheduledStartTime: new Date(Date.now() + 172800000).toISOString(),
            quizzes: [{ id: 'q1', title: 'Quiz 1' }],
          },
        });
        await handleCreateTournament(tCtx.req, tCtx.res, { adminAuth: verifiedAuth, adminDb: db });
        expect(tCtx.getStatus()).toBe(201);
        expect(tCtx.getData().success).toBe(true);

        // 3. Enqueue Outbox Email
        const eCtx = createMockReqRes({
          headers: { authorization: 'Bearer tok' },
          body: {
            idempotencyKey: 'verified_outbox_key_1',
            recipientEmail: 'student@verified.edu',
            subject: 'Congratulations',
            htmlContent: '<p>You won!</p>',
          },
        });
        await handleOutboxEnqueue(eCtx.req, eCtx.res, { adminAuth: verifiedAuth, adminDb: db });
        expect(eCtx.getStatus()).toBe(201);
        expect(eCtx.getData().success).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Phase 3C: Remaining Security Remediation
  // ==========================================================================
  describe('Phase 3C — Remaining Security Remediation', () => {

    function createPhase3cMockDb() {
      const store = new Map<string, any>();

      const makeDocRef = (docPath: string): any => ({
        path: docPath,
        id: docPath.split('/').pop(),
        get: async () => ({
          exists: store.has(docPath),
          id: docPath.split('/').pop(),
          data: () => store.get(docPath),
        }),
        set: async (data: any, opts?: { merge?: boolean }) => {
          if (opts?.merge && store.has(docPath)) {
            store.set(docPath, { ...store.get(docPath), ...data });
          } else {
            store.set(docPath, data);
          }
        },
        update: async (data: any) => {
          const cur = store.get(docPath) || {};
          store.set(docPath, { ...cur, ...data });
        },
        delete: async () => {
          store.delete(docPath);
        },
        collection: (subCol: string) => db.collection(`${docPath}/${subCol}`),
      });

      const makeQuery = (colPath: string, filters: Array<{ field: string; op: string; value: any }> = [], limitVal?: number): any => ({
        where: (field: string, op: string, value: any) => makeQuery(colPath, [...filters, { field, op, value }], limitVal),
        orderBy: (field: string, dir?: string) => makeQuery(colPath, filters, limitVal),
        limit: (n: number) => makeQuery(colPath, filters, n),
        get: async () => {
          const docs: any[] = [];
          for (const [key, val] of store.entries()) {
            if (key.startsWith(colPath + '/') && key.split('/').length === colPath.split('/').length + 1) {
              let match = true;
              for (const f of filters) {
                if (f.op === '==' && val?.[f.field] !== f.value) match = false;
                if (f.op === '<=' && !(val?.[f.field] <= f.value)) match = false;
              }
              if (match) {
                docs.push({
                  id: key.replace(colPath + '/', ''),
                  path: key,
                  data: () => val,
                  exists: true,
                });
              }
            }
          }
          const sliced = typeof limitVal === 'number' ? docs.slice(0, limitVal) : docs;
          return {
            forEach: (cb: (doc: any) => void) => sliced.forEach(cb),
            docs: sliced,
            size: sliced.length,
            empty: sliced.length === 0,
          };
        },
      });

      const db: any = {
        doc: (docPath: string) => makeDocRef(docPath),
        collection: (colPath: string) => ({
          doc: (id: string) => makeDocRef(`${colPath}/${id}`),
          where: (f: string, op: string, v: any) => makeQuery(colPath, [{ field: f, op, value: v }]),
          orderBy: (f: string, dir?: string) => makeQuery(colPath, []),
          limit: (n: number) => makeQuery(colPath, [], n),
          get: async () => makeQuery(colPath, []).get(),
          add: async (data: any) => {
            const id = `auto_${Date.now()}_${Math.random()}`;
            const p = `${colPath}/${id}`;
            store.set(p, data);
            return { id, ...makeDocRef(p) };
          },
        }),
        runTransaction: async (updateFunction: (tx: any) => Promise<any>) => {
          const pendingWrites: Array<() => void> = [];
          const tx = {
            get: async (docRef: any) => docRef.get(),
            set: (docRef: any, data: any, opts?: { merge?: boolean }) => {
              pendingWrites.push(() => {
                const p = docRef.path || docRef;
                if (opts?.merge && store.has(p)) {
                  store.set(p, { ...store.get(p), ...data });
                } else {
                  store.set(p, data);
                }
              });
            },
            update: (docRef: any, data: any) => {
              pendingWrites.push(() => {
                const p = docRef.path || docRef;
                const cur = store.get(p) || {};
                store.set(p, { ...cur, ...data });
              });
            },
          };
          const result = await updateFunction(tx);
          for (const write of pendingWrites) {
            await write();
          }
          return result;
        },
        _store: store,
      };

      return { db, store };
    }

    function createMockReqRes(opts: {
      headers?: Record<string, string>;
      body?: any;
      query?: Record<string, string | number>;
      params?: Record<string, string>;
      ip?: string;
    }) {
      let statusCode = 200;
      let responseData: any = null;
      const headers: Record<string, string> = {};

      const req: any = {
        headers: opts.headers || {},
        body: opts.body || {},
        query: opts.query || {},
        params: opts.params || {},
        ip: opts.ip || '127.0.0.1',
        socket: { remoteAddress: opts.ip || '127.0.0.1' },
      };

      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (data: any) => {
          responseData = data;
          return res;
        },
        setHeader: (name: string, value: string) => {
          headers[name.toLowerCase()] = value;
          return res;
        },
      };

      return {
        req,
        res,
        getStatus: () => statusCode,
        getData: () => responseData,
        getHeader: (name: string) => headers[name.toLowerCase()],
      };
    }

    // ==========================================
    // SEC-06: Match Result and Score Validation
    // ==========================================
    describe('SEC-06 — Match Result & Score Validation', () => {
      const hostUid = 'host_tournament_p3c';
      const player1Uid = 'player_p1';
      const player2Uid = 'player_p2';
      const tournamentId = 'tourney_sec06_test';
      const matchId = 'match_round1_0';

      function setupActiveTournament(store: Map<string, any>, matchOverrides: Record<string, any> = {}) {
        store.set(`users/${hostUid}`, { uid: hostUid, status: 'active', email: 'host@tournament.edu' });
        store.set(`users/${player1Uid}`, { uid: player1Uid, status: 'active' });
        store.set(`users/${player2Uid}`, { uid: player2Uid, status: 'active' });

        const match = {
          id: matchId,
          roundIndex: 0,
          matchIndex: 0,
          player1Id: player1Uid,
          player2Id: player2Uid,
          player1Nickname: 'Alice',
          player2Nickname: 'Bob',
          status: 'scheduled',
          ...matchOverrides,
        };

        const tournament = {
          id: tournamentId,
          hostId: hostUid,
          title: 'SEC-06 Championship',
          status: 'active',
          rounds: [
            {
              roundIndex: 0,
              name: 'Round 1',
              status: 'active',
              matches: [match],
            },
          ],
        };

        store.set(`tournaments/${tournamentId}`, tournament);
        store.set(`tournaments/${tournamentId}/matches/${matchId}`, match);
      }

      const hostAuth: any = {
        verifyIdToken: vi.fn().mockResolvedValue({
          uid: hostUid,
          email: 'host@tournament.edu',
          email_verified: true,
          firebase: { sign_in_provider: 'password' },
        }),
      };

      it('rejects match finalization when missing tournamentId or matchId', async () => {
        const { db } = createPhase3cMockDb();
        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { tournamentId }, // missing matchId
        });
        await handleFinalizeMatch(ctx.req, ctx.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(400);
        expect(ctx.getData().error).toContain('tournamentId and matchId are required');
      });

      it('rejects match finalization from unauthorized non-host user with 403', async () => {
        const { db, store } = createPhase3cMockDb();
        setupActiveTournament(store);

        const attackerAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: 'attacker_uid',
            email: 'attacker@evil.com',
            email_verified: true,
            firebase: { sign_in_provider: 'password' },
          }),
        };
        store.set('users/attacker_uid', { uid: 'attacker_uid', status: 'active' });

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer attacker_token' },
          body: { tournamentId, matchId, winnerId: player1Uid, score1: 100, score2: 50 },
        });
        await handleFinalizeMatch(ctx.req, ctx.res, { adminAuth: attackerAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(403);
        expect(ctx.getData().error).toContain('Forbidden');
      });

      it('rejects match finalization when tournament status is not active', async () => {
        const { db, store } = createPhase3cMockDb();
        setupActiveTournament(store);
        const t = store.get(`tournaments/${tournamentId}`);
        store.set(`tournaments/${tournamentId}`, { ...t, status: 'completed' });

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { tournamentId, matchId, winnerId: player1Uid, score1: 100, score2: 50 },
        });
        await handleFinalizeMatch(ctx.req, ctx.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(400);
        expect(ctx.getData().error).toContain('Cannot finalize match when tournament status is completed');
      });

      it('rejects match finalization when bracket participants are unassigned', async () => {
        const { db, store } = createPhase3cMockDb();
        setupActiveTournament(store, { player1Id: undefined, player2Id: undefined });

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { tournamentId, matchId, winnerId: player1Uid, score1: 100, score2: 50 },
        });
        await handleFinalizeMatch(ctx.req, ctx.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(400);
        expect(ctx.getData().error).toContain('participants have not been determined');
      });

      it('returns idempotent 200 with completed match if match is already finalized', async () => {
        const { db, store } = createPhase3cMockDb();
        setupActiveTournament(store, {
          status: 'completed',
          winnerId: player1Uid,
          score1: 200,
          score2: 150,
          finalizedAt: new Date().toISOString(),
        });

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { tournamentId, matchId, winnerId: player1Uid, score1: 200, score2: 150 },
        });
        await handleFinalizeMatch(ctx.req, ctx.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(200);
        expect(ctx.getData().message).toBe('Match already finalized.');
        expect(ctx.getData().match.status).toBe('completed');
      });

      it('linked match: rejects finalization when linked game session is still active', async () => {
        const { db, store } = createPhase3cMockDb();
        const gameId = 'game_active_linked_1';
        setupActiveTournament(store, { gameId });
        store.set(`games/${gameId}`, {
          id: gameId,
          hostId: hostUid,
          status: 'active', // not finished!
        });

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { tournamentId, matchId },
        });
        await handleFinalizeMatch(ctx.req, ctx.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(400);
        expect(ctx.getData().error).toContain('linked game session is still active. Game must be finished first');
      });

      it('linked match: rejects finalization when linked game session belongs to another host', async () => {
        const { db, store } = createPhase3cMockDb();
        const gameId = 'game_other_host_1';
        setupActiveTournament(store, { gameId });
        store.set(`games/${gameId}`, {
          id: gameId,
          hostId: 'another_teacher_uid',
          status: 'finished',
        });

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { tournamentId, matchId },
        });
        await handleFinalizeMatch(ctx.req, ctx.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(403);
        expect(ctx.getData().error).toContain('does not belong to this tournament host');
      });

      it('linked match: authoritatively derives scores and winner from Firestore, ignoring forged client input', async () => {
        const { db, store } = createPhase3cMockDb();
        const gameId = 'game_authoritative_1';
        setupActiveTournament(store, { gameId });
        store.set(`games/${gameId}`, {
          id: gameId,
          hostId: hostUid,
          status: 'finished',
        });
        // Authoritative scores in subcollection: Alice scored 2500, Bob scored 1200
        store.set(`games/${gameId}/players/${player1Uid}`, { id: player1Uid, score: 2500 });
        store.set(`games/${gameId}/players/${player2Uid}`, { id: player2Uid, score: 1200 });

        // Malicious client claims Bob won with 999999 points
        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: {
            tournamentId,
            matchId,
            winnerId: player2Uid, // forged!
            score1: 0,            // forged!
            score2: 999999,       // forged!
          },
        });
        await handleFinalizeMatch(ctx.req, ctx.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(200);

        const finalizedMatch = ctx.getData().match;
        // Server derived score1=2500, score2=1200 and awarded winner to player1Id (Alice)
        expect(finalizedMatch.score1).toBe(2500);
        expect(finalizedMatch.score2).toBe(1200);
        expect(finalizedMatch.winnerId).toBe(player1Uid);
        expect(finalizedMatch.status).toBe('completed');
      });

      it('unlinked match: rejects negative, non-integer, or oversized scores with 400', async () => {
        const { db, store } = createPhase3cMockDb();
        setupActiveTournament(store);

        // Negative score
        const ctx1 = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { tournamentId, matchId, winnerId: player1Uid, score1: -50, score2: 100 },
        });
        await handleFinalizeMatch(ctx1.req, ctx1.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx1.getStatus()).toBe(400);

        // Oversized score (> 500,000)
        const ctx2 = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { tournamentId, matchId, winnerId: player1Uid, score1: 999999999, score2: 100 },
        });
        await handleFinalizeMatch(ctx2.req, ctx2.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx2.getStatus()).toBe(400);
        expect(ctx2.getData().error).toContain('cannot exceed 500000');
      });

      it('unlinked match: rejects winner claim inconsistent with scores with 400', async () => {
        const { db, store } = createPhase3cMockDb();
        setupActiveTournament(store);

        // Player 1 scored 500, Player 2 scored 100, but client claims Player 2 won
        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { tournamentId, matchId, winnerId: player2Uid, score1: 500, score2: 100 },
        });
        await handleFinalizeMatch(ctx.req, ctx.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(400);
        expect(ctx.getData().error).toContain('Player 1 has higher score (500 > 100)');
      });

      it('unlinked match: successfully records scores and winner when consistent with 200', async () => {
        const { db, store } = createPhase3cMockDb();
        setupActiveTournament(store);

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { tournamentId, matchId, winnerId: player1Uid, score1: 1500, score2: 1200 },
        });
        await handleFinalizeMatch(ctx.req, ctx.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(200);
        const match = ctx.getData().match;
        expect(match.winnerId).toBe(player1Uid);
        expect(match.score1).toBe(1500);
        expect(match.score2).toBe(1200);
        expect(match.status).toBe('completed');
      });

      it('handleEndGame: enforces host authorization, state transitions, and idempotency', async () => {
        const { db, store } = createPhase3cMockDb();
        const testGameId = 'game_end_test_1';
        store.set(`users/${hostUid}`, { uid: hostUid, status: 'active' });
        store.set(`games/${testGameId}`, {
          id: testGameId,
          hostId: hostUid,
          status: 'lobby',
        });

        // 1. Cannot finish game in lobby state
        const ctx1 = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { gameId: testGameId },
        });
        await handleEndGame(ctx1.req, ctx1.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx1.getStatus()).toBe(400);
        expect(ctx1.getData().error).toContain('still in lobby');

        // 2. Transition to active -> now finish succeeds
        store.set(`games/${testGameId}`, { id: testGameId, hostId: hostUid, status: 'active' });
        const ctx2 = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { gameId: testGameId },
        });
        await handleEndGame(ctx2.req, ctx2.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx2.getStatus()).toBe(200);
        expect(ctx2.getData().status).toBe('finished');

        // 3. Second call is idempotent
        const ctx3 = createMockReqRes({
          headers: { authorization: 'Bearer host_token' },
          body: { gameId: testGameId },
        });
        await handleEndGame(ctx3.req, ctx3.res, { adminAuth: hostAuth, adminDb: db });
        expect(ctx3.getStatus()).toBe(200);
        expect(ctx3.getData().message).toBe('Game already finished');
      });
    });

    // ==========================================
    // SEC-07: Read Limits & Resource Protection
    // ==========================================
    describe('SEC-07 — Read Limits & Resource Protection', () => {
      const hostUid = 'host_read_limits';
      const userAuth: any = {
        verifyIdToken: vi.fn().mockResolvedValue({
          uid: hostUid,
          email: 'reader@school.edu',
          email_verified: true,
          firebase: { sign_in_provider: 'password' },
        }),
      };

      it('handleGetTournament: validates ID format and returns 400 for malformed IDs', async () => {
        const { db } = createPhase3cMockDb();
        const ctx = createMockReqRes({
          params: { id: '../escaped_path/id!@#$%^' },
        });
        await handleGetTournament(ctx.req, ctx.res, { adminAuth: userAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(400);
        expect(ctx.getData().error).toContain('Invalid tournament ID format');
      });

      it('handleGetTournamentStandings: validates ID and pagination parameters, rejecting negative values', async () => {
        const { db, store } = createPhase3cMockDb();
        const tourneyId = 'tourney_standings_1';
        store.set(`tournaments/${tourneyId}`, { id: tourneyId, title: 'Standings Cup', visibility: 'public' });

        // Negative limit
        const ctx1 = createMockReqRes({
          params: { id: tourneyId },
          query: { limit: -10 },
        });
        await handleGetTournamentStandings(ctx1.req, ctx1.res, { adminAuth: userAuth, adminDb: db });
        expect(ctx1.getStatus()).toBe(400);
        expect(ctx1.getData().error).toContain('Invalid limit parameter');

        // Negative offset
        const ctx2 = createMockReqRes({
          params: { id: tourneyId },
          query: { offset: -5 },
        });
        await handleGetTournamentStandings(ctx2.req, ctx2.res, { adminAuth: userAuth, adminDb: db });
        expect(ctx2.getStatus()).toBe(400);
        expect(ctx2.getData().error).toContain('Invalid offset parameter');
      });

      it('handleGetTournamentStandings: returns paginated standings with metadata and bounds queries', async () => {
        const { db, store } = createPhase3cMockDb();
        const tourneyId = 'tourney_standings_paginated';
        store.set(`tournaments/${tourneyId}`, {
          id: tourneyId,
          title: 'Paginated Tournament',
          visibility: 'public',
          maxParticipants: 32,
          rounds: [],
        });

        // Seed 10 participants
        for (let i = 1; i <= 10; i++) {
          store.set(`tournaments/${tourneyId}/registrations/user_${i}`, {
            tournamentId: tourneyId,
            participantId: `user_${i}`,
            participantNickname: `Player ${i}`,
            status: 'registered',
          });
        }

        const ctx = createMockReqRes({
          params: { id: tourneyId },
          query: { limit: 5, offset: 0 },
        });
        await handleGetTournamentStandings(ctx.req, ctx.res, { adminAuth: userAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(200);
        const data = ctx.getData();
        expect(data.standings.length).toBe(5);
        expect(data.pagination).toEqual({
          total: 10,
          count: 5,
          limit: 5,
          offset: 0,
          hasMore: true,
          isCapped: false,
        });
      });

      it('handleListTournaments: clamps limit to 50 max and returns paginated list with metadata', async () => {
        const { db, store } = createPhase3cMockDb();
        // Seed 15 tournaments
        for (let i = 1; i <= 15; i++) {
          store.set(`tournaments/tourney_${i}`, {
            id: `tourney_${i}`,
            title: `Tournament ${i}`,
            visibility: 'public',
            createdAt: new Date(Date.now() - i * 1000).toISOString(),
          });
        }

        // Request limit 5, offset 2
        const ctx = createMockReqRes({
          query: { limit: 5, offset: 2 },
        });
        await handleListTournaments(ctx.req, ctx.res, { adminAuth: userAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(200);
        const data = ctx.getData();
        expect(data.tournaments.length).toBe(5);
        expect(data.pagination.limit).toBe(5);
        expect(data.pagination.offset).toBe(2);
        expect(data.pagination.hasMore).toBe(true);
      });

      it('handleListUserCertificates: enforces authentication and provides bounded pagination', async () => {
        const { db, store } = createPhase3cMockDb();
        const studentUid = 'student_certs_1';
        store.set(`users/${studentUid}`, { uid: studentUid, status: 'active' });

        // 1. Unauthenticated rejected with 401
        const ctx1 = createMockReqRes({});
        await handleListUserCertificates(ctx1.req, ctx1.res, { adminAuth: userAuth, adminDb: db });
        expect(ctx1.getStatus()).toBe(401);

        // Seed 8 certificates for this student
        for (let i = 1; i <= 8; i++) {
          store.set(`certificates/cert_${i}`, {
            id: `cert_${i}`,
            ownerId: studentUid,
            recipientName: 'Student Alice',
            issueDate: new Date(Date.now() - i * 1000).toISOString(),
          });
        }

        const studentAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: studentUid,
            email: 'alice@student.edu',
            email_verified: false,
            firebase: { sign_in_provider: 'password' },
          }),
        };

        const ctx2 = createMockReqRes({
          headers: { authorization: 'Bearer student_token' },
          query: { limit: 4, offset: 0 },
        });
        await handleListUserCertificates(ctx2.req, ctx2.res, { adminAuth: studentAuth, adminDb: db });
        expect(ctx2.getStatus()).toBe(200);
        const data = ctx2.getData();
        expect(data.certificates.length).toBe(4);
        expect(data.pagination.limit).toBe(4);
        expect(data.pagination.offset).toBe(0);
        expect(data.pagination.count).toBe(4);
        expect(data.pagination.hasMore).toBe(true);
      });

      it('handleListUserCertificates: enforces bounded pagination policy (rejects offset > 500 with 400)', async () => {
        const { db } = createPhase3cMockDb();
        const studentAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: 'student_pag_1',
            email: 'alice@student.edu',
            email_verified: true,
          }),
        };

        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer student_token' },
          query: { limit: 10, offset: 501 },
        });
        await handleListUserCertificates(ctx.req, ctx.res, { adminAuth: studentAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(400);
        expect(ctx.getData().error).toContain('offset cannot exceed 500');
      });

      it('handleListUserCertificates: supports offset > 199 without misleading empty results', async () => {
        const { db, store } = createPhase3cMockDb();
        const studentUid = 'high_cert_student';
        // Seed 220 certificates
        for (let i = 1; i <= 220; i++) {
          store.set(`certificates/cert_${i}`, {
            id: `cert_${i}`,
            ownerId: studentUid,
            verificationId: `v_${i}`,
            title: `Cert ${i}`,
            issueDate: new Date(1700000000000 + i * 1000).toISOString(),
          });
        }

        const studentAuth: any = {
          verifyIdToken: vi.fn().mockResolvedValue({
            uid: studentUid,
            email: 'alice@student.edu',
            email_verified: true,
          }),
        };

        // Query offset=200, limit=10
        const ctx = createMockReqRes({
          headers: { authorization: 'Bearer student_token' },
          query: { limit: 10, offset: 200 },
        });
        await handleListUserCertificates(ctx.req, ctx.res, { adminAuth: studentAuth, adminDb: db });
        expect(ctx.getStatus()).toBe(200);
        const data = ctx.getData();
        expect(data.certificates.length).toBe(10);
        expect(data.pagination.offset).toBe(200);
        expect(data.pagination.count).toBe(10);
        expect(data.pagination.hasMore).toBe(true); // 220 > 210
      });

      it('handleGetTournamentStandings: enforces bounded pagination, handles capped subsets, and rejects offset > 500', async () => {
        const { db, store } = createPhase3cMockDb();
        const tId = 'tourn_pag_test';
        store.set(`tournaments/${tId}`, {
          id: tId,
          title: 'Paginated Tournament',
          status: 'active',
          hostId: 'host_1',
          visibility: 'public',
          maxParticipants: 16,
          rounds: [],
        });

        // Seed 3 registrations (fewer than minimum query limit 16/50)
        for (let i = 1; i <= 3; i++) {
          store.set(`tournaments/${tId}/registrations/p${i}`, {
            participantId: `p${i}`,
            participantNickname: `Player ${i}`,
            status: 'registered',
            registeredAt: new Date().toISOString(),
          });
        }

        // 1. Rejects offset > 500
        const badOffsetCtx = createMockReqRes({
          params: { id: tId },
          query: { offset: 501 },
        });
        await handleGetTournamentStandings(badOffsetCtx.req, badOffsetCtx.res, { adminAuth: null as any, adminDb: db });
        expect(badOffsetCtx.getStatus()).toBe(400);
        expect(badOffsetCtx.getData().error).toContain('offset cannot exceed 500');

        // 2. Normal pagination with fewer participants than limit (total accurate, isCapped: false)
        const okCtx = createMockReqRes({
          params: { id: tId },
          query: { limit: 10, offset: 0 },
        });
        await handleGetTournamentStandings(okCtx.req, okCtx.res, { adminAuth: null as any, adminDb: db });
        expect(okCtx.getStatus()).toBe(200);
        const okData = okCtx.getData();
        expect(okData.standings.length).toBe(3);
        expect(okData.pagination.total).toBe(3);
        expect(okData.pagination.count).toBe(3);
        expect(okData.pagination.hasMore).toBe(false);
        expect(okData.pagination.isCapped).toBe(false);

        // 3. Offset exceeds returned registrations -> empty slice, count: 0, hasMore: false
        const pastEndCtx = createMockReqRes({
          params: { id: tId },
          query: { limit: 10, offset: 10 },
        });
        await handleGetTournamentStandings(pastEndCtx.req, pastEndCtx.res, { adminAuth: null as any, adminDb: db });
        expect(pastEndCtx.getStatus()).toBe(200);
        const pastData = pastEndCtx.getData();
        expect(pastData.standings).toEqual([]);
        expect(pastData.pagination.count).toBe(0);
        expect(pastData.pagination.hasMore).toBe(false);
      });

      it('handleVerifyCertificate: rejects malformed verification IDs with 400', async () => {
        const { db } = createPhase3cMockDb();
        const ctx = createMockReqRes({
          params: { verificationId: 'bad;injection<script>' },
        });
        await handleVerifyCertificate(ctx.req, ctx.res, { adminDb: db });
        expect(ctx.getStatus()).toBe(400);
        expect(ctx.getData().error).toContain('Invalid verification ID format');
      });
    });

    // ==========================================
    // SEC-08: /api/time Nonce Memory Protection
    // ==========================================
    describe('SEC-08 — /api/time Nonce Memory Protection & Lifecycle Manager', () => {
      beforeEach(() => {
        clearAllNonces();
      });

      it('generates cryptographically strong random nonces with timestamp prefix', () => {
        const uid = 'test_user_nonce_1';
        const now = 1700000000000;
        const nonce = issueLatencyNonce(uid, now);

        expect(nonce).toMatch(/^1700000000000_[a-f0-9]{32}$/);
        expect(getPendingNonceCount()).toBe(1);
        expect(getUserPendingNonceCount(uid)).toBe(1);
      });

      it('enforces per-user max pending nonces (caps at 5 and evicts oldest for that user)', () => {
        const uid = 'heavy_user_1';
        const nonces: string[] = [];

        // Issue 5 nonces
        for (let i = 1; i <= 5; i++) {
          nonces.push(issueLatencyNonce(uid, 1700000000000 + i * 100));
        }
        expect(getUserPendingNonceCount(uid)).toBe(5);
        expect(getPendingNonceCount()).toBe(5);

        // 6th nonce must evict nonces[0]
        const sixthNonce = issueLatencyNonce(uid, 1700000001000);
        expect(getUserPendingNonceCount(uid)).toBe(5);
        expect(getPendingNonceCount()).toBe(5);

        // First nonce was evicted
        const checkOld = validateAndConsumeNonce(nonces[0], uid, 1700000001000);
        expect(checkOld.valid).toBe(false);
        expect(checkOld.error).toContain('not found or already consumed');

        // Sixth nonce is valid and consumed
        const checkNew = validateAndConsumeNonce(sixthNonce, uid, 1700000001000);
        expect(checkNew.valid).toBe(true);
        expect(getUserPendingNonceCount(uid)).toBe(4);
      });

      it('atomically consumes nonce upon validation preventing reuse/replay', () => {
        const uid = 'single_use_user';
        const now = 1700000000000;
        const nonce = issueLatencyNonce(uid, now);

        // First consumption succeeds
        const res1 = validateAndConsumeNonce(nonce, uid, now + 50);
        expect(res1.valid).toBe(true);
        expect(res1.issuedAt).toBe(now);

        // Second consumption fails (already deleted)
        const res2 = validateAndConsumeNonce(nonce, uid, now + 100);
        expect(res2.valid).toBe(false);
        expect(res2.error).toContain('not found or already consumed');
      });

      it('rejects nonce echoed by a different authenticated user with 403 error', () => {
        const victimUid = 'victim_user_1';
        const attackerUid = 'attacker_user_2';
        const now = 1700000000000;
        const nonce = issueLatencyNonce(victimUid, now);

        // Attacker attempts to consume victim's nonce
        const res = validateAndConsumeNonce(nonce, attackerUid, now + 50);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('Nonce belongs to another user');
      });

      it('rejects expired nonces (> 30s) and cleans them up', () => {
        const uid = 'expired_user_1';
        const issuedTime = 1700000000000;
        const nonce = issueLatencyNonce(uid, issuedTime);

        // Validate at issued + 31 seconds
        const res = validateAndConsumeNonce(nonce, uid, issuedTime + 31000);
        expect(res.valid).toBe(false);
        expect(res.error).toBe('Nonce expired');
        expect(getUserPendingNonceCount(uid)).toBe(0);
      });

      it('sweeps and purges expired nonces using cleanupExpiredNonces', () => {
        const now = 1700000000000;
        issueLatencyNonce('u1', now - 40000); // expired
        issueLatencyNonce('u2', now - 35000); // expired
        issueLatencyNonce('u3', now - 10000); // active
        issueLatencyNonce('u4', now - 2000);  // active

        expect(getPendingNonceCount()).toBe(4);
        const pruned = cleanupExpiredNonces(now);
        expect(pruned).toBe(2);
        expect(getPendingNonceCount()).toBe(2);
      });
    });
  });

});
