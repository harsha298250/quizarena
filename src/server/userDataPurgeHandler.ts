/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import {
  ACCOUNT_DELETION_JOBS_COLLECTION,
  ACCOUNT_DELETION_LOCKS_COLLECTION,
  AccountDeletionJob,
  acquireDeletionJob,
  executeDeletionJob,
  hashIdentifier,
  timingSafeEqualHex,
  toSanitizedJobResponse,
} from './accountDeletionEngine';
import { checkAccountDeletionRateLimit } from './sharedRateLimiter';

export interface UserDataPurgeOptions {
  adminAuth: Auth;
  adminDb: Firestore;
  adminStorage?: any;
}

function isAdminUser(user: any): boolean {
  return Boolean(
    user &&
      user.firebase?.sign_in_provider !== 'anonymous' &&
      (user.admin === true || user.role === 'admin')
  );
}

function isNonAnonymousUser(user: any): boolean {
  return Boolean(user && user.uid && user.firebase?.sign_in_provider !== 'anonymous');
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function authenticateBearer(req: Request, adminAuth: Auth): Promise<any | null> {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const idToken = authHeader.split('Bearer ')[1]?.trim();
  if (!idToken) return null;
  try {
    return await adminAuth.verifyIdToken(idToken, true);
  } catch {
    return null;
  }
}

function hasValidWorkerSecret(req: Request): boolean {
  const rawSecret = req.headers?.['x-worker-secret'];
  const provided = Array.isArray(rawSecret) ? rawSecret[0] : rawSecret;
  const expected = process.env.OUTBOX_WORKER_SECRET?.trim();
  if (!expected || typeof provided !== 'string' || !provided) {
    return false;
  }
  return timingSafeEqualStrings(provided, expected);
}

/**
 * POST /api/account/delete
 * Authenticated owner-only account deletion request.
 */
export async function handleRequestAccountDeletion(
  req: Request,
  res: Response,
  options: UserDataPurgeOptions
): Promise<void> {
  const { adminAuth, adminDb, adminStorage } = options;

  if (!adminAuth || !adminDb || typeof adminDb.runTransaction !== 'function') {
    res.status(503).json({ error: 'Backend authentication or database service unavailable.' });
    return;
  }

  const decoded = await authenticateBearer(req, adminAuth);
  if (!decoded || !decoded.uid) {
    res.status(401).json({ error: 'Unauthorized: Valid Firebase ID token required.' });
    return;
  }

  if (!isNonAnonymousUser(decoded)) {
    res.status(403).json({ error: 'Forbidden: Anonymous sessions do not have persistent accounts to delete.' });
    return;
  }

  // Never trust client-supplied UID; reject spoofing attempts explicitly
  const requestedUid = req.body?.uid || req.body?.targetUid;
  if (requestedUid && requestedUid !== decoded.uid) {
    res.status(403).json({ error: 'Forbidden: You can only delete your own account.' });
    return;
  }

  const rateCheck = checkAccountDeletionRateLimit(decoded.uid);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', String(rateCheck.retryAfterSec || 60));
    res.status(429).json({
      error: `Too many deletion requests. Please wait ${rateCheck.retryAfterSec}s before retrying.`,
    });
    return;
  }

  try {
    const acquired = await acquireDeletionJob(adminDb, decoded.uid);

    if (acquired.isDuplicate) {
      const statusCode = acquired.alreadyCompleted ? 200 : 202;
      res.status(statusCode).json({
        success: acquired.alreadyCompleted,
        isDuplicate: true,
        ...toSanitizedJobResponse(acquired.job),
      });
      return;
    }

    const finalJob = await executeDeletionJob(
      acquired.job,
      { adminAuth, adminDb, adminStorage },
      decoded.email || null
    );

    const isCompleted = finalJob.status === 'completed';
    res.status(isCompleted ? 200 : 500).json({
      success: isCompleted,
      ...toSanitizedJobResponse(finalJob, isCompleted ? undefined : acquired.recoveryToken),
    });
  } catch {
    res.status(500).json({ error: 'Account deletion could not be initiated due to a server error.' });
  }
}

/**
 * GET /api/account/delete/status
 * Returns sanitized deletion job status for the owner, admin, or recovery-token holder.
 */
export async function handleGetDeletionStatus(
  req: Request,
  res: Response,
  options: UserDataPurgeOptions
): Promise<void> {
  const { adminAuth, adminDb } = options;

  if (!adminAuth || !adminDb) {
    res.status(503).json({ error: 'Backend authentication or database service unavailable.' });
    return;
  }

  const jobIdQuery = typeof req.query?.jobId === 'string' ? req.query.jobId.trim() : '';
  const recoveryHeader = req.headers?.['x-deletion-recovery-token'];
  const recoveryToken = Array.isArray(recoveryHeader)
    ? recoveryHeader[0]
    : typeof req.query?.recoveryToken === 'string'
    ? req.query.recoveryToken
    : recoveryHeader;

  if (jobIdQuery && typeof recoveryToken === 'string' && recoveryToken.trim()) {
    const jobSnap = await adminDb
      .collection(ACCOUNT_DELETION_JOBS_COLLECTION)
      .doc(jobIdQuery)
      .get();
    if (!jobSnap.exists) {
      res.status(404).json({ error: 'Deletion job not found.' });
      return;
    }
    const job = jobSnap.data() as AccountDeletionJob;
    if (
      !job.recoveryTokenHash ||
      !timingSafeEqualHex(hashIdentifier(recoveryToken.trim()), job.recoveryTokenHash)
    ) {
      res.status(403).json({ error: 'Forbidden: Invalid recovery token.' });
      return;
    }
    res.status(200).json({ success: job.status === 'completed', ...toSanitizedJobResponse(job) });
    return;
  }

  const decoded = await authenticateBearer(req, adminAuth);
  if (!decoded || !decoded.uid) {
    res.status(401).json({ error: 'Unauthorized: Valid Firebase ID token or recovery token required.' });
    return;
  }

  const targetUid =
    typeof req.query?.uid === 'string' && req.query.uid.trim()
      ? req.query.uid.trim()
      : decoded.uid;

  if (targetUid !== decoded.uid && !isAdminUser(decoded)) {
    res.status(403).json({ error: 'Forbidden: Cannot access another user deletion job.' });
    return;
  }

  const lockSnap = await adminDb
    .collection(ACCOUNT_DELETION_LOCKS_COLLECTION)
    .doc(hashIdentifier(targetUid))
    .get();
  if (!lockSnap.exists) {
    res.status(404).json({ error: 'No deletion job found for this account.' });
    return;
  }

  const lockData = lockSnap.data() || {};
  const jobSnap = await adminDb
    .collection(ACCOUNT_DELETION_JOBS_COLLECTION)
    .doc(lockData.jobId)
    .get();
  if (!jobSnap.exists) {
    res.status(404).json({ error: 'Deletion job not found.' });
    return;
  }

  const job = jobSnap.data() as AccountDeletionJob;
  res.status(200).json({ success: job.status === 'completed', ...toSanitizedJobResponse(job) });
}

/**
 * POST /api/account/delete/retry
 * Resumes a failed deletion job from its last incomplete stage.
 * Does NOT depend on the deleted account's Firebase token when authorized via
 * recoveryToken, admin token, or internal worker secret.
 */
export async function handleRetryAccountDeletion(
  req: Request,
  res: Response,
  options: UserDataPurgeOptions
): Promise<void> {
  const { adminAuth, adminDb, adminStorage } = options;

  if (!adminAuth || !adminDb || typeof adminDb.runTransaction !== 'function') {
    res.status(503).json({ error: 'Backend authentication or database service unavailable.' });
    return;
  }

  const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId.trim() : '';
  const recoveryToken =
    typeof req.body?.recoveryToken === 'string' ? req.body.recoveryToken.trim() : '';

  if (!jobId) {
    res.status(400).json({ error: 'Bad Request: jobId is required.' });
    return;
  }

  const jobRef = adminDb.collection(ACCOUNT_DELETION_JOBS_COLLECTION).doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    res.status(404).json({ error: 'Deletion job not found.' });
    return;
  }

  const existingJob = jobSnap.data() as AccountDeletionJob;

  // Authorize caller via worker secret, recovery token, admin token, or owner token
  let authorized = hasValidWorkerSecret(req);
  if (
    !authorized &&
    recoveryToken &&
    existingJob.recoveryTokenHash &&
    timingSafeEqualHex(hashIdentifier(recoveryToken), existingJob.recoveryTokenHash)
  ) {
    authorized = true;
  }

  if (!authorized) {
    const decoded = await authenticateBearer(req, adminAuth);
    if (decoded && (isAdminUser(decoded) || decoded.uid === existingJob.uid)) {
      authorized = true;
    }
  }

  if (!authorized) {
    res.status(403).json({ error: 'Forbidden: Not authorized to retry this deletion job.' });
    return;
  }

  if (existingJob.status === 'completed') {
    res.status(200).json({ success: true, ...toSanitizedJobResponse(existingJob) });
    return;
  }

  if (existingJob.status === 'processing' || existingJob.status === 'requested') {
    res.status(202).json({ success: false, ...toSanitizedJobResponse(existingJob) });
    return;
  }

  const rateCheck = checkAccountDeletionRateLimit(`retry_${existingJob.uidHash}`);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', String(rateCheck.retryAfterSec || 60));
    res.status(429).json({
      error: `Too many retry attempts. Please wait ${rateCheck.retryAfterSec}s.`,
    });
    return;
  }

  try {
    const resumed = await acquireDeletionJob(adminDb, existingJob.uid);
    const finalJob = await executeDeletionJob(resumed.job, {
      adminAuth,
      adminDb,
      adminStorage,
    });
    const isCompleted = finalJob.status === 'completed';
    res.status(isCompleted ? 200 : 500).json({
      success: isCompleted,
      ...toSanitizedJobResponse(finalJob, isCompleted ? undefined : resumed.recoveryToken),
    });
  } catch {
    res.status(500).json({ error: 'Failed to retry account deletion job.' });
  }
}

/**
 * POST /api/admin/users/:uid/delete
 * Restricted administrative deletion endpoint.
 */
export async function handleAdminDeleteUser(
  req: Request,
  res: Response,
  options: UserDataPurgeOptions
): Promise<void> {
  const { adminAuth, adminDb, adminStorage } = options;

  if (!adminAuth || !adminDb || typeof adminDb.runTransaction !== 'function') {
    res.status(503).json({ error: 'Backend authentication or database service unavailable.' });
    return;
  }

  const decoded = await authenticateBearer(req, adminAuth);
  if (!decoded || !decoded.uid) {
    res.status(401).json({ error: 'Unauthorized: Valid Firebase ID token required.' });
    return;
  }

  if (!isAdminUser(decoded)) {
    res.status(403).json({ error: 'Forbidden: Administrator privileges required.' });
    return;
  }

  const targetUid = typeof req.params?.uid === 'string' ? req.params.uid.trim() : '';
  if (!targetUid) {
    res.status(400).json({ error: 'Bad Request: Target user UID is required.' });
    return;
  }

  try {
    const acquired = await acquireDeletionJob(adminDb, targetUid);
    if (acquired.isDuplicate) {
      res.status(acquired.alreadyCompleted ? 200 : 202).json({
        success: acquired.alreadyCompleted,
        isDuplicate: true,
        ...toSanitizedJobResponse(acquired.job),
      });
      return;
    }

    let targetEmail: string | null = null;
    try {
      const targetUser = await adminAuth.getUser(targetUid);
      targetEmail = targetUser?.email || null;
    } catch {
      // User may already be missing from Auth
    }

    const finalJob = await executeDeletionJob(
      acquired.job,
      { adminAuth, adminDb, adminStorage },
      targetEmail
    );
    const isCompleted = finalJob.status === 'completed';
    res.status(isCompleted ? 200 : 500).json({
      success: isCompleted,
      ...toSanitizedJobResponse(finalJob, isCompleted ? undefined : acquired.recoveryToken),
    });
  } catch {
    res.status(500).json({ error: 'Administrative account deletion failed.' });
  }
}

/**
 * POST /api/purge-user-data
 * Delegates to the Phase 4 staged account deletion engine while maintaining
 * backward-compatible top-level summary fields.
 */
export async function handlePurgeUserData(
  req: Request,
  res: Response,
  options: UserDataPurgeOptions
): Promise<void> {
  const { adminAuth, adminDb, adminStorage } = options;

  if (!adminAuth || !adminDb) {
    res.status(500).json({ error: 'Backend authentication or database service unavailable' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Valid Firebase ID token required for data purge' });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1].trim();
  let decoded: any = null;
  try {
    decoded = await adminAuth.verifyIdToken(idToken, true);
  } catch {
    res.status(401).json({ error: 'Unauthorized: Invalid or expired ID token' });
    return;
  }

  const uid = decoded?.uid;
  if (!uid) {
    res.status(400).json({ error: 'Invalid user identity' });
    return;
  }

  if (typeof adminDb.runTransaction !== 'function') {
    res.status(503).json({ error: 'Authoritative transactional database is unavailable.' });
    return;
  }

  const acquired = await acquireDeletionJob(adminDb, uid);
  const finalJob = acquired.isDuplicate
    ? acquired.job
    : await executeDeletionJob(
        acquired.job,
        { adminAuth, adminDb, adminStorage },
        decoded.email || null
      );

  const isSuccess = finalJob.status === 'completed';
  const isInProgress =
    acquired.isDuplicate &&
    (finalJob.status === 'requested' || finalJob.status === 'processing');
  const httpStatus = isSuccess ? 200 : isInProgress ? 202 : 500;

  res.status(httpStatus).json({
    success: isSuccess,
    ...(acquired.isDuplicate ? { isDuplicate: true } : {}),
    uid: isSuccess ? '[purged]' : uid,
    jobId: finalJob.id,
    status: finalJob.status,
    currentStage: finalJob.currentStage,
    completedStages: finalJob.completedStages,
    deletedQuizzes: finalJob.counts.deletedQuizzes,
    deletedQuestionBank: finalJob.counts.deletedQuestionBank,
    deletedGames: finalJob.counts.deletedGames,
    deletedPlayerRecords: finalJob.counts.deletedPlayerRecords,
    deletedStorageFiles: finalJob.counts.deletedStorageFiles,
    accountDeleted: finalJob.completedStages.includes('delete_auth_and_profile'),
    ...(isSuccess ? {} : { recoveryToken: acquired.recoveryToken }),
    errors: finalJob.sanitizedError ? [finalJob.sanitizedError] : undefined,
    retainedRecords:
      'Shared tournament brackets, completed competition standings, and issued certificates are preserved in a non-reversible anonymized state; minimal deletion-job metadata is retained for 90 days.',
  });
}
