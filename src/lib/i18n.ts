/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SupportedLanguage = 'en';

export interface Translations {
  appName: string;
  tagline: string;
  joinGame: string;
  hostGame: string;
  enterPin: string;
  pinPlaceholder: string;
  nickname: string;
  nicknamePlaceholder: string;
  selectAvatar: string;
  readyToPlay: string;
  lockItIn: string;
  niceOne: string;
  oopsMissed: string;
  points: string;
  streak: string;
  rank: string;
  leaderboard: string;
  nextQuestion: string;
  revealAnswer: string;
  skipQuestion: string;
  pauseGame: string;
  resumeGame: string;
  endGame: string;
  playersJoined: string;
  waitingForHost: string;
  gameOver: string;
  podium: string;
  downloadCertificate: string;
  shareResult: string;
  quizBuilder: string;
  aiGenerator: string;
  analytics: string;
  competitions: string;
  emailOutbox: string;
  soloPractice: string;
  navJoin: string;
  navBuilder: string;
  navAI: string;
  navCompetitions: string;
  navAnalytics: string;
  navOutbox: string;
  navPractice: string;
  accommodations: string;
  extraTime: string;
  dyslexiaFont: string;
  largeText: string;
  readAloud: string;
  powerUps: string;
  powerUp5050: string;
  powerUp2x: string;
  powerUpFreeze: string;
  demoModeNotice: string;
  simulatePlayers: string;
  verifyIntegrity: string;
  integrityPass: string;
  integrityFail: string;
}

export const translations: Record<SupportedLanguage, Translations> = {
  en: {
    appName: 'QuizArena',
    tagline: 'Real-Time Multiplayer Quizzes & Competitions',
    joinGame: 'Join Arena',
    hostGame: 'Host Quiz',
    enterPin: 'Game PIN',
    pinPlaceholder: '6-digit PIN',
    nickname: 'Your Nickname',
    nicknamePlaceholder: 'Choose a brave handle...',
    selectAvatar: 'Pick Your Sticker Avatar',
    readyToPlay: "I'm Ready!",
    lockItIn: 'Lock it in!',
    niceOne: 'Nice one! Spot on!',
    oopsMissed: 'Bummer! Keep your head up!',
    points: 'Points',
    streak: 'Streak',
    rank: 'Rank',
    leaderboard: 'Leaderboard',
    nextQuestion: 'Next Question',
    revealAnswer: 'Reveal Answer',
    skipQuestion: 'Skip',
    pauseGame: 'Pause',
    resumeGame: 'Resume',
    endGame: 'End Game',
    playersJoined: 'Players in the Arena',
    waitingForHost: 'Get ready! Host will launch soon...',
    gameOver: 'Game Over!',
    podium: 'Victory Podium',
    downloadCertificate: 'Download Certificate (PDF)',
    shareResult: 'Share Result Card',
    quizBuilder: 'Quiz Studio',
    aiGenerator: 'AI Generator (PDF/Text)',
    analytics: 'Analytics & COs',
    competitions: 'Tournaments',
    emailOutbox: 'Email Outbox',
    soloPractice: 'Solo Practice',
    navJoin: 'Arena',
    navBuilder: 'Studio',
    navAI: 'AI Quiz',
    navCompetitions: 'Tournaments',
    navAnalytics: 'Analytics',
    navOutbox: 'Outbox',
    navPractice: 'Solo',
    accommodations: 'Accessibility & Accommodations',
    extraTime: 'Extra Time',
    dyslexiaFont: 'Dyslexia-friendly Font',
    largeText: 'Large Text Size',
    readAloud: 'Read Questions Aloud',
    powerUps: 'Power-Ups',
    powerUp5050: '50/50 (Cut 2 Wrong)',
    powerUp2x: 'Double Points (2x)',
    powerUpFreeze: 'Freeze Timer (+5s)',
    demoModeNotice: 'Demo Mode: Running offline / BroadcastChannel sync.',
    simulatePlayers: 'Simulate Players (Dev Tool)',
    verifyIntegrity: 'Verify Audit Integrity',
    integrityPass: 'Chain Verified: Cryptographically Sound',
    integrityFail: 'Tamper Detected in Hash Chain',
  },
};
