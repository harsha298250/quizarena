/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Question, QuestionType, Quiz, BloomLevel } from '../types/quiz.ts';

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface QuestionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  issues: ValidationIssue[];
}

export interface QuizValidationResult {
  valid: boolean;
  canLaunch: boolean;
  errors: string[];
  warnings: string[];
  questionResults: Record<string, QuestionValidationResult>;
}

export const SUPPORTED_QUESTION_TYPES: QuestionType[] = [
  'multiple_choice',
  'true_false',
  'multi_select',
  'type_answer',
  'ordering',
  'poll',
  'word_cloud',
  'info_slide',
];

export const SUPPORTED_BLOOM_LEVELS: BloomLevel[] = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
];

/**
 * Validates an individual quiz question.
 */
export function validateQuestion(question: Question): QuestionValidationResult {
  const issues: ValidationIssue[] = [];

  // 1. Text validation
  if (!question.text || typeof question.text !== 'string' || !question.text.trim()) {
    issues.push({ field: 'text', message: 'Question prompt text cannot be empty.', severity: 'error' });
  } else if (question.text.trim().length > 600) {
    issues.push({ field: 'text', message: 'Question text cannot exceed 600 characters.', severity: 'error' });
  }

  // 2. Question type validation
  if (!SUPPORTED_QUESTION_TYPES.includes(question.type)) {
    issues.push({
      field: 'type',
      message: `Unsupported question type "${question.type}". Supported types: ${SUPPORTED_QUESTION_TYPES.join(', ')}`,
      severity: 'error',
    });
  }

  // 3. Time limit & points
  if (typeof question.timeLimit !== 'number' || isNaN(question.timeLimit) || question.timeLimit < 0 || question.timeLimit > 300) {
    issues.push({ field: 'timeLimit', message: 'Time limit must be between 0 and 300 seconds.', severity: 'error' });
  }

  if (typeof question.points !== 'number' || isNaN(question.points) || question.points < 0 || question.points > 10000) {
    issues.push({ field: 'points', message: 'Points must be a non-negative integer up to 10,000.', severity: 'error' });
  }

  // 4. Options & correct answers per question type
  const options = Array.isArray(question.options) ? question.options : [];
  const correctAnswers = Array.isArray(question.correctAnswers) ? question.correctAnswers : [];

  if (question.type === 'multiple_choice') {
    if (options.length < 2) {
      issues.push({ field: 'options', message: 'Multiple choice questions must have at least 2 options.', severity: 'error' });
    } else if (options.length > 8) {
      issues.push({ field: 'options', message: 'Multiple choice questions cannot exceed 8 options.', severity: 'error' });
    }

    // Check empty options
    options.forEach((opt, idx) => {
      if (!opt || typeof opt !== 'string' || !opt.trim()) {
        issues.push({ field: `options[${idx}]`, message: `Option ${idx + 1} cannot be empty.`, severity: 'error' });
      }
    });

    // Check duplicate options
    const normalizedOptions = options.map(o => (typeof o === 'string' ? o.trim().toLowerCase() : ''));
    const uniqueOptions = new Set(normalizedOptions);
    if (uniqueOptions.size < options.length) {
      issues.push({ field: 'options', message: 'Duplicate answer options detected.', severity: 'error' });
    }

    // Check correct answer
    if (correctAnswers.length !== 1) {
      issues.push({
        field: 'correctAnswers',
        message: 'Multiple choice questions must have exactly one correct answer selected.',
        severity: 'error',
      });
    } else {
      const correctIdx = correctAnswers[0];
      if (!Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx >= options.length) {
        issues.push({
          field: 'correctAnswers',
          message: `Correct answer index ${correctIdx} is out of bounds (options count: ${options.length}).`,
          severity: 'error',
        });
      }
    }
  } else if (question.type === 'true_false') {
    if (options.length !== 2) {
      issues.push({ field: 'options', message: 'True/False questions must have exactly 2 options.', severity: 'error' });
    }
    if (correctAnswers.length !== 1 || (correctAnswers[0] !== 0 && correctAnswers[0] !== 1)) {
      issues.push({ field: 'correctAnswers', message: 'True/False must designate option 0 or 1 as correct.', severity: 'error' });
    }
  } else if (question.type === 'multi_select') {
    if (options.length < 2) {
      issues.push({ field: 'options', message: 'Multi-select questions must have at least 2 options.', severity: 'error' });
    }
    if (correctAnswers.length === 0) {
      issues.push({ field: 'correctAnswers', message: 'Multi-select questions must have at least one correct answer selected.', severity: 'error' });
    }
    const uniqueCorrect = new Set(correctAnswers);
    if (uniqueCorrect.size !== correctAnswers.length) {
      issues.push({ field: 'correctAnswers', message: 'Duplicate correct answer references detected.', severity: 'error' });
    }
    correctAnswers.forEach(idx => {
      if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) {
        issues.push({ field: 'correctAnswers', message: `Correct answer index ${idx} is out of bounds.`, severity: 'error' });
      }
    });
  } else if (question.type === 'type_answer') {
    const accepted = Array.isArray(question.acceptedTextAnswers) ? question.acceptedTextAnswers : [];
    if (accepted.length === 0) {
      issues.push({
        field: 'acceptedTextAnswers',
        message: 'Short answer questions must have at least one accepted text answer.',
        severity: 'error',
      });
    } else {
      accepted.forEach((ans, idx) => {
        if (!ans || typeof ans !== 'string' || !ans.trim()) {
          issues.push({ field: `acceptedTextAnswers[${idx}]`, message: 'Accepted text answer cannot be empty.', severity: 'error' });
        }
      });
    }
  } else if (question.type === 'ordering') {
    if (options.length < 2) {
      issues.push({ field: 'options', message: 'Ordering questions must have at least 2 items.', severity: 'error' });
    }
  }

  // 5. Difficulty check
  if (question.difficulty && !['easy', 'medium', 'hard'].includes(question.difficulty)) {
    issues.push({ field: 'difficulty', message: 'Difficulty must be "easy", "medium", or "hard".', severity: 'error' });
  }

  // 6. Pedagogical warnings
  if (!question.explanation || !question.explanation.trim()) {
    issues.push({
      field: 'explanation',
      message: 'Adding an explanation helps students learn during answer reveals.',
      severity: 'warning',
    });
  }

  const errors = issues.filter(i => i.severity === 'error').map(i => i.message);
  const warnings = issues.filter(i => i.severity === 'warning').map(i => i.message);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    issues,
  };
}

/**
 * Validates an entire Quiz data structure before saving or launching.
 */
export function validateQuiz(quiz: Quiz): QuizValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const questionResults: Record<string, QuestionValidationResult> = {};

  if (!quiz.title || typeof quiz.title !== 'string' || !quiz.title.trim()) {
    errors.push('Quiz title is required.');
  } else if (quiz.title.trim().length > 120) {
    errors.push('Quiz title cannot exceed 120 characters.');
  }

  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    errors.push('Quiz must contain at least one question.');
  } else {
    // Check questions individually
    quiz.questions.forEach((q, idx) => {
      const qRes = validateQuestion(q);
      questionResults[q.id || `q_${idx}`] = qRes;
      if (!qRes.valid) {
        errors.push(`Question #${idx + 1} ("${(q.text || '').slice(0, 30)}..."): ${qRes.errors.join('; ')}`);
      }
    });

    // Check for duplicate questions within the quiz
    const questionTexts = quiz.questions.map(q => (q.text || '').trim().toLowerCase());
    const seen = new Set<string>();
    questionTexts.forEach((text, idx) => {
      if (text && seen.has(text)) {
        warnings.push(`Question #${idx + 1} appears to be a duplicate of an earlier question.`);
      }
      seen.add(text);
    });
  }

  return {
    valid: errors.length === 0,
    canLaunch: errors.length === 0 && (quiz.questions || []).length > 0,
    errors,
    warnings,
    questionResults,
  };
}

export const DEFAULT_DUPLICATE_SIMILARITY_THRESHOLD = 0.65;

const FILLER_STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'into',
  'about', 'that', 'this', 'these', 'those', 'it', 'its', 'and', 'or',
  'does', 'do', 'did', 'can', 'could', 'would', 'should', 'will', 'shall',
  'following', 'statement', 'statements', 'accurately', 'correctly', 'best',
  'describes', 'describe', 'characterizes', 'characterize', 'means',
]);

const QUESTION_INTENT_GROUPS: Record<string, string> = {
  who: 'person',
  whom: 'person',
  whose: 'person',
  when: 'time',
  where: 'place',
  why: 'reason',
  how: 'manner',
  what: 'entity',
  which: 'entity',
};

const NEGATION_WORDS = new Set(['not', 'never', 'except', 'without', 'neither', 'nor']);

/**
 * Normalizes question text (NFKC, lowercase, basic contractions, strip punctuation, collapse whitespace)
 * while preserving numbers, dates, names, and question-intent words.
 */
export function normalizeQuestionText(text: string): string {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\b(what|who|when|where|why|how)'s\b/g, '$1 is')
    .replace(/\bisn't\b/g, 'is not')
    .replace(/\baren't\b/g, 'are not')
    .replace(/\bdoesn't\b/g, 'does not')
    .replace(/\bdon't\b/g, 'do not')
    .replace(/\bcan't\b/g, 'cannot')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lightStemToken(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 4 && /(?:x|ch|sh|ss|z)es$/.test(token)) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss') && !/^\d+$/.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

export interface QuestionFingerprint {
  normalized: string;
  tokens: Set<string>;
  intent: string | null;
  hasNegation: boolean;
  numbers: Set<string>;
}

/**
 * Precomputes normalized text, meaningful content tokens, question intent, negation, and numeric tokens
 * so duplicate comparisons are fast and avoid false positives on differing intents/numbers.
 */
export function buildQuestionFingerprint(text: string): QuestionFingerprint {
  const normalized = normalizeQuestionText(text);
  const rawTokens = normalized ? normalized.split(' ').filter(Boolean) : [];
  const tokens = new Set<string>();
  const numbers = new Set<string>();
  let intent: string | null = null;
  let hasNegation = false;

  for (const raw of rawTokens) {
    const mappedIntent = QUESTION_INTENT_GROUPS[raw];
    if (mappedIntent) {
      if (!intent) intent = mappedIntent;
      tokens.add(`__intent_${mappedIntent}`);
      continue;
    }
    if (NEGATION_WORDS.has(raw)) {
      hasNegation = true;
    }
    if (/^\d+$/.test(raw)) {
      numbers.add(raw);
    }
    if (!FILLER_STOPWORDS.has(raw)) {
      tokens.add(lightStemToken(raw));
    }
  }

  return { normalized, tokens, intent, hasNegation, numbers };
}

export function compareQuestionFingerprints(
  a: QuestionFingerprint,
  b: QuestionFingerprint
): number {
  if (!a.normalized || !b.normalized) return 0;
  if (a.normalized === b.normalized) return 1;

  // Guard against false positives when explicit question intent differs (e.g., "Who ..." vs "When ...")
  if (a.intent && b.intent && a.intent !== b.intent) {
    return 0;
  }

  // Guard against false positives when polarity differs ("... is ..." vs "... is NOT ...")
  if (a.hasNegation !== b.hasNegation) {
    return 0;
  }

  // Guard against false positives when explicit numbers/years/codes differ (e.g. 429 vs 404, 1928 vs 1945)
  if (a.numbers.size > 0 && b.numbers.size > 0) {
    const sameNums =
      a.numbers.size === b.numbers.size && [...a.numbers].every((n) => b.numbers.has(n));
    if (!sameNums) return 0;
  }

  if (a.tokens.size === 0 || b.tokens.size === 0) return 0;

  let intersection = 0;
  for (const token of a.tokens) {
    if (b.tokens.has(token)) intersection++;
  }
  const union = a.tokens.size + b.tokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Calculates Token-based Jaccard similarity between two strings to detect duplicate/near-duplicate questions.
 */
export function calculateQuestionSimilarity(a: string, b: string): number {
  return compareQuestionFingerprints(buildQuestionFingerprint(a), buildQuestionFingerprint(b));
}

/**
 * Determines whether two question prompts are exact or near-duplicates above the similarity threshold.
 */
export function isNearDuplicateQuestion(
  candidateText: string,
  existingText: string,
  threshold: number = DEFAULT_DUPLICATE_SIMILARITY_THRESHOLD
): boolean {
  return calculateQuestionSimilarity(candidateText, existingText) >= threshold;
}

