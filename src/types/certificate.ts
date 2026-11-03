/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type CertificateType =
  | 'quiz_completion'
  | 'quiz_excellence'
  | 'tournament_champion'
  | 'tournament_placement';

export type CertificateStatus = 'valid' | 'revoked';

export interface IssuedCertificate {
  id: string; // e.g. "cert_..."
  verificationId: string; // Cryptographically random, e.g. "QA-V-ABCD-1234-EFGH"
  ownerId: string; // Recipient UID
  recipientName: string;
  assessmentType: 'quiz' | 'tournament';
  assessmentId: string; // Game ID or Tournament ID
  assessmentTitle: string;
  type: CertificateType;
  score: number;
  rank: number;
  totalParticipants: number;
  accuracy: number;
  issuerId: string; // Host UID
  issuerName: string;
  issueDate: string; // ISO date
  status: CertificateStatus;
  revocationReason?: string;
  revokedAt?: string;
  revokedBy?: string;
  reissueCount: number;
  metadata?: Record<string, any>;
}

export interface PublicVerificationResult {
  valid: boolean;
  status: CertificateStatus | 'not_found';
  verificationId?: string;
  recipientName?: string;
  assessmentTitle?: string;
  assessmentType?: 'quiz' | 'tournament';
  type?: CertificateType;
  rank?: number;
  totalParticipants?: number;
  issueDate?: string;
  issuerName?: string;
  revokedAt?: string;
  revocationReason?: string;
}
