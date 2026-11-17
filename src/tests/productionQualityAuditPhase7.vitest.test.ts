/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { getAnswerOptionState, AnswerOptionVisualState } from '../lib/answerUiState';
import { progressActiveGames } from '../server/gameProgressionEngine';
import { getAuthErrorMessage } from '../components/common/AuthModal';
import app from '../../server';

describe('Phase 7: Production Quality Audit & Improvement Tests', () => {
  // ==========================================
  // PART 1: ANSWER SELECTION UI 8-STATE MODEL
  // ==========================================
  describe('Answer UI 8-State Model', () => {
    it('[UI-01] DEFAULT state: unselected option when question is active and answering is open', () => {
      const state = getAnswerOptionState({
        optionIndex: 0,
        selectedIndices: [],
        isRevealed: false,
        correctAnswers: [1],
        hasSubmitted: false,
        isSubmitting: false,
        isLocked: false,
        isExpired: false,
      });
      expect(state).toBe('DEFAULT');
    });

    it('[UI-02] SELECTED state: student has selected an option but has not submitted', () => {
      const state = getAnswerOptionState({
        optionIndex: 2,
        selectedIndices: [2],
        isRevealed: false,
        correctAnswers: [1],
        hasSubmitted: false,
        isSubmitting: false,
        isLocked: false,
        isExpired: false,
      });
      expect(state).toBe('SELECTED');
    });

    it('[UI-03] SUBMITTING state: option submission is in-flight to server', () => {
      const state = getAnswerOptionState({
        optionIndex: 2,
        selectedIndices: [2],
        isRevealed: false,
        correctAnswers: [1],
        hasSubmitted: false,
        isSubmitting: true,
        isLocked: false,
        isExpired: false,
      });
      expect(state).toBe('SUBMITTING');

      const otherOptionState = getAnswerOptionState({
        optionIndex: 0,
        selectedIndices: [2],
        isRevealed: false,
        correctAnswers: [1],
        hasSubmitted: false,
        isSubmitting: true,
        isLocked: false,
        isExpired: false,
      });
      expect(otherOptionState).toBe('LOCKED');
    });

    it('[UI-04] SUBMITTED state: option is locked in awaiting round completion', () => {
      const state = getAnswerOptionState({
        optionIndex: 1,
        selectedIndices: [1],
        isRevealed: false,
        correctAnswers: [1],
        hasSubmitted: true,
        isSubmitting: false,
        isLocked: false,
        isExpired: false,
      });
      expect(state).toBe('SUBMITTED');

      const nonSelectedState = getAnswerOptionState({
        optionIndex: 3,
        selectedIndices: [1],
        isRevealed: false,
        correctAnswers: [1],
        hasSubmitted: true,
        isSubmitting: false,
        isLocked: false,
        isExpired: false,
      });
      expect(nonSelectedState).toBe('LOCKED');
    });

    it('[UI-05] LOCKED state: question is locked due to integrity strikes or late entry', () => {
      const state = getAnswerOptionState({
        optionIndex: 0,
        selectedIndices: [],
        isRevealed: false,
        correctAnswers: [1],
        hasSubmitted: false,
        isSubmitting: false,
        isLocked: true,
        isExpired: false,
      });
      expect(state).toBe('LOCKED');
    });

    it('[UI-06] CORRECT state: reveals correct answer highlighted green', () => {
      const state = getAnswerOptionState({
        optionIndex: 1,
        selectedIndices: [0], // Student chose 0, but 1 is correct
        isRevealed: true,
        correctAnswers: [1],
        hasSubmitted: true,
        isSubmitting: false,
        isLocked: true,
        isExpired: false,
      });
      expect(state).toBe('CORRECT');
    });

    it('[UI-07] INCORRECT state: student selected wrong option, highlighted red during reveal', () => {
      const state = getAnswerOptionState({
        optionIndex: 0,
        selectedIndices: [0], // Student chose 0, 1 is correct
        isRevealed: true,
        correctAnswers: [1],
        hasSubmitted: true,
        isSubmitting: false,
        isLocked: true,
        isExpired: false,
      });
      expect(state).toBe('INCORRECT');
    });

    it('[UI-08] EXPIRED state: round timer expired or unselected option during reveal', () => {
      const unselectedInReveal = getAnswerOptionState({
        optionIndex: 3,
        selectedIndices: [0],
        isRevealed: true,
        correctAnswers: [1],
        hasSubmitted: true,
        isSubmitting: false,
        isLocked: true,
        isExpired: false,
      });
      expect(unselectedInReveal).toBe('EXPIRED');

      const timerExpiredWithoutSelection = getAnswerOptionState({
        optionIndex: 0,
        selectedIndices: [],
        isRevealed: false,
        correctAnswers: [1],
        hasSubmitted: false,
        isSubmitting: false,
        isLocked: false,
        isExpired: true,
      });
      expect(timerExpiredWithoutSelection).toBe('EXPIRED');
    });
  });

  // ==========================================
  // PART 2: AUTOMATIC QUESTION PROGRESSION
  // ==========================================
  describe('Server-Authoritative Automatic Progression Engine', () => {
    it('[AUTO-01] automatically transitions question_active to reveal when timer expires', async () => {
      const mockGameId = 'game_auto_1';
      const now = Date.now();

      const gameDoc = {
        id: mockGameId,
        ref: { id: mockGameId },
        status: 'question_active',
        currentQuestionIndex: 0,
        deadlineTimestampMs: now - 100, // Expired
        isPaused: false,
        questions: [{ text: 'Question 1', options: ['A', 'B'], timeLimit: 20 }],
      };

      const secretsDoc = {
        '0': { correctAnswers: [1], acceptedTextAnswers: [] },
      };

      let txUpdatedPayload: any = null;

      const mockDb: any = {
        collection: (col: string) => ({
          where: () => ({
            get: async () => ({
              empty: false,
              docs: [{ id: mockGameId, ref: { id: mockGameId }, data: () => gameDoc }],
            }),
          }),
        }),
        doc: (p: string) => ({
          get: async () => ({
            exists: true,
            data: () => secretsDoc,
          }),
        }),
        runTransaction: async (cb: any) => {
          const fakeTx = {
            get: async (ref: any) => ({
              exists: true,
              data: () => (ref.id === mockGameId ? gameDoc : secretsDoc),
            }),
            update: (_ref: any, payload: any) => {
              txUpdatedPayload = payload;
            },
          };
          await cb(fakeTx);
        },
      };

      await progressActiveGames(mockDb);

      expect(txUpdatedPayload).not.toBeNull();
      expect(txUpdatedPayload.status).toBe('reveal');
      expect(txUpdatedPayload.revealDeadlineTimestampMs).toBeGreaterThan(now);
      expect(txUpdatedPayload.questions[0].correctAnswers).toEqual([1]);
    });

    it('[AUTO-02] automatically advances reveal to next question when reveal window expires in automatic mode', async () => {
      const mockGameId = 'game_auto_2';
      const now = Date.now();

      const gameDoc = {
        id: mockGameId,
        ref: { id: mockGameId },
        status: 'reveal',
        currentQuestionIndex: 0,
        revealDeadlineTimestampMs: now - 50, // Expired
        isPaused: false,
        settings: { progressionMode: 'automatic' },
        questions: [
          { text: 'Q1', options: ['A', 'B'], timeLimit: 15 },
          { text: 'Q2', options: ['C', 'D'], timeLimit: 20 },
        ],
      };

      let txUpdatedPayload: any = null;

      const mockDb: any = {
        collection: (col: string) => ({
          where: () => ({
            get: async () => ({
              empty: false,
              docs: [{ id: mockGameId, ref: { id: mockGameId }, data: () => gameDoc }],
            }),
          }),
        }),
        doc: () => ({
          get: async () => ({ exists: false, data: () => ({}) }),
        }),
        runTransaction: async (cb: any) => {
          const fakeTx = {
            get: async () => ({
              exists: true,
              data: () => gameDoc,
            }),
            update: (_ref: any, payload: any) => {
              txUpdatedPayload = payload;
            },
          };
          await cb(fakeTx);
        },
      };

      await progressActiveGames(mockDb);

      expect(txUpdatedPayload).not.toBeNull();
      expect(txUpdatedPayload.status).toBe('question_active');
      expect(txUpdatedPayload.currentQuestionIndex).toBe(1);
      expect(txUpdatedPayload.timeLimit).toBe(20);
      expect(txUpdatedPayload.deadlineTimestampMs).toBeGreaterThan(now);
    });

    it('[AUTO-03] does NOT auto-advance when progressionMode is manual (host controls advance)', async () => {
      const mockGameId = 'game_manual_1';
      const now = Date.now();

      const gameDoc = {
        id: mockGameId,
        ref: { id: mockGameId },
        status: 'reveal',
        currentQuestionIndex: 0,
        revealDeadlineTimestampMs: now - 50,
        isPaused: false,
        settings: { progressionMode: 'manual' },
        questions: [
          { text: 'Q1', options: ['A', 'B'], timeLimit: 15 },
          { text: 'Q2', options: ['C', 'D'], timeLimit: 20 },
        ],
      };

      let txCalled = false;

      const mockDb: any = {
        collection: (col: string) => ({
          where: () => ({
            get: async () => ({
              empty: false,
              docs: [{ id: mockGameId, ref: { id: mockGameId }, data: () => gameDoc }],
            }),
          }),
        }),
        runTransaction: async () => {
          txCalled = true;
        },
      };

      await progressActiveGames(mockDb);

      expect(txCalled).toBe(false);
    });

    it('[AUTO-04] finishes quiz when the last question reveal window expires', async () => {
      const mockGameId = 'game_last_q';
      const now = Date.now();

      const gameDoc = {
        id: mockGameId,
        ref: { id: mockGameId },
        status: 'reveal',
        currentQuestionIndex: 1, // Last question (index 1 of 2)
        revealDeadlineTimestampMs: now - 100,
        isPaused: false,
        settings: { progressionMode: 'automatic' },
        questions: [
          { text: 'Q1', options: ['A', 'B'] },
          { text: 'Q2', options: ['C', 'D'] },
        ],
      };

      let txUpdatedPayload: any = null;

      const mockDb: any = {
        collection: () => ({
          where: () => ({
            get: async () => ({
              empty: false,
              docs: [{ id: mockGameId, ref: { id: mockGameId }, data: () => gameDoc }],
            }),
          }),
        }),
        runTransaction: async (cb: any) => {
          const fakeTx = {
            get: async () => ({
              exists: true,
              data: () => gameDoc,
            }),
            update: (_ref: any, payload: any) => {
              txUpdatedPayload = payload;
            },
          };
          await cb(fakeTx);
        },
      };

      await progressActiveGames(mockDb);

      expect(txUpdatedPayload).not.toBeNull();
      expect(txUpdatedPayload.status).toBe('finished');
      expect(txUpdatedPayload.revealDeadlineTimestampMs).toBeNull();
    });
  });

  // ==========================================
  // PART 3: AUTHENTICATION & EMAIL UX
  // ==========================================
  describe('Authentication & Email Verification UX', () => {
    it('[AUTH-01] getAuthErrorMessage provides user-friendly actionable guidance', () => {
      expect(getAuthErrorMessage('auth/popup-blocked')).toContain('browser blocked the sign-in popup');
      expect(getAuthErrorMessage('auth/wrong-password')).toContain('Incorrect email or password');
      expect(getAuthErrorMessage('auth/weak-password')).toContain('Password is too short or weak');
      expect(getAuthErrorMessage('auth/too-many-requests')).toContain('Too many unsuccessful attempts');
      expect(getAuthErrorMessage('unknown-error', 'Custom fallback')).toBe('Custom fallback');
    });
  });

  // ==========================================
  // PART 4: ACCOUNT DELETION REMOVAL VERIFICATION
  // ==========================================
  describe('Account Deletion Removal Verification', () => {
    const getRegisteredRoutes = () => {
      const routes: Array<{ path: string; method?: string }> = [];
      const stack = (app as any)._router?.stack || [];
      for (const layer of stack) {
        if (layer.route) {
          const methods = Object.keys(layer.route.methods || {});
          routes.push({ path: layer.route.path, method: methods[0] });
        }
      }
      return routes;
    };

    it('[DEL-01] POST /api/account/delete route is completely removed from server', () => {
      const routes = getRegisteredRoutes();
      const hasRoute = routes.some(r => r.path === '/api/account/delete');
      expect(hasRoute).toBe(false);
    });

    it('[DEL-02] GET /api/account/delete/status route is completely removed from server', () => {
      const routes = getRegisteredRoutes();
      const hasRoute = routes.some(r => r.path === '/api/account/delete/status');
      expect(hasRoute).toBe(false);
    });

    it('[DEL-03] POST /api/account/delete/retry route is completely removed from server', () => {
      const routes = getRegisteredRoutes();
      const hasRoute = routes.some(r => r.path === '/api/account/delete/retry');
      expect(hasRoute).toBe(false);
    });

    it('[DEL-04] POST /api/admin/users/:uid/delete route is completely removed from server', () => {
      const routes = getRegisteredRoutes();
      const hasRoute = routes.some(r => r.path === '/api/admin/users/:uid/delete');
      expect(hasRoute).toBe(false);
    });

    it('[DEL-05] POST /api/purge-user-data route is completely removed from server', () => {
      const routes = getRegisteredRoutes();
      const hasRoute = routes.some(r => r.path === '/api/purge-user-data');
      expect(hasRoute).toBe(false);
    });
  });
});
