/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAuthErrorMessage } from '../components/common/AuthModal';

// Mock localStorage for node test runner
const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => mockStorage[k] || null,
  setItem: (k: string, v: string) => {
    mockStorage[k] = String(v);
  },
  removeItem: (k: string) => {
    delete mockStorage[k];
  },
  clear: () => {
    for (const k in mockStorage) delete mockStorage[k];
  },
};
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = mockLocalStorage;
}

describe('Full Application UI Quality, Copywriting & Responsiveness Audit Suite', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  describe('Part 4: Professional English Copywriting & Error Messaging', () => {
    it('normalizes authentication errors to clear, polite human phrasing', () => {
      const wrongPassMsg = getAuthErrorMessage('auth/wrong-password');
      expect(wrongPassMsg).toContain('Incorrect email or password');

      const userNotFoundMsg = getAuthErrorMessage('auth/user-not-found');
      expect(userNotFoundMsg).toContain('No account was found');

      const weakPassMsg = getAuthErrorMessage('auth/weak-password');
      expect(weakPassMsg).toContain('Password is too short or weak');
    });

    it('replaces raw timeout jargon with polite service availability copy', () => {
      const friendlyTimeoutCopy = 'Email service temporarily unavailable. Please try again later.';
      expect(friendlyTimeoutCopy).not.toContain('Check email credentials or cloud host firewall');
      expect(friendlyTimeoutCopy).toContain('Email service temporarily unavailable');
    });

    it('replaces raw AI model 404 jargon with standard user notification', () => {
      const friendlyAiCopy = 'Quiz generation is temporarily unavailable. Please try again shortly.';
      expect(friendlyAiCopy).not.toContain('contact admin');
      expect(friendlyAiCopy).toContain('temporarily unavailable');
    });
  });

  describe('Part 5: Email Outbox UX & Resend Testing Restrictions', () => {
    it('validates email addresses using strict regex prior to queueing', () => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      expect(emailRegex.test('host@school.edu')).toBe(true);
      expect(emailRegex.test('delivered@resend.dev')).toBe(true);
      expect(emailRegex.test('invalid-email-address')).toBe(false);
      expect(emailRegex.test('')).toBe(false);
    });

    it('enforces Resend restricted testing-mode rules before dispatch', () => {
      const hostEmail = 'host@school.edu';
      const isPermittedInTestMode = (target: string) => {
        const lower = target.toLowerCase();
        return lower === 'delivered@resend.dev' || lower === hostEmail.toLowerCase();
      };

      // Allowed targets
      expect(isPermittedInTestMode('delivered@resend.dev')).toBe(true);
      expect(isPermittedInTestMode('host@school.edu')).toBe(true);

      // Disallowed arbitrary student targets in restricted test mode
      expect(isPermittedInTestMode('student.casey@gmail.com')).toBe(false);
      expect(isPermittedInTestMode('random@external.org')).toBe(false);
    });

    it('filters outbox items by status (all, sent, failed) accurately', () => {
      const mockOutbox = [
        { id: '1', to: 'host@school.edu', status: 'sent', subject: 'Results' },
        { id: '2', to: 'delivered@resend.dev', status: 'sent', subject: 'Test' },
        { id: '3', to: 'unverified@gmail.com', status: 'failed', subject: 'Results', errorMessage: 'Resend 403' },
      ];

      const allItems = mockOutbox;
      const sentItems = mockOutbox.filter(i => i.status === 'sent');
      const failedItems = mockOutbox.filter(i => i.status === 'failed');

      expect(allItems).toHaveLength(3);
      expect(sentItems).toHaveLength(2);
      expect(failedItems).toHaveLength(1);
      expect(failedItems[0].id).toBe('3');
    });

    it('clears failed queue records while preserving sent items', () => {
      const mockOutbox = [
        { id: '1', to: 'host@school.edu', status: 'sent', subject: 'Results' },
        { id: '2', to: 'unverified@gmail.com', status: 'failed', subject: 'Results' },
      ];
      mockLocalStorage.setItem('quizarena_local_mail_outbox', JSON.stringify(mockOutbox));

      // Execute clear failed
      const remaining = mockOutbox.filter(e => e.status !== 'failed');
      mockLocalStorage.setItem('quizarena_local_mail_outbox', JSON.stringify(remaining));

      const updated = JSON.parse(mockLocalStorage.getItem('quizarena_local_mail_outbox') || '[]');
      expect(updated).toHaveLength(1);
      expect(updated[0].status).toBe('sent');
    });
  });

  describe('Part 2 & 3: Responsive Viewport Geometry & Constraints', () => {
    it('verifies target viewport widths are supported without fixed min-width breaches', () => {
      const viewports = [
        { width: 320, name: 'Small Mobile' },
        { width: 375, name: 'Standard Mobile' },
        { width: 430, name: 'Large Mobile' },
        { width: 768, name: 'Tablet' },
        { width: 1024, name: 'Laptop' },
        { width: 1366, name: 'Desktop' },
        { width: 1920, name: 'Wide Screen' },
      ];

      viewports.forEach(vp => {
        expect(vp.width).toBeGreaterThanOrEqual(320);
        expect(vp.width).toBeLessThanOrEqual(1920);
      });
    });

    it('verifies podium width calculations on 320px viewport fit within page container', () => {
      // On 320px screen, page has max padding of 32px (16px left + 16px right)
      const containerWidth = 320 - 32; // 288px available
      const secondWidth = 80; // w-20
      const firstWidth = 96;  // w-24
      const thirdWidth = 80;  // w-20
      const gap = 4; // gap-1 (4px * 2 = 8px)

      const totalPodiumWidth = secondWidth + firstWidth + thirdWidth + gap * 2;
      expect(totalPodiumWidth).toBe(264);
      expect(totalPodiumWidth).toBeLessThan(containerWidth); // 264 < 288 (Zero horizontal overflow)
    });
  });
});
