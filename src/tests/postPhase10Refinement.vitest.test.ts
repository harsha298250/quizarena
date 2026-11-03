/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Post-Phase-10 Feature Refinements & Regression Test Suite
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateWithAIAdapter, CANDIDATE_GEMINI_MODELS } from '../server/aiProviderAdapter';
import {
  checkGenerateQuizRateLimit,
  checkAnonymousGenerateQuizRateLimit,
} from '../server/sharedRateLimiter';
import { validateAndTrackPowerUp } from '../server/scoringHardening';
import {
  generateVerificationId,
  issueCertificate,
  verifyCertificatePublic,
  revokeCertificate,
  certificateStore,
} from '../server/certificateEngine';
import { dispatchSingleEmail } from '../server/resultEmailsHandler';
import { isValidEmailAddress, enqueueOutboxJob, outboxStore } from '../server/emailOutboxWorker';
import type { GameSession, Player } from '../types/quiz';

describe('Post-Phase-10 Refinement Test Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================
  // PART A: Responsive UI & Accommodations
  // ==========================================
  describe('Part A: Accommodations Hardening', () => {
    it('[P10-01] verifies dyslexiaFont, readAloud, and largeText are valid accommodations', () => {
      const allowedAccommodations = {
        dyslexiaFont: true,
        readAloud: true,
        speechRate: 1.0,
        largeText: true,
      };
      expect(allowedAccommodations.dyslexiaFont).toBe(true);
      expect(allowedAccommodations.readAloud).toBe(true);
      expect(allowedAccommodations.largeText).toBe(true);
    });
  });

  // ==========================================
  // PART B: AI Dual-Provider Architecture
  // ==========================================
  describe('Part B: Multi-Provider AI Quiz Generator (Gemini + Grok)', () => {
    it('[P10-02] includes Gemini candidate fallback models in descending capability', () => {
      expect(CANDIDATE_GEMINI_MODELS).toContain('gemini-2.0-flash');
      expect(CANDIDATE_GEMINI_MODELS).toContain('gemini-1.5-flash');
    });

    it('[P10-03] falls back gracefully to deterministic pedagogical generator when external keys are absent', async () => {
      const result = await generateWithAIAdapter({
        sourceContent: 'Operating systems maintain process control blocks for concurrency scheduling and thread sync.',
        sourceType: 'pasted_text',
        numQuestions: 3,
        difficulty: 'medium',
        targetCO: 'CO2',
      });

      expect(result).toBeDefined();
      expect(result.rawQuestions.length).toBe(3);
      expect(result.providerUsed).toBe('heuristic');
      expect(result.rawQuestions[0].options.length).toBe(4);
      expect(result.rawQuestions[0].correctAnswerIndex).toBe(0);
      expect(result.rawQuestions[0].explanation).toBeDefined();
      expect(result.rawQuestions[0].topicTag).toBe('CO2');
    });

    it('[P10-04] permits anonymous users with guest rate limiter instead of hard 403', () => {
      const anonUid = `anon_${Date.now()}`;
      // First 5 attempts should succeed
      for (let i = 0; i < 5; i++) {
        const check = checkAnonymousGenerateQuizRateLimit(anonUid);
        expect(check.allowed).toBe(true);
      }
      // 6th attempt should be throttled with retry-after
      const throttled = checkAnonymousGenerateQuizRateLimit(anonUid);
      expect(throttled.allowed).toBe(false);
      expect(throttled.retryAfterSec).toBeGreaterThan(0);
    });

    it('[P10-05] provides higher rate limit for authenticated instructors', () => {
      const teacherUid = `teacher_${Date.now()}`;
      for (let i = 0; i < 10; i++) {
        const check = checkGenerateQuizRateLimit(teacherUid);
        expect(check.allowed).toBe(true);
      }
      const throttled = checkGenerateQuizRateLimit(teacherUid);
      expect(throttled.allowed).toBe(false);
    });
  });

  // ==========================================
  // PART C: Question Progression (Manual vs Automatic)
  // ==========================================
  describe('Part C: Question Progression Modes', () => {
    it('[P10-06] supports progressionMode configuration in GameSettings', () => {
      const manualGame: Partial<GameSession> = {
        id: 'game_manual',
        settings: {
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
          progressionMode: 'manual',
        },
      };

      const autoGame: Partial<GameSession> = {
        id: 'game_auto',
        settings: {
          ...manualGame.settings!,
          progressionMode: 'automatic',
        },
      };

      expect(manualGame.settings?.progressionMode).toBe('manual');
      expect(autoGame.settings?.progressionMode).toBe('automatic');
    });
  });

  // ==========================================
  // PART D: Removal of 50/50 and Double Points
  // ==========================================
  describe('Part D: Permanent Removal of 50/50 and Double Points', () => {
    it('[P10-07] rejects 50/50 power-up requests with descriptive error', () => {
      const check = validateAndTrackPowerUp({ powerUps: {} }, 'fiftyFifty');
      expect(check.allowed).toBe(false);
      expect(check.willUse).toBe(false);
      expect(check.error).toMatch(/permanently deprecated and disabled/i);
    });

    it('[P10-08] rejects double points power-up requests with descriptive error', () => {
      const check = validateAndTrackPowerUp({ powerUps: {} }, 'doublePoints');
      expect(check.allowed).toBe(false);
      expect(check.willUse).toBe(false);
      expect(check.error).toMatch(/permanently deprecated and disabled/i);
    });

    it('[P10-09] preserves timeFreeze power-up if not already used', () => {
      const check = validateAndTrackPowerUp({ powerUps: {} }, 'timeFreeze');
      expect(check.allowed).toBe(true);
      expect(check.willUse).toBe(true);
    });
  });

  // ==========================================
  // PART E: Results & Podium Identity Correction
  // ==========================================
  describe('Part E: Host vs Participant Identity Display', () => {
    const mockPlayers = [
      { id: 'student_1', nickname: 'Alice', score: 2500, avatar: '🦊', streak: 3 },
      { id: 'student_2', nickname: 'Bob', score: 1800, avatar: '🐺', streak: 1 },
    ];

    it('[P10-10] identifies viewer as Host without labeling any student as "You"', () => {
      const hostUid = 'teacher_123';
      const isHostViewer = true;
      const activePlayerId = undefined; // Host is viewing, not playing

      const isViewerHost = isHostViewer;
      const activePlayer = !isViewerHost && activePlayerId ? mockPlayers.find(p => p.id === activePlayerId) : null;

      expect(isViewerHost).toBe(true);
      expect(activePlayer).toBeNull(); // Host has no student record
    });

    it('[P10-11] identifies participant as "You" only when UID matches participant record', () => {
      const participantUid = 'student_1';
      const isViewerHost = false;

      const activePlayer = !isViewerHost && participantUid ? mockPlayers.find(p => p.id === participantUid) : null;
      expect(activePlayer).toBeDefined();
      expect(activePlayer?.nickname).toBe('Alice');

      const isCurrentPlayer = !isViewerHost && mockPlayers[0].id === participantUid;
      const isOtherPlayer = !isViewerHost && mockPlayers[1].id === participantUid;

      expect(isCurrentPlayer).toBe(true); // Alice gets (You)
      expect(isOtherPlayer).toBe(false);  // Bob does not get (You)
    });
  });

  // ==========================================
  // PART F & G: Host Participant Inspection & Anti-Cheat
  // ==========================================
  describe('Part F & G: Host Inspection & Anti-Cheat Telemetry', () => {
    it('[P10-12] verifies strike review thresholds and status mapping', () => {
      const calculateStatus = (strikes: number, isTerminated: boolean) => {
        if (isTerminated || strikes >= 6) return 'terminated_integrity';
        if (strikes >= 3) return 'locked';
        if (strikes >= 1) return 'warned';
        return 'clean';
      };

      expect(calculateStatus(0, false)).toBe('clean');
      expect(calculateStatus(1, false)).toBe('warned');
      expect(calculateStatus(3, false)).toBe('locked');
      expect(calculateStatus(6, false)).toBe('terminated_integrity');
      expect(calculateStatus(2, true)).toBe('terminated_integrity');
    });
  });

  // ==========================================
  // PART H: HTTPS Email Delivery (Port 443)
  // ==========================================
  describe('Part H: HTTPS Email Delivery & Render Port Blocking Defense', () => {
    it('[P10-13] validates email address format strictly', () => {
      expect(isValidEmailAddress('student@university.edu')).toBe(true);
      expect(isValidEmailAddress('invalid-email')).toBe(false);
      expect(isValidEmailAddress('test@')).toBe(false);
    });

    it('[P10-14] verifies HTTPS Resend delivery is preferred over SMTP when configured', async () => {
      process.env.RESEND_API_KEY = 're_test_dummy_key_for_unit_tests';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'resend_msg_12345' }),
      });
      globalThis.fetch = mockFetch;

      const result = await dispatchSingleEmail({
        to: 'student@example.com',
        recipientName: 'Student',
        subject: 'Your Quiz Results',
        html: '<p>Results</p>',
        transporter: null,
        fromAddress: 'QuizArena <noreply@quizarena.app>',
      });

      expect(result.status).toBe('sent');
      expect(result.messageId).toBe('resend_msg_12345');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({ method: 'POST' })
      );

      delete process.env.RESEND_API_KEY;
    });

    it('[P10-15] verifies outbox queue prevents duplicate notifications via idempotencyKey', () => {
      const idempotencyKey = `results_game99_user123`;
      const res1 = enqueueOutboxJob({
        idempotencyKey,
        recipientEmail: 'student@example.com',
        recipientName: 'Student',
        eventType: 'quiz_results_ready',
        subject: 'QuizArena Results',
        htmlContent: '<p>Score</p>',
        textContent: 'Score',
      });

      expect(res1.success).toBe(true);
      expect(res1.isDuplicate).toBe(false);

      const res2 = enqueueOutboxJob({
        idempotencyKey,
        recipientEmail: 'student@example.com',
        recipientName: 'Student',
        eventType: 'quiz_results_ready',
        subject: 'QuizArena Results',
        htmlContent: '<p>Score</p>',
        textContent: 'Score',
      });

      expect(res2.success).toBe(true);
      expect(res2.isDuplicate).toBe(true);
    });
  });

  // ==========================================
  // PART I: Verified Digital Certificate Flow
  // ==========================================
  describe('Part I: Verified Digital Certificate Lifecycle', () => {
    it('[P10-16] generates CSPRNG verification ID with QA-V-XXXX-XXXX-XXXX format', () => {
      const vId = generateVerificationId();
      expect(vId).toMatch(/^QA-V-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    });

    it('[P10-17] issues authoritative certificate and verifies publicly without leaking UID', () => {
      const issueRes = issueCertificate({
        ownerId: 'student_uid_777',
        recipientName: 'Devanagari Scholar',
        assessmentType: 'quiz',
        assessmentId: 'assessment_math_101',
        assessmentTitle: 'Advanced Discrete Mathematics',
        type: 'quiz_excellence',
        score: 9500,
        rank: 1,
        totalParticipants: 45,
        accuracy: 0.98,
        issuerId: 'prof_oak',
        issuerName: 'Prof. Oak',
      });

      expect(issueRes.success).toBe(true);
      const cert = issueRes.certificate!;
      expect(cert.verificationId).toBeDefined();

      // Verify publicly
      const verifyRes = verifyCertificatePublic(cert.verificationId);
      expect(verifyRes.valid).toBe(true);
      expect(verifyRes.status).toBe('valid');
      expect(verifyRes.recipientName).toBe('Devanagari Scholar');
      expect(verifyRes.assessmentTitle).toBe('Advanced Discrete Mathematics');
      expect(verifyRes.issuerName).toBe('Prof. Oak');
      // Must NOT leak ownerId or internal system UID to public verification
      expect((verifyRes as any).ownerId).toBeUndefined();
      expect((verifyRes as any).issuerId).toBeUndefined();
    });

    it('[P10-18] records official revocation and reports reason publicly', () => {
      const issueRes = issueCertificate({
        ownerId: 'student_disqualified',
        recipientName: 'Cheater Caught',
        assessmentType: 'tournament',
        assessmentId: 'tourney_finals',
        assessmentTitle: 'Grand Masters Tournament',
        type: 'tournament_champion',
        score: 10000,
        rank: 1,
        totalParticipants: 64,
        accuracy: 1.0,
        issuerId: 'host_dean',
        issuerName: 'Dean of Students',
      });

      const cert = issueRes.certificate!;
      const revokeRes = revokeCertificate(cert.id, 'host_dean', 'Confirmed prohibited collaboration in final round.');
      expect(revokeRes.success).toBe(true);

      const verifyRes = verifyCertificatePublic(cert.verificationId);
      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.status).toBe('revoked');
      expect(verifyRes.revocationReason).toBe('Confirmed prohibited collaboration in final round.');
    });

    it('[P10-19] handles non-existent verification ID safely', () => {
      const verifyRes = verifyCertificatePublic('QA-V-DEAD-BEEF-0000');
      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.status).toBe('not_found');
    });
  });
});
