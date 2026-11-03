/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Quiz, GameSession, Player } from './types/quiz';
import { SAMPLE_QUIZZES } from './data/sampleQuizzes';
import { Navbar } from './components/common/Navbar';
import { OfflineBanner } from './components/common/OfflineBanner';
import { ToastContainer, ToastMessage } from './components/common/Toast';
import { JoinView } from './components/arena/JoinView';
import { LobbyView } from './components/arena/LobbyView';
import { HostArena } from './components/arena/HostArena';
import { PlayerArena } from './components/arena/PlayerArena';
import { PodiumView } from './components/arena/PodiumView';
import { QuizBuilder } from './components/builder/QuizBuilder';
import { AIQuizGenerator } from './components/ai/AIQuizGenerator';
import { AnalyticsDashboard } from './components/analytics/AnalyticsDashboard';
import { CompetitionManager } from './components/competitions/CompetitionManager';
import { EmailOutbox } from './components/outbox/EmailOutbox';
import { SoloPractice } from './components/practice/SoloPractice';
import { HostDashboard } from './components/dashboard/HostDashboard';
import { StudentDashboard } from './components/dashboard/StudentDashboard';
import { CertificateGallery } from './components/certificates/CertificateGallery';
import { GameEngine } from './services/gameEngine';
import { runSelfTests } from './tests/quizArena.test';
import { sound } from './lib/sound';
import { SupportedLanguage } from './lib/i18n';
import { testConnection, ensureAnonymousAuth, auth, isFirebaseConfigured, getRedirectResult } from './lib/firebase';
import { saveQuiz, loadUserQuizzes, deleteQuiz, deleteMyData } from './services/quizService';
import { autoSendGameResults } from './services/emailService';
import { useTheme } from './hooks/useTheme';

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('arena');
  const [userRole, setUserRole] = useState<'host' | 'student'>('host');
  const [lang, setLang] = useState<SupportedLanguage>('en');
  const { theme, setTheme, resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === 'dark';
  const setIsDarkMode = (val: boolean) => setTheme(val ? 'dark' : 'light');

  // Quizzes repository: cached locally, loaded from Firestore
  const [quizzes, setQuizzes] = useState<Quiz[]>(() => {
    try {
      const saved = localStorage.getItem('quizarena_quizzes');
      return saved ? JSON.parse(saved) : SAMPLE_QUIZZES;
    } catch (e) {
      return SAMPLE_QUIZZES;
    }
  });

  // Active game session state
  const [activeGame, setActiveGame] = useState<GameSession | null>(null);
  const [builderSelectedQuizId, setBuilderSelectedQuizId] = useState<string | undefined>(undefined);

  const handleOpenInStudio = async (quiz: Quiz) => {
    try {
      const saved = await handleSaveQuiz(quiz);
      setBuilderSelectedQuizId(saved.id);
    } catch {
      setBuilderSelectedQuizId(quiz.id);
    }
    setCurrentTab('builder');
  };
  const [activePlayer, setActivePlayer] = useState<Player | null>(null);
  const [gameRole, setGameRole] = useState<'host' | 'player' | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isFirebaseOnline, setIsFirebaseOnline] = useState<boolean>(true);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);
  const [testModalOpen, setTestModalOpen] = useState<boolean>(false);
  const [testResults, setTestResults] = useState<{ passed: number; failed: number; results: string[] } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    setToasts(prev => [...prev, { ...toast, id }]);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  useEffect(() => {
    if (firestoreError) {
      addToast({
        type: 'error',
        title: 'Firestore Sync Error',
        message: firestoreError,
        duration: 7000,
      });
    }
  }, [firestoreError]);

  // Test Firebase connection on boot, ensure auth, and load teacher's Firestore quizzes
  useEffect(() => {
    // Check if returning from a sign-in redirect
    getRedirectResult(auth).catch(err => {
      console.warn('Redirect auth result warning:', err);
    });

    ensureAnonymousAuth();
    testConnection().then(connected => {
      setIsFirebaseOnline(connected);
    });
    // Run self-tests in background
    runSelfTests().then(setTestResults);

    // Listen for Firestore real mode errors to show visible banner
    const handleFsError = (e: Event) => {
      const custom = e as CustomEvent<{ message: string }>;
      if (custom.detail?.message) {
        setFirestoreError(custom.detail.message);
      }
    };
    window.addEventListener('quizarena_firestore_error', handleFsError);

    // Authoritative session recovery on page reload/refresh
    try {
      const savedSession = sessionStorage.getItem('quizarena_active_session');
      if (savedSession) {
        const { gameId } = JSON.parse(savedSession);
        if (gameId) {
          GameEngine.recoverSession(gameId)
            .then(recovery => {
              if (recovery && recovery.game) {
                setActiveGame(recovery.game);
                if (recovery.role === 'player' && recovery.player) {
                  setActivePlayer(recovery.player);
                  setGameRole('player');
                } else if (recovery.role === 'host') {
                  setGameRole('host');
                }
                setCurrentTab('arena');
              } else {
                sessionStorage.removeItem('quizarena_active_session');
              }
            })
            .catch(() => {
              sessionStorage.removeItem('quizarena_active_session');
            });
        }
      }
    } catch (e) { }

    // Load teacher's quizzes from Firestore after login
    const unsubAuth = auth.onAuthStateChanged(async user => {
      if (user) {
        try {
          const userQuizzes = await loadUserQuizzes(user.uid);
          if (userQuizzes && userQuizzes.length > 0) {
            setQuizzes(userQuizzes);
          }
        } catch (e) {
          console.warn('Failed to load user quizzes from Firestore:', e);
        }
      }
    });

    return () => {
      window.removeEventListener('quizarena_firestore_error', handleFsError);
      unsubAuth();
    };
  }, []);

  // Save quizzes to Firestore under teacher's UID and keep localStorage as cache
  const handleSaveQuiz = async (quiz: Quiz): Promise<Quiz> => {
    let user = auth.currentUser;
    if (!user) {
      user = await ensureAnonymousAuth();
    }
    const authorId = user?.uid || 'guest_teacher';

    try {
      const saved = await saveQuiz(quiz, authorId);
      setQuizzes(prev => {
        const existingIdx = prev.findIndex(q => q.id === saved.id);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = saved;
          return updated;
        } else {
          return [saved, ...prev];
        }
      });
      return saved;
    } catch (e) {
      console.warn('Failed to save quiz to Firestore:', e);
      // Fallback: ensure local app state still receives the quiz if Firestore throws
      const fallbackQuiz: Quiz = { ...quiz, authorId, updatedAt: new Date().toISOString() };
      setQuizzes(prev => {
        const existingIdx = prev.findIndex(q => q.id === fallbackQuiz.id);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = fallbackQuiz;
          return updated;
        } else {
          return [fallbackQuiz, ...prev];
        }
      });
      return fallbackQuiz;
    }
  };

  // Delete My Data (GDPR / Privacy compliance)
  const handleDeleteMyData = async () => {
    const confirmed = window.confirm(
      '⚠️ Permanently delete all your data?\n\n' +
      'This will delete:\n' +
      '• All your saved quizzes from Firestore\n' +
      '• Your user records and question bank items\n' +
      '• All locally cached offline data\n\n' +
      'This action cannot be undone. Do you wish to continue?'
    );
    if (!confirmed) return;

    sound.playClick();
    try {
      const result = await deleteMyData(auth.currentUser);
      setQuizzes(SAMPLE_QUIZZES);
      setActiveGame(null);
      setActivePlayer(null);
      setGameRole(null);
      alert(
        `✓ All your data has been permanently deleted.\n` +
        `• ${result.deletedQuizzes} quizzes deleted from Firestore\n` +
        `• ${result.clearedLocalKeys} local cached items cleared\n` +
        `• Account session reset.`
      );
    } catch (err) {
      alert('Error deleting data: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Delete individual quiz from Firestore & local cache
  const handleDeleteQuiz = async (quizId: string) => {
    sound.playClick();
    const confirmed = window.confirm('Are you sure you want to delete this quiz?');
    if (!confirmed) return;
    try {
      await deleteQuiz(quizId);
      setQuizzes(prev => {
        const filtered = prev.filter(q => q.id !== quizId);
        return filtered.length > 0 ? filtered : SAMPLE_QUIZZES;
      });
    } catch (err) {
      console.warn('Failed to delete quiz:', err);
    }
  };

  // Host launches a quiz
  const handleHostQuiz = async (quizToHost: Quiz) => {
    sound.playClick();
    let user = auth.currentUser;
    if (!user) {
      user = await ensureAnonymousAuth();
    }
    const hostId = user?.uid || 'host_active';
    const hostName = user?.displayName || 'Host Teacher';
    const game = await GameEngine.createGame(quizToHost, hostId, hostName);
    setActiveGame(game);
    setGameRole('host');
    setCurrentTab('arena');
    try {
      sessionStorage.setItem(
        'quizarena_active_session',
        JSON.stringify({ gameId: game.id, playerId: hostId, role: 'host' })
      );
    } catch (e) { }
  };

  // Player joins with PIN
  const handlePlayerJoin = async (pin: string, newPlayer: Player) => {
    sound.playClick();
    let user = auth.currentUser;
    if (!user) {
      user = await ensureAnonymousAuth();
    }
    if (user && newPlayer.id !== user.uid) {
      newPlayer.id = user.uid;
    }
    const gameId = `game_${pin}`;

    // Load or create game session reference
    let gameSession: GameSession | null = null;
    try {
      const saved = localStorage.getItem(`quizarena_game_${gameId}`);
      if (saved) gameSession = JSON.parse(saved);
    } catch (e) { }

    if (!gameSession) {
      // Create guest game session on the fly matching the PIN if not pre-cached
      const defaultQuiz = quizzes[0] || SAMPLE_QUIZZES[0];
      const sanitizedQuestions = defaultQuiz.questions.map(({ correctAnswers, acceptedTextAnswers, ...rest }) => rest as any);
      gameSession = {
        id: gameId,
        pin,
        hostId: 'host_auto',
        hostName: 'Arena Master',
        quizId: defaultQuiz.id,
        quizTitle: defaultQuiz.title,
        status: 'lobby',
        gameMode: 'classic',
        currentQuestionIndex: 0,
        questionStartTime: null,
        timeLimit: defaultQuiz.questions[0]?.timeLimit || 20,
        isPaused: false,
        settings: {
          shuffleQuestions: false,
          shuffleOptions: false,
          allowLateJoin: true,
          enablePowerUps: true,
          antiCheatDetection: true,
          showLeaderboardBetween: true,
          autoEmailResults: true,
          scoringProfile: 'speed_weighted',
          requireApprovalToJoin: false,
          teamMode: false,
        },
        questions: sanitizedQuestions,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(`quizarena_game_${gameId}`, JSON.stringify(gameSession));
    }

    try {
      const joinRes = await GameEngine.joinGame(gameSession.id, newPlayer);
      const resolvedPlayer = joinRes.player;
      const resolvedGame = joinRes.game || gameSession;

      setActiveGame(resolvedGame);
      setActivePlayer(resolvedPlayer);
      setGameRole('player');
      try {
        sessionStorage.setItem(
          'quizarena_active_session',
          JSON.stringify({ gameId: resolvedGame.id, playerId: resolvedPlayer.id, role: 'player', pin })
        );
      } catch (e) { }
    } catch (joinErr: any) {
      alert(joinErr.message || 'Failed to join game');
    }
  };

  // Subscribe to live game changes when activeGame is set
  useEffect(() => {
    if (!activeGame?.id) return;

    const gameId = activeGame.id;
    const unsubGame = GameEngine.subscribeToGame(gameId, updated => {
      if (updated) {
        setActiveGame(updated);
      }
    });

    const unsubPlayers = GameEngine.subscribeToPlayers(gameId, updatedPlayers => {
      setPlayers(updatedPlayers);
      if (activePlayer) {
        const live = updatedPlayers.find(p => p.id === activePlayer.id);
        if (live) {
          setActivePlayer(live);
        }
      }
    });

    return () => {
      unsubGame();
      unsubPlayers();
    };
  }, [activeGame?.id]);

  // Track games for which result emails have already been dispatched
  const sentEmailsGameIds = useRef<Set<string>>(new Set());

  // Automatically build and send result emails when game reaches status "finished" (host side)
  useEffect(() => {
    if (
      activeGame &&
      activeGame.status === 'finished' &&
      gameRole === 'host' &&
      !sentEmailsGameIds.current.has(activeGame.id)
    ) {
      sentEmailsGameIds.current.add(activeGame.id);
      autoSendGameResults(activeGame, players).then(res => {
        if (res.attempted && res.sentCount > 0) {
          console.log(`[ResultEmails] Dispatched ${res.sentCount} result emails for game ${activeGame.id}`);
        }
      }).catch(err => {
        console.warn('[ResultEmails] Auto dispatch error:', err);
      });
    }
  }, [activeGame?.status, activeGame?.id, gameRole, players]);

  const handleStartGame = async () => {
    if (!activeGame) return;
    sound.playClick();
    try {
      await GameEngine.startGame(activeGame.id);
    } catch (err: any) {
      alert(err.message || 'Failed to start game');
    }
  };

  const handleLeaveGame = () => {
    sound.playClick();
    if (activeGame && gameRole === 'player') {
      GameEngine.leaveGame(activeGame.id).catch(() => {});
    }
    try {
      sessionStorage.removeItem('quizarena_active_session');
    } catch (e) { }
    setActiveGame(null);
    setActivePlayer(null);
    setGameRole(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-page)] text-[var(--text)]">
      {/* Top Navbar */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={tab => {
          if (activeGame && tab !== 'arena') {
            const leave = window.confirm('Leave active game session?');
            if (!leave) return;
            handleLeaveGame();
          }
          setCurrentTab(tab);
        }}
        lang={lang}
        setLang={setLang}
        theme={theme}
        setTheme={setTheme}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
        onDeleteMyData={handleDeleteMyData}
        userRole={userRole}
        setUserRole={setUserRole}
      />

      {/* Main App Switcher with Page Transition */}
      <main key={currentTab} className="flex-1 py-4 sm:py-6 animate-fadeIn transition-all">
        {/* Tab 0A: Host Dashboard */}
        {currentTab === 'host_dashboard' && (
          <HostDashboard
            quizzes={quizzes}
            onNavigateTab={setCurrentTab}
            onHostQuiz={handleHostQuiz}
            onEditQuiz={quizId => {
              setBuilderSelectedQuizId(quizId);
              setCurrentTab('builder');
            }}
          />
        )}

        {/* Tab 0B: Student Dashboard */}
        {currentTab === 'student_dashboard' && (
          <StudentDashboard
            quizzes={quizzes}
            onJoinArenaPin={() => setCurrentTab('arena')}
            onStartPractice={() => setCurrentTab('practice')}
            onViewTournaments={() => setCurrentTab('competitions')}
            onViewCertificates={() => setCurrentTab('certificates')}
          />
        )}

        {/* Tab 1: Arena (Join, Lobby, Live Question, Results) */}
        {currentTab === 'arena' && (
          <div>
            {!activeGame ? (
              <JoinView
                onJoinSuccess={handlePlayerJoin}
                onHostNewGame={() => handleHostQuiz(quizzes[0] || SAMPLE_QUIZZES[0])}
              />
            ) : activeGame.status === 'lobby' ? (
              <LobbyView
                game={activeGame}
                players={players}
                isHost={gameRole === 'host'}
                onStartGame={handleStartGame}
                onKickPlayer={async id => {
                  try {
                    if (activeGame) {
                      await GameEngine.kickPlayer(activeGame.id, id);
                    }
                    const updated = players.filter(p => p.id !== id);
                    setPlayers(updated);
                  } catch (err: any) {
                    alert(err.message || 'Failed to kick player');
                  }
                }}
                onUpdateSettings={settings => {
                  if (!activeGame) return;
                  const updated = {
                    ...activeGame,
                    settings: { ...activeGame.settings, ...settings },
                  };
                  setActiveGame(updated);
                  GameEngine.updateGameStatus(updated, updated.status).catch(err => {
                    console.warn('Failed to persist settings update:', err);
                  });
                }}
              />
            ) : activeGame.status === 'finished' ? (
              <PodiumView
                game={activeGame}
                players={players}
                activePlayerId={gameRole === 'player' ? activePlayer?.id : undefined}
                isHost={gameRole === 'host'}
                onPlayAgain={handleLeaveGame}
                onReviewAnalytics={() => {
                  handleLeaveGame();
                  setCurrentTab('analytics');
                }}
              />
            ) : gameRole === 'host' ? (
              <HostArena
                game={activeGame}
                players={players}
                onFinishGame={() => {
                  GameEngine.updateGameStatus(activeGame, 'finished');
                  if (gameRole === 'host' && !sentEmailsGameIds.current.has(activeGame.id)) {
                    sentEmailsGameIds.current.add(activeGame.id);
                    autoSendGameResults(activeGame, players);
                  }
                }}
              />
            ) : (
              <PlayerArena
                game={activeGame}
                player={activePlayer || players[0]}
                onUpdatePlayer={p => setActivePlayer(p)}
              />
            )}
          </div>
        )}

        {/* Tab 2: Quiz Builder */}
        {currentTab === 'builder' && (
          <QuizBuilder
            quizzes={quizzes}
            onSaveQuiz={handleSaveQuiz}
            onSelectForHost={handleHostQuiz}
            onDeleteQuiz={handleDeleteQuiz}
            initialSelectedQuizId={builderSelectedQuizId}
          />
        )}

        {/* Tab 3: AI Quiz Generator */}
        {currentTab === 'ai' && (
          <AIQuizGenerator
            existingQuizzes={quizzes}
            onSaveToQuiz={handleSaveQuiz}
            onHostNow={handleHostQuiz}
            onOpenInStudio={handleOpenInStudio}
          />
        )}

        {/* Tab 4: Competition Tournaments */}
        {currentTab === 'competitions' && (
          <CompetitionManager
            quizzes={quizzes}
            onLaunchRound={(q, compTitle) => {
              const quizWithTitle: Quiz = { ...q, title: compTitle };
              handleHostQuiz(quizWithTitle);
            }}
          />
        )}

        {/* Tab 5: Analytics & CO Attainment */}
        {currentTab === 'analytics' && (
          <AnalyticsDashboard
            quiz={activeGame ? (quizzes.find(q => q.id === activeGame.quizId) || quizzes[0]) : quizzes[0]}
            players={players}
            hostId={auth.currentUser?.uid}
            onLaunchReteachPack={handleHostQuiz}
          />
        )}

        {/* Tab 6: Email Outbox */}
        {currentTab === 'outbox' && <EmailOutbox />}

        {/* Tab 7: Solo Practice Spaced Repetition */}
        {currentTab === 'practice' && <SoloPractice quizzes={quizzes} />}

        {/* Tab 8: Verified Digital Certificates */}
        {currentTab === 'certificates' && <CertificateGallery />}
      </main>

      {/* Footer & Self-Test Verifier Badge */}
      <footer className="border-t border-[var(--border)] bg-[var(--surface)] text-[var(--text)] py-4 px-6 text-center text-xs font-bold transition-colors">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-['Bricolage_Grotesque'] text-sm font-black text-[var(--accent)]">
              QuizArena
            </span>
            <span className="text-[var(--text-muted)]">• Modern Real-Time EdTech SaaS Platform</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setTestModalOpen(true)}
              className="text-[var(--ok)] dark:text-[var(--accent-2)] hover:underline flex items-center gap-1 font-mono-code font-bold"
            >
              🛡️ System Engine: {testResults ? `${testResults.passed} Verified` : 'Verifying...'}
            </button>
            <span className="text-[var(--text-muted)]">PWA • WCAG 2.2 AA Certified</span>
          </div>
        </div>
      </footer>

      {/* Self-Tests Verification Modal */}
      {testModalOpen && testResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="paper-card p-6 max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
                Engine Self-Tests & Cryptographic Verification
              </h3>
              <button onClick={() => setTestModalOpen(false)} className="paper-btn paper-btn-sm text-xs">
                ✕
              </button>
            </div>

            <div className="p-3 bg-[var(--surface-2)] rounded-xl border-2 border-[var(--border)] font-mono-code text-xs space-y-1.5 max-h-64 overflow-y-auto">
              {testResults.results.map((res, i) => (
                <div key={i} className={res.startsWith('✓') ? 'text-green-700 dark:text-green-400 font-bold' : 'text-red-700 dark:text-red-400 font-bold'}>
                  {res}
                </div>
              ))}
            </div>

            <div className="text-xs font-bold text-[var(--text-muted)] text-center">
              Scoring algorithms, latency compensation, SHA-256 hash chains, and nickname sanitization passed.
            </div>

            <button
              onClick={() => setTestModalOpen(false)}
              className="paper-btn paper-btn-ok w-full py-2 text-xs font-bold"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Single Accurate Connectivity & Offline Banner */}
      <OfflineBanner
        isDemoMode={!isFirebaseConfigured}
        isFirebaseOnline={isFirebaseOnline}
        isSignedIn={Boolean(auth.currentUser && !auth.currentUser.isAnonymous)}
      />

      {/* Global Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
