/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
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

// In-memory certificate store for tests / server state
export const certificateStore = new Map<string, IssuedCertificate>(); // id -> certificate
export const verificationIdIndex = new Map<string, string>(); // verificationId -> id
export const idempotencyIndex = new Map<string, string>(); // `${assessmentId}_${ownerId}` -> id

/**
 * Generates an unpredictable, cryptographically random verification ID
 * Format: QA-V-XXXX-XXXX-XXXX (uppercase alphanumeric)
 */
export function generateVerificationId(): string {
  const bytes = crypto.randomBytes(6);
  const hex = bytes.toString('hex').toUpperCase();
  return `QA-V-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

/**
 * Issues a verified certificate derived strictly from server-authoritative data.
 * Enforces atomic idempotency to prevent duplicate issuance.
 */
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

  let certId = existingId || `cert_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
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

/**
 * Verifies a certificate publically.
 * Strictly preserves student privacy: OMITTING email, UID, and internal fields.
 */
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
 * Revokes a certificate. Restricts to authorized issuer or administrator.
 * Preserves historical record and marks status as revoked.
 */
export function revokeCertificate(
  certificateId: string,
  revokerId: string,
  reason: string
): { success: boolean; certificate?: IssuedCertificate; error?: string } {
  const cert = certificateStore.get(certificateId);
  if (!cert) {
    return { success: false, error: 'Certificate not found.' };
  }

  // Authorization check: Must be the issuer or admin
  if (cert.issuerId !== revokerId && revokerId !== 'admin_root') {
    return { success: false, error: 'Forbidden: Only the issuing host or an admin can revoke this certificate.' };
  }

  // Idempotent: If already revoked, return success
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

/**
 * Retrieves all issued certificates for a given recipient owner ID.
 */
export function getIssuedCertificatesByOwner(ownerId: string): IssuedCertificate[] {
  const result: IssuedCertificate[] = [];
  for (const cert of certificateStore.values()) {
    if (cert.ownerId === ownerId) {
      result.push(cert);
    }
  }
  return result;
}


