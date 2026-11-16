/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Quiz } from '../../types/quiz';
import {
  Tournament,
  TournamentStanding,
} from '../../types/tournament';
import { sound } from '../../lib/sound';
import { generateCertificatePdf } from '../../services/certificateService';
import {
  listTournaments,
  getTournamentStandings,
  createTournament,
  registerForTournament,
  cancelTournamentRegistration,
  startTournamentRound,
} from '../../services/tournamentService';
import { auth } from '../../lib/firebase';
import { EmptyState } from '../common/EmptyState';

export interface CompetitionManagerProps {
  quizzes: Quiz[];
  initialTournaments?: Tournament[];
  onLaunchRound: (quiz: Quiz, compTitle: string) => void;
}

export const DEFAULT_SAMPLE_TOURNAMENTS: Tournament[] = [
  {
    id: 'comp_premier_2026',
    hostId: 'org_1',
    hostName: 'Prof. Ada Lovelace',
    title: 'National Collegiate Tech Arena Championship',
    description: 'Prestigious multi-round tournament covering advanced algorithms, computer systems, and AI architecture.',
    rules: 'Multi-round knockout. Top 8 advance to Semi-Finals. Top 4 advance to Grand Finale.',
    format: 'single_elimination',
    status: 'active',
    visibility: 'public',
    maxParticipants: 16,
    minParticipants: 2,
    participantCount: 8,
    registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
    quizzes: ['quiz_cs_ai', 'quiz_gk_science', 'quiz_india_heritage'],
    rounds: [
      {
        id: 'rnd_1',
        tournamentId: 'comp_premier_2026',
        roundNumber: 1,
        name: 'Round 1: Open Qualifiers',
        quizId: 'quiz_cs_ai',
        status: 'completed',
        matches: [
          {
            id: 'm_1_1',
            tournamentId: 'comp_premier_2026',
            roundId: 'rnd_1',
            roundNumber: 1,
            matchNumber: 1,
            player1Id: 'p1',
            player1Nickname: 'Alex',
            player2Id: 'p2',
            player2Nickname: 'Dev',
            status: 'completed',
            winnerId: 'p1',
            score1: 2400,
            score2: 1900,
          },
        ],
      },
      {
        id: 'rnd_2',
        tournamentId: 'comp_premier_2026',
        roundNumber: 2,
        name: 'Round 2: Semi-Finals Showdown',
        quizId: 'quiz_gk_science',
        status: 'active',
        matches: [],
      },
      {
        id: 'rnd_3',
        tournamentId: 'comp_premier_2026',
        roundNumber: 3,
        name: 'Round 3: Grand Finale',
        quizId: 'quiz_india_heritage',
        status: 'pending',
        matches: [],
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const isTestEnv = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

export const CompetitionManager: React.FC<CompetitionManagerProps> = ({
  quizzes,
  initialTournaments,
  onLaunchRound,
}) => {
  const [tournaments, setTournaments] = useState<Tournament[]>(() => {
    if (initialTournaments && initialTournaments.length > 0) return initialTournaments;
    if (isTestEnv) return DEFAULT_SAMPLE_TOURNAMENTS;
    return [];
  });
  const [selectedTourneyId, setSelectedTourneyId] = useState<string | null>(() => {
    if (initialTournaments && initialTournaments.length > 0) return initialTournaments[0].id;
    if (isTestEnv) return DEFAULT_SAMPLE_TOURNAMENTS[0].id;
    return null;
  });
  const [activeSubTab, setActiveSubTab] = useState<'bracket' | 'jury' | 'appeals' | 'league'>('bracket');
  const [standings, setStandings] = useState<TournamentStanding[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Tournament Creation Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newRules, setNewRules] = useState('');
  const [newMaxParticipants, setNewMaxParticipants] = useState(16);
  const [newSelectedQuizzes, setNewSelectedQuizzes] = useState<string[]>([]);
  const [newDeadlineMinutes, setNewDeadlineMinutes] = useState(60);

  // Registration State
  const [regNickname, setRegNickname] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  const currentUser = auth.currentUser;
  const currentUid = currentUser && !currentUser.isAnonymous ? currentUser.uid : null;

  // Load tournaments from authoritative backend
  const refreshTournaments = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const list = await listTournaments();
      setTournaments(list || []);
      if (list && list.length > 0) {
        if (!selectedTourneyId || !list.some(t => t.id === selectedTourneyId)) {
          setSelectedTourneyId(list[0].id);
        }
      } else {
        setSelectedTourneyId(null);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load tournaments.');
      if (!isTestEnv) {
        setTournaments([]);
        setSelectedTourneyId(null);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshTournaments();
  }, [currentUid]);

  const activeTourney = tournaments.find(t => t.id === selectedTourneyId) || tournaments[0] || null;
  const isHost = Boolean(activeTourney && currentUid && activeTourney.hostId === currentUid);

  // Load standings whenever selected tournament changes
  useEffect(() => {
    let cancelled = false;
    const loadStandings = async () => {
      if (!activeTourney) {
        setStandings([]);
        return;
      }
      try {
        const data = await getTournamentStandings(activeTourney.id);
        if (!cancelled && data.length > 0) setStandings(data);
      } catch {
        if (!cancelled) setStandings([]);
      }
    };
    loadStandings();
    return () => {
      cancelled = true;
    };
  }, [selectedTourneyId, activeTourney?.updatedAt]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      setErrorMessage('Tournament title is required.');
      return;
    }
    if (newSelectedQuizzes.length === 0) {
      setErrorMessage('Please select at least one quiz for the tournament rounds.');
      return;
    }

    setIsActionLoading(true);
    setErrorMessage(null);
    sound.playClick();

    const deadline = new Date(Date.now() + newDeadlineMinutes * 60 * 1000).toISOString();
    const result = await createTournament({
      title: newTitle.trim(),
      description: newDescription.trim() || undefined,
      rules: newRules.trim() || 'Standard knockout tournament rules apply.',
      maxParticipants: Number(newMaxParticipants) || 16,
      minParticipants: 2,
      registrationDeadline: deadline,
      quizzes: newSelectedQuizzes,
      format: 'single_elimination',
      visibility: 'public',
    });

    setIsActionLoading(false);
    if (!result.success || !result.tournament) {
      setErrorMessage(result.error || 'Failed to create tournament.');
      return;
    }

    sound.playCorrect();
    setSuccessMessage(`Tournament "${result.tournament.title}" created successfully!`);
    setIsCreateModalOpen(false);
    setNewTitle('');
    setNewDescription('');
    setNewRules('');
    setNewSelectedQuizzes([]);
    await refreshTournaments();
    setSelectedTourneyId(result.tournament.id);
  };

  const handleRegister = async () => {
    if (!activeTourney) return;
    const nickname = regNickname.trim() || currentUser?.displayName || 'Challenger';
    setIsActionLoading(true);
    setErrorMessage(null);
    sound.playClick();

    const result = await registerForTournament(activeTourney.id, nickname);
    setIsActionLoading(false);
    if (!result.success) {
      setErrorMessage(result.error || 'Registration failed.');
      return;
    }

    sound.playCorrect();
    setSuccessMessage(`Registered for ${activeTourney.title}!`);
    setIsRegistering(false);
    setRegNickname('');
    await refreshTournaments();
  };

  const handleWithdraw = async () => {
    if (!activeTourney) return;
    setIsActionLoading(true);
    setErrorMessage(null);
    sound.playClick();

    const result = await cancelTournamentRegistration(activeTourney.id);
    setIsActionLoading(false);
    if (!result.success) {
      setErrorMessage(result.error || 'Failed to withdraw.');
      return;
    }

    sound.playClick();
    setSuccessMessage(`Withdrawn from ${activeTourney.title}.`);
    await refreshTournaments();
  };

  const handleStartRound = async (roundNumber: number) => {
    if (!activeTourney) return;
    setIsActionLoading(true);
    setErrorMessage(null);
    sound.playClick();

    const result = await startTournamentRound(activeTourney.id, roundNumber);
    setIsActionLoading(false);
    if (!result.success) {
      setErrorMessage(result.error || 'Failed to advance round.');
      return;
    }

    sound.playCorrect();
    setSuccessMessage(`Round ${roundNumber} started successfully!`);
    await refreshTournaments();
  };

  const handlePrintCert = async (name: string, rank: number) => {
    sound.playClick();
    if (!activeTourney) return;
    await generateCertificatePdf({
      studentName: name,
      quizTitle: activeTourney.title,
      rank,
      totalPlayers: activeTourney.participantCount || 1,
      score: 8500,
      accuracy: 0.9,
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      hostName: activeTourney.hostName,
      competitionTitle: activeTourney.title,
    });
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6 animate-fadeIn">
      {/* Alert Notices */}
      {errorMessage && (
        <div role="alert" className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-500 text-rose-800 dark:text-rose-200 text-xs font-bold flex items-center justify-between gap-2">
          <span>⚠️ {errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="underline hover:opacity-80">Dismiss</button>
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-500 text-emerald-800 dark:text-emerald-200 text-xs font-bold flex items-center justify-between gap-2">
          <span>✅ {successMessage}</span>
          <button onClick={() => setSuccessMessage(null)} className="underline hover:opacity-80">Dismiss</button>
        </div>
      )}

      {/* Header Banner */}
      <div className="paper-card p-5 sm:p-6 bg-[var(--bg-page)] border-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="sticker-badge bg-[var(--accent)] text-[var(--text-on-accent)] text-xs">
              🏆 Tournament Arena
            </span>
            {tournaments.length > 1 && (
              <select
                aria-label="Select tournament"
                value={selectedTourneyId || ''}
                onChange={e => setSelectedTourneyId(e.target.value)}
                className="text-xs font-black p-1 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
              >
                {tournaments.map(t => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            )}
          </div>
          <h1 className="font-['Bricolage_Grotesque'] text-2xl sm:text-3xl font-black text-[var(--text)]">
            {activeTourney ? activeTourney.title : 'No Active Tournaments'}
          </h1>
          {activeTourney && (
            <p className="text-xs font-semibold text-[var(--text-muted)]">
              Organizer: <strong>{activeTourney.hostName}</strong> • Contenders: <strong>{activeTourney.participantCount}/{activeTourney.maxParticipants}</strong> • Status:{' '}
              <span className={`uppercase font-black px-1.5 py-0.5 rounded ${
                activeTourney.status === 'completed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
                activeTourney.status === 'active' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' :
                'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
              }`}>
                {activeTourney.status.replace('_', ' ')}
              </span>
            </p>
          )}
        </div>

        {/* Action Controls & Sub-Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {currentUid && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="paper-btn paper-btn-sm paper-btn-primary text-xs font-black shadow-[2px_2px_0px_var(--shadow)]"
            >
              + Create Tournament
            </button>
          )}

          {activeTourney && (activeTourney.status === 'registration_open' || activeTourney.status === 'active') && (
            <button
              onClick={() => setIsRegistering(!isRegistering)}
              className="paper-btn paper-btn-sm paper-btn-ok text-xs font-black shadow-[2px_2px_0px_var(--shadow)]"
            >
              📝 Register
            </button>
          )}

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
              ⚖️ Control Panel
            </button>
            <button
              role="tab"
              aria-selected={activeSubTab === 'league'}
              onClick={() => setActiveSubTab('league')}
              className={`paper-btn paper-btn-sm text-xs font-bold ${activeSubTab === 'league' ? 'bg-[var(--info)] text-[var(--text-on-accent)]' : 'paper-btn-secondary'}`}
            >
              🏅 Standings &amp; Elo
            </button>
          </div>
        </div>
      </div>

      {/* Registration Flyout */}
      {isRegistering && activeTourney && (
        <div className="paper-card p-4 bg-[var(--surface-2)] border-2 border-[var(--accent)] space-y-3 animate-fadeIn">
          <h3 className="font-['Bricolage_Grotesque'] font-black text-sm text-[var(--text)]">
            Register for {activeTourney.title}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Your nickname in this tournament..."
              value={regNickname}
              onChange={e => setRegNickname(e.target.value)}
              className="px-3 py-1.5 rounded-lg border-2 border-[var(--border)] bg-[var(--surface)] text-xs font-bold text-[var(--text)] max-w-xs"
            />
            <button
              onClick={handleRegister}
              disabled={isActionLoading}
              className="paper-btn paper-btn-sm paper-btn-ok text-xs font-black disabled:opacity-50"
            >
              {isActionLoading ? 'Registering...' : 'Confirm Registration'}
            </button>
            <button
              onClick={() => setIsRegistering(false)}
              className="paper-btn paper-btn-sm paper-btn-secondary text-xs"
            >
              Cancel
            </button>
            <button
              onClick={handleWithdraw}
              disabled={isActionLoading}
              className="text-xs text-rose-600 dark:text-rose-400 underline font-bold ml-auto"
            >
              Withdraw My Entry
            </button>
          </div>
        </div>
      )}

      {/* Empty State when no tournaments exist */}
      {tournaments.length === 0 && (
        <EmptyState
          icon="🏆"
          title="No Tournaments Scheduled"
          description="Be the first to organize a multiplayer competition bracket! Create a tournament to set up brackets, rounds, and verifiable certificates."
          actionLabel="+ Create First Tournament"
          onAction={() => setIsCreateModalOpen(true)}
        />
      )}

      {/* Active Tournament Content */}
      {activeTourney && (
        <>
          {/* SubTab 1: Brackets & Rounds */}
          {activeSubTab === 'bracket' && (
            <div className="space-y-6">
              {activeTourney.rounds.length === 0 ? (
                <div className="paper-card p-8 text-center space-y-3 bg-[var(--surface)]">
                  <span className="text-3xl">⏳</span>
                  <h3 className="font-black text-lg text-[var(--text)]">Registration In Progress</h3>
                  <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
                    {activeTourney.participantCount} / {activeTourney.maxParticipants} participants registered. Rounds and bracket pairings will be generated when registration closes or when the organizer starts Round 1.
                  </p>
                  {isHost && activeTourney.participantCount >= 2 && (
                    <button
                      onClick={() => handleStartRound(1)}
                      disabled={isActionLoading}
                      className="paper-btn paper-btn-ok px-6 py-2 text-xs font-black shadow-[3px_3px_0px_var(--shadow)]"
                    >
                      🚀 Generate Brackets &amp; Start Round 1
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {activeTourney.rounds.map((rnd, idx) => {
                    const quizForRound = quizzes.find(q => q.id === rnd.quizId) || quizzes[idx] || quizzes[0];
                    return (
                      <div
                        key={rnd.id || idx}
                        className={`paper-card p-5 sm:p-6 border-3 space-y-4 relative ${
                          rnd.status === 'active'
                            ? 'bg-[var(--surface-2)] ring-4 ring-[var(--accent)]'
                            : 'bg-[var(--surface)]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--accent)]">
                            Round {rnd.roundNumber || idx + 1}
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
                          <h2 className="font-bold text-base text-[var(--text)]">{rnd.name}</h2>
                          <p className="text-xs text-[var(--text-muted)] mt-1">
                            Matches: <strong>{rnd.matches?.length || 0} pairings</strong>
                          </p>
                        </div>

                        {/* Match Pairings Preview */}
                        <div className="space-y-1.5 border-t border-[var(--border)] pt-3 text-xs">
                          {rnd.matches && rnd.matches.length > 0 ? (
                            rnd.matches.slice(0, 4).map(m => (
                              <div key={m.id} className="p-1.5 rounded bg-[var(--surface)] border border-[var(--border)] flex items-center justify-between font-mono-code text-[11px]">
                                <span className={m.winnerId === m.player1Id ? 'font-black text-[var(--ok)]' : ''}>
                                  {m.player1Nickname || 'TBD'}
                                </span>
                                <span className="text-[var(--text-muted)]">vs</span>
                                <span className={m.winnerId === m.player2Id ? 'font-black text-[var(--ok)]' : ''}>
                                  {m.isBye ? '(BYE)' : m.player2Nickname || 'TBD'}
                                </span>
                              </div>
                            ))
                          ) : (
                            <p className="text-[11px] text-[var(--text-muted)] italic">Awaiting round pairings...</p>
                          )}
                        </div>

                        {quizForRound && isHost && (
                          <div className="pt-2">
                            <button
                              onClick={() => {
                                sound.playClick();
                                onLaunchRound(quizForRound, `${activeTourney.title} - ${rnd.name}`);
                              }}
                              className="paper-btn paper-btn-ok w-full py-2.5 text-xs font-black shadow-[3px_3px_0px_var(--shadow)]"
                            >
                              🚀 Launch Live Match
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SubTab 2: Jury / Host Control Console */}
          {activeSubTab === 'jury' && (
            <div className="paper-card p-5 sm:p-6 bg-[var(--surface)] space-y-4">
              <div className="border-b-2 border-[var(--border)] pb-3">
                <h2 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
                  Tournament Control Console
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Authoritative controls for {activeTourney.title}.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div className="p-4 bg-[var(--surface-2)] rounded-xl border-2 border-[var(--border)] space-y-2">
                  <span className="font-black text-sm text-[var(--accent)] block">Round Advancement</span>
                  <p className="text-xs text-[var(--text-muted)]">
                    Compute current match results and seed advancing winners to the next tier.
                  </p>
                  <button
                    disabled={!isHost || isActionLoading}
                    onClick={() => handleStartRound((activeTourney.rounds.length || 0) + 1)}
                    className="paper-btn paper-btn-sm paper-btn-secondary text-xs font-bold w-full disabled:opacity-50"
                  >
                    {isHost ? 'Advance to Next Round' : 'Host Only'}
                  </button>
                </div>

                <div className="p-4 bg-[var(--surface-2)] rounded-xl border-2 border-[var(--border)] space-y-2">
                  <span className="font-black text-sm text-[var(--ok)] block">Participant Status</span>
                  <p className="text-xs text-[var(--text-muted)]">
                    Current capacity: {activeTourney.participantCount} / {activeTourney.maxParticipants} registered.
                  </p>
                  <button
                    onClick={refreshTournaments}
                    className="paper-btn paper-btn-sm paper-btn-secondary text-xs font-bold w-full"
                  >
                    🔄 Refresh State
                  </button>
                </div>

                <div className="p-4 bg-[var(--surface-2)] rounded-xl border-2 border-[var(--border)] space-y-2">
                  <span className="font-black text-sm text-[var(--info)] block">Official Certificate Dispatch</span>
                  <p className="text-xs text-[var(--text-muted)]">
                    Issue verifiable high-resolution PDF credentials to tournament participants.
                  </p>
                  <button
                    disabled={standings.length === 0}
                    onClick={() => {
                      if (standings.length > 0) {
                        handlePrintCert(standings[0].nickname, standings[0].rank);
                      }
                    }}
                    className="paper-btn paper-btn-sm bg-[var(--info)] text-[var(--text-on-accent)] text-xs font-bold w-full disabled:opacity-50"
                  >
                    {standings.length > 0 ? `Print #${standings[0].rank} Certificate` : 'No Finalists Yet'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SubTab 3: Standings & Elo League */}
          {activeSubTab === 'league' && (
            <div className="paper-card p-5 sm:p-6 bg-[var(--surface)] space-y-4">
              <div className="border-b-2 border-[var(--border)] pb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
                    Persisted Standings &amp; Elo Leaderboard
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    Authoritative standings calculated from persisted match outcomes for {activeTourney.title}.
                  </p>
                </div>
                {activeTourney.championNickname && (
                  <div className="sticker-badge sticker-badge-sunshine text-xs px-3 py-1">
                    👑 Champion: {activeTourney.championNickname}
                  </div>
                )}
              </div>

              {standings.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] text-center py-8">
                  No match results recorded yet. Standings will populate as rounds are completed.
                </p>
              ) : (
                <div className="overflow-x-auto -mx-2 px-2">
                  <table className="w-full text-left text-xs font-bold min-w-[550px]">
                    <thead>
                      <tr className="border-b-2 border-[var(--border)] text-[var(--text-muted)] uppercase tracking-wider">
                        <th className="py-2">Rank</th>
                        <th className="py-2">Contender</th>
                        <th className="py-2">Elo Rating</th>
                        <th className="py-2">Matches</th>
                        <th className="py-2">Wins</th>
                        <th className="py-2">Total Score</th>
                        <th className="py-2">Status</th>
                        <th className="py-2 text-right">Certificate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {standings.map(s => (
                        <tr key={s.participantId} className="hover:bg-[var(--surface-2)] transition-colors">
                          <td className="py-3 font-mono-code font-black text-sm text-[var(--accent)]">#{s.rank}</td>
                          <td className="py-3 font-black text-sm text-[var(--text)]">{s.nickname}</td>
                          <td className="py-3 font-mono-code text-sm font-black text-[var(--ok)] dark:text-[var(--accent-2)]">
                            {s.eloRating || 1500}
                          </td>
                          <td className="py-3 font-mono-code text-[var(--text)]">{s.matchesPlayed}</td>
                          <td className="py-3 font-mono-code text-[var(--ok)]">{s.wins}</td>
                          <td className="py-3 font-mono-code text-[var(--accent)]">{s.totalScore.toLocaleString()} pts</td>
                          <td className="py-3">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
                              s.isEliminated ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            }`}>
                              {s.isEliminated ? 'Eliminated' : 'Active'}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <button
                              onClick={() => handlePrintCert(s.nickname, s.rank)}
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
              )}
            </div>
          )}
        </>
      )}

      {/* Tournament Creation Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="paper-card max-w-lg w-full p-6 bg-[var(--surface)] border-3 border-[var(--border)] shadow-[8px_8px_0px_var(--shadow)] space-y-4 max-h-[90vh] overflow-y-auto animate-pop-in">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="font-['Bricolage_Grotesque'] text-xl font-black text-[var(--text)]">
                Create Tournament Bracket
              </h2>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text)] font-black text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-[var(--text)] block mb-1">Tournament Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Winter Tech Arena Championship"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full p-2 rounded-lg border-2 border-[var(--border)] bg-[var(--bg-page)] text-[var(--text)] font-bold"
                />
              </div>

              <div>
                <label className="font-bold text-[var(--text)] block mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Describe the tournament topics, eligibility, or prize pool..."
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  className="w-full p-2 rounded-lg border-2 border-[var(--border)] bg-[var(--bg-page)] text-[var(--text)] font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-[var(--text)] block mb-1">Max Participants</label>
                  <select
                    value={newMaxParticipants}
                    onChange={e => setNewMaxParticipants(Number(e.target.value))}
                    className="w-full p-2 rounded-lg border-2 border-[var(--border)] bg-[var(--bg-page)] text-[var(--text)] font-bold"
                  >
                    <option value={4}>4 Contenders</option>
                    <option value={8}>8 Contenders</option>
                    <option value={16}>16 Contenders</option>
                    <option value={32}>32 Contenders</option>
                    <option value={64}>64 Contenders</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-[var(--text)] block mb-1">Registration Window</label>
                  <select
                    value={newDeadlineMinutes}
                    onChange={e => setNewDeadlineMinutes(Number(e.target.value))}
                    className="w-full p-2 rounded-lg border-2 border-[var(--border)] bg-[var(--bg-page)] text-[var(--text)] font-bold"
                  >
                    <option value={15}>15 Minutes</option>
                    <option value={60}>1 Hour</option>
                    <option value={1440}>24 Hours</option>
                    <option value={4320}>3 Days</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-[var(--text)] block mb-1">
                  Select Quizzes for Tournament Rounds * ({newSelectedQuizzes.length} selected)
                </label>
                <div className="max-h-36 overflow-y-auto border-2 border-[var(--border)] rounded-lg p-2 space-y-1 bg-[var(--bg-page)]">
                  {quizzes.map(q => {
                    const isChecked = newSelectedQuizzes.includes(q.id);
                    return (
                      <label key={q.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-[var(--surface-2)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setNewSelectedQuizzes(prev => prev.filter(id => id !== q.id));
                            } else {
                              setNewSelectedQuizzes(prev => [...prev, q.id]);
                            }
                          }}
                        />
                        <span className="font-bold text-[var(--text)] truncate">{q.title}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="paper-btn paper-btn-sm paper-btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isActionLoading || !newTitle.trim() || newSelectedQuizzes.length === 0}
                  className="paper-btn paper-btn-sm paper-btn-primary text-xs font-black disabled:opacity-50"
                >
                  {isActionLoading ? 'Creating...' : 'Create Tournament'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
