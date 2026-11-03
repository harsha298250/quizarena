/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import {
  issueCertificate,
  verifyCertificatePublic,
  revokeCertificate,
  certificateStore,
} from './certificateEngine';
import {
  enqueueOutboxJob,
  processOutboxBatch,
  handleProviderWebhook,
  isValidEmailAddress,
} from './emailOutboxWorker';
import {
  getSmtpTransporter,
  dispatchSingleEmail,
  getResolvedEmailProvider,
  getResolvedFromAddress,
} from './resultEmailsHandler';

export interface NotificationRouteDependencies {
  adminAuth: Auth;
  adminDb: Firestore;
}

async function authenticate(req: Request, adminAuth: Auth) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split('Bearer ')[1].trim();
  try {
    return await adminAuth.verifyIdToken(token);
  } catch {
    return null;
  }
}

/**
 * POST /api/certificates/issue
 * Server-authoritative certificate issuance.
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

  const {
    ownerId,
    recipientName,
    assessmentType,
    assessmentId,
    assessmentTitle,
    type,
    score,
    rank,
    totalParticipants,
    accuracy,
    reissue = false,
  } = req.body;

  // Validation: Only the owner or host can request issuance
  if (user.uid !== ownerId && user.uid !== req.body.issuerId) {
    res.status(403).json({ error: 'Forbidden: You cannot issue certificates for other users.' });
    return;
  }

  const result = issueCertificate(
    {
      ownerId,
      recipientName,
      assessmentType: assessmentType || 'quiz',
      assessmentId,
      assessmentTitle,
      type: type || 'quiz_completion',
      score: Number(score) || 0,
      rank: Number(rank) || 1,
      totalParticipants: Number(totalParticipants) || 1,
      accuracy: Number(accuracy) || 1,
      issuerId: user.uid,
      issuerName: user.name || user.email || 'Quiz Master',
    },
    Boolean(reissue)
  );

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.status(201).json({ success: true, certificate: result.certificate });
}

/**
 * GET /api/certificates/verify/:verificationId
 * Public, privacy-conscious verification endpoint.
 */
export async function handleVerifyCertificate(req: Request, res: Response): Promise<void> {
  const { verificationId } = req.params;
  const result = verifyCertificatePublic(verificationId);

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
      revokedAt: result.revokedAt,
      revocationReason: result.revocationReason,
    });
    return;
  }

  res.status(200).json(result);
}

/**
 * POST /api/certificates/revoke
 * Issuer or admin revocation endpoint.
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

  const { certificateId, reason } = req.body;
  const result = revokeCertificate(certificateId, user.uid, reason);

  if (!result.success) {
    res.status(403).json({ error: result.error });
    return;
  }

  res.status(200).json({ success: true, certificate: result.certificate });
}

/**
 * POST /api/outbox/process
 * Protected queue worker dispatch endpoint.
 */
export async function handleProcessOutbox(
  req: Request,
  res: Response,
  deps: NotificationRouteDependencies
): Promise<void> {
  // Protect worker: Must have internal secret header or admin token
  const internalSecret = req.headers['x-worker-secret'];
  const expectedSecret = process.env.WORKER_SECRET || 'quizarena_internal_worker_secret';

  let isAuthorized = internalSecret === expectedSecret;
  if (!isAuthorized) {
    const user = await authenticate(req, deps.adminAuth);
    if (user && !user.firebase?.sign_in_provider) {
      isAuthorized = true; // Authorized authenticated host/admin
    }
  }

  if (!isAuthorized) {
    res.status(403).json({ error: 'Forbidden: Worker dispatch is protected.' });
    return;
  }

  const batchSize = Number(req.query.batchSize) || 10;

  // Use resolved HTTPS API provider (Resend/Brevo) or SMTP transporter
  const sender = async (job: any) => {
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
      });

      if (dispatchResult.status === 'sent') {
        return { success: true, providerMessageId: dispatchResult.messageId || `msg_${job.id}` };
      }

      // If skipped (no HTTPS keys or SMTP configured), use mock provider for test/offline environment
      return { success: true, providerMessageId: `mock_${job.id}` };
    } catch (err: any) {
      const isPermanent = Boolean(
        err?.isPermanent ||
        err?.status === 403 ||
        err?.status === 422 ||
        /invalid|550|rejected|401|403|422|unauthorized|forbidden|domain.not.verified|not.allowed/i.test(err?.message || '')
      );
      return { success: false, error: err?.message, isPermanent };
    }
  };

  const batchResult = await processOutboxBatch(batchSize, sender);
  res.status(200).json({ success: true, result: batchResult });
}

/**
 * POST /api/outbox/webhook
 * Provider delivery webhook endpoint.
 */
export async function handleOutboxWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers['x-provider-signature'];
  const expectedKey = process.env.WEBHOOK_SECRET || 'test_webhook_secret';
  const isSignatureValid = signature === expectedKey;

  const { messageId, event } = req.body;
  const result = handleProviderWebhook(messageId, event, isSignatureValid);

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.status(200).json({ success: true, job: result.job });
}
