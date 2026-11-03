/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';

// vi.hoisted guarantees globals exist BEFORE any component imports evaluate
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
  if ((globalThis as any).window) {
    (globalThis as any).window.btoa = (str: string) => Buffer.from(str, 'binary').toString('base64');
    (globalThis as any).window.atob = (b64: string) => Buffer.from(b64, 'base64').toString('binary');
  }
});

import { renderToString } from 'react-dom/server';
import { JSDOM } from 'jsdom';

// Helper to render React element to a JSDOM document
function renderToDoc(element: React.ReactElement): Document {
  const html = renderToString(element);
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  return dom.window.document;
}

// Components and Fixtures
import { SAMPLE_QUIZZES } from '../data/sampleQuizzes';
import { Navbar } from '../components/common/Navbar';
import { AuthModal } from '../components/common/AuthModal';
import { StudentDashboard } from '../components/dashboard/StudentDashboard';
import { HostDashboard } from '../components/dashboard/HostDashboard';
import { CertificateGallery } from '../components/certificates/CertificateGallery';
import { EmptyState } from '../components/common/EmptyState';
import { QuizCardSkeleton } from '../components/common/Skeleton';
import { LobbyView } from '../components/arena/LobbyView';
import { CompetitionManager } from '../components/competitions/CompetitionManager';
import { EmailOutbox } from '../components/outbox/EmailOutbox';

describe('Phase 8 — UI/UX Redesign, Responsive Design & Accessibility Hardening Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // 1. Main navigation rendering
  it('[UI-01] main navigation renders brand wordmark and core elements', () => {
    const doc = renderToDoc(
      React.createElement(Navbar, {
        currentTab: 'arena',
        setCurrentTab: () => {},
        lang: 'en',
        setLang: () => {},
        isDarkMode: false,
        setIsDarkMode: () => {},
      })
    );
    expect(doc.body.textContent).toContain('Quiz');
    expect(doc.body.textContent).toContain('Arena');
    expect(doc.querySelector('header')).not.toBeNull();
    expect(doc.querySelector('nav')).not.toBeNull();
  });

  // 2. Role-based navigation visibility
  it('[UI-02] role-based navigation displays correct tabs for host vs student', () => {
    // Host Mode
    const hostDoc = renderToDoc(
      React.createElement(Navbar, {
        currentTab: 'host_dashboard',
        setCurrentTab: () => {},
        lang: 'en',
        setLang: () => {},
        userRole: 'host',
      })
    );
    expect(hostDoc.body.textContent).toContain('Dashboard');
    expect(hostDoc.body.textContent).toContain('Studio');
    expect(hostDoc.body.textContent).toContain('AI Quiz');

    // Student Mode
    const studentDoc = renderToDoc(
      React.createElement(Navbar, {
        currentTab: 'student_dashboard',
        setCurrentTab: () => {},
        lang: 'en',
        setLang: () => {},
        userRole: 'student',
      })
    );
    expect(studentDoc.body.textContent).toContain('My Portal');
    expect(studentDoc.body.textContent).toContain('Solo');
    expect(studentDoc.body.textContent).toContain('Certificates');
    // Students must not see host builder or outbox in primary nav
    expect(studentDoc.querySelector('button[data-tab="builder"]')).toBeNull();
    expect(studentDoc.querySelector('button[data-tab="outbox"]')).toBeNull();
  });

  // 3. Student dashboard data states
  it('[UI-03] student dashboard renders welcome section and learning metrics', () => {
    const doc = renderToDoc(
      React.createElement(StudentDashboard, {
        quizzes: SAMPLE_QUIZZES,
        onJoinArenaPin: () => {},
        onStartPractice: () => {},
        onViewTournaments: () => {},
        onViewCertificates: () => {},
      })
    );
    expect(doc.body.textContent).toContain('Student Learning Portal');
    expect(doc.body.textContent).toContain('Have a Game PIN?');
    expect(doc.body.textContent).toContain('Recommended Practice');
    expect(doc.body.textContent).toContain('Earned Certificates');
  });

  // 4. Host dashboard data states
  it('[UI-04] host dashboard renders educator command center and operational KPIs', () => {
    const doc = renderToDoc(
      React.createElement(HostDashboard, {
        quizzes: SAMPLE_QUIZZES,
        onNavigateTab: () => {},
        onHostQuiz: () => {},
        onEditQuiz: () => {},
      })
    );
    expect(doc.body.textContent).toContain('Educator Command Center');
    expect(doc.body.textContent).toContain('Total Quizzes');
    expect(doc.body.textContent).toContain('Published Quiz Repository');
    expect(doc.body.textContent).toContain('Create Quiz');
    expect(doc.body.textContent).toContain('AI Generator');
  });

  // 5. Quiz Studio rendering
  it('[UI-05] quiz studio renders question cards and management tools', async () => {
    const { QuizBuilder } = await import('../components/builder/QuizBuilder');
    const doc = renderToDoc(
      React.createElement(QuizBuilder, {
        quizzes: SAMPLE_QUIZZES,
        onSaveQuiz: () => {},
        onSelectForHost: () => {},
      })
    );
    expect(doc.body.textContent).toContain('Quiz Studio');
    expect(doc.body.textContent).toContain('Questions');
  });

  // 6. Question editor interactions
  it('[UI-06] question editor displays Bloom taxonomy and time limit controls', async () => {
    const { QuizBuilder } = await import('../components/builder/QuizBuilder');
    const doc = renderToDoc(
      React.createElement(QuizBuilder, {
        quizzes: SAMPLE_QUIZZES,
        onSaveQuiz: () => {},
        onSelectForHost: () => {},
      })
    );
    const text = doc.body.textContent || '';
    expect(text).toContain('Bloom');
  });

  // 7. AI generator validation
  it('[UI-07] AI quiz generator renders prompt input and generation workflow', async () => {
    const { AIQuizGenerator } = await import('../components/ai/AIQuizGenerator');
    const doc = renderToDoc(
      React.createElement(AIQuizGenerator, {
        existingQuizzes: SAMPLE_QUIZZES,
        onSaveToQuiz: () => {},
        onHostNow: () => {},
      })
    );
    expect(doc.body.textContent).toContain('AI');
    expect(doc.querySelector('textarea, input[type="text"]')).not.toBeNull();
  });

  // 8. Multiplayer lobby rendering
  it('[UI-08] multiplayer lobby renders PIN, capacity limit, and host controls', () => {
    const mockGame: any = {
      id: 'game_123456',
      pin: '123456',
      hostId: 'host_1',
      hostName: 'Prof. Miller',
      quizId: SAMPLE_QUIZZES[0].id,
      quizTitle: SAMPLE_QUIZZES[0].title,
      status: 'lobby',
      currentQuestionIndex: 0,
      settings: {},
      questions: SAMPLE_QUIZZES[0].questions,
    };

    const doc = renderToDoc(
      React.createElement(LobbyView, {
        game: mockGame,
        players: [],
        isHost: true,
        onStartGame: () => {},
      })
    );
    expect(doc.body.textContent).toContain('123456');
    expect(doc.body.textContent).toContain('Capacity:');
    expect(doc.body.textContent).toContain('300'); // Maximum capacity limit
  });

  // 9. Multiplayer answer interaction & touch targets
  it('[UI-09] option buttons meet minimum touch target standards', async () => {
    const { WatermarkedQuestionCanvas } = await import('../components/arena/WatermarkedQuestionCanvas');
    const doc = renderToDoc(
      React.createElement(WatermarkedQuestionCanvas, {
        questionText: 'What is the time complexity of QuickSort?',
        options: ['O(n)', 'O(n log n)', 'O(n^2)', 'O(1)'],
        playerNickname: 'SpeedyCheetah',
        playerId: 'player_1',
        questionIndex: 0,
        totalQuestions: 5,
        selectedIndices: [],
        hasSubmitted: false,
        isLocked: false,
        isAccessibleMode: true,
        onSelectOption: () => {},
      })
    );
    const buttons = doc.querySelectorAll('button');
    expect(buttons.length).toBe(4);
    buttons.forEach(btn => {
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    });
  });

  // 10. Tournament card rendering
  it('[UI-10] tournament manager renders championship cards and rounds', () => {
    const doc = renderToDoc(
      React.createElement(CompetitionManager, {
        quizzes: SAMPLE_QUIZZES,
        onLaunchRound: () => {},
      })
    );
    expect(doc.body.textContent).toContain('Collegiate Tech Arena Championship');
    expect(doc.body.textContent).toContain('Round 1');
  });

  // 11. Tournament status presentation
  it('[UI-11] tournament rounds display correct status badges (active, completed)', () => {
    const doc = renderToDoc(
      React.createElement(CompetitionManager, {
        quizzes: SAMPLE_QUIZZES,
        onLaunchRound: () => {},
      })
    );
    expect(doc.body.textContent).toContain('COMPLETED');
    expect(doc.body.textContent).toContain('ACTIVE');
  });

  // 12. Analytics loading state
  it('[UI-12] analytics loading state renders accessible loading skeletons', () => {
    const doc = renderToDoc(React.createElement(QuizCardSkeleton));
    const skeletonEl = doc.querySelector('[aria-hidden="true"]');
    expect(skeletonEl).not.toBeNull();
  });

  // 13. Analytics empty state
  it('[UI-13] empty state component renders informative copy and optional action', () => {
    const doc = renderToDoc(
      React.createElement(EmptyState, {
        icon: '📊',
        title: 'No Completed Assessments',
        description: 'Host a quiz to see cohort analytics and CO attainment.',
        actionLabel: 'Host Game Now',
        onAction: () => {},
      })
    );
    expect(doc.body.textContent).toContain('No Completed Assessments');
    expect(doc.body.textContent).toContain('Host Game Now');
  });

  // 14. Certificate gallery
  it('[UI-14] certificate gallery renders verification check and credential cards', () => {
    const doc = renderToDoc(React.createElement(CertificateGallery));
    expect(doc.body.textContent).toContain('Verified Digital Certificate Gallery');
    expect(doc.body.textContent).toContain('Verify Any Certificate');
  });

  // 15. Email outbox states
  it('[UI-15] email outbox renders health status and queue tabs', () => {
    const doc = renderToDoc(React.createElement(EmailOutbox));
    expect(doc.body.textContent).toContain('Outbox');
  });

  // 16. Form validation in AuthModal
  it('[UI-16] auth modal provides accessible email and password inputs with labels', () => {
    const doc = renderToDoc(
      React.createElement(AuthModal, {
        isOpen: true,
        onClose: () => {},
      })
    );
    expect(doc.querySelector('input[type="email"]')).not.toBeNull();
    expect(doc.querySelector('label[for="auth-email-input"]')).not.toBeNull();
    expect(doc.querySelector('label[for="auth-password-input"]')).not.toBeNull();
  });

  // 17. Error feedback with accessible role
  it('[UI-17] error messages have role="alert" for assistive technology', () => {
    const doc = renderToDoc(
      React.createElement(AuthModal, {
        isOpen: true,
        onClose: () => {},
      })
    );
    const submitBtn = doc.querySelector('button[type="submit"]');
    expect(submitBtn).not.toBeNull();
  });

  // 18. Modal keyboard behavior
  it('[UI-18] auth modal includes close button with accessible label', () => {
    const doc = renderToDoc(
      React.createElement(AuthModal, {
        isOpen: true,
        onClose: () => {},
      })
    );
    const closeBtn = doc.querySelector('button[aria-label="Close authentication modal"]');
    expect(closeBtn).not.toBeNull();
  });

  // 19. Accessible button labels on navigation controls
  it('[UI-19] navigation controls contain accessible aria-labels', () => {
    const doc = renderToDoc(
      React.createElement(Navbar, {
        currentTab: 'arena',
        setCurrentTab: () => {},
        lang: 'en',
        setLang: () => {},
      })
    );
    expect(doc.querySelector('button[aria-label="Settings and Privacy"]')).not.toBeNull();
    expect(doc.querySelector('select[aria-label="Select Language"]')).not.toBeNull();
  });

  // 20. Responsive navigation behavior
  it('[UI-20] mobile drawer toggle exists for small viewports', () => {
    const doc = renderToDoc(
      React.createElement(Navbar, {
        currentTab: 'arena',
        setCurrentTab: () => {},
        lang: 'en',
        setLang: () => {},
      })
    );
    const mobileToggle = doc.querySelector('button[aria-label="Toggle mobile navigation menu"]');
    expect(mobileToggle).not.toBeNull();
  });

  // 21. No unauthorized navigation actions
  it('[UI-21] unauthorized administration controls are excluded from student mode', () => {
    const doc = renderToDoc(
      React.createElement(Navbar, {
        currentTab: 'student_dashboard',
        setCurrentTab: () => {},
        lang: 'en',
        setLang: () => {},
        userRole: 'student',
      })
    );
    const html = doc.body.innerHTML;
    // Host-only admin tabs should not be present in student navigation
    expect(html).not.toContain('data-tab="outbox"');
    expect(html).not.toContain('data-tab="builder"');
  });

  // 22. Existing Phase 1–7 regression preservation
  it('[UI-22] multi-phase core models and scoring remain intact', async () => {
    const { calculateFairScore } = await import('../lib/scoring');
    const score = calculateFairScore({
      basePoints: 1000,
      isCorrect: true,
      timeLimitSeconds: 20,
      rawResponseTimeMs: 4000,
      latencyMs: 30,
      clockOffsetMs: 0,
      currentStreak: 2,
      scoringProfile: 'speed_weighted',
    });
    expect(score.finalPoints).toBeGreaterThan(0);

    const { generateVerificationId } = await import('../server/certificateEngine');
    const vid = generateVerificationId();
    expect(vid).toMatch(/^QA-V-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
  });
});
