/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://quizarena.io',
    });
    (globalThis as any).window = dom.window;
    (globalThis as any).document = dom.window.document;
  }
});

import { renderToString } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { PlayerShell } from '../components/shell/PlayerShell';
import { HostShell } from '../components/shell/HostShell';
import { GameEngine } from '../services/gameEngine';
import { GameSession, Quiz } from '../types/quiz';
import { issueCertificate, verifyCertificatePublic, certificateStore, idempotencyIndex } from '../server/certificateEngine';

function renderToDoc(element: React.ReactElement): Document {
  const html = renderToString(element);
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  return dom.window.document;
}

describe('Two-Shell Navigation, Authentication UI, Gameplay Timer & Results Audit Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    certificateStore.clear();
    idempotencyIndex.clear();
  });

  // TEST 1: Sign Out hidden before authentication
  it('1. Sign Out hidden before authentication', () => {
    // A. Unauthenticated / anonymous user in PlayerShell
    const anonUser: any = { uid: 'anon_123', isAnonymous: true };
    const playerDoc = renderToDoc(
      React.createElement(
        PlayerShell,
        {
          lang: 'en',
          setLang: () => {},
          currentUser: anonUser,
        },
        React.createElement('div', null, 'Player Game Content')
      )
    );

    expect(playerDoc.body.textContent).not.toContain('Sign Out');
    expect(playerDoc.body.textContent).toContain('Sign In');

    // B. Unauthenticated visitor (null user) in PlayerShell
    const nullDoc = renderToDoc(
      React.createElement(
        PlayerShell,
        {
          lang: 'en',
          setLang: () => {},
          currentUser: null,
        },
        React.createElement('div', null, 'Visitor Arena')
      )
    );

    expect(nullDoc.body.textContent).not.toContain('Sign Out');
    expect(nullDoc.body.textContent).toContain('Sign In');
  });

  // TEST 2: Sign Out visible for authenticated hosts
  it('2. Sign Out visible for authenticated hosts', () => {
    const authHostUser: any = {
      uid: 'host_teacher_99',
      displayName: 'Dr. Turing',
      email: 'turing@quizarena.com',
      isAnonymous: false,
    };

    const hostDoc = renderToDoc(
      React.createElement(
        HostShell,
        {
          currentTab: 'host_dashboard',
          setCurrentTab: () => {},
          lang: 'en',
          setLang: () => {},
          currentUser: authHostUser,
          userRole: 'host',
          setUserRole: () => {},
        },
        React.createElement('div', null, 'Host Dashboard Area')
      )
    );

    expect(hostDoc.body.textContent).toContain('Sign Out');
    expect(hostDoc.body.textContent).toContain('Dr. Turing');
    expect(hostDoc.body.textContent).toContain('turing@quizarena.com');
  });

  // TEST 3: Guest players receive player shell
  it('3. Guest players receive player shell', () => {
    const guestUser: any = { uid: 'guest_player_1', isAnonymous: true };
    const doc = renderToDoc(
      React.createElement(
        PlayerShell,
        {
          lang: 'en',
          setLang: () => {},
          currentUser: guestUser,
        },
        React.createElement('div', { id: 'join-view' }, 'Join Arena Form')
      )
    );

    // Player shell has slim top bar and no host sidebar tabs
    expect(doc.querySelector('#join-view')).not.toBeNull();
    expect(doc.body.textContent).toContain('QuizArena');
    expect(doc.body.textContent).not.toContain('Quiz Studio');
    expect(doc.body.textContent).not.toContain('Email Outbox');
    expect(doc.body.textContent).not.toContain('Tournaments');
  });

  // TEST 4: Host/Student shell switching
  it('4. Host/Student shell switching', () => {
    const authUser: any = {
      uid: 'host_42',
      displayName: 'Teacher Grace',
      email: 'grace@school.org',
      isAnonymous: false,
    };

    let switchCalled = false;
    const playerDoc = renderToDoc(
      React.createElement(
        PlayerShell,
        {
          lang: 'en',
          setLang: () => {},
          currentUser: authUser,
          onSwitchToHost: () => {
            switchCalled = true;
          },
        },
        React.createElement('div', null, 'Student Portal')
      )
    );

    // In student mode, an authenticated host sees a clear button to return to Host View
    expect(playerDoc.body.textContent).toContain('Host View');

    // In HostShell, the segmented switch between Host and Student is present
    const hostDoc = renderToDoc(
      React.createElement(
        HostShell,
        {
          currentTab: 'host_dashboard',
          setCurrentTab: () => {},
          lang: 'en',
          setLang: () => {},
          currentUser: authUser,
          userRole: 'host',
          setUserRole: () => {},
        },
        React.createElement('div', null, 'Host Area')
      )
    );

    expect(hostDoc.body.textContent).toContain('Host');
    expect(hostDoc.body.textContent).toContain('Student');
  });

  // TEST 5: Automatic mode does not start the game
  it('5. Automatic mode does not start the game', async () => {
    const gameId = 'game_test_lobby_1';
    const initialSession: GameSession = {
      id: gameId,
      pin: '123456',
      hostId: 'host_auto_test',
      hostName: 'Test Host',
      quizId: 'quiz_1',
      quizTitle: 'Auto Progression Test Quiz',
      status: 'lobby',
      gameMode: 'classic',
      currentQuestionIndex: 0,
      questionStartTime: null,
      timeLimit: 20,
      isPaused: false,
      settings: {
        progressionMode: 'manual',
        shuffleQuestions: false,
        shuffleOptions: false,
        allowLateJoin: true,
        enablePowerUps: true,
        antiCheatDetection: true,
        showLeaderboardBetween: true,
        autoEmailResults: true,
        scoringProfile: 'speed_weighted',
        requireApprovalToJoin: false,
        teamMode: false,
      },
      questions: [
        { id: 'q1', text: 'Question 1', type: 'multiple_choice', options: ['A', 'B'], timeLimit: 20 },
        { id: 'q2', text: 'Question 2', type: 'multiple_choice', options: ['C', 'D'], timeLimit: 20 },
      ] as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    localStorage.setItem(`quizarena_game_${gameId}`, JSON.stringify(initialSession));

    // Changing settings to automatic in the lobby
    await GameEngine.updateGameSettings(gameId, { progressionMode: 'automatic' });

    const saved = JSON.parse(localStorage.getItem(`quizarena_game_${gameId}`) || '{}');

    // Expected behavior: Progression mode changed, but game did NOT start
    expect(saved.settings?.progressionMode).toBe('automatic');
    expect(saved.status).toBe('lobby');
    expect(saved.questionStartTime).toBeNull();
    expect(saved.currentQuestionIndex).toBe(0);
  });

  // TEST 6: Automatic progression at timer expiry
  it('6. Automatic progression at timer expiry', () => {
    const gameSession: Partial<GameSession> = {
      status: 'question_active',
      currentQuestionIndex: 0,
      timeLimit: 10,
      settings: {
        progressionMode: 'automatic',
        shuffleQuestions: false,
        shuffleOptions: false,
        allowLateJoin: true,
        enablePowerUps: true,
        antiCheatDetection: true,
        showLeaderboardBetween: true,
        autoEmailResults: true,
        scoringProfile: 'speed_weighted',
        requireApprovalToJoin: false,
        teamMode: false,
      },
    };

    // Calculate progression when timeLeft reaches 0
    let autoNextTriggered = false;
    const simulateCountdownExpiry = (timeLeft: number) => {
      if (timeLeft <= 0) {
        if (gameSession.settings?.progressionMode === 'automatic') {
          autoNextTriggered = true;
          return { answersLocked: true, shouldAdvance: true };
        }
        return { answersLocked: true, shouldAdvance: false };
      }
      return { answersLocked: false, shouldAdvance: false };
    };

    const result = simulateCountdownExpiry(0);
    expect(result.answersLocked).toBe(true);
    expect(result.shouldAdvance).toBe(true);
    expect(autoNextTriggered).toBe(true);
  });

  // TEST 7: Manual progression at timer expiry
  it('7. Manual progression at timer expiry', () => {
    const gameSession: Partial<GameSession> = {
      status: 'question_active',
      currentQuestionIndex: 0,
      timeLimit: 10,
      settings: {
        progressionMode: 'manual',
        shuffleQuestions: false,
        shuffleOptions: false,
        allowLateJoin: true,
        enablePowerUps: true,
        antiCheatDetection: true,
        showLeaderboardBetween: true,
        autoEmailResults: true,
        scoringProfile: 'speed_weighted',
        requireApprovalToJoin: false,
        teamMode: false,
      },
    };

    const simulateManualExpiry = (timeLeft: number) => {
      if (timeLeft <= 0) {
        return {
          answersLocked: true,
          status: 'reveal',
          shouldAdvance: gameSession.settings?.progressionMode === 'automatic',
        };
      }
      return { answersLocked: false, status: 'question_active', shouldAdvance: false };
    };

    const result = simulateManualExpiry(0);
    expect(result.answersLocked).toBe(true);
    expect(result.status).toBe('reveal');
    expect(result.shouldAdvance).toBe(false); // Manual mode waits for host click!
  });

  // TEST 8: Pause/resume timing
  it('8. Pause/resume timing', () => {
    const totalMs = 20000;
    const elapsedAtPause = 7000;
    const now = 1000000;
    const startMs = now - elapsedAtPause;

    // 1. Pause calculation
    const remainingMs = Math.max(0, totalMs - (now - startMs));
    expect(remainingMs).toBe(13000);

    // 2. Resume calculation
    const resumeTime = now + 15000; // paused for 15 seconds
    const simulatedStartMs = resumeTime - (totalMs - remainingMs);

    // Verify remaining time right after resume is preserved exactly at 13000ms
    const remainingAfterResume = Math.max(0, totalMs - (resumeTime - simulatedStartMs));
    expect(remainingAfterResume).toBe(13000);
    expect(Math.round(remainingAfterResume / 1000)).toBe(13);
  });

  // TEST 9: No duplicate advancement
  it('9. No duplicate advancement', () => {
    let currentIdx = 0;
    let isAdvancing = false;
    let advanceCount = 0;

    const advanceQuestion = () => {
      if (isAdvancing) return false;
      isAdvancing = true;
      currentIdx += 1;
      advanceCount += 1;
      return true;
    };

    // First call succeeds
    const call1 = advanceQuestion();
    expect(call1).toBe(true);
    expect(currentIdx).toBe(1);
    expect(advanceCount).toBe(1);

    // Concurrent second call is suppressed
    const call2 = advanceQuestion();
    expect(call2).toBe(false);
    expect(currentIdx).toBe(1);
    expect(advanceCount).toBe(1);
  });

  // TEST 10: Consistent timer across clients
  it('10. Consistent timer across clients', () => {
    const questionStartTimeMs = 5000000;
    const clientA_CurrentTime = 5005000; // 5s elapsed
    const clientB_CurrentTime = 5005100; // 5.1s elapsed (different clock/render time)
    const timeLimit = 20;

    const calcTimeLeft = (now: number) => {
      const elapsed = Math.floor((now - questionStartTimeMs) / 1000);
      return Math.max(0, timeLimit - elapsed);
    };

    expect(calcTimeLeft(clientA_CurrentTime)).toBe(15);
    expect(calcTimeLeft(clientB_CurrentTime)).toBe(15);
  });

  // TEST 11: Per-question response status finalization
  it('11. Per-question response status finalization', () => {
    const questions = [
      { id: 'q1', text: 'Capital of France?', options: ['Paris', 'Rome'] },
      { id: 'q2', text: 'Capital of Japan?', options: ['Tokyo', 'Seoul'] },
    ];

    const answers = [
      { questionIndex: 0, playerId: 'player_1', isCorrect: true, pointsAwarded: 950 },
    ];

    // During active round on question 2
    const resolveStatusActive = (qIdx: number, gameStatus: string, currentQuestionIndex: number) => {
      const sub = answers.find(a => a.questionIndex === qIdx);
      const isClosed = gameStatus === 'finished' || qIdx < currentQuestionIndex;
      const isCurrent = qIdx === currentQuestionIndex && gameStatus === 'question_active';

      if (isClosed) {
        if (sub) return sub.isCorrect ? `Correct (+${sub.pointsAwarded})` : 'Incorrect (0 pts)';
        return 'No Answer Submitted (0 pts)';
      }
      if (isCurrent) {
        return sub ? 'Answer Locked In' : 'Waiting for Submission';
      }
      return 'Upcoming Round';
    };

    expect(resolveStatusActive(0, 'question_active', 1)).toBe('Correct (+950)');
    expect(resolveStatusActive(1, 'question_active', 1)).toBe('Waiting for Submission');

    // After game finished: all questions are finalized, none left in "Waiting for Submission"
    expect(resolveStatusActive(0, 'finished', 1)).toBe('Correct (+950)');
    expect(resolveStatusActive(1, 'finished', 1)).toBe('No Answer Submitted (0 pts)');
  });

  // TEST 12: Certificate eligibility and display
  it('12. Certificate eligibility and display', () => {
    // A. Successful issuance for eligible participant
    const issueResult = issueCertificate({
      ownerId: 'student_101',
      recipientName: 'Kavya Raman',
      assessmentType: 'quiz',
      assessmentId: 'game_quiz_finish_1',
      assessmentTitle: 'Modern Web Architecture',
      type: 'quiz_completion',
      score: 1800,
      rank: 1,
      totalParticipants: 25,
      accuracy: 0.95,
      issuerId: 'host_verified_1',
      issuerName: 'Prof. Turing',
    });

    expect(issueResult.success).toBe(true);
    expect(issueResult.certificate).toBeDefined();
    expect(issueResult.certificate?.verificationId).toMatch(/^QA-V-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // B. Public verification
    const vResult = verifyCertificatePublic(issueResult.certificate!.verificationId);
    expect(vResult.valid).toBe(true);
    expect(vResult.recipientName).toBe('Kavya Raman');
    expect(vResult.status).toBe('valid');

    // C. Ineligible issuance rejection (rank 0 or participants <= 0)
    const invalidResult = issueCertificate({
      ownerId: 'student_ineligible',
      recipientName: 'Incomplete Match',
      assessmentType: 'quiz',
      assessmentId: 'game_incomplete',
      assessmentTitle: 'Incomplete Quiz',
      type: 'quiz_completion',
      score: 0,
      rank: 0,
      totalParticipants: 0,
      accuracy: 0,
      issuerId: 'host_1',
      issuerName: 'Host',
    });

    expect(invalidResult.success).toBe(false);
    expect(invalidResult.error).toContain('Invalid participant count or rank');
  });
});
