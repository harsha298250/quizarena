/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Profanity filter & playful auto-rename generator
const BANNED_TERMS = [
  'fuck', 'shit', 'asshole', 'bitch', 'crap', 'bastard', 'dick', 'nude', 'porn', 'sex',
  'kill', 'hate', 'racist', 'nazi', 'hitler', 'terrorist', 'slut', 'whore', 'pussy',
  'dumbass', 'fag', 'retard'
];

const ADJECTIVES = ['Speedy', 'Clever', 'Cosmic', 'Brave', 'Sparky', 'Zippy', 'Mighty', 'Curious', 'Turbo', 'Golden', 'Hyper', 'Swift'];
const NOUNS = ['Otter', 'Falcon', 'Panda', 'Rocket', 'Badger', 'Dolphin', 'Tiger', 'Comet', 'Fox', 'Koala', 'Phoenix', 'Penguin'];

export function sanitizeNickname(input: string): { cleanName: string; wasCensored: boolean } {
  let trimmed = input.trim();
  if (!trimmed) {
    return { cleanName: generatePlayfulNickname(), wasCensored: false };
  }

  // Length clamp
  if (trimmed.length > 25) {
    trimmed = trimmed.substring(0, 25);
  }

  const lower = trimmed.toLowerCase();
  for (const bad of BANNED_TERMS) {
    if (lower.includes(bad)) {
      return { cleanName: generatePlayfulNickname(), wasCensored: true };
    }
  }

  return { cleanName: trimmed, wasCensored: false };
}

export function generatePlayfulNickname(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(NOUNS.length * Math.random())];
  const num = Math.floor(Math.random() * 90) + 10;
  return `${adj}${noun}${num}`;
}

export const AVATAR_OPTIONS = [
  { id: 'fox', label: 'Cunning Fox', color: '#FF5A36' },
  { id: 'owl', label: 'Wise Owl', color: '#14B8A6' },
  { id: 'tiger', label: 'Fierce Tiger', color: '#FFC83D' },
  { id: 'bear', label: 'Sturdy Bear', color: '#4DA3FF' },
  { id: 'rabbit', label: 'Quick Rabbit', color: '#EC4899' },
  { id: 'robot', label: 'Turbo Bot', color: '#8B5CF6' },
  { id: 'panda', label: 'Zen Panda', color: '#10B981' },
  { id: 'lion', label: 'Brave Lion', color: '#F97316' },
];
