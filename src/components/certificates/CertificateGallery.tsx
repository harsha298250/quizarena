/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { sound } from '../../lib/sound';
import { EmptyState } from '../common/EmptyState';
import { auth, db, isFirebaseConfigured } from '../../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { IssuedCertificate, PublicVerificationResult } from '../../types/certificate';
import { generateCertificatePdf } from '../../services/certificateService';

export const CertificateGallery: React.FC = () => {
  const [certificates, setCertificates] = useState<IssuedCertificate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCert, setSelectedCert] = useState<IssuedCertificate | null>(null);
  const [verificationQuery, setVerificationQuery] = useState('');
  const [verificationResult, setVerificationResult] = useState<PublicVerificationResult | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [studentUid, setStudentUid] = useState<string | null>(() => {
    const u = auth.currentUser;
    return u && !u.isAnonymous ? u.uid : null;
  });

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      setStudentUid(user && !user.isAnonymous ? user.uid : null);
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadCertificates = async () => {
      if (!studentUid) {
        if (!cancelled) {
          setCertificates([]);
          setLoadError(null);
          setIsLoading(false);
        }
        return;
      }
      if (!isFirebaseConfigured || !db) {
        if (!cancelled) {
          setCertificates([]);
          setLoadError('Certificate storage is unavailable in this environment.');
          setIsLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setIsLoading(true);
        setLoadError(null);
      }

      try {
        const q = query(collection(db, 'certificates'), where('ownerId', '==', studentUid));
        const snap = await getDocs(q);
        const list = snap.docs
          .map(d => d.data() as IssuedCertificate)
          .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''));
        if (!cancelled) setCertificates(list);
      } catch (err: any) {
        if (!cancelled) {
          setCertificates([]);
          setLoadError(err?.message || 'Unable to load your certificates. Please try again later.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    loadCertificates();
    return () => {
      cancelled = true;
    };
  }, [studentUid]);

  const handleDownloadPdf = async (cert: IssuedCertificate) => {
    sound.playClick();
    await generateCertificatePdf({
      studentName: cert.recipientName,
      quizTitle: cert.assessmentTitle,
      score: cert.score || 100,
      totalPlayers: cert.totalParticipants || 1,
      rank: cert.rank || 1,
      accuracy: cert.accuracy || 100,
      date: new Date(cert.issueDate).toLocaleDateString(),
      certificateNumber: cert.verificationId,
      verificationId: cert.verificationId,
    });
  };

  const handleCopyVerificationUrl = (vId: string) => {
    sound.playClick();
    const url = `${window.location.origin}/verify?id=${vId}`;
    navigator.clipboard.writeText(url);
    setCopiedId(vId);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handlePublicVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationQuery.trim()) return;
    sound.playClick();
    setIsVerifying(true);
    setVerificationError(null);

    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${apiBase}/api/certificates/verify/${encodeURIComponent(verificationQuery.trim())}`);
      if (res.status === 404) {
        setVerificationResult({ valid: false, status: 'not_found' });
        return;
      }
      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        setVerificationResult(null);
        setVerificationError(
          errPayload?.error || `Verification service error (HTTP ${res.status}). Please try again later.`
        );
        return;
      }
      const data = (await res.json()) as PublicVerificationResult;
      setVerificationResult(data);
    } catch {
      setVerificationResult(null);
      setVerificationError('Unable to reach the certificate verification service. Please check your connection and try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8 animate-fadeIn">
      {/* 1. Header Banner */}
      <section className="paper-card p-6 sm:p-8 bg-gradient-to-r from-amber-500/10 via-white to-amber-500/5 dark:from-amber-950/30 dark:via-slate-900 dark:to-slate-900 border border-[var(--border)]">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-xs font-bold">
              <span>🏅</span> Official Credentials & Verifications
            </div>
            <h1 className="font-['Bricolage_Grotesque'] text-2xl sm:text-3xl font-black text-[var(--text)] tracking-tight">
              Verified Digital Certificate Gallery
            </h1>
            <p className="text-sm text-[var(--text-muted)] max-w-xl">
              Authentic, tamper-evident educational credentials backed by cryptographic verification IDs. Download high-resolution PDFs or verify third-party credentials.
            </p>
          </div>

          {/* Public Verification Quick Input */}
          <form
            onSubmit={handlePublicVerify}
            className="w-full md:w-auto flex-shrink-0 p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-xs space-y-2"
          >
            <div className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">
              🔍 Verify Any Certificate
            </div>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <input
                type="text"
                value={verificationQuery}
                onChange={e => setVerificationQuery(e.target.value)}
                placeholder="QA-V-XXXX-XXXX"
                className="w-full sm:w-44 font-mono-code text-xs py-1.5 px-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text)]"
                aria-label="Enter Verification ID"
              />
              <button
                type="submit"
                disabled={!verificationQuery.trim() || isVerifying}
                className="paper-btn paper-btn-sm paper-btn-secondary text-xs font-bold px-3 shrink-0"
              >
                {isVerifying ? 'Checking...' : 'Verify'}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Verification Service Error Alert */}
      {verificationError && (
        <div
          role="alert"
          className="paper-card p-4 border-2 border-red-400 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 flex items-center justify-between gap-3 text-xs font-bold"
        >
          <span>⚠️ {verificationError}</span>
          <button
            type="button"
            onClick={() => setVerificationError(null)}
            className="text-xs font-bold hover:underline shrink-0"
          >
            ✕ Dismiss
          </button>
        </div>
      )}

      {/* Verification Query Result Modal / Alert */}
      {verificationResult && (
        <div className="paper-card p-5 border-2 border-[var(--info)] bg-sky-50/50 dark:bg-sky-950/20 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">{verificationResult.valid ? '✅' : '❌'}</span>
              <h3 className="font-bold text-sm text-[var(--text)]">
                Verification Result: {verificationResult.status.toUpperCase()}
              </h3>
            </div>
            <button
              onClick={() => setVerificationResult(null)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] font-bold"
            >
              ✕ Close
            </button>
          </div>

          {verificationResult.valid ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-[var(--surface)] p-3 rounded-lg border border-[var(--border)]">
              <div>
                <span className="text-[var(--text-muted)] block">Recipient</span>
                <span className="font-bold text-[var(--text)]">{verificationResult.recipientName}</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block">Assessment</span>
                <span className="font-bold text-[var(--text)]">{verificationResult.assessmentTitle}</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block">Issued By</span>
                <span className="font-bold text-[var(--text)]">{verificationResult.issuerName}</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block">Issue Date</span>
                <span className="font-bold text-[var(--text)]">
                  {verificationResult.issueDate ? new Date(verificationResult.issueDate).toLocaleDateString() : 'N/A'}
                </span>
              </div>
            </div>
          ) : verificationResult.status === 'revoked' ? (
            <div className="p-3 bg-red-100 dark:bg-red-950/50 border border-red-400 rounded-lg text-xs text-red-800 dark:text-red-200 font-bold space-y-1">
              <div>⚠️ This credential was officially REVOKED by the institution.</div>
              <div className="text-[11px] font-normal">
                Reason: {verificationResult.revocationReason || 'Revoked by authorized issuer.'}
              </div>
            </div>
          ) : (
            <div className="p-3 bg-amber-100 dark:bg-amber-950/50 border border-amber-400 rounded-lg text-xs text-amber-800 dark:text-amber-200 font-bold">
              No active certificate matches verification ID &quot;{verificationQuery}&quot;. Please verify the format (QA-V-XXXX-XXXX-XXXX).
            </div>
          )}
        </div>
      )}

      {/* 2. My Certificates Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-['Bricolage_Grotesque'] text-xl font-bold text-[var(--text)]">
            🎓 My Issued Certificates ({certificates.length})
          </h2>
        </div>

        {isLoading ? (
          <div className="paper-card p-6 text-center text-sm font-semibold text-[var(--text-muted)]" role="status">
            Loading your issued certificates...
          </div>
        ) : loadError ? (
          <div
            role="alert"
            className="paper-card p-5 border-2 border-red-400 bg-red-50 dark:bg-red-950/40 text-xs font-bold text-red-800 dark:text-red-200"
          >
            ⚠️ {loadError}
          </div>
        ) : certificates.length === 0 ? (
          <EmptyState
            icon="🏅"
            title="No Certificates Issued Yet"
            description="Complete a live quiz arena or finish on a tournament podium to receive your official tamper-evident digital certificate."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {certificates.map(cert => (
              <div
                key={cert.id}
                className="paper-card p-6 border border-[var(--border)] flex flex-col justify-between space-y-4 hover:border-[var(--accent)] transition-all"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span
                      className={`sticker-badge ${
                        cert.status === 'valid' ? 'sticker-badge-ok' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {cert.status.toUpperCase()}
                    </span>
                    <span className="text-xs font-mono-code text-[var(--text-muted)]">
                      {new Date(cert.issueDate).toLocaleDateString()}
                    </span>
                  </div>

                  <div>
                    <h3 className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text)] line-clamp-1">
                      {cert.assessmentTitle}
                    </h3>
                    <div className="text-xs text-[var(--text-muted)]">
                      Recipient: <span className="font-bold text-[var(--text)]">{cert.recipientName}</span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Verification ID:</span>
                      <span className="font-mono-code font-bold text-[var(--text)]">{cert.verificationId}</span>
                    </div>
                    {cert.rank && (
                      <div className="flex justify-between">
                        <span className="text-[var(--text-muted)]">Standing:</span>
                        <span className="font-bold text-[var(--accent-2)]">Rank #{cert.rank}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-[var(--border)]/10">
                  <button
                    onClick={() => handleDownloadPdf(cert)}
                    className="paper-btn paper-btn-sm paper-btn-primary w-full text-xs font-bold flex items-center justify-center gap-2"
                  >
                    <span>📥</span> Download PDF
                  </button>
                  <button
                    onClick={() => handleCopyVerificationUrl(cert.verificationId)}
                    className="paper-btn paper-btn-sm paper-btn-ghost w-full text-xs font-bold text-[var(--text-muted)]"
                  >
                    {copiedId === cert.verificationId ? '✓ Link Copied!' : '📋 Copy Verification Link'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
