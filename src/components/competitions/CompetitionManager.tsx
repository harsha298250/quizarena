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
      <div className="paper-card p-6 bg-[#FFF6E5] dark:bg-[#16120E] border-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="sticker-badge bg-[#FF5A36] text-white text-xs mb-1">
            Tournament Arena
          </span>
          <h1 className="font-['Bricolage_Grotesque'] text-2xl sm:text-3xl font-black text-[#16120E] dark:text-white">
            {activeComp.title}
          </h1>
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mt-1">
            Organizer: <strong>{activeComp.organizerName}</strong> • Status: <strong className="text-[#14B8A6] uppercase">{activeComp.status}</strong>
          </p>
        </div>

        {/* Tab switchers */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setActiveSubTab('bracket')}
            className={`paper-btn paper-btn-sm text-xs font-bold ${activeSubTab === 'bracket' ? 'bg-[#FF5A36] text-white' : 'bg-white dark:bg-[#221c16]'}`}
          >
            🏟️ Brackets & Rounds
          </button>
          <button
            onClick={() => setActiveSubTab('jury')}
            className={`paper-btn paper-btn-sm text-xs font-bold ${activeSubTab === 'jury' ? 'bg-[#14B8A6] text-white' : 'bg-white dark:bg-[#221c16]'}`}
          >
            ⚖️ Jury Panel
          </button>
          <button
            onClick={() => setActiveSubTab('appeals')}
            className={`paper-btn paper-btn-sm text-xs font-bold ${activeSubTab === 'appeals' ? 'bg-[#FFC83D] text-[#16120E]' : 'bg-white dark:bg-[#221c16]'}`}
          >
            ⚠️ Appeals ({appeals.filter(a => a.status === 'pending').length})
          </button>
          <button
            onClick={() => setActiveSubTab('league')}
            className={`paper-btn paper-btn-sm text-xs font-bold ${activeSubTab === 'league' ? 'bg-[#4DA3FF] text-white' : 'bg-white dark:bg-[#221c16]'}`}
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
                  className={`paper-card p-6 border-3 space-y-4 relative ${
                    rnd.status === 'active'
                      ? 'bg-[#FFFAEE] dark:bg-[#221c16] ring-4 ring-[#FF5A36]'
                      : 'bg-white dark:bg-[#16120E]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-['Bricolage_Grotesque'] font-black text-lg text-[#FF5A36]">
                      Tier {idx + 1}
                    </span>
                    <span
                      className={`sticker-badge text-[10px] ${
                        rnd.status === 'completed'
                          ? 'bg-green-100 text-green-800'
                          : rnd.status === 'active'
                          ? 'bg-[#FFC83D] text-[#16120E] animate-pulse'
                          : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      {rnd.status.toUpperCase()}
                    </span>
                  </div>

                  <div>
                    <h3 className="font-bold text-base text-[#16120E] dark:text-white">
                      {rnd.name}
                    </h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
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
                      className="paper-btn w-full bg-[#14B8A6] text-white py-2.5 text-xs font-black shadow-[3px_3px_0px_#16120E]"
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
            <div className="paper-card p-5 bg-white dark:bg-[#221c16] space-y-3">
              <h3 className="font-['Bricolage_Grotesque'] font-black text-lg text-[#16120E] dark:text-white">
                Team Standings & Roster
              </h3>
              <div className="divide-y-2 divide-gray-200">
                {activeComp.teams.map((t, i) => (
                  <div key={t.id} className="py-2.5 flex items-center justify-between text-xs font-bold">
                    <div className="flex items-center gap-3">
                      <span className="font-mono-code text-gray-400">#{i + 1}</span>
                      <span className="text-base text-[#FF5A36]">{t.name}</span>
                      <span className="text-gray-500">({t.members.join(', ')})</span>
                    </div>
                    <span className="font-mono-code text-base text-[#14B8A6]">
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
        <div className="paper-card p-6 bg-white dark:bg-[#221c16] space-y-4">
          <div className="flex items-center justify-between border-b-2 border-gray-200 pb-3">
            <div>
              <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[#16120E] dark:text-white">
                Jury & Moderator Control Console
              </h3>
              <p className="text-xs text-gray-500">
                Authorized override tools for verified competition judges.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="p-4 bg-[#FFFAEE] rounded-xl border-2 border-[#16120E] space-y-2">
              <span className="font-black text-sm text-[#FF5A36] block">Void Question Override</span>
              <p className="text-xs text-gray-600">
                Nullify points from a disputed question and auto-recalculate round scores across all participants.
              </p>
              <button
                onClick={() => {
                  sound.playClick();
                  alert('Question #3 voided. Round standings recalculated.');
                }}
                className="paper-btn paper-btn-sm bg-white text-xs font-bold w-full"
              >
                Void Question #3
              </button>
            </div>

            <div className="p-4 bg-[#FFFAEE] rounded-xl border-2 border-[#16120E] space-y-2">
              <span className="font-black text-sm text-[#14B8A6] block">Manual Point Adjustment</span>
              <p className="text-xs text-gray-600">
                Grant or dock points with transparent jury record annotation for sportsmanship or appeals.
              </p>
              <button
                onClick={() => {
                  sound.playClick();
                  alert('Awarded +500 points to Jordan Hayes (Reason: Jury Appeal #1 accepted).');
                }}
                className="paper-btn paper-btn-sm bg-white text-xs font-bold w-full"
              >
                +500 Discretionary Points
              </button>
            </div>

            <div className="p-4 bg-[#FFFAEE] rounded-xl border-2 border-[#16120E] space-y-2">
              <span className="font-black text-sm text-[#4DA3FF] block">Official Certificate Dispatch</span>
              <p className="text-xs text-gray-600">
                Issue cryptographic high-res PDF credentials directly to finalists.
              </p>
              <button
                onClick={() => handlePrintCert('Devendra K.', 1)}
                className="paper-btn paper-btn-sm bg-[#4DA3FF] text-white text-xs font-bold w-full"
              >
                Print 1st Place Certificate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View 3: Appeals Workflow */}
      {activeSubTab === 'appeals' && (
        <div className="paper-card p-6 bg-white dark:bg-[#221c16] space-y-4">
          <div className="flex items-center justify-between border-b-2 border-gray-200 pb-3">
            <div>
              <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[#16120E] dark:text-white">
                Player Appeals & Dispute Resolution
              </h3>
              <p className="text-xs text-gray-500">
                Transparent adjudication process for ambiguous prompts or hardware disconnects.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {appeals.map(a => (
              <div key={a.id} className="p-4 rounded-xl border-2 border-[#16120E] bg-[#FFF6E5] dark:bg-[#16120E] space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-[#FF5A36]">{a.playerName}</span>
                    <span className="text-xs text-gray-500 font-mono-code">• Question #{a.questionNumber}</span>
                  </div>
                  <span
                    className={`sticker-badge text-[10px] ${
                      a.status === 'accepted'
                        ? 'bg-green-600 text-white'
                        : a.status === 'rejected'
                        ? 'bg-red-600 text-white'
                        : 'bg-[#FFC83D] text-[#16120E]'
                    }`}
                  >
                    {a.status.toUpperCase()}
                  </span>
                </div>

                <p className="text-xs text-gray-700 dark:text-gray-300">
                  <strong>Dispute Statement:</strong> {a.disputeReason}
                </p>
                <p className="text-xs text-[#14B8A6]">
                  <strong>Proposed Remedy:</strong> {a.proposedFix}
                </p>

                {a.status === 'pending' ? (
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => handleResolveAppeal(a.id, 'accepted')}
                      className="paper-btn paper-btn-sm bg-[#14B8A6] text-white text-xs font-bold"
                    >
                      ✓ Accept & Adjust Points (+1000)
                    </button>
                    <button
                      onClick={() => handleResolveAppeal(a.id, 'rejected')}
                      className="paper-btn paper-btn-sm bg-gray-300 text-gray-800 text-xs font-bold"
                    >
                      ✕ Reject Dispute
                    </button>
                  </div>
                ) : (
                  <div className="text-xs font-semibold text-gray-500 pt-1 italic">
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
        <div className="paper-card p-6 bg-white dark:bg-[#221c16] space-y-4">
          <div className="flex items-center justify-between border-b-2 border-gray-200 pb-3">
            <div>
              <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[#16120E] dark:text-white">
                Official Ranked League (Elo Ratings)
              </h3>
              <p className="text-xs text-gray-500">
                Competitive ladder calculated using chess-standard Elo rating formula across verified tournaments.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-bold">
              <thead>
                <tr className="border-b-2 border-[#16120E] text-gray-500 uppercase tracking-wider">
                  <th className="py-2">Rank</th>
                  <th className="py-2">Contender</th>
                  <th className="py-2">Affiliation</th>
                  <th className="py-2">Elo Rating</th>
                  <th className="py-2">Matches</th>
                  <th className="py-2">Win Rate</th>
                  <th className="py-2 text-right">Certificate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {leagueStandings.map(s => (
                  <tr key={s.rank} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <td className="py-3 font-mono-code font-black text-sm text-[#FF5A36]">#{s.rank}</td>
                    <td className="py-3 font-black text-sm text-[#16120E] dark:text-white">{s.name}</td>
                    <td className="py-3 text-gray-500">{s.team}</td>
                    <td className="py-3 font-mono-code text-sm font-black text-[#14B8A6]">{s.elo}</td>
                    <td className="py-3 font-mono-code">{s.matches}</td>
                    <td className="py-3 font-mono-code text-green-600">{s.winRate}</td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => handlePrintCert(s.name, s.rank)}
                        className="paper-btn paper-btn-sm bg-white dark:bg-[#16120E] text-[11px]"
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
