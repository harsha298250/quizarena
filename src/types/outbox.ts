/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type OutboxJobStatus =
  | 'pending'
  | 'processing'
  | 'accepted'
  | 'delivered'
  | 'bounced'
  | 'rejected'
  | 'retrying'
  | 'failed'
  | 'cancelled';

export type NotificationEventType =
  | 'quiz_results_ready'
  | 'tournament_registered'
  | 'tournament_match_ready'
  | 'tournament_completed'
  | 'certificate_issued';

export interface EmailOutboxJob {
  id: string; // e.g. "job_..."
  idempotencyKey: string;
  recipientEmail: string;
  recipientName: string;
  recipientUid?: string;
  eventType: NotificationEventType;
  subject: string;
  htmlContent: string;
  textContent: string;
  status: OutboxJobStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: string; // ISO string
  lockedUntil?: string; // Concurrency lock ISO string
  workerId?: string;
  errorCategory?: 'transient' | 'permanent';
  lastErrorMessage?: string;
  providerMessageId?: string;
  createdAt: string;
  sentAt?: string;
  deliveredAt?: string;
  metadata?: Record<string, any>;
}
