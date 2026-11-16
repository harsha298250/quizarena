/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { issueGameCertificate, listUserCertificates } from '../services/certificateService';
import { PodiumView } from '../components/arena/PodiumView';
import { CertificateGallery } from '../components/certificates/CertificateGallery';
import { GameSession, Player } from '../types/quiz';

describe('Workstream 2B: Certificate Issuance and Verification Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('certificateService.issueGameCertificate', () => {
    it('returns failure when no authenticated user is present', async () => {
      // In node/test environment by default auth.currentUser is null
      const res = await issueGameCertificate('game-123', 'player-456');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Authentication required|auth token/i);
    });

    it('successfully issues and returns verifiable certificate payload when authenticated', async () => {
      const mockCert = {
        verificationId: 'QA-V-9988-7766-5544',
        recipientName: 'Alice Champion',
        assessmentTitle: 'TypeScript Masters',
        assessmentType: 'quiz' as const,
        assessmentId: 'game-123',
        ownerId: 'user-alice',
        score: 1000,
        rank: 1,
        totalParticipants: 5,
        accuracy: 1.0,
        issueDate: new Date().toISOString(),
      };

      // Mock fetch
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          certificate: mockCert,
        }),
      } as any);

      // Mock auth currentUser with getIdToken
      const fakeAuthUser = {
        uid: 'user-alice',
        getIdToken: async () => 'mock-token-xyz',
      };
      const firebaseModule = await import('../lib/firebase');
      (firebaseModule.auth as any).currentUser = fakeAuthUser;

      const res = await issueGameCertificate('game-123', 'user-alice');
      expect(res.success).toBe(true);
      expect(res.certificate?.verificationId).toBe('QA-V-9988-7766-5544');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/certificates/issue'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token-xyz',
          }),
        })
      );

      // Clean up auth currentUser
      (firebaseModule.auth as any).currentUser = null;
    });
  });

  describe('certificateService.listUserCertificates', () => {
    it('fetches certificates from /api/certificates/my-certificates when authenticated', async () => {
      const mockList = [
        {
          verificationId: 'QA-V-1111-2222-3333',
          recipientName: 'Bob Builder',
          assessmentTitle: 'React Concurrency',
          assessmentType: 'quiz' as const,
          assessmentId: 'game-456',
          ownerId: 'user-bob',
          score: 800,
          rank: 2,
          totalParticipants: 10,
          accuracy: 0.8,
          issueDate: new Date().toISOString(),
        },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          certificates: mockList,
        }),
      } as any);

      const firebaseModule = await import('../lib/firebase');
      (firebaseModule.auth as any).currentUser = {
        uid: 'user-bob',
        getIdToken: async () => 'mock-token-bob',
      };

      const result = await listUserCertificates('user-bob');
      expect(result).toHaveLength(1);
      expect(result[0].verificationId).toBe('QA-V-1111-2222-3333');

      (firebaseModule.auth as any).currentUser = null;
    });
  });

  describe('PodiumView and CertificateGallery UI components', () => {
    const mockGame: any = {
      id: 'game-winner-101',
      pin: '123456',
      hostId: 'host-999',
      hostName: 'Dr. Host',
      quizTitle: 'Grand Engineering Finals',
      status: 'finished',
      currentQuestionIndex: 0,
      questions: [
        {
          id: 'q1',
          type: 'multiple_choice',
          text: 'What is hydration?',
          options: ['Render HTML', 'Attach listeners', 'Server paint', 'Bundle code'],
          correctAnswers: [1],
          timeLimit: 30,
          points: 100,
          topicTag: 'react',
          bloomLevel: 'understand',
          courseOutcomeTag: 'CO1',
          explanation: 'Hydration attaches listeners.',
        },
      ],
      createdAt: new Date().toISOString(),
    };

    const mockPlayers: any = [
      {
        id: 'player-1',
        nickname: 'Alice',
        score: 500,
        streak: 3,
        maxStreak: 3,
        correctCount: 1,
        connected: true,
        isHost: false,
        avatar: 'avatar1',
        latencyMs: 10,
        clockOffsetMs: 0,
        integrityScore: 100,
      },
      {
        id: 'player-2',
        nickname: 'Bob',
        score: 300,
        streak: 1,
        maxStreak: 1,
        correctCount: 0,
        connected: true,
        isHost: false,
        avatar: 'avatar2',
        latencyMs: 15,
        clockOffsetMs: 0,
        integrityScore: 100,
      },
    ];

    it('renders PodiumView with certificate download button for active player', () => {
      const html = renderToStaticMarkup(
        React.createElement(PodiumView, {
          game: mockGame,
          players: mockPlayers,
          activePlayerId: 'player-1',
          isHost: false,
          onPlayAgain: () => {},
          onReviewAnalytics: () => {},
        })
      );

      expect(html).toContain('Podium of Champions');
      expect(html).toContain('Alice');
      expect(html).toContain('Download Official Certificate (PDF)');
    });

    it('renders CertificateGallery with verification section', () => {
      const html = renderToStaticMarkup(
        React.createElement(CertificateGallery)
      );

      expect(html).toContain('Verified Digital Certificate Gallery');
      expect(html).toContain('Verify Any Certificate');
      expect(html).toContain('QA-V-XXXX-XXXX');
    });
  });
});
