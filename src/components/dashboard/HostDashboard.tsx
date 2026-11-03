/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Quiz } from '../../types/quiz';
import { sound } from '../../lib/sound';
import { EmptyState } from '../common/EmptyState';
import { Skeleton } from '../common/Skeleton';
import { auth } from '../../lib/firebase';
import { getFinishedGamesList, FinishedGameSummary } from '../../services/analyticsService';
import { getLocalOutboxEmails } from '../../services/emailService';

interface HostDashboardProps {
  quizzes: Quiz[];
  onNavigateTab: (tab: string) => void;
  onHostQuiz: (quiz: Quiz) => void;
  onEditQuiz: (quizId: string) => void;
}

export const HostDashboard: React.FC<HostDashboardProps> = ({
  quizzes,
  onNavigateTab,
  onHostQuiz,
  onEditQuiz,
}) => {
  const [finishedGames, setFinishedGames] = useState<FinishedGameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [outboxPendingCount, setOutboxPendingCount] = useState(0);
  const currentUser = auth.currentUser;
  const hostName = currentUser?.displayName || 'Educator';
  const hostUid = currentUser?.uid;

  useEffect(() => {
    let mounted = true;
    async function fetchHostData() {
      setLoading(true);
      try {
        const games = await getFinishedGamesList(hostUid);
        if (mounted) setFinishedGames(games);

        const outbox = getLocalOutboxEmails();
        const pending = outbox.filter(m => m.status === 'queued' || m.status === 'failed').length;
        if (mounted) setOutboxPendingCount(pending);
      } catch (e) {
        if (mounted) setFinishedGames([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchHostData();
    return () => {
      mounted = false;
    };
  }, [hostUid]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8 animate-fadeIn">
      {/* 1. Host Header Banner */}
      <section className="paper-card p-6 sm:p-8 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white border border-[var(--border)]">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold border border-indigo-500/30">
              <span>🎓</span> Educator Command Center
            </div>
            <h1 className="font-['Bricolage_Grotesque'] text-2xl sm:text-3xl font-black text-white tracking-tight">
              Host Console — {hostName}
            </h1>
            <p className="text-sm text-slate-300 max-w-xl">
              Create, validate, and broadcast real-time quiz assessments, run competitive brackets, and track cohort Bloom's taxonomy attainment.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <button
              onClick={() => {
                sound.playClick();
                onNavigateTab('builder');
              }}
              className="paper-btn paper-btn-primary px-4 py-2 text-xs font-bold flex items-center gap-2"
            >
              <span>✏️</span> Create Quiz
            </button>
            <button
              onClick={() => {
                sound.playClick();
                onNavigateTab('ai');
              }}
              className="paper-btn bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 text-xs font-bold flex items-center gap-2"
            >
              <span>✨</span> AI Generator
            </button>
          </div>
        </div>
      </section>

      {/* 2. Executive KPI Cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4" aria-label="Host Operational Metrics">
        <div className="paper-card p-4 sm:p-5 border border-[var(--border)] space-y-1">
          <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Total Quizzes</div>
          <div className="font-['Bricolage_Grotesque'] text-2xl font-black text-[var(--accent)]">
            {quizzes.length}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] font-medium">Published in bank</div>
        </div>

        <div className="paper-card p-4 sm:p-5 border border-[var(--border)] space-y-1">
          <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Completed Sessions</div>
          <div className="font-['Bricolage_Grotesque'] text-2xl font-black text-[var(--ok)]">
            {finishedGames.length}
          </div>
          <div className="text-[11px] text-[var(--ok)] font-medium">Authoritative results</div>
        </div>

        <div className="paper-card p-4 sm:p-5 border border-[var(--border)] space-y-1">
          <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Outbox Queue</div>
          <div className={`font-['Bricolage_Grotesque'] text-2xl font-black ${outboxPendingCount > 0 ? 'text-amber-500' : 'text-[var(--text)]'}`}>
            {outboxPendingCount}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] font-medium">
            {outboxPendingCount === 0 ? 'All delivered' : 'Pending dispatch'}
          </div>
        </div>

        <div className="paper-card p-4 sm:p-5 border border-[var(--border)] space-y-1">
          <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Tournament Platform</div>
          <div className="font-['Bricolage_Grotesque'] text-2xl font-black text-[var(--info)]">
            Active
          </div>
          <div className="text-[11px] text-[var(--info)] font-medium">Elo rating enabled</div>
        </div>
      </section>

      {/* 3. Main Host Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Quiz Bank & Quick Launch (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-['Bricolage_Grotesque'] text-xl font-bold text-[var(--text)]">
              📚 Published Quiz Repository
            </h2>
            <button
              onClick={() => onNavigateTab('builder')}
              className="text-xs font-bold text-[var(--accent)] hover:underline"
            >
              Open Studio →
            </button>
          </div>

          {quizzes.length === 0 ? (
            <EmptyState
              icon="✏️"
              title="No Quizzes Found"
              description="Create your first quiz in the Studio or generate one with AI."
              actionLabel="Launch Quiz Studio"
              onAction={() => onNavigateTab('builder')}
            />
          ) : (
            <div className="space-y-3">
              {quizzes.slice(0, 5).map(quiz => (
                <div
                  key={quiz.id}
                  className="paper-card p-4 border border-[var(--border)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="sticker-badge sticker-badge-primary text-[10px]">
                        {quiz.tags?.[0] || 'General'}
                      </span>
                      <span className="text-xs text-[var(--text-muted)] font-mono-code font-bold">
                        {quiz.questions.length} Questions
                      </span>
                    </div>
                    <div className="font-['Bricolage_Grotesque'] font-bold text-base text-[var(--text)] truncate">
                      {quiz.title}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] line-clamp-1">
                      {quiz.description || 'Interactive assessment'}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                    <button
                      onClick={() => onEditQuiz(quiz.id)}
                      className="paper-btn paper-btn-sm paper-btn-ghost text-xs font-bold flex-1 sm:flex-initial"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onHostQuiz(quiz)}
                      className="paper-btn paper-btn-sm paper-btn-primary text-xs font-bold flex-1 sm:flex-initial"
                    >
                      Host Live Arena
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Launchpad & Outbox Quick Actions (1 col) */}
        <div className="space-y-4">
          <h2 className="font-['Bricolage_Grotesque'] text-xl font-bold text-[var(--text)]">
            ⚡ Quick Shortcuts
          </h2>

          <div className="paper-card p-5 border border-[var(--border)] space-y-3">
            <button
              onClick={() => onNavigateTab('ai')}
              className="w-full text-left p-3 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors flex items-center justify-between group"
            >
              <div>
                <div className="font-bold text-sm text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                  ✨ AI PDF to Quiz
                </div>
                <div className="text-xs text-[var(--text-muted)]">Upload textbook PDF and extract grounded MCQs</div>
              </div>
              <span className="text-xs font-bold text-[var(--text-muted)]">→</span>
            </button>

            <button
              onClick={() => onNavigateTab('competitions')}
              className="w-full text-left p-3 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors flex items-center justify-between group"
            >
              <div>
                <div className="font-bold text-sm text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                  🏆 Tournament Manager
                </div>
                <div className="text-xs text-[var(--text-muted)]">Manage knockout brackets and Elo leaderboards</div>
              </div>
              <span className="text-xs font-bold text-[var(--text-muted)]">→</span>
            </button>

            <button
              onClick={() => onNavigateTab('analytics')}
              className="w-full text-left p-3 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors flex items-center justify-between group"
            >
              <div>
                <div className="font-bold text-sm text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                  📊 Cohort Analytics
                </div>
                <div className="text-xs text-[var(--text-muted)]">Inspect CO attainment & Bloom distribution</div>
              </div>
              <span className="text-xs font-bold text-[var(--text-muted)]">→</span>
            </button>

            <button
              onClick={() => onNavigateTab('outbox')}
              className="w-full text-left p-3 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors flex items-center justify-between group"
            >
              <div>
                <div className="font-bold text-sm text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                  📬 Email Outbox & Health
                </div>
                <div className="text-xs text-[var(--text-muted)]">Review SMTP status and result email queue</div>
              </div>
              <span className="text-xs font-bold text-[var(--text-muted)]">→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
