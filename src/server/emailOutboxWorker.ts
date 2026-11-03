/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { EmailOutboxJob, NotificationEventType, OutboxJobStatus } from '../types/outbox';

// In-memory outbox store
export const outboxStore = new Map<string, EmailOutboxJob>();
export const idempotencyOutboxIndex = new Map<string, string>(); // idempotencyKey -> jobId

export interface EnqueueEmailParams {
  idempotencyKey: string;
  recipientEmail: string;
  recipientName: string;
  recipientUid?: string;
  eventType: NotificationEventType;
  subject: string;
  htmlContent: string;
  textContent: string;
  maxAttempts?: number;
  metadata?: Record<string, any>;
}

export interface ProcessBatchResult {
  claimedCount: number;
  sentCount: number;
  failedCount: number;
  retriedCount: number;
  jobsProcessed: string[];
}

export type EmailSenderFunction = (
  job: EmailOutboxJob
) => Promise<{ success: boolean; providerMessageId?: string; error?: string; isPermanent?: boolean }>;

/**
 * Validates email format strictly.
 */
export function isValidEmailAddress(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
}

/**
 * Strips HTML tags and generates clean plain-text MIME alternative
 */
export function generatePlainTextFallback(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Enqueues an email job with idempotency protection.
 */
export function enqueueOutboxJob(params: EnqueueEmailParams): {
  success: boolean;
  job?: EmailOutboxJob;
  error?: string;
  isDuplicate?: boolean;
} {
  if (!isValidEmailAddress(params.recipientEmail)) {
    return { success: false, error: `Invalid recipient email address "${params.recipientEmail}".` };
  }

  // Idempotency check: Return existing job if duplicate key supplied
  if (params.idempotencyKey && idempotencyOutboxIndex.has(params.idempotencyKey)) {
    const existingId = idempotencyOutboxIndex.get(params.idempotencyKey)!;
    const existingJob = outboxStore.get(existingId);
    if (existingJob) {
      return { success: true, job: existingJob, isDuplicate: true };
    }
  }

  const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const textContent = params.textContent || generatePlainTextFallback(params.htmlContent);

  const job: EmailOutboxJob = {
    id: jobId,
    idempotencyKey: params.idempotencyKey,
    recipientEmail: params.recipientEmail.trim().toLowerCase(),
    recipientName: params.recipientName.trim(),
    recipientUid: params.recipientUid,
    eventType: params.eventType,
    subject: params.subject.trim(),
    htmlContent: params.htmlContent,
    textContent,
    status: 'pending',
    attempts: 0,
    maxAttempts: params.maxAttempts || 5,
    createdAt: new Date().toISOString(),
    metadata: params.metadata,
  };

  outboxStore.set(jobId, job);
  if (params.idempotencyKey) {
    idempotencyOutboxIndex.set(params.idempotencyKey, jobId);
  }

  return { success: true, job, isDuplicate: false };
}

/**
 * Processes a bounded batch of outbox jobs with atomic claiming, exponential backoff, and lock recovery.
 */
export async function processOutboxBatch(
  batchSize: number = 10,
  sender: EmailSenderFunction,
  workerId: string = `worker_${process.pid || 'main'}`
): Promise<ProcessBatchResult> {
  const now = new Date();
  const nowIso = now.toISOString();

  // Find candidate jobs: pending or retrying where nextRetryAt <= now OR abandoned processing locks
  const candidates: EmailOutboxJob[] = [];
  for (const job of outboxStore.values()) {
    if (candidates.length >= batchSize) break;

    // Check lock expiration (120 seconds timeout)
    const isLockExpired = job.status === 'processing' && job.lockedUntil && new Date(job.lockedUntil).getTime() < now.getTime();
    const isReadyForRetry = job.status === 'retrying' && job.nextRetryAt && new Date(job.nextRetryAt).getTime() <= now.getTime();

    if (job.status === 'pending' || isReadyForRetry || isLockExpired) {
      candidates.push(job);
    }
  }

  const result: ProcessBatchResult = {
    claimedCount: candidates.length,
    sentCount: 0,
    failedCount: 0,
    retriedCount: 0,
    jobsProcessed: [],
  };

  // Process claimed jobs
  for (const job of candidates) {
    // Atomic claiming lock (120s lease)
    job.status = 'processing';
    job.workerId = workerId;
    job.lockedUntil = new Date(Date.now() + 120000).toISOString();
    outboxStore.set(job.id, job);

    result.jobsProcessed.push(job.id);
    job.attempts++;

    try {
      const sendResult = await sender(job);

      if (sendResult.success) {
        job.status = 'accepted';
        job.providerMessageId = sendResult.providerMessageId;
        job.sentAt = new Date().toISOString();
        job.lockedUntil = undefined;
        result.sentCount++;
      } else {
        // Classify failure
        const isPermanent = sendResult.isPermanent || job.attempts >= job.maxAttempts;

        if (isPermanent) {
          job.status = 'failed';
          job.errorCategory = 'permanent';
          job.lastErrorMessage = sendResult.error || 'Permanent dispatch error.';
          job.lockedUntil = undefined;
          result.failedCount++;
        } else {
          // Exponential backoff: 2^(attempts - 1) * 1000ms
          const backoffMs = Math.pow(2, job.attempts - 1) * 1000;
          job.status = 'retrying';
          job.errorCategory = 'transient';
          job.lastErrorMessage = sendResult.error || 'Transient provider timeout.';
          job.nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
          job.lockedUntil = undefined;
          result.retriedCount++;
        }
      }
    } catch (err: any) {
      job.status = job.attempts >= job.maxAttempts ? 'failed' : 'retrying';
      job.lastErrorMessage = err?.message || 'Uncaught dispatch error.';
      job.lockedUntil = undefined;
      result.failedCount++;
    }

    outboxStore.set(job.id, job);
  }

  return result;
}

/**
 * Webhook handler to record confirmed delivery / bounce events.
 */
export function handleProviderWebhook(
  messageId: string,
  event: 'delivered' | 'bounced' | 'rejected',
  signatureVerified: boolean
): { success: boolean; job?: EmailOutboxJob; error?: string } {
  if (!signatureVerified) {
    return { success: false, error: 'Invalid webhook signature.' };
  }

  if (!messageId) {
    return { success: false, error: 'Missing providerMessageId.' };
  }

  // Find job by providerMessageId
  let targetJob: EmailOutboxJob | null = null;
  for (const job of outboxStore.values()) {
    if (job.providerMessageId === messageId) {
      targetJob = job;
      break;
    }
  }

  if (!targetJob) {
    return { success: false, error: 'Job not found for providerMessageId.' };
  }

  if (event === 'delivered') {
    targetJob.status = 'delivered';
    targetJob.deliveredAt = new Date().toISOString();
  } else if (event === 'bounced') {
    targetJob.status = 'bounced';
  } else if (event === 'rejected') {
    targetJob.status = 'rejected';
  }

  outboxStore.set(targetJob.id, targetJob);
  return { success: true, job: targetJob };
}
