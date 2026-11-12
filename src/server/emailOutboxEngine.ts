/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type {
  EmailOutboxJob,
  NotificationEventType,
  OutboxErrorCategory,
  OutboxJobStatus,
} from '../types/outbox';
import {
  hashIdentifier,
  isAccountDeletionPending,
  isEmailBlockedForDeletion,
} from './accountDeletionEngine';
import {
  generatePlainTextFallback,
  isValidEmailAddress,
  type EnqueueEmailParams,
} from './emailOutboxWorker';

export const EMAIL_OUTBOX_COLLECTION = 'emailOutbox';
export const EMAIL_OUTBOX_IDEMPOTENCY_COLLECTION = 'emailOutboxIdempotency';
export const EMAIL_WEBHOOK_EVENTS_COLLECTION = 'emailWebhookEvents';
export const EMAIL_OUTBOX_METRICS_COLLECTION = 'emailOutboxMetrics';
export const EMAIL_OUTBOX_METRICS_DOC_ID = 'summary';

export const DEFAULT_LEASE_MS = 120_000;
export const BASE_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 300_000; // 5 minutes cap

export interface PersistentEnqueueParams extends EnqueueEmailParams {
  ownerId?: string;
  idempotencyScope?: string;
  provider?: string;
}

export interface PersistentSenderResult {
  success: boolean;
  providerMessageId?: string;
  provider?: string;
  error?: string;
  isPermanent?: boolean;
  isAmbiguous?: boolean;
  retryAfterSec?: number;
  errorCategory?: OutboxErrorCategory;
}

export type PersistentEmailSender = (job: EmailOutboxJob) => Promise<PersistentSenderResult>;

export interface PersistentBatchResult {
  claimedCount: number;
  acceptedCount: number;
  sentCount: number; // Alias for acceptedCount for backward compatibility
  failedCount: number;
  retriedCount: number;
  cancelledCount: number;
  ambiguousCount: number;
  staleLeaseCount: number;
  jobsProcessed: string[];
}

export interface OutboxMetricsSummary {
  pending: number;
  processing: number;
  retrying: number;
  accepted: number;
  delivered: number;
  bounced: number;
  rejected: number;
  failed: number;
  cancelled: number;
  ambiguous: number;
  oldestPendingAgeMs: number;
  expiredLeases: number;
  failureCategories: Record<string, number>;
  updatedAt: string;
}

function createEmptyMetricsSummary(nowIso: string): OutboxMetricsSummary {
  return {
    pending: 0,
    processing: 0,
    retrying: 0,
    accepted: 0,
    delivered: 0,
    bounced: 0,
    rejected: 0,
    failed: 0,
    cancelled: 0,
    ambiguous: 0,
    oldestPendingAgeMs: 0,
    expiredLeases: 0,
    failureCategories: {
      transient: 0,
      permanent: 0,
      rate_limit: 0,
      timeout: 0,
      ambiguous: 0,
      provider_5xx: 0,
    },
    updatedAt: nowIso,
  };
}

export function computeBackoffMs(
  attempts: number,
  retryAfterSec?: number,
  jitterRatio: number = Math.random()
): number {
  const expMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1)));
  const retryAfterMs =
    typeof retryAfterSec === 'number' && Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? Math.min(MAX_BACKOFF_MS, retryAfterSec * 1000)
      : 0;
  const baseMs = Math.max(expMs, retryAfterMs);
  const jitterMs = Math.floor(Math.min(10_000, baseMs * 0.2) * Math.max(0, Math.min(1, jitterRatio)));
  return baseMs + jitterMs;
}

function applyMetricsTransition(
  current: OutboxMetricsSummary | undefined,
  fromStatus: OutboxJobStatus | null,
  toStatus: OutboxJobStatus,
  nowIso: string,
  errorCategory?: OutboxErrorCategory
): OutboxMetricsSummary {
  const next: OutboxMetricsSummary = current
    ? {
        ...createEmptyMetricsSummary(nowIso),
        ...current,
        failureCategories: {
          ...createEmptyMetricsSummary(nowIso).failureCategories,
          ...(current.failureCategories || {}),
        },
        updatedAt: nowIso,
      }
    : createEmptyMetricsSummary(nowIso);

  if (fromStatus && typeof (next as any)[fromStatus] === 'number') {
    (next as any)[fromStatus] = Math.max(0, (next as any)[fromStatus] - 1);
  }
  if (typeof (next as any)[toStatus] === 'number') {
    (next as any)[toStatus] = ((next as any)[toStatus] || 0) + 1;
  }
  if (errorCategory) {
    next.failureCategories[errorCategory] = (next.failureCategories[errorCategory] || 0) + 1;
  }
  return next;
}

function buildScopedIdempotencyHash(
  scope: string,
  eventType: NotificationEventType,
  rawKey: string
): string {
  return hashIdentifier(`${scope}::${eventType}::${rawKey}`);
}

/**
 * Durably persists an outbox email job inside a Firestore transaction with scoped idempotency
 * and Phase 4 account deletion suppression.
 */
export async function enqueueOutboxJobPersistent(
  adminDb: Firestore,
  params: PersistentEnqueueParams
): Promise<{
  success: boolean;
  job?: EmailOutboxJob;
  isDuplicate?: boolean;
  suppressed?: boolean;
  error?: string;
}> {
  if (!isValidEmailAddress(params.recipientEmail)) {
    return { success: false, error: `Invalid recipient email address "${params.recipientEmail}".` };
  }

  const normalizedEmail = params.recipientEmail.trim().toLowerCase();
  const targetUid = params.recipientUid || params.ownerId;

  // Phase 4 deletion & suppression guards before persisting
  if (
    (targetUid && (await isAccountDeletionPending(adminDb, targetUid))) ||
    (await isEmailBlockedForDeletion(adminDb, normalizedEmail))
  ) {
    return {
      success: false,
      suppressed: true,
      error: 'Recipient or owner account is deleted or pending deletion; email suppressed.',
    };
  }

  const scope = (params.idempotencyScope || params.ownerId || 'system').trim();
  const rawKey = (params.idempotencyKey || `${normalizedEmail}:${params.eventType}:${Date.now()}`).trim();
  const scopedHash = buildScopedIdempotencyHash(scope, params.eventType, rawKey);

  const idempRef = adminDb.collection(EMAIL_OUTBOX_IDEMPOTENCY_COLLECTION).doc(scopedHash);
  const metricsRef = adminDb
    .collection(EMAIL_OUTBOX_METRICS_COLLECTION)
    .doc(EMAIL_OUTBOX_METRICS_DOC_ID);

  return adminDb.runTransaction(async tx => {
    const [idempSnap, metricsSnap] = await Promise.all([
      tx.get(idempRef),
      tx.get(metricsRef),
    ]);

    if (idempSnap.exists) {
      const idempData = idempSnap.data() || {};
      const existingJobRef = adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(idempData.jobId);
      const existingJobSnap = await tx.get(existingJobRef);
      if (existingJobSnap.exists) {
        const existingJob = existingJobSnap.data() as EmailOutboxJob;
        if ((existingJob.idempotencyScope || 'system') === scope) {
          return { success: true, job: existingJob, isDuplicate: true };
        }
      }
    }

    const nowIso = new Date().toISOString();
    const jobId = `job_${crypto.randomUUID()}`;
    const jobRef = adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(jobId);

    const job: EmailOutboxJob = {
      id: jobId,
      idempotencyKey: scopedHash,
      idempotencyScope: scope,
      ...(params.ownerId ? { ownerId: params.ownerId } : {}),
      recipientEmail: normalizedEmail,
      recipientName: (params.recipientName || 'Participant').trim(),
      ...(params.recipientUid ? { recipientUid: params.recipientUid } : {}),
      eventType: params.eventType,
      subject: params.subject.trim(),
      htmlContent: params.htmlContent,
      textContent: params.textContent || generatePlainTextFallback(params.htmlContent),
      status: 'pending',
      attempts: 0,
      maxAttempts: Math.max(1, Math.min(10, Number(params.maxAttempts) || 5)),
      leaseVersion: 0,
      ...(params.provider ? { provider: params.provider } : {}),
      createdAt: nowIso,
      updatedAt: nowIso,
      ...(params.metadata ? { metadata: params.metadata } : {}),
    };

    const nextMetrics = applyMetricsTransition(
      metricsSnap.exists ? (metricsSnap.data() as OutboxMetricsSummary) : undefined,
      null,
      'pending',
      nowIso
    );

    tx.set(idempRef, {
      jobId,
      scope,
      eventType: params.eventType,
      createdAt: nowIso,
    });
    tx.set(jobRef, job);
    tx.set(metricsRef, nextMetrics);

    return { success: true, job, isDuplicate: false };
  });
}

/**
 * Renews an active worker lease if and only if workerId and leaseVersion match.
 */
export async function renewOutboxLeasePersistent(
  adminDb: Firestore,
  jobId: string,
  workerId: string,
  leaseVersion: number,
  leaseMs: number = DEFAULT_LEASE_MS
): Promise<{ renewed: boolean; lockedUntil?: string; reason?: string }> {
  const jobRef = adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(jobId);
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) {
      return { renewed: false, reason: 'not_found' };
    }
    const job = snap.data() as EmailOutboxJob;
    if (
      job.status !== 'processing' ||
      job.workerId !== workerId ||
      (job.leaseVersion || 0) !== leaseVersion
    ) {
      return { renewed: false, reason: 'stale_lease' };
    }
    const nowIso = new Date().toISOString();
    const lockedUntil = new Date(Date.now() + leaseMs).toISOString();
    tx.set(jobRef, { ...job, lockedUntil, updatedAt: nowIso });
    return { renewed: true, lockedUntil };
  });
}

/**
 * Fenced completion transition: rejects stale workers whose lease was reclaimed.
 */
export async function completeClaimedOutboxJobPersistent(
  adminDb: Firestore,
  jobId: string,
  workerId: string,
  leaseVersion: number,
  nextState: {
    status: 'accepted' | 'retrying' | 'failed' | 'cancelled' | 'ambiguous';
    provider?: string;
    providerMessageId?: string;
    errorCategory?: OutboxErrorCategory;
    lastErrorMessage?: string;
    nextRetryAt?: string;
    scrubPii?: boolean;
  }
): Promise<{ updated: boolean; staleLease?: boolean; job?: EmailOutboxJob }> {
  const jobRef = adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(jobId);
  const metricsRef = adminDb
    .collection(EMAIL_OUTBOX_METRICS_COLLECTION)
    .doc(EMAIL_OUTBOX_METRICS_DOC_ID);

  return adminDb.runTransaction(async tx => {
    const [jobSnap, metricsSnap] = await Promise.all([
      tx.get(jobRef),
      tx.get(metricsRef),
    ]);

    if (!jobSnap.exists) {
      return { updated: false, staleLease: true };
    }

    const current = jobSnap.data() as EmailOutboxJob;
    if (
      current.status !== 'processing' ||
      current.workerId !== workerId ||
      (current.leaseVersion || 0) !== leaseVersion
    ) {
      return { updated: false, staleLease: true };
    }

    const nowIso = new Date().toISOString();
    const updatedJob: EmailOutboxJob = {
      ...current,
      status: nextState.status,
      lockedUntil: undefined,
      updatedAt: nowIso,
      ...(nextState.provider ? { provider: nextState.provider } : {}),
      ...(nextState.providerMessageId ? { providerMessageId: nextState.providerMessageId } : {}),
      ...(nextState.errorCategory ? { errorCategory: nextState.errorCategory } : {}),
      ...(nextState.lastErrorMessage ? { lastErrorMessage: nextState.lastErrorMessage } : {}),
      ...(nextState.nextRetryAt ? { nextRetryAt: nextState.nextRetryAt } : { nextRetryAt: undefined }),
      ...(nextState.status === 'accepted' ? { sentAt: nowIso } : {}),
      ...(nextState.status === 'cancelled' ? { cancelledAt: nowIso } : {}),
      ...(nextState.scrubPii
        ? {
            recipientEmail: '[deleted]',
            recipientName: 'Deleted User',
            subject: '[cancelled]',
            htmlContent: '',
            textContent: '',
          }
        : {}),
    };

    const nextMetrics = applyMetricsTransition(
      metricsSnap.exists ? (metricsSnap.data() as OutboxMetricsSummary) : undefined,
      'processing',
      nextState.status,
      nowIso,
      nextState.errorCategory
    );

    tx.set(jobRef, updatedJob);
    tx.set(metricsRef, nextMetrics);

    return { updated: true, job: updatedJob };
  });
}

async function claimJobInTransaction(
  adminDb: Firestore,
  jobId: string,
  workerId: string,
  leaseMs: number,
  nowMs: number
): Promise<EmailOutboxJob | null> {
  const jobRef = adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(jobId);
  const metricsRef = adminDb
    .collection(EMAIL_OUTBOX_METRICS_COLLECTION)
    .doc(EMAIL_OUTBOX_METRICS_DOC_ID);

  return adminDb.runTransaction(async tx => {
    const [jobSnap, metricsSnap] = await Promise.all([
      tx.get(jobRef),
      tx.get(metricsRef),
    ]);

    if (!jobSnap.exists) return null;
    const job = jobSnap.data() as EmailOutboxJob;

    const isPending = job.status === 'pending';
    const isReadyRetry =
      job.status === 'retrying' &&
      (!job.nextRetryAt || new Date(job.nextRetryAt).getTime() <= nowMs);
    const isExpiredLease =
      job.status === 'processing' &&
      Boolean(job.lockedUntil) &&
      new Date(job.lockedUntil!).getTime() < nowMs;

    if (!isPending && !isReadyRetry && !isExpiredLease) {
      return null;
    }

    const nowIso = new Date(nowMs).toISOString();
    const claimed: EmailOutboxJob = {
      ...job,
      status: 'processing',
      workerId,
      leaseVersion: (job.leaseVersion || 0) + 1,
      lockedUntil: new Date(nowMs + leaseMs).toISOString(),
      attempts: (job.attempts || 0) + 1,
      updatedAt: nowIso,
    };

    const nextMetrics = applyMetricsTransition(
      metricsSnap.exists ? (metricsSnap.data() as OutboxMetricsSummary) : undefined,
      job.status,
      'processing',
      nowIso
    );

    tx.set(jobRef, claimed);
    tx.set(metricsRef, nextMetrics);
    return claimed;
  });
}

/**
 * Durably claims and processes up to batchSize eligible outbox jobs using
 * transactional leases, fencing tokens, Phase 4 suppression, and ambiguous-timeout handling.
 */
export async function processOutboxBatchPersistent(
  adminDb: Firestore,
  batchSize: number = 10,
  sender: PersistentEmailSender,
  workerId: string = `worker_${process.pid || 'main'}`,
  opts?: { leaseMs?: number; nowMs?: number }
): Promise<PersistentBatchResult> {
  const safeBatchSize = Math.max(1, Math.min(50, Number(batchSize) || 10));
  const leaseMs = opts?.leaseMs || DEFAULT_LEASE_MS;
  const nowMs = opts?.nowMs || Date.now();

  const col = adminDb.collection(EMAIL_OUTBOX_COLLECTION);
  const [pendingSnap, retryingSnap, processingSnap] = await Promise.all([
    col.where('status', '==', 'pending').limit(safeBatchSize).get(),
    col.where('status', '==', 'retrying').limit(safeBatchSize).get(),
    col.where('status', '==', 'processing').limit(safeBatchSize).get(),
  ]);

  const candidateIds: string[] = [];
  const seen = new Set<string>();
  const addDocs = (docs: any[]) => {
    for (const d of docs || []) {
      if (candidateIds.length >= safeBatchSize) break;
      if (!seen.has(d.id)) {
        seen.add(d.id);
        candidateIds.push(d.id);
      }
    }
  };

  addDocs(pendingSnap.docs || []);
  addDocs(retryingSnap.docs || []);
  addDocs(
    (processingSnap.docs || []).filter((d: any) => {
      const data = d.data() || {};
      return data.lockedUntil && new Date(data.lockedUntil).getTime() < nowMs;
    })
  );

  const result: PersistentBatchResult = {
    claimedCount: 0,
    acceptedCount: 0,
    sentCount: 0,
    failedCount: 0,
    retriedCount: 0,
    cancelledCount: 0,
    ambiguousCount: 0,
    staleLeaseCount: 0,
    jobsProcessed: [],
  };

  for (const jobId of candidateIds) {
    const claimedJob = await claimJobInTransaction(adminDb, jobId, workerId, leaseMs, nowMs);
    if (!claimedJob) continue;

    result.claimedCount++;
    result.jobsProcessed.push(claimedJob.id);

    const leaseVersion = claimedJob.leaseVersion || 1;
    const targetUid = claimedJob.ownerId || claimedJob.recipientUid;

    // Phase 4 deletion & suppression check immediately before dispatch
    if (
      (targetUid && (await isAccountDeletionPending(adminDb, targetUid))) ||
      (await isEmailBlockedForDeletion(adminDb, claimedJob.recipientEmail))
    ) {
      const fin = await completeClaimedOutboxJobPersistent(adminDb, claimedJob.id, workerId, leaseVersion, {
        status: 'cancelled',
        lastErrorMessage: 'Recipient or owner account is deleted or pending deletion; message cancelled.',
        scrubPii: true,
      });
      if (fin.staleLease) result.staleLeaseCount++;
      else result.cancelledCount++;
      continue;
    }

    try {
      const sendResult = await sender(claimedJob);

      if (sendResult.success) {
        const fin = await completeClaimedOutboxJobPersistent(adminDb, claimedJob.id, workerId, leaseVersion, {
          status: 'accepted',
          provider: sendResult.provider || claimedJob.provider,
          providerMessageId: sendResult.providerMessageId,
        });
        if (fin.staleLease) result.staleLeaseCount++;
        else {
          result.acceptedCount++;
          result.sentCount++;
        }
      } else if (sendResult.isAmbiguous) {
        const fin = await completeClaimedOutboxJobPersistent(adminDb, claimedJob.id, workerId, leaseVersion, {
          status: 'ambiguous',
          provider: sendResult.provider || claimedJob.provider,
          errorCategory: 'ambiguous',
          lastErrorMessage:
            sendResult.error ||
            'Provider response timed out or was ambiguous; reconciliation required before retry.',
        });
        if (fin.staleLease) result.staleLeaseCount++;
        else result.ambiguousCount++;
      } else {
        const isPermanent = Boolean(sendResult.isPermanent || claimedJob.attempts >= claimedJob.maxAttempts);
        const category: OutboxErrorCategory =
          sendResult.errorCategory || (isPermanent ? 'permanent' : 'transient');

        if (isPermanent) {
          const fin = await completeClaimedOutboxJobPersistent(adminDb, claimedJob.id, workerId, leaseVersion, {
            status: 'failed',
            provider: sendResult.provider || claimedJob.provider,
            errorCategory: category,
            lastErrorMessage: sendResult.error || 'Permanent dispatch error.',
          });
          if (fin.staleLease) result.staleLeaseCount++;
          else result.failedCount++;
        } else {
          const backoffMs = computeBackoffMs(claimedJob.attempts, sendResult.retryAfterSec);
          const fin = await completeClaimedOutboxJobPersistent(adminDb, claimedJob.id, workerId, leaseVersion, {
            status: 'retrying',
            provider: sendResult.provider || claimedJob.provider,
            errorCategory: category,
            lastErrorMessage: sendResult.error || 'Transient provider error.',
            nextRetryAt: new Date(Date.now() + backoffMs).toISOString(),
          });
          if (fin.staleLease) result.staleLeaseCount++;
          else result.retriedCount++;
        }
      }
    } catch (err: any) {
      const isPermanent = claimedJob.attempts >= claimedJob.maxAttempts;
      const backoffMs = computeBackoffMs(claimedJob.attempts);
      const fin = await completeClaimedOutboxJobPersistent(adminDb, claimedJob.id, workerId, leaseVersion, {
        status: isPermanent ? 'failed' : 'retrying',
        errorCategory: isPermanent ? 'permanent' : 'transient',
        lastErrorMessage: err?.message || 'Uncaught dispatch error.',
        ...(isPermanent ? {} : { nextRetryAt: new Date(Date.now() + backoffMs).toISOString() }),
      });
      if (fin.staleLease) result.staleLeaseCount++;
      else if (isPermanent) result.failedCount++;
      else result.retriedCount++;
    }
  }

  return result;
}

/**
 * Idempotently processes a verified provider webhook event in Firestore,
 * deduplicating by eventId (e.g., svix-id) and protecting terminal states.
 */
export async function handleProviderWebhookPersistent(
  adminDb: Firestore,
  params: {
    eventId?: string;
    provider: string;
    messageId: string;
    event: 'delivered' | 'bounced' | 'rejected';
  }
): Promise<{
  success: boolean;
  duplicate?: boolean;
  ignoredOutOfOrder?: boolean;
  job?: EmailOutboxJob;
  error?: string;
}> {
  if (!params.messageId) {
    return { success: false, error: 'Missing providerMessageId.' };
  }

  const eventKey = hashIdentifier(
    `${params.provider}::${params.eventId || `${params.messageId}:${params.event}`}`
  );
  const eventRef = adminDb.collection(EMAIL_WEBHOOK_EVENTS_COLLECTION).doc(eventKey);
  const metricsRef = adminDb
    .collection(EMAIL_OUTBOX_METRICS_COLLECTION)
    .doc(EMAIL_OUTBOX_METRICS_DOC_ID);

  // Locate target outbox job by providerMessageId
  const matchingSnap = await adminDb
    .collection(EMAIL_OUTBOX_COLLECTION)
    .where('providerMessageId', '==', params.messageId)
    .limit(1)
    .get();

  if (!matchingSnap.docs || matchingSnap.docs.length === 0) {
    return { success: false, error: 'Job not found for providerMessageId.' };
  }

  const jobRef = matchingSnap.docs[0].ref;

  return adminDb.runTransaction(async tx => {
    const [eventSnap, jobSnap, metricsSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(jobRef),
      tx.get(metricsRef),
    ]);

    if (!jobSnap.exists) {
      return { success: false, error: 'Job not found for providerMessageId.' };
    }

    const currentJob = jobSnap.data() as EmailOutboxJob;

    if (eventSnap.exists) {
      return { success: true, duplicate: true, job: currentJob };
    }

    const nowIso = new Date().toISOString();
    tx.set(eventRef, {
      eventKey,
      eventId: params.eventId || null,
      provider: params.provider,
      messageId: params.messageId,
      event: params.event,
      processedAt: nowIso,
    });

    // Terminal state protection against out-of-order webhooks
    const terminalStatuses: OutboxJobStatus[] = ['delivered', 'bounced', 'rejected', 'cancelled'];
    if (terminalStatuses.includes(currentJob.status)) {
      return { success: true, ignoredOutOfOrder: true, job: currentJob };
    }

    const updatedJob: EmailOutboxJob = {
      ...currentJob,
      status: params.event,
      updatedAt: nowIso,
      ...(params.event === 'delivered' ? { deliveredAt: nowIso } : {}),
    };

    const nextMetrics = applyMetricsTransition(
      metricsSnap.exists ? (metricsSnap.data() as OutboxMetricsSummary) : undefined,
      currentJob.status,
      params.event,
      nowIso
    );

    tx.set(jobRef, updatedJob);
    tx.set(metricsRef, nextMetrics);

    return { success: true, job: updatedJob };
  });
}

/**
 * Returns real-time outbox operational metrics using O(1) maintained summary counters
 * plus bounded (limit 50) queries for oldest pending age and expired leases.
 */
export async function getOutboxMetricsPersistent(
  adminDb: Firestore,
  nowMs: number = Date.now()
): Promise<OutboxMetricsSummary> {
  const nowIso = new Date(nowMs).toISOString();
  const metricsRef = adminDb
    .collection(EMAIL_OUTBOX_METRICS_COLLECTION)
    .doc(EMAIL_OUTBOX_METRICS_DOC_ID);
  const col = adminDb.collection(EMAIL_OUTBOX_COLLECTION);

  const [summarySnap, pendingSampleSnap, processingSampleSnap] = await Promise.all([
    metricsRef.get(),
    col.where('status', '==', 'pending').limit(50).get(),
    col.where('status', '==', 'processing').limit(50).get(),
  ]);

  const summary = summarySnap.exists
    ? { ...createEmptyMetricsSummary(nowIso), ...(summarySnap.data() as OutboxMetricsSummary) }
    : createEmptyMetricsSummary(nowIso);

  let oldestPendingAgeMs = 0;
  for (const d of pendingSampleSnap.docs || []) {
    const createdAt = d.data()?.createdAt;
    if (createdAt) {
      const age = Math.max(0, nowMs - new Date(createdAt).getTime());
      if (age > oldestPendingAgeMs) oldestPendingAgeMs = age;
    }
  }

  let expiredLeases = 0;
  for (const d of processingSampleSnap.docs || []) {
    const lockedUntil = d.data()?.lockedUntil;
    if (lockedUntil && new Date(lockedUntil).getTime() < nowMs) {
      expiredLeases++;
    }
  }

  return {
    ...summary,
    oldestPendingAgeMs,
    expiredLeases,
  };
}

async function getOutboxDocsPaginated(queryRef: any, pageSize: number = 400): Promise<any[]> {
  if (typeof queryRef.limit !== 'function' || typeof queryRef.startAfter !== 'function') {
    const snap = await queryRef.get();
    return snap?.docs || [];
  }

  const allDocs: any[] = [];
  let cursor: any = null;
  while (true) {
    let q = queryRef.limit(pageSize);
    if (cursor) {
      q = q.startAfter(cursor);
    }
    const snap = await q.get();
    const docs = snap?.docs || [];
    if (docs.length === 0) break;
    allDocs.push(...docs);
    if (docs.length < pageSize) break;
    cursor = docs[docs.length - 1];
  }
  return allDocs;
}

/**
 * Rebuilds emailOutboxMetrics/summary using paginated (400-doc) reads.
 * Guards against overwriting concurrent counter updates by checking updatedAt and reconciliationVersion
 * inside the final commit transaction.
 */
export async function reconcileOutboxMetricsPersistent(
  adminDb: Firestore,
  nowMs: number = Date.now()
): Promise<{
  reconciled: boolean;
  concurrentUpdate?: boolean;
  scannedCount: number;
  metrics?: OutboxMetricsSummary & { reconciliationVersion: number; reconciledAt: string };
}> {
  const metricsRef = adminDb
    .collection(EMAIL_OUTBOX_METRICS_COLLECTION)
    .doc(EMAIL_OUTBOX_METRICS_DOC_ID);
  const startSnap = await metricsRef.get();
  const startData = startSnap.exists ? (startSnap.data() as any) : {};
  const startVersion = Number(startData?.reconciliationVersion || 0);
  const startUpdatedAt = startData?.updatedAt || null;

  const nowIso = new Date(nowMs).toISOString();
  const rebuilt = createEmptyMetricsSummary(nowIso);
  let scannedCount = 0;

  const col = adminDb.collection(EMAIL_OUTBOX_COLLECTION);
  const PAGE_SIZE = 400;
  let cursor: any = null;

  while (true) {
    let q: any = typeof col.limit === 'function' ? col.limit(PAGE_SIZE) : col;
    if (cursor && typeof q.startAfter === 'function') {
      q = q.startAfter(cursor);
    }
    const snap = await q.get();
    const docs = snap?.docs || [];
    if (docs.length === 0) break;

    for (const d of docs) {
      scannedCount++;
      const job = d.data() as EmailOutboxJob;
      const st = job.status;
      if (st && typeof (rebuilt as any)[st] === 'number') {
        (rebuilt as any)[st] = ((rebuilt as any)[st] || 0) + 1;
      }
      if (job.errorCategory) {
        rebuilt.failureCategories[job.errorCategory] =
          (rebuilt.failureCategories[job.errorCategory] || 0) + 1;
      }
      if (st === 'pending' && job.createdAt) {
        const age = Math.max(0, nowMs - new Date(job.createdAt).getTime());
        if (age > rebuilt.oldestPendingAgeMs) rebuilt.oldestPendingAgeMs = age;
      }
      if (st === 'processing' && job.lockedUntil && new Date(job.lockedUntil).getTime() < nowMs) {
        rebuilt.expiredLeases++;
      }
    }

    if (typeof col.limit !== 'function' || typeof q.startAfter !== 'function' || docs.length < PAGE_SIZE) {
      break;
    }
    cursor = docs[docs.length - 1];
  }

  return adminDb.runTransaction(async tx => {
    const latestSnap = await tx.get(metricsRef);
    const latestData = latestSnap.exists ? (latestSnap.data() as any) : {};
    const latestVersion = Number(latestData?.reconciliationVersion || 0);
    const latestUpdatedAt = latestData?.updatedAt || null;

    if (latestVersion !== startVersion || latestUpdatedAt !== startUpdatedAt) {
      return { reconciled: false, concurrentUpdate: true, scannedCount };
    }

    const finalDoc = {
      ...rebuilt,
      reconciliationVersion: startVersion + 1,
      reconciledAt: nowIso,
    };
    tx.set(metricsRef, finalDoc);
    return { reconciled: true, scannedCount, metrics: finalDoc };
  });
}

/**
 * Eagerly cancels and scrubs PII from pending/retrying/processing emailOutbox jobs
 * belonging to an account undergoing Phase 4 deletion, incrementing leaseVersion to fence active workers.
 */
export async function cancelOutboxJobsForAccountDeletion(
  adminDb: Firestore,
  params: { uid: string; email?: string | null; pseudoId: string }
): Promise<{ cancelledCount: number }> {
  const { uid, email, pseudoId } = params;
  const col = adminDb.collection(EMAIL_OUTBOX_COLLECTION);

  const byOwner = await getOutboxDocsPaginated(col.where('ownerId', '==', uid), 400);
  const byRecipientUid = await getOutboxDocsPaginated(col.where('recipientUid', '==', uid), 400);
  const byEmail = email
    ? await getOutboxDocsPaginated(col.where('recipientEmail', '==', email.trim().toLowerCase()), 400)
    : [];

  const seen = new Set<string>();
  const uniqueDocs = [...byOwner, ...byRecipientUid, ...byEmail].filter(d => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });

  const metricsRef = adminDb
    .collection(EMAIL_OUTBOX_METRICS_COLLECTION)
    .doc(EMAIL_OUTBOX_METRICS_DOC_ID);
  let cancelledCount = 0;

  for (const doc of uniqueDocs) {
    const didCancel = await adminDb.runTransaction(async tx => {
      const [jobSnap, metricsSnap]: any[] = await Promise.all([
        tx.get(doc.ref),
        tx.get(metricsRef),
      ]);
      if (!jobSnap.exists) return false;
      const current = jobSnap.data() as EmailOutboxJob;

      if (current.status !== 'pending' && current.status !== 'retrying' && current.status !== 'processing') {
        return false;
      }

      const nowIso = new Date().toISOString();
      const cancelledJob: EmailOutboxJob = {
        ...current,
        status: 'cancelled',
        ownerId: current.ownerId === uid ? pseudoId : current.ownerId,
        recipientUid: current.recipientUid === uid ? pseudoId : current.recipientUid,
        recipientEmail: '[deleted]',
        recipientName: 'Deleted User',
        subject: '[cancelled]',
        htmlContent: '',
        textContent: '',
        lockedUntil: undefined,
        leaseVersion: (current.leaseVersion || 0) + 1, // Fence any active worker
        cancelledAt: nowIso,
        updatedAt: nowIso,
        lastErrorMessage: 'Cancelled due to account deletion.',
      };

      const nextMetrics = applyMetricsTransition(
        metricsSnap.exists ? (metricsSnap.data() as OutboxMetricsSummary) : undefined,
        current.status,
        'cancelled',
        nowIso
      );

      tx.set(doc.ref, cancelledJob);
      tx.set(metricsRef, nextMetrics);
      return true;
    });

    if (didCancel) cancelledCount++;
  }

  return { cancelledCount };
}

