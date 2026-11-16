/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { CertificateType, IssuedCertificate } from '../types/certificate';
import {
  issueCertificatePersistent,
  verifyCertificatePublicPersistent,
  revokeCertificatePersistent,
} from './certificateEngine';
import {
  processOutboxBatch,
  handleProviderWebhook,
} from './emailOutboxWorker';
import {
  enqueueOutboxJobPersistent,
  processOutboxBatchPersistent,
  handleProviderWebhookPersistent,
  getOutboxMetricsPersistent,
  listOutboxJobsPersistent,
  retryOutboxJobPersistent,
} from './emailOutboxEngine';
import {
  getSmtpTransporter,
  dispatchSingleEmail,
  getResolvedEmailProvider,
  getResolvedFromAddress,
} from './resultEmailsHandler';
import {
  checkOutboxEnqueueRateLimit,
  checkCertificateRateLimit,
  checkPublicVerifyRateLimit,
  extractClientIp,
} from './sharedRateLimiter';
import {
  assertAccountActive,
  isAccountDeletionPending,
  isEmailBlockedForDeletion,
} from './accountDeletionEngine';

export interface NotificationRouteDependencies {
  adminAuth: Auth;
  adminDb: Firestore;
}

const SVIX_TOLERANCE_SEC = 300; // 5 minutes replay window

function timingSafeEqualStrings(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Verifies official Resend / Svix webhook signatures using:
 * - Headers: svix-id, svix-timestamp, svix-signature
 * - Secret: whsec_<base64> (or raw UTF-8 fallback if non-prefixed)
 * - Original raw request body bytes (req.rawBody) — never JSON.stringify(req.body)
 */
export function verifyResendSvixSignature(
  req: Request & { rawBody?: Buffer | string },
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): { valid: boolean; reason?: string } {
  const getHeader = (name: string): string | null => {
    const raw = req.headers[name];
    const val = Array.isArray(raw) ? raw[0] : raw;
    return typeof val === 'string' && val.trim() ? val.trim() : null;
  };

  const svixId = getHeader('svix-id');
  const svixTimestamp = getHeader('svix-timestamp');
  const svixSignature = getHeader('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { valid: false, reason: 'Missing required Svix signature headers (svix-id, svix-timestamp, svix-signature).' };
  }

  if (!/^\d+$/.test(svixTimestamp)) {
    return { valid: false, reason: 'Invalid svix-timestamp format.' };
  }

  const tsSec = Number(svixTimestamp);
  if (Math.abs(nowSec - tsSec) > SVIX_TOLERANCE_SEC) {
    return { valid: false, reason: 'Webhook timestamp outside replay tolerance window.' };
  }

  const rawBodyStr = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.toString('utf8')
    : typeof req.rawBody === 'string'
      ? req.rawBody
      : null;

  if (rawBodyStr === null) {
    return { valid: false, reason: 'Missing original raw request body for signature verification.' };
  }

  const keyBytes = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice(6), 'base64')
    : Buffer.from(secret, 'utf8');

  if (keyBytes.length === 0) {
    return { valid: false, reason: 'Invalid webhook signing secret.' };
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBodyStr}`;
  const expectedSigBytes = crypto.createHmac('sha256', keyBytes).update(signedContent).digest();

  const candidateSignatures = svixSignature.split(/\s+/).filter(Boolean);
  for (const entry of candidateSignatures) {
    const parts = entry.split(',');
    if (parts.length !== 2 || parts[0] !== 'v1' || !parts[1]) continue;
    try {
      const providedBytes = Buffer.from(parts[1], 'base64');
      if (
        providedBytes.length === expectedSigBytes.length &&
        crypto.timingSafeEqual(providedBytes, expectedSigBytes)
      ) {
        return { valid: true };
      }
    } catch {
      // Ignore malformed base64 entry and continue checking others
    }
  }

  return { valid: false, reason: 'Invalid Svix webhook signature.' };
}

function deriveAuthoritativeCertificateType(
  assessmentType: 'quiz' | 'tournament',
  rank: number,
  accuracy: number
): CertificateType {
  if (assessmentType === 'tournament') {
    if (rank === 1) return 'tournament_champion';
    if (rank <= 3) return 'tournament_placement';
    return 'quiz_completion';
  }
  if (rank === 1 || accuracy >= 0.85) {
    return 'quiz_excellence';
  }
  return 'quiz_completion';
}

async function authenticate(req: Request, adminAuth: Auth) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split('Bearer ')[1].trim();
  try {
    return await adminAuth.verifyIdToken(token, true);
  } catch {
    return null;
  }
}

/**
 * POST /api/certificates/issue
 * Server-authoritative certificate issuance.
 * Never trusts client-supplied issuerId, type, score, rank, totalParticipants, or accuracy.
 * Restricts reissue=true strictly to the assessment host or an administrator.
 */
export async function handleIssueCertificate(
  req: Request,
  res: Response,
  deps: NotificationRouteDependencies
): Promise<void> {
  const user = await authenticate(req, deps.adminAuth);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized: Authentication required.' });
    return;
  }

  const certRate = checkCertificateRateLimit(user.uid);
  if (!certRate.allowed) {
    res.setHeader('Retry-After', String(certRate.retryAfterSec || 60));
    res.status(429).json({ error: `Rate limit exceeded for certificate issuance. Please wait ${certRate.retryAfterSec}s.` });
    return;
  }

  const {
    ownerId,
    assessmentType = 'quiz',
    assessmentId,
    reissue = false,
  } = req.body || {};

  if (!ownerId || typeof ownerId !== 'string' || !assessmentId || typeof assessmentId !== 'string') {
    res.status(400).json({ error: 'Bad Request: ownerId and assessmentId are required.' });
    return;
  }

  if (!deps.adminDb || typeof deps.adminDb.collection !== 'function') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative database is not configured.' });
    return;
  }

  const acct = await assertAccountActive(deps.adminDb, user.uid);
  if (!acct.active) {
    res.status(403).json({ error: acct.error });
    return;
  }

  const isAdmin = Boolean(
    user.firebase?.sign_in_provider !== 'anonymous' &&
    (user.admin === true || user.role === 'admin')
  );
  const normalizedAssessmentType: 'quiz' | 'tournament' =
    assessmentType === 'tournament' ? 'tournament' : 'quiz';

  let authoritativeTitle = 'QuizArena Assessment';
  let authoritativeIssuerId = '';
  let authoritativeIssuerName = 'Quiz Master';
  let authoritativeRecipientName = 'Participant';
  let authoritativeScore = 0;
  let authoritativeRank = 1;
  let authoritativeTotalParticipants = 1;
  let authoritativeAccuracy = 0;
  let isHost = false;

  if (normalizedAssessmentType === 'tournament') {
    const tourneySnap = await deps.adminDb.collection('tournaments').doc(assessmentId).get();
    if (!tourneySnap.exists) {
      res.status(404).json({ error: 'Tournament assessment not found.' });
      return;
    }
    const tourneyData = tourneySnap.data() || {};
    if (tourneyData.status !== 'completed') {
      res.status(400).json({ error: 'Bad Request: Tournament must be completed before issuing certificates.' });
      return;
    }
    isHost = tourneyData.hostId === user.uid;
    if (!isHost && !isAdmin && user.uid !== ownerId) {
      res.status(403).json({ error: 'Forbidden: You cannot issue certificates for other users.' });
      return;
    }

    const regSnap = await deps.adminDb
      .collection('tournaments')
      .doc(assessmentId)
      .collection('registrations')
      .doc(ownerId)
      .get();

    if (!regSnap.exists) {
      res.status(403).json({ error: 'Forbidden: User is not a verified participant in this tournament.' });
      return;
    }

    const regData = regSnap.data() || {};
    authoritativeTitle = tourneyData.title || 'Tournament Assessment';
    authoritativeIssuerId = tourneyData.hostId || '';
    authoritativeIssuerName = tourneyData.hostName || 'Tournament Host';
    authoritativeRecipientName = regData.participantNickname || regData.nickname || regData.name || 'Participant';
    authoritativeScore = Math.max(0, Number(regData.score) || 0);
    authoritativeRank = Math.max(1, Number(regData.rank) || 1);
    authoritativeTotalParticipants = Math.max(1, Number(tourneyData.participantCount) || 1);
    authoritativeAccuracy = Math.min(1, Math.max(0, Number(regData.accuracy) || 0));
  } else {
    const gameSnap = await deps.adminDb.collection('games').doc(assessmentId).get();
    if (!gameSnap.exists) {
      res.status(404).json({ error: 'Quiz game session not found.' });
      return;
    }
    const gameData = gameSnap.data() || {};
    isHost = gameData.hostId === user.uid;

    if (!isHost && !isAdmin && user.uid !== ownerId) {
      res.status(403).json({ error: 'Forbidden: You cannot issue certificates for other users.' });
      return;
    }

    const playersCol = deps.adminDb.collection('games').doc(assessmentId).collection('players');
    const playerSnap = await playersCol.doc(ownerId).get();
    if (!playerSnap.exists) {
      res.status(403).json({ error: 'Forbidden: User is not a verified participant in this game.' });
      return;
    }

    const playerData = playerSnap.data() || {};
    const allPlayersSnap = await playersCol.get();
    const sortedPlayers = (allPlayersSnap?.docs || [])
      .map(d => ({ id: d.id, score: Number(d.data()?.score) || 0 }))
      .sort((a, b) => b.score - a.score);

    const computedRank = sortedPlayers.findIndex(p => p.id === ownerId);
    const totalQuestions = Array.isArray(gameData.questions) ? gameData.questions.length : 0;

    authoritativeTitle = gameData.quizTitle || 'QuizArena Assessment';
    authoritativeIssuerId = gameData.hostId || '';
    authoritativeIssuerName = gameData.hostName || 'Quiz Master';
    authoritativeRecipientName = playerData.nickname || playerData.name || 'Participant';
    authoritativeScore = Math.max(0, Number(playerData.score) || 0);
    authoritativeTotalParticipants = Math.max(1, sortedPlayers.length || 1);
    authoritativeRank = computedRank >= 0 ? computedRank + 1 : 1;

    if (typeof playerData.accuracy === 'number') {
      authoritativeAccuracy = Math.min(1, Math.max(0, playerData.accuracy));
    } else if (typeof playerData.correctCount === 'number' && totalQuestions > 0) {
      authoritativeAccuracy = Math.min(1, Math.max(0, playerData.correctCount / totalQuestions));
    }
  }

  if (!authoritativeIssuerId) {
    res.status(403).json({ error: 'Forbidden: Assessment has no authoritative host/issuer.' });
    return;
  }

  if (Boolean(reissue) && !isHost && !isAdmin) {
    res.status(403).json({ error: 'Forbidden: Only the assessment host or an administrator can reissue certificates.' });
    return;
  }

  const authoritativeType = deriveAuthoritativeCertificateType(
    normalizedAssessmentType,
    authoritativeRank,
    authoritativeAccuracy
  );

  try {
    const result = await issueCertificatePersistent(
      deps.adminDb,
      {
        ownerId,
        recipientName: authoritativeRecipientName,
        assessmentType: normalizedAssessmentType,
        assessmentId,
        assessmentTitle: authoritativeTitle,
        type: authoritativeType,
        score: authoritativeScore,
        rank: authoritativeRank,
        totalParticipants: authoritativeTotalParticipants,
        accuracy: authoritativeAccuracy,
        issuerId: authoritativeIssuerId,
        issuerName: authoritativeIssuerName,
      },
      Boolean(reissue)
    );

    if (!result.success) {
      res.status(result.statusCode || 400).json({ error: result.error });
      return;
    }

    res.status(201).json({ success: true, certificate: result.certificate, isDuplicate: Boolean(result.isDuplicate) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to persist certificate in database.' });
  }
}

/**
 * GET /api/certificates/my-certificates
 * Lists authenticated user's certificates.
 */
export async function handleListUserCertificates(
  req: Request,
  res: Response,
  deps: NotificationRouteDependencies
): Promise<void> {
  const user = await authenticate(req, deps.adminAuth);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized: Authentication required.' });
    return;
  }

  const adminDb = deps.adminDb;
  if (!adminDb || typeof adminDb.collection !== 'function') {
    res.status(503).json({ error: 'Service Unavailable: Database not configured.' });
    return;
  }

  let limit = 20;
  let offset = 0;
  const query = req.query || {};
  if (query.limit !== undefined) {
    const parsedLimit = parseInt(String(query.limit), 10);
    if (isNaN(parsedLimit) || parsedLimit <= 0) {
      res.status(400).json({ error: 'Invalid limit parameter: must be a positive integer.' });
      return;
    }
    limit = Math.min(parsedLimit, 100);
  }
  if (query.offset !== undefined) {
    const parsedOffset = parseInt(String(query.offset), 10);
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      res.status(400).json({ error: 'Invalid offset parameter: must be a non-negative integer.' });
      return;
    }
    if (parsedOffset > 500) {
      res.status(400).json({ error: 'Invalid offset parameter: offset cannot exceed 500.' });
      return;
    }
    offset = parsedOffset;
  }

  try {
    const certsCol = adminDb.collection('certificates');
    // Ensure fetchBound covers the requested page up to offset + limit + 1, safely bounded at 1001
    const fetchBound = Math.min(limit + offset + 1, 1001);
    const certQuery = certsCol.where('ownerId', '==', user.uid);
    const snap = typeof certQuery.limit === 'function'
      ? await certQuery.orderBy('issueDate', 'desc').limit(fetchBound).get().catch(async () => {
          return typeof certQuery.limit === 'function' ? await certQuery.limit(fetchBound).get() : await certQuery.get();
        })
      : await certQuery.get();

    const allCertificates = (snap.docs || [])
      .map(d => d.data() as IssuedCertificate)
      .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''));

    const paginatedCertificates = offset >= allCertificates.length
      ? []
      : allCertificates.slice(offset, offset + limit);

    const hasMore = paginatedCertificates.length > 0 && allCertificates.length > offset + limit;

    res.status(200).json({
      certificates: paginatedCertificates,
      pagination: {
        limit,
        offset,
        count: paginatedCertificates.length,
        hasMore,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load user certificates.' });
  }
}

/**
 * GET /api/certificates/verify/:verificationId
 * Public, privacy-conscious persistent verification endpoint backed by Firestore.
 */
export async function handleVerifyCertificate(
  req: Request,
  res: Response,
  deps?: Pick<NotificationRouteDependencies, 'adminDb'>
): Promise<void> {
  const verifyRate = checkPublicVerifyRateLimit(extractClientIp(req));
  if (!verifyRate.allowed) {
    res.setHeader('Retry-After', String(verifyRate.retryAfterSec || 60));
    res.status(429).json({
      valid: false,
      status: 'rate_limited',
      error: `Too many verification requests. Please wait ${verifyRate.retryAfterSec}s.`,
    });
    return;
  }

  const { verificationId } = req.params;
  if (!verificationId || typeof verificationId !== 'string' || verificationId.trim().length === 0 || verificationId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(verificationId)) {
    res.status(400).json({ valid: false, status: 'invalid_format', error: 'Invalid verification ID format.' });
    return;
  }

  const adminDb = deps?.adminDb;
  if (!adminDb || typeof adminDb.collection !== 'function') {
    res.status(503).json({ valid: false, status: 'error', error: 'Service Unavailable: Verification database is not configured.' });
    return;
  }
  try {
    const result = await verifyCertificatePublicPersistent(adminDb, verificationId);

    if (result.status === 'not_found') {
      res.status(404).json({ valid: false, status: 'not_found', message: 'Certificate not found.' });
      return;
    }

    if (result.status === 'revoked') {
      res.status(200).json({
        valid: false,
        status: 'revoked',
        verificationId: result.verificationId,
        recipientName: result.recipientName,
        assessmentTitle: result.assessmentTitle,
        assessmentType: result.assessmentType,
        type: result.type,
        issueDate: result.issueDate,
        issuerName: result.issuerName,
        revokedAt: result.revokedAt,
        revocationReason: result.revocationReason,
      });
      return;
    }

    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ valid: false, status: 'error', error: err?.message || 'Verification lookup failed.' });
  }
}

/**
 * POST /api/certificates/revoke
 * Persistent issuer or admin revocation endpoint.
 */
export async function handleRevokeCertificate(
  req: Request,
  res: Response,
  deps: NotificationRouteDependencies
): Promise<void> {
  const user = await authenticate(req, deps.adminAuth);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const certRate = checkCertificateRateLimit(user.uid);
  if (!certRate.allowed) {
    res.setHeader('Retry-After', String(certRate.retryAfterSec || 60));
    res.status(429).json({ error: `Rate limit exceeded for certificate revocation. Please wait ${certRate.retryAfterSec}s.` });
    return;
  }

  const acct = await assertAccountActive(deps.adminDb, user.uid);
  if (!acct.active) {
    res.status(403).json({ error: acct.error });
    return;
  }

  if (!deps.adminDb || typeof deps.adminDb.runTransaction !== 'function') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative database is not configured.' });
    return;
  }

  const isAdmin = Boolean(
    user.firebase?.sign_in_provider !== 'anonymous' &&
    (user.admin === true || user.role === 'admin')
  );

  const { certificateId, reason } = req.body || {};
  try {
    const result = await revokeCertificatePersistent(deps.adminDb, certificateId, user.uid, reason, isAdmin);

    if (!result.success) {
      res.status(result.statusCode || 403).json({ error: result.error });
      return;
    }

    res.status(200).json({ success: true, certificate: result.certificate });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to revoke certificate in database.' });
  }
}

/**
 * POST /api/outbox/process
 * Protected queue worker dispatch endpoint.
 * Fails closed when OUTBOX_WORKER_SECRET is unset unless caller has genuine admin claims.
 */
export async function handleProcessOutbox(
  req: Request,
  res: Response,
  deps: NotificationRouteDependencies
): Promise<void> {
  const rawSecret = req.headers['x-worker-secret'];
  const internalSecret = Array.isArray(rawSecret) ? rawSecret[0] : rawSecret;
  const expectedSecret = process.env.OUTBOX_WORKER_SECRET?.trim();

  let isAuthorized = false;
  if (expectedSecret && typeof internalSecret === 'string' && internalSecret.length > 0) {
    isAuthorized = timingSafeEqualStrings(internalSecret, expectedSecret);
  }

  if (!isAuthorized) {
    const user = await authenticate(req, deps.adminAuth);
    const isAdminClaim = Boolean(
      user &&
      user.firebase?.sign_in_provider !== 'anonymous' &&
      (user.admin === true || user.role === 'admin')
    );
    if (isAdminClaim) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    res.status(403).json({ error: 'Forbidden: Worker dispatch is protected.' });
    return;
  }

  const batchSize = Number((req.query && req.query.batchSize) || 10);
  const hasDurableDb = Boolean(deps.adminDb && typeof deps.adminDb.runTransaction === 'function');

  if (!hasDurableDb && process.env.NODE_ENV !== 'test') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative Firestore outbox is not configured.' });
    return;
  }

  const sender = async (job: any) => {
    const targetUid = job?.ownerId || job?.userId || job?.recipientUid;
    if (
      (targetUid && (await isAccountDeletionPending(deps.adminDb, targetUid))) ||
      (await isEmailBlockedForDeletion(deps.adminDb, job?.recipientEmail))
    ) {
      return {
        success: false,
        isPermanent: true,
        error: 'Recipient account is deleted or pending deletion; message cancelled.',
      };
    }

    const provider = getResolvedEmailProvider();
    const fromAddress = getResolvedFromAddress(provider);
    const transporter = provider === 'smtp' ? getSmtpTransporter() : null;

    try {
      const dispatchResult = await dispatchSingleEmail({
        to: job.recipientEmail,
        recipientName: job.recipientName || 'Participant',
        subject: job.subject,
        html: job.htmlContent,
        transporter,
        fromAddress,
        idempotencyKey: job.idempotencyKey,
      });

      if (dispatchResult.status === 'sent') {
        return {
          success: true,
          provider: dispatchResult.provider || provider,
          providerMessageId: dispatchResult.messageId || `msg_${job.id}`,
        };
      }

      return {
        success: false,
        error: 'Email delivery provider is not configured or skipped dispatch.',
        isPermanent: false,
      };
    } catch (err: any) {
      const isPermanent = Boolean(
        err?.isPermanent ||
        err?.status === 403 ||
        err?.status === 422 ||
        /invalid|550|rejected|401|403|422|unauthorized|forbidden|domain.not.verified|not.allowed/i.test(err?.message || '')
      );
      return {
        success: false,
        error: err?.message,
        isPermanent,
        isAmbiguous: Boolean(err?.isAmbiguous),
        retryAfterSec: err?.retryAfter,
        errorCategory: err?.errorCategory,
      };
    }
  };

  const batchResult = hasDurableDb
    ? await processOutboxBatchPersistent(deps.adminDb, batchSize, sender)
    : await processOutboxBatch(batchSize, sender);
  res.status(200).json({ success: true, result: batchResult });
}

/**
 * POST /api/outbox/webhook
 * Provider delivery webhook endpoint.
 * - Supports Resend official Svix signature verification over rawBody.
 * - Deduplicates webhook events via Firestore emailWebhookEvents.
 * - Fails closed for providers without supported webhook verification (Brevo, SMTP) or missing WEBHOOK_SECRET.
 */
export async function handleOutboxWebhook(
  req: Request & { rawBody?: Buffer | string },
  res: Response,
  deps?: Partial<NotificationRouteDependencies>
): Promise<void> {
  const provider = getResolvedEmailProvider();
  if (provider === 'brevo' || provider === 'smtp') {
    res.status(501).json({
      error: `Webhook verification is not implemented for email provider "${provider}". Failing closed.`,
    });
    return;
  }

  const expectedKey = process.env.WEBHOOK_SECRET?.trim();
  if (!expectedKey) {
    res.status(503).json({ error: 'Service Unavailable: WEBHOOK_SECRET is not configured.' });
    return;
  }

  const verification = verifyResendSvixSignature(req, expectedKey);
  if (!verification.valid) {
    res.status(401).json({ error: `Unauthorized: ${verification.reason || 'Invalid webhook signature.'}` });
    return;
  }

  // Normalize Resend webhook payload or direct { messageId, event }
  const body = req.body || {};
  const messageId = body.data?.email_id || body.messageId;
  const rawEvent = body.type || body.event;
  let normalizedEvent: 'delivered' | 'bounced' | 'rejected' | undefined;
  if (rawEvent === 'email.delivered' || rawEvent === 'delivered') {
    normalizedEvent = 'delivered';
  } else if (rawEvent === 'email.bounced' || rawEvent === 'bounced') {
    normalizedEvent = 'bounced';
  } else if (rawEvent === 'email.complained' || rawEvent === 'email.failed' || rawEvent === 'rejected') {
    normalizedEvent = 'rejected';
  }

  if (!normalizedEvent) {
    res.status(400).json({ error: 'Unsupported or missing webhook event type.' });
    return;
  }

  const rawSvixId = req.headers['svix-id'];
  const eventId = Array.isArray(rawSvixId) ? rawSvixId[0] : rawSvixId || body.id;
  const hasDurableDb = Boolean(deps?.adminDb && typeof deps.adminDb.runTransaction === 'function');

  if (!hasDurableDb && process.env.NODE_ENV !== 'test') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative Firestore outbox is not configured.' });
    return;
  }

  const result = hasDurableDb
    ? await handleProviderWebhookPersistent(deps!.adminDb!, {
        eventId: typeof eventId === 'string' ? eventId : undefined,
        provider: provider === 'none' ? 'resend' : provider,
        messageId,
        event: normalizedEvent,
      })
    : handleProviderWebhook(messageId, normalizedEvent, true);

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.status(200).json({
    success: true,
    ...(('duplicate' in result && result.duplicate) ? { duplicate: true } : {}),
    job: result.job,
  });
}

async function authorizeWorkerOrAdmin(
  req: Request,
  deps: NotificationRouteDependencies
): Promise<boolean> {
  const rawSecret = req.headers['x-worker-secret'];
  const internalSecret = Array.isArray(rawSecret) ? rawSecret[0] : rawSecret;
  const expectedSecret = process.env.OUTBOX_WORKER_SECRET?.trim();

  if (expectedSecret && typeof internalSecret === 'string' && internalSecret.length > 0) {
    if (timingSafeEqualStrings(internalSecret, expectedSecret)) {
      return true;
    }
  }

  const user = await authenticate(req, deps.adminAuth);
  if (!user) return false;
  const acct = await assertAccountActive(deps.adminDb, user.uid);
  if (!acct.active) return false;

  return Boolean(
    user.firebase?.sign_in_provider !== 'anonymous' &&
    (user.admin === true || user.role === 'admin')
  );
}

/**
 * GET /api/outbox/metrics
 * Protected administrative/worker operational visibility endpoint.
 */
export async function handleOutboxMetrics(
  req: Request,
  res: Response,
  deps: NotificationRouteDependencies
): Promise<void> {
  if (!(await authorizeWorkerOrAdmin(req, deps))) {
    res.status(403).json({ error: 'Forbidden: Administrative or worker authorization required.' });
    return;
  }

  if (!deps.adminDb || typeof deps.adminDb.collection !== 'function') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative Firestore database is not configured.' });
    return;
  }

  const metrics = await getOutboxMetricsPersistent(deps.adminDb);
  res.status(200).json({ success: true, metrics });
}

/**
 * POST /api/outbox/enqueue
 * Authenticated endpoint to enqueue durable email notifications with scoped idempotency.
 */
export async function handleOutboxEnqueue(
  req: Request,
  res: Response,
  deps: NotificationRouteDependencies
): Promise<void> {
  const user = await authenticate(req, deps.adminAuth);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized: Valid Firebase ID token required.' });
    return;
  }

  if (user.firebase?.sign_in_provider === 'anonymous') {
    res.status(403).json({ error: 'Forbidden: Anonymous accounts cannot enqueue notifications.' });
    return;
  }

  // SEC-05: Server-side email verification required to enqueue email notifications
  if (user.email_verified !== true) {
    res.status(403).json({
      error: 'Email verification required to enqueue email notifications.',
      code: 'EMAIL_NOT_VERIFIED',
    });
    return;
  }

  if (!deps.adminDb || typeof deps.adminDb.runTransaction !== 'function') {
    res.status(503).json({ error: 'Service Unavailable: Authoritative Firestore database is not configured.' });
    return;
  }

  const acct = await assertAccountActive(deps.adminDb, user.uid);
  if (!acct.active) {
    res.status(403).json({ error: acct.error });
    return;
  }

  const enqRate = checkOutboxEnqueueRateLimit(user.uid);
  if (!enqRate.allowed) {
    res.setHeader('Retry-After', String(enqRate.retryAfterSec || 60));
    res.status(429).json({ error: 'Rate limit exceeded for email enqueue requests.' });
    return;
  }

  const {
    idempotencyKey,
    recipientEmail,
    recipientName = 'Participant',
    recipientUid,
    eventType = 'quiz_results_ready',
    subject,
    htmlContent,
    textContent = '',
  } = req.body || {};

  if (!idempotencyKey || !recipientEmail || !subject || !htmlContent) {
    res.status(400).json({
      error: 'Bad Request: idempotencyKey, recipientEmail, subject, and htmlContent are required.',
    });
    return;
  }

  const result = await enqueueOutboxJobPersistent(deps.adminDb, {
    idempotencyKey: String(idempotencyKey),
    idempotencyScope: user.uid,
    ownerId: user.uid,
    recipientEmail: String(recipientEmail),
    recipientName: String(recipientName),
    ...(recipientUid ? { recipientUid: String(recipientUid) } : {}),
    eventType,
    subject: String(subject),
    htmlContent: String(htmlContent),
    textContent: String(textContent),
  });

  if (result.suppressed) {
    res.status(403).json({ error: result.error });
    return;
  }

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.status(result.isDuplicate ? 200 : 201).json({
    success: true,
    isDuplicate: Boolean(result.isDuplicate),
    jobId: result.job?.id,
    status: result.job?.status,
  });
}

/**
 * GET /api/outbox/jobs
 * Protected outbox listing endpoint.
 * Administrators can list jobs with status filter and bounded pagination.
 * Non-administrators can only see their own jobs.
 */
export async function handleListOutboxJobs(
  req: Request,
  res: Response,
  deps: NotificationRouteDependencies
): Promise<void> {
  const user = await authenticate(req, deps.adminAuth);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized: Valid Firebase ID token required.' });
    return;
  }

  if (!deps.adminDb || typeof deps.adminDb.collection !== 'function') {
    res.status(503).json({ error: 'Service Unavailable: Database not configured.' });
    return;
  }

  const isAdmin = Boolean(
    user.firebase?.sign_in_provider !== 'anonymous' &&
    (user.admin === true || user.role === 'admin')
  );

  const status = typeof req.query.status === 'string' ? (req.query.status as any) : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

  const result = await listOutboxJobsPersistent(deps.adminDb, {
    userId: user.uid,
    isAdmin,
    status,
    limit,
    offset,
  });

  res.status(200).json({ success: true, ...result });
}

/**
 * POST /api/outbox/retry
 * Administrative recovery endpoint to reschedule a failed outbox job.
 */
export async function handleRetryOutboxJob(
  req: Request,
  res: Response,
  deps: NotificationRouteDependencies
): Promise<void> {
  const user = await authenticate(req, deps.adminAuth);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized: Valid Firebase ID token required.' });
    return;
  }

  const isAdmin = Boolean(
    user.firebase?.sign_in_provider !== 'anonymous' &&
    (user.admin === true || user.role === 'admin')
  );

  if (!isAdmin) {
    res.status(403).json({ error: 'Forbidden: Administrative authorization required to retry outbox jobs.' });
    return;
  }

  if (!deps.adminDb || typeof deps.adminDb.runTransaction !== 'function') {
    res.status(503).json({ error: 'Service Unavailable: Database not configured.' });
    return;
  }

  const { jobId } = req.body || {};
  if (!jobId || typeof jobId !== 'string') {
    res.status(400).json({ error: 'Bad Request: jobId is required.' });
    return;
  }

  const result = await retryOutboxJobPersistent(deps.adminDb, jobId);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.status(200).json({ success: true, job: result.job });
}
