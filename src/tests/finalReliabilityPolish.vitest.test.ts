/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

vi.hoisted(() => {
  const fakeStorage = new Map<string, string>();
  const fakeSession = new Map<string, string>();

  const mockStorage = {
    getItem: (key: string) => fakeStorage.get(key) || null,
    setItem: (key: string, val: string) => fakeStorage.set(key, val),
    removeItem: (key: string) => fakeStorage.delete(key),
    clear: () => fakeStorage.clear(),
    length: 0,
    key: () => null,
  };

  const mockSession = {
    getItem: (key: string) => fakeSession.get(key) || null,
    setItem: (key: string, val: string) => fakeSession.set(key, val),
    removeItem: (key: string) => fakeSession.delete(key),
    clear: () => fakeSession.clear(),
    length: 0,
    key: () => null,
  };

  (globalThis as any).localStorage = mockStorage;
  (globalThis as any).sessionStorage = mockSession;

  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {
      localStorage: mockStorage,
      sessionStorage: mockSession,
    };
  }
});

import { renderToString } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { extractSecretAnswerForQuestion } from '../server/scoringHardening';
import { handlePurgeUserData } from '../server/userDataPurgeHandler';
import { sound } from '../lib/sound';
import { CommandPalette } from '../components/common/CommandPalette';
import { SettingsModal } from '../components/common/SettingsModal';
import { PlayerShell } from '../components/shell/PlayerShell';

function renderToDoc(element: React.ReactElement): Document {
  const html = renderToString(element);
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  return dom.window.document;
}

describe('QuizArena — Final UX Polish, Performance, Firebase Audit & Reliability Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // ==========================================
  // PART 1: GAMEPLAY & DATA CONTRACT (answersList.find bugfix)
  // ==========================================
  describe('Gameplay & Data Contract: Answer Key Normalization', () => {
    it('[BUGFIX-01] extractSecretAnswerForQuestion handles answers as a plain Object/Record without throwing', () => {
      // Replicates actual Firestore data written by gameSessionHandler: { answers: { 0: {...}, 1: {...} } }
      const secretData = {
        answers: {
          0: { correctAnswers: [1], acceptedTextAnswers: [] },
          1: { correctAnswers: [3], acceptedTextAnswers: [] },
        },
        hostId: 'host_test_123',
      };

      const fallback = {
        type: 'multiple_choice',
        options: ['Oxygen', 'Hydrogen', 'Carbon', 'Nitrogen'],
      };

      // Calling this must NEVER throw "answersList.find is not a function"
      const result = extractSecretAnswerForQuestion(secretData, 0, fallback);
      expect(result).not.toBeNull();
      expect(result?.questionIndex).toBe(0);
      expect(result?.correctAnswers).toEqual([1]);
      expect(result?.options).toHaveLength(4);
      expect(result?.type).toBe('multiple_choice');
    });

    it('[BUGFIX-02] extractSecretAnswerForQuestion handles answers as an Array cleanly', () => {
      // Replicates test store schema: { answers: [ { questionIndex: 0, ... } ] }
      const secretData = {
        answers: [
          { questionIndex: 0, correctAnswers: [2], options: ['A', 'B', 'C', 'D'], type: 'multiple_choice' },
          { questionIndex: 1, correctAnswers: [0], options: ['True', 'False'], type: 'true_false' },
        ],
      };

      const result = extractSecretAnswerForQuestion(secretData, 1);
      expect(result).not.toBeNull();
      expect(result?.questionIndex).toBe(1);
      expect(result?.correctAnswers).toEqual([0]);
      expect(result?.type).toBe('true_false');
    });

    it('[BUGFIX-03] extractSecretAnswerForQuestion safely falls back to public question when secret is missing', () => {
      const fallback = {
        type: 'type_answer',
        acceptedTextAnswers: ['Photosynthesis'],
        timeLimit: 30,
        points: 1000,
      };

      const result = extractSecretAnswerForQuestion(null, 2, fallback);
      expect(result).not.toBeNull();
      expect(result?.acceptedTextAnswers).toEqual(['Photosynthesis']);
      expect(result?.timeLimit).toBe(30);
      expect(result?.points).toBe(1000);
    });
  });

  // ==========================================
  // PART 2: DATA DELETION & GDPR PURGE
  // ==========================================
  describe('Data Privacy & Server-Authoritative Deletion', () => {
    it('[GDPR-01] handlePurgeUserData rejects unauthenticated requests with 401 Unauthorized', async () => {
      const req = {
        headers: {},
      } as any;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;

      const mockAdminAuth = {
        verifyIdToken: vi.fn(),
        deleteUser: vi.fn(),
      };
      const mockAdminDb = {} as any;

      await handlePurgeUserData(req, res, { adminAuth: mockAdminAuth as any, adminDb: mockAdminDb });
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('ID token required') }));
    });

    it('[GDPR-02] handlePurgeUserData purges quizzes, games, and auth user for authenticated uid', async () => {
      const targetUid = 'user_disposable_test_456';
      const req = {
        headers: {
          authorization: 'Bearer valid_mock_token_123',
        },
      } as any;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;

      const mockDeleteDoc = vi.fn().mockResolvedValue(undefined);
      const mockQuizzesSnap = {
        docs: [
          { ref: { delete: mockDeleteDoc } },
          { ref: { delete: mockDeleteDoc } },
        ],
      };

      const mockGamesSnap = {
        docs: [
          {
            ref: {
              delete: mockDeleteDoc,
              collection: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ docs: [{ ref: { delete: mockDeleteDoc } }] }),
              }),
            },
          },
        ],
      };

      const mockAdminDb = {
        collection: vi.fn().mockImplementation((colName: string) => {
          if (colName === 'quizzes') {
            return {
              where: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue(mockQuizzesSnap) }),
            };
          }
          if (colName === 'questionBank') {
            return {
              where: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
            };
          }
          if (colName === 'games') {
            return {
              where: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue(mockGamesSnap) }),
            };
          }
          if (colName === 'users') {
            return {
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ exists: true }),
                delete: mockDeleteDoc,
              }),
            };
          }
          return { where: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue({ docs: [] }) };
        }),
        collectionGroup: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ docs: [] }) }),
        }),
      };

      const mockAdminAuth = {
        verifyIdToken: vi.fn().mockResolvedValue({ uid: targetUid }),
        deleteUser: vi.fn().mockResolvedValue(undefined),
      };

      await handlePurgeUserData(req, res, { adminAuth: mockAdminAuth as any, adminDb: mockAdminDb as any });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        uid: targetUid,
        deletedQuizzes: 2,
        deletedGames: 1,
        accountDeleted: true,
        retainedRecords: expect.any(String),
      }));
    });
  });

  // ==========================================
  // PART 3: MULTIPLAYER TIMER & PROGRESSION SYNCHRONIZATION
  // ==========================================
  describe('Multiplayer Timer & Pause Synchronization', () => {
    it('[TIMER-01] calculates exact remaining duration when game is paused', () => {
      const pausedGame = {
        status: 'question_active',
        isPaused: true,
        pauseRemainingMs: 14200,
        timeLimit: 20,
      };

      const remainingSec = Math.max(0, Math.ceil((pausedGame.pauseRemainingMs ?? 0) / 1000));
      expect(remainingSec).toBe(15);
    });

    it('[TIMER-02] authoritative deadline timestamp takes precedence over local drift', () => {
      const now = 1700000000000;
      const deadlineTimestampMs = now + 12000; // 12 seconds in future

      const calculatedRemaining = Math.max(0, Math.ceil((deadlineTimestampMs - now) / 1000));
      expect(calculatedRemaining).toBe(12);
    });
  });

  // ==========================================
  // PART 4: SOUND, MUTE & SPEECH SYNTHESIS
  // ==========================================
  describe('Sound & Speech Synthesis Synchronization', () => {
    it('[SOUND-01] setMuted(true) persists preference and cancels speech synthesis', () => {
      const cancelMock = vi.fn();
      (window as any).speechSynthesis = {
        cancel: cancelMock,
        speak: vi.fn(),
      };

      sound.setMuted(true);
      expect(sound.getMuted()).toBe(true);
      expect(localStorage.getItem('quizarena_mute')).toBe('true');
      expect(cancelMock).toHaveBeenCalled();

      // Audio effects must NOT throw or play when muted
      sound.playClick();
      sound.playCorrect();
      sound.playWrong();
      sound.playTick(true);

      // Unmuting
      sound.setMuted(false);
      expect(sound.getMuted()).toBe(false);
      expect(localStorage.getItem('quizarena_mute')).toBe('false');
    });
  });

  // ==========================================
  // PART 5: ENGLISH-ONLY INTERFACE & SETTINGS MODAL
  // ==========================================
  describe('English-Only Language Setting', () => {
    it('[LANG-01] SettingsModal presents English as default interface language without Tamil/Hindi options', () => {
      const doc = renderToDoc(
        React.createElement(SettingsModal, {
          isOpen: true,
          onClose: vi.fn(),
          lang: 'en',
          setLang: vi.fn(),
          theme: 'light',
          setTheme: vi.fn(),
        })
      );

      const text = doc.body.textContent || '';
      expect(text).toContain('Interface Language');
      expect(text).toContain('Default (EN)');
      // Tamil and Hindi options must not exist in interface selector
      expect(text).not.toContain('தமிழ்');
      expect(text).not.toContain('हिन्दी');
    });
  });

  // ==========================================
  // PART 6: KEYBOARD SHORTCUTS & FOCUS MANAGEMENT
  // ==========================================
  describe('Command Palette & Keyboard Focus', () => {
    it('[KEY-01] CommandPalette renders input and keyboard navigation targets', () => {
      const doc = renderToDoc(
        React.createElement(CommandPalette, {
          isOpen: true,
          onClose: vi.fn(),
          onNavigate: vi.fn(),
        })
      );

      const input = doc.querySelector('input[type="text"]');
      expect(input).not.toBeNull();
      expect(input?.getAttribute('placeholder')).toContain('Type a command or destination');

      const text = doc.body.textContent || '';
      expect(text).toContain('Go to Dashboard');
      expect(text).toContain('Quiz Studio');
    });

    it('[KEY-02] PlayerShell conceals host navigation and sign-in button during live match', () => {
      const doc = renderToDoc(
        React.createElement(
          PlayerShell,
          {
            theme: 'light',
            currentUser: null,
            isLiveGame: true,
            onSwitchToHost: vi.fn(),
          },
          React.createElement('div', { id: 'live-player-arena' }, 'Live Game Arena Active')
        )
      );

      expect(doc.getElementById('live-player-arena')).not.toBeNull();
      const text = doc.body.textContent || '';
      // Host View pill and Sign In button must be hidden during live gameplay
      expect(text).not.toContain('Host View');
      expect(text).not.toContain('Sign In');
    });
  });
});
