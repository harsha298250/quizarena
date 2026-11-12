/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import {
  IssuedCertificate,
  PublicVerificationResult,
  CertificateType,
} from '../types/certificate';

export interface IssueCertificateParams {
  ownerId: string;
  recipientName: string;
  assessmentType: 'quiz' | 'tournament';
  assessmentId: string;
  assessmentTitle: string;
  type: CertificateType;
  score: number;
  rank: number;
  totalParticipants: number;
  accuracy: number;
  issuerId: string;
  issuerName: string;
}

export const CERTIFICATES_COLLECTION = 'certificates';
export const CERTIFICATE_VERIFICATION_COLLECTION = 'certificateVerification';
export const CERTIFICATE_IDEMPOTENCY_COLLECTION = 'certificateIdempotency';

const MAX_VERIFICATION_COLLISION_RETRIES = 5;

/**
 * Legacy in-memory certificate stores.
 * @deprecated Retained only for legacy synchronous unit tests; NOT used by server endpoints.
 */
export const certificateStore = new Map<string, IssuedCertificate>();
export const verificationIdIndex = new Map<string, string>();
export const idempotencyIndex = new Map<string, string>();

/**
 * Generates an unpredictable, cryptographically random verification ID
 * Format: QA-V-XXXX-XXXX-XXXX (uppercase alphanumeric)
 */
export function generateVerificationId(): string {
  const bytes = crypto.randomBytes(6);
  const hex = bytes.toString('hex').toUpperCase();
  return `QA-V-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export function buildCertificateIdempotencyKey(
  assessmentType: 'quiz' | 'tournament',
  assessmentId: string,
  ownerId: string
): string {
  const cleanType = assessmentType === 'tournament' ? 'tournament' : 'quiz';
  const cleanAssessment = assessmentId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanOwner = ownerId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${cleanType}_${cleanAssessment}_${cleanOwner}`;
}

function toPublicVerificationResult(cert: IssuedCertificate): PublicVerificationResult {
  if (cert.status === 'revoked') {
    return {
      valid: false,
      status: 'revoked',
      verificationId: cert.verificationId,
      recipientName: cert.recipientName,
      assessmentTitle: cert.assessmentTitle,
      assessmentType: cert.assessmentType,
      type: cert.type,
      issueDate: cert.issueDate,
      issuerName: cert.issuerName,
      revokedAt: cert.revokedAt,
      revocationReason: cert.revocationReason || 'Revoked by authorized issuer.',
    };
  }

  return {
    valid: true,
    status: 'valid',
    verificationId: cert.verificationId,
    recipientName: cert.recipientName,
    assessmentTitle: cert.assessmentTitle,
    assessmentType: cert.assessmentType,
    type: cert.type,
    rank: cert.rank,
    totalParticipants: cert.totalParticipants,
    issueDate: cert.issueDate,
    issuerName: cert.issuerName,
  };
}

/**
 * Persistently issues (or reissues) a verified certificate in Firestore using an atomic transaction
 * across `certificates`, `certificateVerification`, and `certificateIdempotency`.
 */
export async function issueCertificatePersistent(
  adminDb: Firestore,
  params: IssueCertificateParams,
  reissue: boolean = false,
  idGenerator: () => string = generateVerificationId
): Promise<{ success: boolean; certificate?: IssuedCertificate; isDuplicate?: boolean; error?: string; statusCode?: number }> {
  if (!adminDb || typeof adminDb.runTransaction !== 'function') {
    return { success: false, error: 'Authoritative Firestore database is unavailable.' };
  }

  if (!params.ownerId || !params.recipientName || !params.assessmentId || !params.issuerId) {
    return { success: false, error: 'Missing required recipient, issuer, or assessment information.' };
  }

  if (params.totalParticipants <= 0 || params.rank <= 0) {
    return { success: false, error: 'Invalid participant count or rank.' };
  }

  const idempotencyKey = buildCertificateIdempotencyKey(
    params.assessmentType,
    params.assessmentId,
    params.ownerId
  );

  return await adminDb.runTransaction(async (tx: Transaction) => {
    const idempRef = adminDb.collection(CERTIFICATE_IDEMPOTENCY_COLLECTION).doc(idempotencyKey);
    const idempSnap = await tx.get(idempRef);

    let existingCert: IssuedCertificate | null = null;
    if (idempSnap.exists) {
      const existingCertId = idempSnap.data()?.certificateId as string | undefined;
      if (existingCertId) {
        const existingCertRef = adminDb.collection(CERTIFICATES_COLLECTION).doc(existingCertId);
        const existingCertSnap = await tx.get(existingCertRef);
        if (existingCertSnap.exists) {
          existingCert = existingCertSnap.data() as IssuedCertificate;
          if (!reissue) {
            return { success: true, certificate: existingCert, isDuplicate: true };
          }
          if (existingCert.status === 'revoked') {
            return {
              success: false,
              error: 'Conflict: Cannot reissue a revoked certificate.',
              statusCode: 409,
            };
          }
        }
      }
    }

    // Allocate a unique verificationId inside the transaction (never overwrite an existing record)
    let verificationId = '';
    let verifRef: FirebaseFirestore.DocumentReference | null = null;
    for (let attempt = 0; attempt < MAX_VERIFICATION_COLLISION_RETRIES; attempt++) {
      const candidate = idGenerator();
      const candidateRef = adminDb.collection(CERTIFICATE_VERIFICATION_COLLECTION).doc(candidate);
      const candidateSnap = await tx.get(candidateRef);
      if (!candidateSnap.exists) {
        verificationId = candidate;
        verifRef = candidateRef;
        break;
      }
    }

    if (!verificationId || !verifRef) {
      throw new Error('Failed to allocate a unique certificate verification ID after retries.');
    }

    const nowIso = new Date().toISOString();
    const certId = existingCert?.id || `cert_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const reissueCount = existingCert && reissue ? (existingCert.reissueCount || 0) + 1 : 0;

    const newCert: IssuedCertificate = {
      id: certId,
      verificationId,
      ownerId: params.ownerId,
      recipientName: params.recipientName.trim(),
      assessmentType: params.assessmentType,
      assessmentId: params.assessmentId,
      assessmentTitle: params.assessmentTitle.trim(),
      type: params.type,
      score: Math.max(0, Math.round(params.score)),
      rank: params.rank,
      totalParticipants: params.totalParticipants,
      accuracy: Math.min(1, Math.max(0, params.accuracy)),
      issuerId: params.issuerId,
      issuerName: params.issuerName,
      issueDate: nowIso,
      status: 'valid',
      reissueCount,
    };

    const certRef = adminDb.collection(CERTIFICATES_COLLECTION).doc(certId);

    // Supersede previous verification record on reissue so rotated IDs cannot verify
    if (existingCert && reissue && existingCert.verificationId && existingCert.verificationId !== verificationId) {
      const oldVerifRef = adminDb
        .collection(CERTIFICATE_VERIFICATION_COLLECTION)
        .doc(existingCert.verificationId);
      tx.set(
        oldVerifRef,
        {
          verificationId: existingCert.verificationId,
          certificateId: certId,
          status: 'superseded',
          supersededBy: verificationId,
          updatedAt: nowIso,
        },
        { merge: true }
      );
    }

    tx.set(certRef, newCert);
    tx.set(verifRef, {
      verificationId,
      certificateId: certId,
      assessmentType: params.assessmentType,
      assessmentId: params.assessmentId,
      status: 'valid',
      createdAt: nowIso,
    });
    tx.set(idempRef, {
      idempotencyKey,
      certificateId: certId,
      ownerId: params.ownerId,
      issuerId: params.issuerId,
      assessmentType: params.assessmentType,
      assessmentId: params.assessmentId,
      createdAt: idempSnap.exists ? (idempSnap.data()?.createdAt || nowIso) : nowIso,
      updatedAt: nowIso,
    });

    return { success: true, certificate: newCert, isDuplicate: false };
  });
}

/**
 * Public, privacy-conscious persistent verification backed by Firestore.
 * Strictly omits ownerId, email, score, and internal metadata.
 */
export async function verifyCertificatePublicPersistent(
  adminDb: Firestore,
  verificationId: string
): Promise<PublicVerificationResult> {
  if (!verificationId || typeof verificationId !== 'string' || !verificationId.trim()) {
    return { valid: false, status: 'not_found' };
  }

  const trimmedId = verificationId.trim();
  const verifSnap = await adminDb.collection(CERTIFICATE_VERIFICATION_COLLECTION).doc(trimmedId).get();

  let cert: IssuedCertificate | null = null;

  if (verifSnap.exists) {
    const verifData = verifSnap.data() || {};
    if (verifData.status === 'superseded') {
      return { valid: false, status: 'not_found' };
    }
    const certId = verifData.certificateId as string | undefined;
    if (certId) {
      const certSnap = await adminDb.collection(CERTIFICATES_COLLECTION).doc(certId).get();
      if (certSnap.exists) {
        cert = certSnap.data() as IssuedCertificate;
      }
    }
  } else {
    // Compatibility fallback for legacy certificates stored directly in `certificates`
    const legacyQuery = await adminDb
      .collection(CERTIFICATES_COLLECTION)
      .where('verificationId', '==', trimmedId)
      .limit(1)
      .get();
    if (legacyQuery && !legacyQuery.empty && legacyQuery.docs?.[0]) {
      cert = legacyQuery.docs[0].data() as IssuedCertificate;
    }
  }

  if (!cert) {
    return { valid: false, status: 'not_found' };
  }

  return toPublicVerificationResult(cert);
}

/**
 * Persistently revokes a certificate in Firestore using an atomic transaction.
 * Restricts revocation to the issuing host or an administrator.
 */
export async function revokeCertificatePersistent(
  adminDb: Firestore,
  certificateId: string,
  revokerId: string,
  reason: string,
  isAdmin: boolean = false
): Promise<{ success: boolean; certificate?: IssuedCertificate; error?: string; statusCode?: number }> {
  if (!adminDb || typeof adminDb.runTransaction !== 'function') {
    return { success: false, error: 'Authoritative Firestore database is unavailable.', statusCode: 503 };
  }

  if (!certificateId || typeof certificateId !== 'string') {
    return { success: false, error: 'certificateId is required.', statusCode: 400 };
  }

  return await adminDb.runTransaction(async (tx: Transaction) => {
    const certRef = adminDb.collection(CERTIFICATES_COLLECTION).doc(certificateId);
    const certSnap = await tx.get(certRef);

    if (!certSnap.exists) {
      return { success: false, error: 'Certificate not found.', statusCode: 404 };
    }

    const cert = certSnap.data() as IssuedCertificate;

    if (cert.issuerId !== revokerId && !isAdmin) {
      return {
        success: false,
        error: 'Forbidden: Only the issuing host or an admin can revoke this certificate.',
        statusCode: 403,
      };
    }

    if (cert.status === 'revoked') {
      return { success: true, certificate: cert, statusCode: 200 };
    }

    const nowIso = new Date().toISOString();
    const cleanReason = (typeof reason === 'string' ? reason.trim() : '') || 'Unspecified issuer revocation.';
    const updatedCert: IssuedCertificate = {
      ...cert,
      status: 'revoked',
      revocationReason: cleanReason,
      revokedAt: nowIso,
      revokedBy: revokerId,
    };

    tx.set(certRef, updatedCert, { merge: true });

    if (cert.verificationId) {
      const verifRef = adminDb
        .collection(CERTIFICATE_VERIFICATION_COLLECTION)
        .doc(cert.verificationId);
      tx.set(
        verifRef,
        {
          verificationId: cert.verificationId,
          certificateId: cert.id,
          status: 'revoked',
          revokedAt: nowIso,
        },
        { merge: true }
      );
    }

    return { success: true, certificate: updatedCert, statusCode: 200 };
  });
}

/**
 * Retrieves all persisted certificates for an owner from Firestore.
 */
export async function getIssuedCertificatesByOwnerPersistent(
  adminDb: Firestore,
  ownerId: string
): Promise<IssuedCertificate[]> {
  if (!adminDb || !ownerId) return [];
  const snap = await adminDb
    .collection(CERTIFICATES_COLLECTION)
    .where('ownerId', '==', ownerId)
    .get();
  const list = (snap?.docs || []).map(d => d.data() as IssuedCertificate);
  return list.sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''));
}

// ---------------------------------------------------------------------------
// Legacy synchronous helpers (@deprecated — kept for existing unit tests only)
// ---------------------------------------------------------------------------

/** @deprecated Use issueCertificatePersistent(adminDb, ...) for all production paths. */
export function issueCertificate(
  params: IssueCertificateParams,
  reissue: boolean = false
): { success: boolean; certificate?: IssuedCertificate; error?: string } {
  if (!params.ownerId || !params.recipientName || !params.assessmentId) {
    return { success: false, error: 'Missing required recipient or assessment information.' };
  }

  if (params.totalParticipants <= 0 || params.rank <= 0) {
    return { success: false, error: 'Invalid participant count or rank.' };
  }

  const idempotencyKey = `${params.assessmentId}_${params.ownerId}`;
  const existingId = idempotencyIndex.get(idempotencyKey);

  if (existingId && !reissue) {
    const existing = certificateStore.get(existingId);
    if (existing) {
      return { success: true, certificate: existing };
    }
  }

  const certId = existingId || `cert_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  let reissueCount = 0;

  if (existingId && reissue) {
    const prev = certificateStore.get(existingId);
    if (prev) {
      reissueCount = (prev.reissueCount || 0) + 1;
    }
  }

  const verificationId = generateVerificationId();

  const newCert: IssuedCertificate = {
    id: certId,
    verificationId,
    ownerId: params.ownerId,
    recipientName: params.recipientName.trim(),
    assessmentType: params.assessmentType,
    assessmentId: params.assessmentId,
    assessmentTitle: params.assessmentTitle.trim(),
    type: params.type,
    score: Math.max(0, Math.round(params.score)),
    rank: params.rank,
    totalParticipants: params.totalParticipants,
    accuracy: Math.min(1, Math.max(0, params.accuracy)),
    issuerId: params.issuerId,
    issuerName: params.issuerName,
    issueDate: new Date().toISOString(),
    status: 'valid',
    reissueCount,
  };

  certificateStore.set(certId, newCert);
  verificationIdIndex.set(verificationId, certId);
  idempotencyIndex.set(idempotencyKey, certId);

  return { success: true, certificate: newCert };
}

/** @deprecated Use verifyCertificatePublicPersistent(adminDb, ...) for all production paths. */
export function verifyCertificatePublic(verificationId: string): PublicVerificationResult {
  if (!verificationId || typeof verificationId !== 'string') {
    return { valid: false, status: 'not_found' };
  }

  const certId = verificationIdIndex.get(verificationId.trim());
  if (!certId) {
    return { valid: false, status: 'not_found' };
  }

  const cert = certificateStore.get(certId);
  if (!cert) {
    return { valid: false, status: 'not_found' };
  }

  return toPublicVerificationResult(cert);
}

/** @deprecated Use revokeCertificatePersistent(adminDb, ...) for all production paths. */
export function revokeCertificate(
  certificateId: string,
  revokerId: string,
  reason: string
): { success: boolean; certificate?: IssuedCertificate; error?: string } {
  const cert = certificateStore.get(certificateId);
  if (!cert) {
    return { success: false, error: 'Certificate not found.' };
  }

  if (cert.issuerId !== revokerId && revokerId !== 'admin_root') {
    return { success: false, error: 'Forbidden: Only the issuing host or an admin can revoke this certificate.' };
  }

  if (cert.status === 'revoked') {
    return { success: true, certificate: cert };
  }

  cert.status = 'revoked';
  cert.revocationReason = reason.trim() || 'Unspecified issuer revocation.';
  cert.revokedAt = new Date().toISOString();
  cert.revokedBy = revokerId;

  certificateStore.set(certificateId, cert);

  return { success: true, certificate: cert };
}

/** @deprecated Use getIssuedCertificatesByOwnerPersistent(adminDb, ...) for all production paths. */
export function getIssuedCertificatesByOwner(ownerId: string): IssuedCertificate[] {
  const result: IssuedCertificate[] = [];
  for (const cert of certificateStore.values()) {
    if (cert.ownerId === ownerId) {
      result.push(cert);
    }
  }
  return result;
}
