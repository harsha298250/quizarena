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
  | 'cancelled'
  | 'ambiguous';

export type OutboxErrorCategory =
  | 'transient'
  | 'permanent'
  | 'rate_limit'
  | 'timeout'
  | 'ambiguous'
  | 'provider_5xx';

export type NotificationEventType =
  | 'quiz_results_ready'
  | 'tournament_registered'
  | 'tournament_match_ready'
  | 'tournament_completed'
  | 'certificate_issued';

export interface EmailOutboxJob {
  id: string; // e.g. "job_..."
  idempotencyKey: string;
  idempotencyScope?: string;
  ownerId?: string;
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
  nextRetryAt?: string | null; // ISO string or null when unqueued
  lockedUntil?: string | null; // Concurrency lock ISO string or null when unlocked
  leaseVersion?: number; // Monotonic fencing token
  workerId?: string;
  provider?: string;
  errorCategory?: OutboxErrorCategory;
  lastErrorMessage?: string;
  providerMessageId?: string;
  createdAt: string;
  updatedAt?: string;
  sentAt?: string;
  deliveredAt?: string;
  cancelledAt?: string;
  metadata?: Record<string, any>;
}
