/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Competition, CompetitionRound, CompetitionAppeal, Quiz } from '../../types/quiz';
import { sound } from '../../lib/sound';
import { generateCertificatePdf } from '../../services/certificateService';

interface CompetitionManagerProps {
  quizzes: Quiz[];
  onLaunchRound: (quiz: Quiz, compTitle: string) => void;
}

export const CompetitionManager: React.FC<CompetitionManagerProps> = ({ quizzes, onLaunchRound }) => {
  // Sample pre-seeded tournament
  const [competitions, setCompetitions] = useState<Competition[]>([
    {
      id: 'comp_premier_2026',
      title: 'National Collegiate Tech Arena Championship',
      description: 'Prestigious multi-round tournament covering advanced algorithms, computer systems, and AI architecture.',
      organizerId: 'org_1',
      organizerName: 'Prof. Ada Lovelace',
      status: 'in_progress',
      rules: 'Multi-round knockout. Top 8 advance to Semi-Finals. Top 4 advance to Grand Finale.',
      createdAt: new Date().toISOString(),
      rounds: [
        {
          id: 'rnd_1',
          name: 'Round 1: Open Qualifiers',
          quizId: quizzes[0]?.id || 'quiz_cs_ai',
          roundType: 'qualifier',
          qualificationRule: 'top_n',
          qualificationValue: 8,
          status: 'completed',
        },
        {
          id: 'rnd_2',
          name: 'Round 2: Semi-Finals Showdown',
          quizId: quizzes[1]?.id || 'quiz_gk_science',
          roundType: 'semi',
          qualificationRule: 'top_n',
          qualificationValue: 4,
          status: 'active',
        },
        {
          id: 'rnd_3',
          name: 'Round 3: Grand Finale',
          quizId: quizzes[2]?.id || 'quiz_india_heritage',
          roundType: 'final',
          qualificationRule: 'top_n',
          qualificationValue: 1,
          status: 'pending',
        },
      ],
      teams: [
        { id: 'tm_1', name: 'Binary Titans', members: ['Alex', 'Dev', 'Priya'], score: 7450 },
        { id: 'tm_2', name: 'Quantum Foxes', members: ['Jordan', 'Rohan', 'Sam'], score: 6890 },
        { id: 'tm_3', name: 'Cyber Falcons', members: ['Casey', 'Ananya', 'Taylor'], score: 6420 },
      ],
    },
  ]);

  const [selectedCompId, setSelectedCompId] = useState<string>(competitions[0].id);
  const [activeSubTab, setActiveSubTab] = useState<'bracket' | 'jury' | 'appeals' | 'league'>('bracket');

  // Appeals dispute state
  const [appeals, setAppeals] = useState<CompetitionAppeal[]>([
    {
      id: 'app_1',
      competitionId: competitions[0].id,
      playerId: 'player_jordan',
      playerName: 'Jordan (Quantum Foxes)',
      questionNumber: 3,
      disputeReason: 'Question wording on QuickSort worst-case time complexity could be interpreted as randomized QuickSort.',
      proposedFix: 'Award 1000 points to participants who selected O(n log n) under randomized premise.',
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
  ]);

  // Elo rating league standings
  const leagueStandings = [
    { rank: 1, name: 'Devendra K.', team: 'Binary Titans', elo: 1845, matches: 14, winRate: '86%' },
    { rank: 2, name: 'Priya Sundaram', team: 'Binary Titans', elo: 1810, matches: 12, winRate: '83%' },
    { rank: 3, name: 'Jordan Hayes', team: 'Quantum Foxes', elo: 1760, matches: 15, winRate: '78%' },
    { rank: 4, name: 'Samira Patel', team: 'Cyber Falcons', elo: 1690, matches: 10, winRate: '70%' },
    { rank: 5, name: 'Taylor Brooks', team: 'Quantum Foxes', elo: 1640, matches: 11, winRate: '65%' },
  ];

  const activeComp = competitions.find(c => c.id === selectedCompId) || competitions[0];

  const handleResolveAppeal = (appealId: string, status: 'accepted' | 'rejected') => {
    sound.playClick();
    setAppeals(prev =>
      prev.map(a =>
        a.id === appealId
          ? {
              ...a,
              status,
              organizerNotes: status === 'accepted' ? 'Accepted by Jury with +1000 point correction.' : 'Rejected per official specification rules.',
              pointAdjustment: status === 'accepted' ? 1000 : 0,
            }
          : a
      )
    );
  };

  const handlePrintCert = async (name: string, rank: number) => {
    sound.playClick();
    await generateCertificatePdf({
      studentName: name,
      quizTitle: activeComp.title,
      rank,
      totalPlayers: 32,
      score: 8500,
      accuracy: 0.9,
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      hostName: activeComp.organizerName,
      competitionTitle: activeComp.title,
    });
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      {/* Header Banner */}
      <div className="paper-card p-5 sm:p-6 bg-[var(--bg-page)] border-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="sticker-badge bg-[var(--accent)] text-[var(--text-on-accent)] text-xs mb-1">
            Tournament Arena
          </span>
          <h1 className="font-['Bricolage_Grotesque'] text-2xl sm:text-3xl font-black text-[var(--text)]">
            {activeComp.title}
          </h1>
          <p className="text-xs font-semibold text-[var(--text-muted)] mt-1">
            Organizer: <strong>{activeComp.organizerName}</strong> • Status: <strong className="text-[var(--ok)] uppercase">{activeComp.status}</strong>
          </p>
        </div>

        {/* Tab switchers */}
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Tournament navigation">
          <button
            role="tab"
            aria-selected={activeSubTab === 'bracket'}
            onClick={() => setActiveSubTab('bracket')}
            className={`paper-btn paper-btn-sm text-xs font-bold ${activeSubTab === 'bracket' ? 'paper-btn-primary' : 'paper-btn-secondary'}`}
          >
            🏟️ Brackets &amp; Rounds
          </button>
          <button
            role="tab"
            aria-selected={activeSubTab === 'jury'}
            onClick={() => setActiveSubTab('jury')}
            className={`paper-btn paper-btn-sm text-xs font-bold ${activeSubTab === 'jury' ? 'paper-btn-ok' : 'paper-btn-secondary'}`}
          >
            ⚖️ Jury Panel
          </button>
          <button
            role="tab"
            aria-selected={activeSubTab === 'appeals'}
            onClick={() => setActiveSubTab('appeals')}
            className={`paper-btn paper-btn-sm text-xs font-bold ${activeSubTab === 'appeals' ? 'bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)] border-2 border-[var(--border)]' : 'paper-btn-secondary'}`}
          >
            ⚠️ Appeals ({appeals.filter(a => a.status === 'pending').length})
          </button>
          <button
            role="tab"
            aria-selected={activeSubTab === 'league'}
            onClick={() => setActiveSubTab('league')}
            className={`paper-btn paper-btn-sm text-xs font-bold ${activeSubTab === 'league' ? 'bg-[var(--info)] text-[var(--text-on-accent)]' : 'paper-btn-secondary'}`}
          >
            🏅 Elo League
          </button>
        </div>
      </div>

      {/* View 1: Brackets & Rounds Flow */}
      {activeSubTab === 'bracket' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {activeComp.rounds.map((rnd, idx) => {
              const quizForRound = quizzes.find(q => q.id === rnd.quizId) || quizzes[0];
              const isAvailable = Boolean(quizForRound);

              return (
                <div
                  key={rnd.id}
                  className={`paper-card p-5 sm:p-6 border-3 space-y-4 relative ${
                    rnd.status === 'active'
                      ? 'bg-[var(--surface-2)] ring-4 ring-[var(--accent)]'
                      : 'bg-[var(--surface)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--accent)]">
                      Tier {idx + 1}
                    </span>
                    <span
                      className={`sticker-badge text-[10px] ${
                        rnd.status === 'completed'
                          ? 'sticker-badge-ok'
                          : rnd.status === 'active'
                          ? 'sticker-badge-sunshine animate-pulse'
                          : 'bg-[var(--surface-2)] text-[var(--text-muted)]'
                      }`}
                    >
                      {rnd.status.toUpperCase()}
                    </span>
                  </div>

                  <div>
                    <h2 className="font-bold text-base text-[var(--text)]">
                      {rnd.name}
                    </h2>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Advancement Rule: <strong>Top {rnd.qualificationValue} Contenders</strong>
                    </p>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={() => {
                        sound.playClick();
                        if (quizForRound) {
                          onLaunchRound(quizForRound, `${activeComp.title} - ${rnd.name}`);
                        }
                      }}
                      className="paper-btn paper-btn-ok w-full py-2.5 text-xs font-black shadow-[3px_3px_0px_var(--shadow)]"
                    >
                      🚀 Launch Live Round
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Teams Table */}
          {activeComp.teams && (
            <div className="paper-card p-5 bg-[var(--surface)] space-y-3">
              <h2 className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text)]">
                Team Standings &amp; Roster
              </h2>
              <div className="divide-y divide-[var(--border)]">
                {activeComp.teams.map((t, i) => (
                  <div key={t.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 text-xs font-bold">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono-code text-[var(--text-muted)] shrink-0">#{i + 1}</span>
                      <span className="text-sm font-black text-[var(--accent)] truncate shrink-0">{t.name}</span>
                      <span className="text-[11px] text-[var(--text-muted)] truncate">({t.members.join(', ')})</span>
                    </div>
                    <span className="font-mono-code text-sm font-black text-[var(--ok)] shrink-0">
                      {t.score.toLocaleString()} pts
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* View 2: Jury & Moderator Panel */}
      {activeSubTab === 'jury' && (
        <div className="paper-card p-5 sm:p-6 bg-[var(--surface)] space-y-4">
          <div className="flex items-center justify-between border-b-2 border-[var(--border)] pb-3">
            <div>
              <h2 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
                Jury &amp; Moderator Control Console
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Authorized override tools for verified competition judges.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="p-4 bg-[var(--surface-2)] rounded-xl border-2 border-[var(--border)] space-y-2">
              <span className="font-black text-sm text-[var(--accent)] block">Void Question Override</span>
              <p className="text-xs text-[var(--text-muted)]">
                Nullify points from a disputed question and auto-recalculate round scores across all participants.
              </p>
              <button
                onClick={() => {
                  sound.playClick();
                  alert('Question #3 voided. Round standings recalculated.');
                }}
                className="paper-btn paper-btn-sm paper-btn-secondary text-xs font-bold w-full"
              >
                Void Question #3
              </button>
            </div>

            <div className="p-4 bg-[var(--surface-2)] rounded-xl border-2 border-[var(--border)] space-y-2">
              <span className="font-black text-sm text-[var(--ok)] block">Manual Point Adjustment</span>
              <p className="text-xs text-[var(--text-muted)]">
                Grant or dock points with transparent jury record annotation for sportsmanship or appeals.
              </p>
              <button
                onClick={() => {
                  sound.playClick();
                  alert('Awarded +500 points to Jordan Hayes (Reason: Jury Appeal #1 accepted).');
                }}
                className="paper-btn paper-btn-sm paper-btn-secondary text-xs font-bold w-full"
              >
                +500 Discretionary Points
              </button>
            </div>

            <div className="p-4 bg-[var(--surface-2)] rounded-xl border-2 border-[var(--border)] space-y-2">
              <span className="font-black text-sm text-[var(--info)] block">Official Certificate Dispatch</span>
              <p className="text-xs text-[var(--text-muted)]">
                Issue cryptographic high-res PDF credentials directly to finalists.
              </p>
              <button
                onClick={() => handlePrintCert('Devendra K.', 1)}
                className="paper-btn paper-btn-sm bg-[var(--info)] text-[var(--text-on-accent)] text-xs font-bold w-full"
              >
                Print 1st Place Certificate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View 3: Appeals Workflow */}
      {activeSubTab === 'appeals' && (
        <div className="paper-card p-5 sm:p-6 bg-[var(--surface)] space-y-4">
          <div className="flex items-center justify-between border-b-2 border-[var(--border)] pb-3">
            <div>
              <h2 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
                Player Appeals &amp; Dispute Resolution
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Transparent adjudication process for ambiguous prompts or hardware disconnects.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {appeals.map(a => (
              <div key={a.id} className="p-4 rounded-xl border-2 border-[var(--border)] bg-[var(--bg-page)] space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-[var(--accent)]">{a.playerName}</span>
                    <span className="text-xs text-[var(--text-muted)] font-mono-code">• Question #{a.questionNumber}</span>
                  </div>
                  <span
                    className={`sticker-badge text-[10px] ${
                      a.status === 'accepted'
                        ? 'sticker-badge-ok'
                        : a.status === 'rejected'
                        ? 'sticker-badge-tomato'
                        : 'sticker-badge-sunshine'
                    }`}
                  >
                    {a.status.toUpperCase()}
                  </span>
                </div>

                <p className="text-xs text-[var(--text)]">
                  <strong>Dispute Statement:</strong> {a.disputeReason}
                </p>
                <p className="text-xs text-[var(--ok)] dark:text-[var(--accent-2)]">
                  <strong>Proposed Remedy:</strong> {a.proposedFix}
                </p>

                {a.status === 'pending' ? (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      onClick={() => handleResolveAppeal(a.id, 'accepted')}
                      className="paper-btn paper-btn-sm paper-btn-ok text-xs font-bold"
                    >
                      ✓ Accept &amp; Adjust Points (+1000)
                    </button>
                    <button
                      onClick={() => handleResolveAppeal(a.id, 'rejected')}
                      className="paper-btn paper-btn-sm paper-btn-secondary text-xs font-bold"
                    >
                      ✕ Reject Dispute
                    </button>
                  </div>
                ) : (
                  <div className="text-xs font-semibold text-[var(--text-muted)] pt-1 italic">
                    Jury Decision: {a.organizerNotes}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* View 4: Ranked Elo League */}
      {activeSubTab === 'league' && (
        <div className="paper-card p-5 sm:p-6 bg-[var(--surface)] space-y-4">
          <div className="flex items-center justify-between border-b-2 border-[var(--border)] pb-3">
            <div>
              <h2 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
                Official Ranked League (Elo Ratings)
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Competitive ladder calculated using chess-standard Elo rating formula across verified tournaments.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-bold">
              <thead>
                <tr className="border-b-2 border-[var(--border)] text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="py-2">Rank</th>
                  <th className="py-2">Contender</th>
                  <th className="py-2">Affiliation</th>
                  <th className="py-2">Elo Rating</th>
                  <th className="py-2">Matches</th>
                  <th className="py-2">Win Rate</th>
                  <th className="py-2 text-right">Certificate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {leagueStandings.map(s => (
                  <tr key={s.rank} className="hover:bg-[var(--surface-2)] transition-colors">
                    <td className="py-3 font-mono-code font-black text-sm text-[var(--accent)]">#{s.rank}</td>
                    <td className="py-3 font-black text-sm text-[var(--text)]">{s.name}</td>
                    <td className="py-3 text-[var(--text-muted)]">{s.team}</td>
                    <td className="py-3 font-mono-code text-sm font-black text-[var(--ok)] dark:text-[var(--accent-2)]">{s.elo}</td>
                    <td className="py-3 font-mono-code text-[var(--text)]">{s.matches}</td>
                    <td className="py-3 font-mono-code text-[var(--ok)] dark:text-[var(--accent-2)]">{s.winRate}</td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => handlePrintCert(s.name, s.rank)}
                        className="paper-btn paper-btn-sm paper-btn-secondary text-[11px]"
                      >
                        PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
