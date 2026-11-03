/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Quiz } from '../../types/quiz';
import { sound } from '../../lib/sound';
import { EmptyState } from '../common/EmptyState';
import { Skeleton, QuizCardSkeleton } from '../common/Skeleton';
import { auth } from '../../lib/firebase';
import { getIssuedCertificatesByOwner } from '../../server/certificateEngine';
import { IssuedCertificate } from '../../types/certificate';
import { generateCertificatePdf } from '../../services/certificateService';

interface StudentDashboardProps {
  quizzes: Quiz[];
  onJoinArenaPin: (pin: string) => void;
  onStartPractice: (quizId?: string) => void;
  onViewTournaments: () => void;
  onViewCertificates: () => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  quizzes,
  onJoinArenaPin,
  onStartPractice,
  onViewTournaments,
  onViewCertificates,
}) => {
  const [quickPin, setQuickPin] = useState('');
  const [loading, setLoading] = useState(true);
  const [certificates, setCertificates] = useState<IssuedCertificate[]>([]);
  const currentUser = auth.currentUser;
  const studentName = currentUser?.displayName || 'Learner';
  const studentUid = currentUser?.uid || 'guest_student';

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const certs = getIssuedCertificatesByOwner(studentUid);
        setCertificates(certs);
      } catch (err) {
        setCertificates([]);
      }
      setLoading(false);
    }, 400);

    return () => clearTimeout(timer);
  }, [studentUid]);

  const handleQuickJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPin.trim()) return;
    sound.playClick();
    onJoinArenaPin(quickPin.trim());
  };

  const handleDownloadCert = async (cert: IssuedCertificate) => {
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8 animate-fadeIn">
      {/* 1. Student Hero Welcome */}
      <section className="paper-card p-6 sm:p-8 bg-gradient-to-r from-indigo-50/50 via-white to-sky-50/50 dark:from-slate-900 dark:via-slate-900/90 dark:to-indigo-950/40 border border-[var(--border)]">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold">
              <span>⚡</span> Student Learning Portal
            </div>
            <h1 className="font-['Bricolage_Grotesque'] text-2xl sm:text-3xl font-black text-[var(--text)] tracking-tight">
              Welcome back, {studentName}!
            </h1>
            <p className="text-sm text-[var(--text-muted)] max-w-xl">
              Sharpen your knowledge with real-time multiplayer arenas, spaced repetition solo practice, and certified competitions.
            </p>
          </div>

          {/* Quick PIN Join Card */}
          <form
            onSubmit={handleQuickJoin}
            className="w-full md:w-auto flex-shrink-0 p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-xs space-y-3"
          >
            <div className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">
              🎮 Have a Game PIN?
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                maxLength={6}
                value={quickPin}
                onChange={e => setQuickPin(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-28 text-center font-mono-code font-black text-lg py-1.5 px-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text)]"
                aria-label="Enter 6-digit Game PIN"
              />
              <button
                type="submit"
                disabled={quickPin.length < 4}
                className="paper-btn paper-btn-primary paper-btn-sm font-extrabold text-xs px-4"
              >
                Join
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* 2. Key Metrics Row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4" aria-label="Student Key Metrics">
        <div className="paper-card p-4 sm:p-5 border border-[var(--border)] space-y-1">
          <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Certificates</div>
          <div className="font-['Bricolage_Grotesque'] text-2xl font-black text-[var(--accent)]">
            {certificates.length}
          </div>
          <div className="text-[11px] text-[var(--ok)] font-medium">Verified credentials</div>
        </div>

        <div className="paper-card p-4 sm:p-5 border border-[var(--border)] space-y-1">
          <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Active Competitions</div>
          <div className="font-['Bricolage_Grotesque'] text-2xl font-black text-[var(--info)]">
            1
          </div>
          <div className="text-[11px] text-[var(--text-muted)] font-medium">Collegiate Championship</div>
        </div>

        <div className="paper-card p-4 sm:p-5 border border-[var(--border)] space-y-1">
          <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Spaced Mastery</div>
          <div className="font-['Bricolage_Grotesque'] text-2xl font-black text-[var(--accent-2)]">
            {quizzes.length} Quizzes
          </div>
          <div className="text-[11px] text-[var(--text-muted)] font-medium">Ready for practice</div>
        </div>

        <div className="paper-card p-4 sm:p-5 border border-[var(--border)] space-y-1">
          <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Integrity Standing</div>
          <div className="font-['Bricolage_Grotesque'] text-2xl font-black text-[var(--ok)]">
            100%
          </div>
          <div className="text-[11px] text-[var(--ok)] font-medium">Clean audit record</div>
        </div>
      </section>

      {/* 3. Recommended Practice & Certificates Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recommended Solo Practice (2 Cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-['Bricolage_Grotesque'] text-xl font-bold text-[var(--text)]">
              🎯 Recommended Practice
            </h2>
            <button
              onClick={() => onStartPractice()}
              className="text-xs font-bold text-[var(--accent)] hover:underline"
            >
              View all practice →
            </button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <QuizCardSkeleton />
              <QuizCardSkeleton />
            </div>
          ) : quizzes.length === 0 ? (
            <EmptyState
              icon="📚"
              title="No Quizzes Available"
              description="Check back later when your teachers publish new interactive quizzes."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {quizzes.slice(0, 4).map(quiz => (
                <div
                  key={quiz.id}
                  className="paper-card p-5 border border-[var(--border)] space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="sticker-badge sticker-badge-primary">
                        {quiz.tags?.[0] || 'General'}
                      </span>
                      <span className="text-[var(--text-muted)] font-medium">
                        {quiz.questions.length} Questions
                      </span>
                    </div>
                    <h3 className="font-['Bricolage_Grotesque'] font-bold text-base text-[var(--text)] line-clamp-1">
                      {quiz.title}
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2">
                      {quiz.description || 'Practice core concepts and test your recall with adaptive pacing.'}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-[var(--border)]/10 flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)] font-mono-code font-bold">
                      ⭐ {quiz.gameMode || 'classic'}
                    </span>
                    <button
                      onClick={() => onStartPractice(quiz.id)}
                      className="paper-btn paper-btn-sm paper-btn-primary text-xs font-bold"
                    >
                      Practice Now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Certificates (1 Col) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-['Bricolage_Grotesque'] text-xl font-bold text-[var(--text)]">
              🎓 Earned Certificates
            </h2>
            <button
              onClick={onViewCertificates}
              className="text-xs font-bold text-[var(--accent)] hover:underline"
            >
              Gallery →
            </button>
          </div>

          {loading ? (
            <div className="paper-card p-5 border border-[var(--border)] space-y-3">
              <Skeleton className="h-6 w-3/4 rounded-md" />
              <Skeleton className="h-4 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-lg" />
            </div>
          ) : certificates.length === 0 ? (
            <div className="paper-card p-6 text-center border border-[var(--border)] space-y-3">
              <div className="text-3xl">🏅</div>
              <div className="text-sm font-bold text-[var(--text)]">No Certificates Yet</div>
              <p className="text-xs text-[var(--text-muted)]">
                Participate in live multiplayer arenas or competitions to earn verified PDF credentials.
              </p>
              <button
                onClick={onViewTournaments}
                className="paper-btn paper-btn-sm paper-btn-secondary text-xs font-bold mt-2"
              >
                Explore Tournaments
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {certificates.slice(0, 3).map(cert => (
                <div
                  key={cert.id}
                  className="paper-card p-4 border border-[var(--border)] space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="sticker-badge sticker-badge-ok">
                      {cert.type.includes('tournament') ? 'Podium Finish' : 'Completion'}
                    </span>
                    <span className="font-mono-code text-[11px] text-[var(--text-muted)]">
                      {new Date(cert.issueDate).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="font-bold text-sm text-[var(--text)] line-clamp-1">
                    {cert.assessmentTitle}
                  </div>
                  <div className="text-[11px] font-mono-code text-[var(--text-muted)] truncate">
                    ID: {cert.verificationId}
                  </div>
                  <button
                    onClick={() => handleDownloadCert(cert)}
                    className="paper-btn paper-btn-sm w-full text-xs font-bold flex items-center justify-center gap-1.5 pt-1"
                  >
                    <span>📥</span> Download PDF
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
