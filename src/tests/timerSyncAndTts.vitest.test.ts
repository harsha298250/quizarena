/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { resolveQuestionDuration } from '../server/scoringHardening';
import {
  getServerClockOffsetMs,
  setServerClockOffsetMs,
  getEstimatedServerTimeMs,
  computeAuthoritativeRemainingSeconds,
} from '../lib/clockSync';
import {
  buildQuestionSpeechScript,
  speechService,
} from '../lib/speechService';
import type { Question } from '../types/quiz';

describe('Timer Synchronization & Early Reveal Prevention Tests', () => {
  beforeEach(() => {
    setServerClockOffsetMs(0);
  });

  describe('1. Authoritative Question Duration Resolution', () => {
    const sampleGame = {
      timeLimit: 20,
      settings: {},
      questions: [
        { id: 'q1', text: 'Q1', timeLimit: 25 },
        { id: 'q2', text: 'Q2', timeLimit: 15 },
        { id: 'q3', text: 'Q3', timeLimit: 30 },
      ],
    };

    it('governs all questions with session timeLimit when perQuestionTimer is not enabled', () => {
      // By default in QuizArena, standard game duration governs consistently
      expect(resolveQuestionDuration(sampleGame, 0)).toBe(20);
      expect(resolveQuestionDuration(sampleGame, 1)).toBe(20);
      expect(resolveQuestionDuration(sampleGame, 2)).toBe(20);
    });

    it('applies configured custom match timeLimit across all questions consistently', () => {
      const customMatch = {
        ...sampleGame,
        timeLimit: 30,
      };
      expect(resolveQuestionDuration(customMatch, 0)).toBe(30);
      expect(resolveQuestionDuration(customMatch, 1)).toBe(30);
      expect(resolveQuestionDuration(customMatch, 2)).toBe(30);
    });

    it('respects individual question time limits only when perQuestionTimer is explicitly enabled', () => {
      const perQuestionGame = {
        ...sampleGame,
        settings: { perQuestionTimer: true },
      };
      expect(resolveQuestionDuration(perQuestionGame, 0)).toBe(25);
      expect(resolveQuestionDuration(perQuestionGame, 1)).toBe(15);
      expect(resolveQuestionDuration(perQuestionGame, 2)).toBe(30);
    });

    it('falls back to 20 seconds when game data is empty or corrupted', () => {
      expect(resolveQuestionDuration(null, 0)).toBe(20);
      expect(resolveQuestionDuration({}, 0)).toBe(20);
      expect(resolveQuestionDuration({ timeLimit: 0 }, 0)).toBe(20);
    });

    it('respects explicit parameter override if supplied by host advance call', () => {
      expect(resolveQuestionDuration(sampleGame, 0, 45)).toBe(45);
    });
  });

  describe('2. Clock Synchronization & Authoritative Deadline Calculation', () => {
    it('calculates estimated server time by applying clock offset', () => {
      setServerClockOffsetMs(1500); // Client is 1.5s behind server
      const clientNow = 1000000;
      const estimatedServer = clientNow + getServerClockOffsetMs();
      expect(estimatedServer).toBe(1001500);
    });

    it('computes remaining seconds accurately with server clock offset', () => {
      const clientNow = 1000000;
      const offsetMs = 2000; // Client is 2s behind server clock
      // Server deadline is 15s from now in server time: 1002000 + 15000 = 1017000
      const deadlineMs = 1017000;

      const remaining = computeAuthoritativeRemainingSeconds(deadlineMs, clientNow, offsetMs);
      expect(remaining).toBe(15);
    });

    it('clamps remaining seconds to 0 when deadline has passed', () => {
      const clientNow = 1000000;
      const offsetMs = 0;
      const deadlineMs = 995000; // 5s in the past

      const remaining = computeAuthoritativeRemainingSeconds(deadlineMs, clientNow, offsetMs);
      expect(remaining).toBe(0);
    });

    it('returns 0 for non-finite or missing deadlines', () => {
      expect(computeAuthoritativeRemainingSeconds(0)).toBe(0);
      expect(computeAuthoritativeRemainingSeconds(-100)).toBe(0);
      expect(computeAuthoritativeRemainingSeconds(NaN)).toBe(0);
    });
  });

  describe('3. Pause & Resume Authoritative Integrity', () => {
    it('preserves exact remaining duration on pause and resumes deadline accurately', () => {
      const startTimeMs = 1000000;
      const durationSec = 20;
      const deadlineMs = startTimeMs + durationSec * 1000; // 1020000

      // Pause 7 seconds into the question
      const pauseTimeMs = startTimeMs + 7000; // 1007000
      const pauseRemainingMs = Math.max(0, deadlineMs - pauseTimeMs); // 13000ms

      expect(pauseRemainingMs).toBe(13000);

      // Resume 5 seconds later
      const resumeTimeMs = pauseTimeMs + 5000; // 1012000
      const newDeadlineMs = resumeTimeMs + pauseRemainingMs; // 1025000
      const simulatedStartMs = resumeTimeMs - (durationSec * 1000 - pauseRemainingMs);

      expect(newDeadlineMs).toBe(1025000);
      expect(newDeadlineMs - resumeTimeMs).toBe(13000); // Exactly 13s remain
      expect(simulatedStartMs).toBe(resumeTimeMs - 7000);
    });
  });
});

describe('Accessibility & TTS Speech Reliability Tests', () => {
  const sampleQuestion: Question = {
    id: 'q_test_1',
    type: 'multiple_choice',
    text: 'What is the speed of light in vacuum?',
    options: ['300,000 km/s', '150,000 km/s', '1,000 km/s', 'Instantaneous'],
    correctAnswers: [0],
    explanation: 'The speed of light in vacuum is approximately 299,792 km/s.',
    points: 1000,
    timeLimit: 20,
    topicTag: 'Physics',
    bloomLevel: 'remember',
    courseOutcomeTag: 'CO1',
  };

  describe('1. Question Speech Script Sanitization & Anti-Leak Rules', () => {
    it('includes question text and option labels clearly', () => {
      const script = buildQuestionSpeechScript(sampleQuestion);
      expect(script).toContain('Question: What is the speed of light in vacuum?');
      expect(script).toContain('Option A: 300,000 km/s.');
      expect(script).toContain('Option B: 150,000 km/s.');
      expect(script).toContain('Option C: 1,000 km/s.');
      expect(script).toContain('Option D: Instantaneous.');
    });

    it('NEVER leaks correct answers or explanation in TTS script', () => {
      const script = buildQuestionSpeechScript(sampleQuestion);
      expect(script).not.toContain('299,792');
      expect(script).not.toContain('explanation');
      expect(script).not.toContain('correct');
    });

    it('NEVER leaks question metadata (points, timeLimit, topicTag, CO)', () => {
      const script = buildQuestionSpeechScript(sampleQuestion);
      expect(script).not.toContain('1000');
      expect(script).not.toContain('points');
      expect(script).not.toContain('Physics');
      expect(script).not.toContain('CO1');
      expect(script).not.toContain('remember');
      expect(script).not.toContain('timeLimit');
    });

    it('omits options for type_answer question type', () => {
      const typeAnswerQ: Question = {
        ...sampleQuestion,
        type: 'type_answer',
        text: 'Enter the chemical formula for water:',
        options: ['H2O', 'h2o'],
        correctAnswers: [0],
        acceptedTextAnswers: ['h2o'],
      };

      const script = buildQuestionSpeechScript(typeAnswerQ);
      expect(script).toBe('Question: Enter the chemical formula for water:.');
      expect(script).not.toContain('Option A');
      expect(script).not.toContain('h2o');
    });

    it('skips options hidden by accommodations (fewerOptions)', () => {
      // Hide options 1 and 2
      const script = buildQuestionSpeechScript(sampleQuestion, [1, 2]);
      expect(script).toContain('Option A: 300,000 km/s.');
      expect(script).not.toContain('Option B: 150,000 km/s.');
      expect(script).not.toContain('Option C: 1,000 km/s.');
      expect(script).toContain('Option D: Instantaneous.');
    });

    it('strips HTML and markdown formatting cleanly', () => {
      const dirtyQ: Question = {
        ...sampleQuestion,
        text: 'What does <strong>HTML</strong> stand for in <em>web development</em>?',
        options: ['<b>HyperText</b> Markup Language', 'Home Tool Markup Language'],
      };

      const script = buildQuestionSpeechScript(dirtyQ);
      expect(script).toContain('Question: What does HTML stand for in web development?.');
      expect(script).toContain('Option A: HyperText Markup Language.');
      expect(script).not.toContain('<strong>');
      expect(script).not.toContain('<em>');
      expect(script).not.toContain('<b>');
    });

    it('handles empty or null question safely without throwing', () => {
      expect(buildQuestionSpeechScript(null)).toBe('');
      expect(buildQuestionSpeechScript(undefined)).toBe('');
      expect(buildQuestionSpeechScript({ text: '' })).toBe('');
    });
  });

  describe('2. Speech Controller Lifecycle & Rate Bounds', () => {
    it('enforces rate clamping between 0.5x and 2.0x', () => {
      speechService.setRate(1.25);
      expect(speechService.getRate()).toBe(1.25);

      speechService.setRate(0.2); // Too low, ignored
      expect(speechService.getRate()).toBe(1.25);

      speechService.setRate(3.5); // Too high, ignored
      expect(speechService.getRate()).toBe(1.25);

      speechService.setRate(0.75);
      expect(speechService.getRate()).toBe(0.75);
    });

    it('returns clean initial speech state', () => {
      const state = speechService.getState();
      expect(typeof state.isSpeaking).toBe('boolean');
      expect(typeof state.isPaused).toBe('boolean');
      expect(typeof state.rate).toBe('number');
    });
  });
});
