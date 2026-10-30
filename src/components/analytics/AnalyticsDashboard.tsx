/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Quiz, Player } from '../../types/quiz';
import { aiService, AIInsightsReport } from '../../services/aiService';
import { exportLmsGradeCsv } from '../../services/certificateService';
import { sound } from '../../lib/sound';
import {
  FinishedGameSummary,
  FullGameAnalytics,
  computeGameAnalytics,
  getFinishedGamesList,
  loadGameData,
} from '../../services/analyticsService';

interface AnalyticsDashboardProps {
  quiz?: Quiz;
  players?: Player[];
  onLaunchReteachPack: (reteachQuiz: Quiz) => void;
}

const PALETTE = ['#FF5A36', '#FFC83D', '#14B8A6', '#4DA3FF', '#8B5CF6'];

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  quiz: initialQuiz,
  players: initialPlayers = [],
  onLaunchReteachPack,
}) => {
  const [gamesList, setGamesList] = useState<FinishedGameSummary[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [attainmentTarget, setAttainmentTarget] = useState<number>(60);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [analytics, setAnalytics] = useState<FullGameAnalytics | null>(null);

  const [aiInsights, setAiInsights] = useState<AIInsightsReport | null>(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState<boolean>(false);

  // Load available games list on mount
  useEffect(() => {
    let mounted = true;
    async function loadGames() {
      setIsLoading(true);
      const list = await getFinishedGamesList();
      if (!mounted) return;

      setGamesList(list);
      if (list.length > 0) {
        setSelectedGameId(list[0].id);
      } else if (initialQuiz && initialPlayers.length > 0) {
        // Fallback to active live game in progress
        const computed = computeGameAnalytics(
          initialQuiz.questions,
          initialPlayers,
          [],
          attainmentTarget,
          {
            gameId: 'live_active',
            quizTitle: initialQuiz.title,
            finishedAt: new Date().toISOString(),
          }
        );
        setAnalytics(computed);
      }
      setIsLoading(false);
    }
    loadGames();
    return () => {
      mounted = false;
    };
  }, []);

  // Filter games list by date
  const filteredGames = useMemo(() => {
    if (dateFilter === 'all') return gamesList;
    const now = Date.now();
    return gamesList.filter(g => {
      const gTime = new Date(g.finishedAt).getTime();
      const diffMs = now - gTime;
      if (dateFilter === 'today') return diffMs <= 86400000;
      if (dateFilter === '7d') return diffMs <= 7 * 86400000;
      if (dateFilter === '30d') return diffMs <= 30 * 86400000;
      return true;
    });
  }, [gamesList, dateFilter]);

  // When selected game or attainment target changes, load and compute analytics
  useEffect(() => {
    if (!selectedGameId) {
      if (filteredGames.length > 0) {
        setSelectedGameId(filteredGames[0].id);
      } else {
        setAnalytics(null);
      }
      return;
    }

    let mounted = true;
    async function fetchAndCompute() {
      setIsLoading(true);
      const { game, questions, players, answers } = await loadGameData(selectedGameId);
      if (!mounted) return;

      if (game || questions.length > 0) {
        const computed = computeGameAnalytics(
          questions.length > 0 ? questions : (initialQuiz?.questions || []),
          players.length > 0 ? players : initialPlayers,
          answers,
          attainmentTarget,
          {
            gameId: selectedGameId,
            quizTitle: game?.quizTitle || initialQuiz?.title || 'Game Assessment',
            finishedAt: game?.updatedAt || game?.createdAt,
            isDemo: Boolean((game as any)?.isDemo || selectedGameId.startsWith('demo_')),
          }
        );
        setAnalytics(computed);
      } else {
        setAnalytics(null);
      }
      setIsLoading(false);
    }

    fetchAndCompute();
    return () => {
      mounted = false;
    };
  }, [selectedGameId, attainmentTarget]);

  // Trigger AI Insights with strictly real data
  const handleGenerateAIInsights = async () => {
    if (!analytics) return;
    sound.playClick();
    setIsGeneratingInsights(true);

    try {
      const insights = await aiService.generateInsights({
        quizTitle: analytics.quizTitle,
        totalPlayers: analytics.totalPlayers,
        averageAccuracy: analytics.overallAccuracy / 100,
        weakestQuestions: analytics.hardestQuestions.slice(0, 3).map(q => ({
          text: q.questionText,
          correctRate: q.accuracy / 100,
        })),
        topPerformers: analytics.topPerformers.map(p => p.nickname),
        lowestPerformers: analytics.lowestPerformers.map(p => p.nickname),
        coAttainments: analytics.coStats.map(c => ({
          coTag: c.coTag,
          accuracyRate: c.accuracyRate,
          isAttained: c.isAttained,
        })),
      });
      setAiInsights(insights);
    } catch (e) {
      console.error('Error generating AI Insights:', e);
    } finally {
      setIsGeneratingInsights(false);
    }
  };

  // Launch Reteach Quiz Pack
  const handleReteachPack = () => {
    sound.playClick();
    if (!analytics || analytics.hardestQuestions.length === 0) return;

    const weakQuestions = analytics.hardestQuestions.slice(0, 3).map(h => ({
      id: h.questionId,
      text: h.questionText,
      options: ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
      correctAnswers: [0],
      type: 'multiple_choice' as const,
      points: 1000,
      timeLimit: h.timeLimit,
      bloomLevel: h.bloomLevel as any,
      courseOutcomeTag: h.courseOutcomeTag,
      topicTag: h.courseOutcomeTag || 'General',
      explanation: 'Targeted reinforcement question addressing identified misconception.',
    }));

    const reteachQuiz: Quiz = {
      id: `quiz_reteach_${Date.now()}`,
      title: `[Reteach Pack] ${analytics.quizTitle}`,
      description: 'Personalized practice focusing on identified cohort misconceptions.',
      authorId: 'host_active',
      authorName: 'Instructor AI',
      isPublic: true,
      gameMode: 'accuracy',
      tags: ['Reteach', 'Misconceptions'],
      coverColor: '#FF5A36',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: weakQuestions,
    };

    onLaunchReteachPack(reteachQuiz);
  };

  const handleExportCsv = () => {
    sound.playClick();
    if (!analytics) return;
    const rows = analytics.topPerformers.concat(analytics.lowestPerformers).map((p, idx) => ({
      studentId: `s_${idx + 1}`,
      studentName: p.nickname,
      email: 'N/A',
      score: p.score,
      rank: p.rank,
      correctAnswers: Math.round(p.score / 1000),
      totalQuestions: analytics.questionStats.length,
      accuracy: `${analytics.overallAccuracy}%`,
      completionTime: analytics.finishedAt,
    }));
    exportLmsGradeCsv(rows, analytics.quizTitle);
  };

  // Recharts accuracy data (names like Q1, Q2 and numeric accuracy)
  const questionAccuracyData = useMemo(() => {
    if (!analytics) return [];
    return analytics.questionStats.map((q, idx) => ({
      name: `Q${idx + 1}`,
      accuracy: q.accuracy,
      avgTime: q.avgTimeSec,
      bloom: q.bloomLevel,
      co: q.courseOutcomeTag,
    }));
  }, [analytics]);

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      {/* Top Header Banner */}
      <div className="paper-card p-6 bg-[var(--bg-page)] border-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="sticker-badge bg-[var(--ok)] text-white text-xs">
              Curriculum Analytics
            </span>
            {analytics?.isDemoData && (
              <span className="sticker-badge bg-amber-400 text-black text-xs font-black">
                Demo Data
              </span>
            )}
          </div>
          <h1 className="font-['Bricolage_Grotesque'] text-2xl sm:text-3xl font-black text-[var(--text)]">
            Performance & Course Outcome (CO) Attainment
          </h1>
          <p className="text-xs font-semibold text-[var(--text-muted)] mt-1">
            {analytics
              ? `Real diagnostic data across ${analytics.totalPlayers} students on "${analytics.quizTitle}".`
              : 'Real diagnostic analytics calculated strictly from finished game submissions.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={!analytics}
            className="paper-btn paper-btn-sm paper-btn-secondary text-xs font-bold disabled:opacity-50"
          >
            📥 Export Grade CSV (LMS)
          </button>
          <button
            onClick={handleReteachPack}
            disabled={!analytics || analytics.hardestQuestions.length === 0}
            className="paper-btn paper-btn-sm paper-btn-primary text-xs font-bold disabled:opacity-50"
          >
            🎯 Create Reteach Pack
          </button>
        </div>
      </div>

      {/* Filter & Game Selection Toolbar */}
      <div className="paper-card p-4 bg-[var(--surface)] border-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--text)]">
            <label htmlFor="selectGame">Session:</label>
            <select
              id="selectGame"
              value={selectedGameId}
              onChange={e => setSelectedGameId(e.target.value)}
              className="paper-input text-xs font-bold py-1 px-2 rounded-lg border-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)] max-w-xs"
            >
              {filteredGames.length === 0 ? (
                <option value="">No Finished Games Found</option>
              ) : (
                filteredGames.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.quizTitle} ({new Date(g.finishedAt).toLocaleDateString()}) {g.isDemo ? '[Demo]' : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex items-center gap-1 text-xs font-bold">
            <span className="text-[var(--text-muted)]">Date:</span>
            {(['all', 'today', '7d', '30d'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setDateFilter(f)}
                className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors ${
                  dateFilter === f
                    ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)]'
                    : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)]'
                }`}
              >
                {f === 'all' ? 'All Time' : f === 'today' ? 'Today' : f === '7d' ? '7 Days' : '30 Days'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-bold text-[var(--text)]">
          <label htmlFor="targetThresholdInput" className="cursor-pointer">Target Threshold:</label>
          <input
            id="targetThresholdInput"
            aria-label="Target Threshold percentage"
            type="number"
            min={40}
            max={95}
            value={attainmentTarget}
            onChange={e => setAttainmentTarget(Number(e.target.value))}
            className="paper-input w-16 rounded border-2 border-[var(--border)] px-2 py-1 text-center font-bold"
          />
          <span>%</span>
        </div>
      </div>

      {/* Main Content Area: Analytics or Empty State */}
      {isLoading ? (
        <div className="paper-card p-12 text-center text-sm font-bold text-[var(--text-muted)] animate-pulse">
          Computing analytics from stored answer records...
        </div>
      ) : !analytics || analytics.questionStats.length === 0 ? (
        <div className="paper-card p-12 text-center space-y-3 bg-[var(--surface)]">
          <div className="text-4xl">📊</div>
          <h2 className="text-xl font-black font-['Bricolage_Grotesque'] text-[var(--text)]">
            No finished games yet
          </h2>
          <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
            Host and complete an arena quiz to view real-time student performance, discrimination indices, and course outcome metrics.
          </p>
        </div>
      ) : (
        <>
          {/* CO Attainment Report Card */}
          <div className="paper-card p-5 sm:p-6 bg-[var(--surface)] space-y-4">
            <div className="border-b-2 border-[var(--border)] pb-3">
              <h2 className="font-['Bricolage_Grotesque'] text-xl font-black text-[var(--text)]">
                Course Outcome (CO) Threshold Analysis
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Measures accreditation outcome criteria per syllabus mapping against the {attainmentTarget}% target threshold.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {analytics.coStats.map(co => (
                <div
                  key={co.coTag}
                  className={`paper-card p-4 border-2 ${
                    co.isAttained ? 'bg-emerald-50 dark:bg-emerald-950/30 border-[var(--ok)]' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-500'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text)]">
                      {co.coTag}
                    </span>
                    <span
                      className={`sticker-badge text-xs ${
                        co.isAttained ? 'sticker-badge-ok' : 'sticker-badge-sunshine'
                      }`}
                    >
                      {co.isAttained ? '✓ Attained' : '⚠️ Gaps Detected'}
                    </span>
                  </div>
                  <div className="font-mono-code text-2xl font-black text-[var(--text)]">
                    {Math.round(co.accuracyRate * 100)}%
                  </div>
                  <div className="text-xs text-[var(--text-muted)] mt-1">
                    Threshold: {attainmentTarget}% • Total Assessments: {co.totalAttempts}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Hardest Questions Table (Ranked by Lowest Accuracy) */}
          <div className="paper-card p-5 sm:p-6 bg-[var(--surface)] space-y-4">
            <div className="border-b-2 border-[var(--border)] pb-2">
              <h2 className="font-['Bricolage_Grotesque'] text-xl font-black text-[var(--text)]">
                Hardest Questions Analysis
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Questions ranked by lowest accuracy, highlighting the most-chosen distractor and psychometric discrimination index (D).
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-[var(--border)] text-[var(--text-muted)] uppercase">
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Question Text</th>
                    <th className="py-2 px-3">Bloom</th>
                    <th className="py-2 px-3">Accuracy</th>
                    <th className="py-2 px-3">Avg Time</th>
                    <th className="py-2 px-3">Most-Chosen Wrong Option</th>
                    <th className="py-2 px-3">Discrimination (D)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {analytics.hardestQuestions.map((q, idx) => (
                    <tr key={q.questionId} className="hover:bg-[var(--surface-2)]">
                      <td className="py-2.5 px-3 font-bold font-mono-code">Q{q.questionIndex + 1}</td>
                      <td className="py-2.5 px-3 font-bold text-[var(--text)] max-w-xs truncate" title={q.questionText}>
                        {q.questionText}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="sticker-badge text-[10px] bg-slate-100 dark:bg-slate-800 text-[var(--text)]">
                          {q.bloomLevel}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono-code font-bold">
                        <span className={q.accuracy < 50 ? 'text-red-500 font-black' : 'text-[var(--text)]'}>
                          {q.accuracy}%
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono-code">{q.avgTimeSec}s</td>
                      <td className="py-2.5 px-3 text-[var(--text-muted)] max-w-xs truncate">
                        {q.mostChosenWrongOption ? (
                          <span title={q.mostChosenWrongOption.optionText}>
                            "{q.mostChosenWrongOption.optionText}" ({q.mostChosenWrongOption.percentage}%)
                          </span>
                        ) : (
                          <span className="text-gray-400">None</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono-code font-bold">
                        <span
                          className={
                            q.discriminationIndex >= 0.3
                              ? 'text-green-600'
                              : q.discriminationIndex < 0.1
                              ? 'text-amber-500'
                              : 'text-[var(--text)]'
                          }
                        >
                          {q.discriminationIndex >= 0 ? `+${q.discriminationIndex.toFixed(2)}` : q.discriminationIndex.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Visual Analytics Charts: Question Accuracy + Bloom Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Per-Question Accuracy Bar Chart */}
            <div className="lg:col-span-2 paper-card p-4 sm:p-5 bg-[var(--surface)] space-y-3 min-w-0 overflow-hidden">
              <h2 className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text)]">
                Per-Question Cohort Accuracy (%)
              </h2>
              <div className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={questionAccuracyData}>
                    <XAxis dataKey="name" stroke="currentColor" className="text-[var(--text)]" strokeWidth={2} />
                    <YAxis stroke="currentColor" className="text-[var(--text)]" strokeWidth={2} domain={[0, 100]} />
                    <Tooltip />
                    <Bar dataKey="accuracy" fill="var(--accent)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Right: Bloom Taxonomy Hierarchy Pie Chart */}
            <div className="paper-card p-4 sm:p-5 bg-[var(--surface)] space-y-3 min-w-0 overflow-hidden">
              <h2 className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text)]">
                Bloom's Taxonomy Balance
              </h2>
              <div className="h-64 w-full flex items-center justify-center min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={analytics.bloomStats}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      dataKey="value"
                      label={({ name }) => name}
                    >
                      {analytics.bloomStats.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} stroke="var(--border)" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* AI Pedagogical Insights & Recommendations */}
          <div className="paper-card p-5 sm:p-6 bg-[var(--surface-2)] dark:bg-[var(--surface)] border-3 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="sticker-badge bg-[var(--accent-2-bg)] text-[var(--text-on-accent-2)] sticker-rot-1 text-xs">
                    Gemini Advisory
                  </span>
                  <h2 className="font-['Bricolage_Grotesque'] text-xl font-black text-[var(--text)]">
                    AI Class Insights &amp; Actionable Next Steps
                  </h2>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Synthesizes discrimination index, error clusters, and student remediation priorities from actual submissions.
                </p>
              </div>

              <button
                onClick={handleGenerateAIInsights}
                disabled={isGeneratingInsights}
                className="paper-btn paper-btn-sm paper-btn-ok text-xs font-bold disabled:opacity-50"
              >
                {isGeneratingInsights ? 'Synthesizing...' : '⚡ Generate AI Analysis'}
              </button>
            </div>

            {aiInsights ? (
              <div className="space-y-4 pt-2">
                <div className="p-4 bg-[var(--surface)] rounded-xl border-2 border-[var(--border)] text-sm leading-relaxed text-[var(--text)]">
                  <strong>Cohort Summary:</strong> {aiInsights.overallSummary}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-xl border-2 border-green-700">
                    <span className="text-xs font-black uppercase text-green-800 dark:text-green-300">
                      Key Strengths
                    </span>
                    <ul className="text-xs space-y-1 mt-2 text-green-900 dark:text-green-200 list-disc list-inside">
                      {aiInsights.strengths.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-xl border-2 border-red-700">
                    <span className="text-xs font-black uppercase text-red-800 dark:text-red-300">
                      Misconception Areas
                    </span>
                    <ul className="text-xs space-y-1 mt-2 text-red-900 dark:text-red-200 list-disc list-inside">
                      {aiInsights.strugglingAreas.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl border-2 border-blue-700">
                    <span className="text-xs font-black uppercase text-blue-800 dark:text-blue-300">
                      Actionable Steps
                    </span>
                    <ul className="text-xs space-y-1 mt-2 text-blue-900 dark:text-blue-200 list-disc list-inside">
                      {aiInsights.actionableNextSteps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-xs font-bold text-gray-500 bg-[var(--surface)] rounded-xl border-2 border-dashed border-[var(--border)]">
                Click "Generate AI Analysis" to extract automated diagnostic recommendations and reteach plans from verified submissions.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
