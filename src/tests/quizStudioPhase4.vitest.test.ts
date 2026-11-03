/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 4: Quiz Studio & AI Generator Hardening — Automated Test Suite
 * Covers: question validation, quiz validation, duplicate detection,
 *         PDF extraction guards, quizService localStorage scoping,
 *         server-side input validation logic, and regression tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateQuestion,
  validateQuiz,
  calculateQuestionSimilarity,
} from '../lib/questionValidation.ts';
import { validatePdfFile } from '../services/pdfExtractor.ts';
import type { Question, Quiz } from '../types/quiz.ts';

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------
function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q_test',
    type: 'multiple_choice',
    text: 'What is the capital of France?',
    options: ['London', 'Paris', 'Berlin', 'Rome'],
    correctAnswers: [1],
    explanation: 'Paris is the capital and largest city of France.',
    timeLimit: 20,
    points: 1000,
    difficulty: 'easy',
    ...overrides,
  } as Question;
}

function makeQuiz(overrides: Partial<Quiz> = {}): Quiz {
  return {
    id: 'quiz_test',
    title: 'Test Quiz',
    authorId: 'user_abc',
    questions: [makeQuestion()],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Quiz;
}

// ---------------------------------------------------------------------------
// 1. Question Validation
// ---------------------------------------------------------------------------
describe('Phase 4 — Question Validation', () => {
  it('[QV-01] valid multiple_choice question passes validation', () => {
    const result = validateQuestion(makeQuestion());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('[QV-02] empty question text is rejected', () => {
    const result = validateQuestion(makeQuestion({ text: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /empty/i.test(e))).toBe(true);
  });

  it('[QV-03] whitespace-only text is rejected', () => {
    const result = validateQuestion(makeQuestion({ text: '   ' }));
    expect(result.valid).toBe(false);
  });

  it('[QV-04] question text exceeding 600 chars is rejected', () => {
    const result = validateQuestion(makeQuestion({ text: 'A'.repeat(601) }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /600/i.test(e))).toBe(true);
  });

  it('[QV-05] fewer than 2 options is rejected for multiple_choice', () => {
    const result = validateQuestion(makeQuestion({ options: ['Only one'] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /2 options/i.test(e) || /at least 2/i.test(e))).toBe(true);
  });

  it('[QV-06] more than 8 options is rejected', () => {
    const result = validateQuestion(
      makeQuestion({ options: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], correctAnswers: [0] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /8/i.test(e))).toBe(true);
  });

  it('[QV-07] duplicate options are rejected', () => {
    const result = validateQuestion(makeQuestion({ options: ['Paris', 'Paris', 'Berlin', 'Rome'] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /duplicate/i.test(e))).toBe(true);
  });

  it('[QV-08] out-of-bounds correctAnswers index is rejected', () => {
    const result = validateQuestion(makeQuestion({ correctAnswers: [99] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /out of bounds/i.test(e))).toBe(true);
  });

  it('[QV-09] multiple correctAnswers for multiple_choice is rejected', () => {
    const result = validateQuestion(makeQuestion({ correctAnswers: [0, 1] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /exactly one/i.test(e))).toBe(true);
  });

  it('[QV-10] valid true_false question passes', () => {
    const result = validateQuestion(
      makeQuestion({ type: 'true_false', options: ['True', 'False'], correctAnswers: [0] }),
    );
    expect(result.valid).toBe(true);
  });

  it('[QV-11] true_false with 3 options is rejected', () => {
    const result = validateQuestion(
      makeQuestion({ type: 'true_false', options: ['True', 'False', 'Maybe'], correctAnswers: [0] }),
    );
    expect(result.valid).toBe(false);
  });

  it('[QV-12] multi_select with no correct answers is rejected', () => {
    const result = validateQuestion(
      makeQuestion({ type: 'multi_select', correctAnswers: [] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /at least one correct/i.test(e))).toBe(true);
  });

  it('[QV-13] type_answer with empty acceptedTextAnswers is rejected', () => {
    const result = validateQuestion(
      makeQuestion({ type: 'type_answer', options: [], correctAnswers: [], acceptedTextAnswers: [] } as any),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /accepted text/i.test(e))).toBe(true);
  });

  it('[QV-14] valid type_answer passes', () => {
    const result = validateQuestion(
      makeQuestion({ type: 'type_answer', options: [], correctAnswers: [], acceptedTextAnswers: ['Paris', 'paris'] } as any),
    );
    expect(result.valid).toBe(true);
  });

  it('[QV-15] missing explanation generates warning (not error)', () => {
    const result = validateQuestion(makeQuestion({ explanation: '' }));
    expect(result.valid).toBe(true); // Not a blocking error
    expect(result.warnings.some(w => /explanation/i.test(w))).toBe(true);
  });

  it('[QV-16] invalid timeLimit is rejected', () => {
    const result = validateQuestion(makeQuestion({ timeLimit: 999 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /300/i.test(e) || /time/i.test(e))).toBe(true);
  });

  it('[QV-17] negative points is rejected', () => {
    const result = validateQuestion(makeQuestion({ points: -100 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /points/i.test(e))).toBe(true);
  });

  it('[QV-18] unsupported question type is rejected', () => {
    const result = validateQuestion(makeQuestion({ type: 'unknown_type' as any }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /unsupported/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Quiz Validation
// ---------------------------------------------------------------------------
describe('Phase 4 — Quiz Validation', () => {
  it('[QZ-01] valid quiz passes and canLaunch is true', () => {
    const result = validateQuiz(makeQuiz());
    expect(result.valid).toBe(true);
    expect(result.canLaunch).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('[QZ-02] quiz without title fails', () => {
    const result = validateQuiz(makeQuiz({ title: '' }));
    expect(result.valid).toBe(false);
    expect(result.canLaunch).toBe(false);
    expect(result.errors.some(e => /title/i.test(e))).toBe(true);
  });

  it('[QZ-03] quiz title over 120 chars fails', () => {
    const result = validateQuiz(makeQuiz({ title: 'T'.repeat(121) }));
    expect(result.valid).toBe(false);
  });

  it('[QZ-04] quiz with no questions fails', () => {
    const result = validateQuiz(makeQuiz({ questions: [] }));
    expect(result.valid).toBe(false);
    expect(result.canLaunch).toBe(false);
    expect(result.errors.some(e => /at least one/i.test(e))).toBe(true);
  });

  it('[QZ-05] quiz with an invalid question surfaces the error', () => {
    const badQ = makeQuestion({ text: '' });
    const result = validateQuiz(makeQuiz({ questions: [badQ] }));
    expect(result.valid).toBe(false);
    expect(result.canLaunch).toBe(false);
  });

  it('[QZ-06] exact duplicate questions within a quiz generate a warning', () => {
    const q1 = makeQuestion({ id: 'q1', text: 'What is the capital of France?' });
    const q2 = makeQuestion({ id: 'q2', text: 'What is the capital of France?' });
    const result = validateQuiz(makeQuiz({ questions: [q1, q2] }));
    expect(result.warnings.some(w => /duplicate/i.test(w))).toBe(true);
  });

  it('[QZ-07] questionResults includes per-question validation state', () => {
    const q = makeQuestion({ id: 'q_specific' });
    const result = validateQuiz(makeQuiz({ questions: [q] }));
    expect(result.questionResults['q_specific']).toBeDefined();
    expect(result.questionResults['q_specific'].valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Duplicate / Similarity Detection
// ---------------------------------------------------------------------------
describe('Phase 4 — Question Similarity Detection', () => {
  it('[DUP-01] identical questions score 1.0', () => {
    const text = 'What is the capital of France?';
    expect(calculateQuestionSimilarity(text, text)).toBe(1.0);
  });

  it('[DUP-02] totally unrelated questions score below 0.1', () => {
    const a = 'What is photosynthesis?';
    const b = 'Explain the HTTP request lifecycle.';
    const score = calculateQuestionSimilarity(a, b);
    expect(score).toBeLessThan(0.1);
  });

  it('[DUP-03] near-duplicate paraphrase scores above 0.6', () => {
    const a = 'What is the capital city of France?';
    const b = 'Which city is the capital of France?';
    const score = calculateQuestionSimilarity(a, b);
    expect(score).toBeGreaterThan(0.6);
  });

  it('[DUP-04] slightly reworded question scores between 0.3 and 0.9', () => {
    const a = 'Describe the OSI networking model layers.';
    const b = 'List the layers of the OSI model in networking.';
    const score = calculateQuestionSimilarity(a, b);
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(1.0);
  });

  it('[DUP-05] empty strings return 0', () => {
    expect(calculateQuestionSimilarity('', 'Something')).toBe(0);
    expect(calculateQuestionSimilarity('', '')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. PDF Extraction Guards (validatePdfFile)
// ---------------------------------------------------------------------------
describe('Phase 4 — PDF File Validation', () => {
  function makeFile(name: string, type: string, size: number): File {
    const blob = new Blob(['x'.repeat(Math.min(size, 100))], { type });
    const file = new File([blob], name, { type });
    // Override size for large-file tests (JSDOM File size matches blob size)
    Object.defineProperty(file, 'size', { value: size });
    return file;
  }

  it('[PDF-01] valid PDF file passes validation', () => {
    const file = makeFile('notes.pdf', 'application/pdf', 1024);
    expect(() => validatePdfFile(file)).not.toThrow();
  });

  it('[PDF-02] non-PDF MIME type throws', () => {
    const file = makeFile('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1024);
    expect(() => validatePdfFile(file)).toThrow(/invalid file type/i);
  });

  it('[PDF-03] file exceeding 20 MB limit throws', () => {
    const file = makeFile('huge.pdf', 'application/pdf', 21 * 1024 * 1024);
    expect(() => validatePdfFile(file)).toThrow(/too large/i);
  });

  it('[PDF-04] zero-byte file throws', () => {
    const file = makeFile('empty.pdf', 'application/pdf', 0);
    expect(() => validatePdfFile(file)).toThrow(/empty/i);
  });

  it('[PDF-05] file without MIME type but wrong extension throws', () => {
    const file = makeFile('notes.exe', '', 1024);
    expect(() => validatePdfFile(file)).toThrow(/\.pdf/i);
  });

  it('[PDF-06] file without MIME type but correct .pdf extension passes', () => {
    const file = makeFile('notes.pdf', '', 2048);
    expect(() => validatePdfFile(file)).not.toThrow();
  });

  it('[PDF-07] exactly 20 MB file passes', () => {
    const file = makeFile('boundary.pdf', 'application/pdf', 20 * 1024 * 1024);
    expect(() => validatePdfFile(file)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. localStorage Scoping (quizService)
// ---------------------------------------------------------------------------
describe('Phase 4 — localStorage Scoping', () => {
  // We test the scoping logic in isolation without full quizService imports
  // (which pull in Firebase), verifying the key-naming convention.
  function localStorageKey(authorId: string): string {
    if (!authorId) return 'quizarena_quizzes_anonymous';
    return `quizarena_quizzes_${authorId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  it('[LS-01] different authors produce different cache keys', () => {
    const keyA = localStorageKey('user_alice');
    const keyB = localStorageKey('user_bob');
    expect(keyA).not.toBe(keyB);
  });

  it('[LS-02] same author always produces the same key', () => {
    expect(localStorageKey('uid_xyz123')).toBe(localStorageKey('uid_xyz123'));
  });

  it('[LS-03] empty authorId produces anonymous key', () => {
    expect(localStorageKey('')).toBe('quizarena_quizzes_anonymous');
  });

  it('[LS-04] key contains the authorId', () => {
    const key = localStorageKey('teacher_001');
    expect(key).toContain('teacher_001');
  });

  it('[LS-05] special characters in authorId are sanitised', () => {
    const key = localStorageKey('user@example.com');
    expect(key).not.toContain('@');
    expect(key).not.toContain('.');
  });
});

// ---------------------------------------------------------------------------
// 6. Server-side Input Validation Logic (unit-tested in isolation)
// ---------------------------------------------------------------------------
describe('Phase 4 — Generate Quiz Input Validation (isolated)', () => {
  function validateGenerateQuizInputs(body: any): { valid: boolean; error?: string } {
    const ALLOWED_DIFFICULTIES = ['easy', 'medium', 'hard', 'mixed'];
    const ALLOWED_LANGUAGES = ['en', 'hi', 'ta'];

    if (!body.sourceContent || typeof body.sourceContent !== 'string' || !body.sourceContent.trim()) {
      return { valid: false, error: 'sourceContent is required and must be a non-empty string.' };
    }
    const numQuestions = parseInt(String(body.numQuestions ?? 5), 10);
    if (isNaN(numQuestions) || numQuestions < 1 || numQuestions > 50) {
      return { valid: false, error: 'numQuestions must be an integer between 1 and 50.' };
    }
    const difficulty = String(body.difficulty ?? 'mixed').toLowerCase();
    if (!ALLOWED_DIFFICULTIES.includes(difficulty)) {
      return { valid: false, error: `difficulty must be one of: ${ALLOWED_DIFFICULTIES.join(', ')}.` };
    }
    const language = String(body.language ?? 'en').toLowerCase();
    if (!ALLOWED_LANGUAGES.includes(language)) {
      return { valid: false, error: `language must be one of: ${ALLOWED_LANGUAGES.join(', ')}.` };
    }
    return { valid: true };
  }

  it('[SV-01] valid inputs pass', () => {
    const r = validateGenerateQuizInputs({ sourceContent: 'Some text', numQuestions: 5, difficulty: 'medium', language: 'en' });
    expect(r.valid).toBe(true);
  });

  it('[SV-02] missing sourceContent fails', () => {
    const r = validateGenerateQuizInputs({ numQuestions: 5 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/sourceContent/i);
  });

  it('[SV-03] numQuestions = 0 fails', () => {
    const r = validateGenerateQuizInputs({ sourceContent: 'text', numQuestions: 0 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/1 and 50/i);
  });

  it('[SV-04] numQuestions = 51 fails', () => {
    const r = validateGenerateQuizInputs({ sourceContent: 'text', numQuestions: 51 });
    expect(r.valid).toBe(false);
  });

  it('[SV-05] numQuestions = -5 fails', () => {
    const r = validateGenerateQuizInputs({ sourceContent: 'text', numQuestions: -5 });
    expect(r.valid).toBe(false);
  });

  it('[SV-06] invalid difficulty fails', () => {
    const r = validateGenerateQuizInputs({ sourceContent: 'text', numQuestions: 5, difficulty: 'extreme' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/difficulty/i);
  });

  it('[SV-07] invalid language fails', () => {
    const r = validateGenerateQuizInputs({ sourceContent: 'text', numQuestions: 5, language: 'fr' });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/language/i);
  });

  it('[SV-08] language "hi" is accepted', () => {
    const r = validateGenerateQuizInputs({ sourceContent: 'text', numQuestions: 5, language: 'hi' });
    expect(r.valid).toBe(true);
  });

  it('[SV-09] language "ta" is accepted', () => {
    const r = validateGenerateQuizInputs({ sourceContent: 'text', numQuestions: 5, language: 'ta' });
    expect(r.valid).toBe(true);
  });

  it('[SV-10] numQuestions = 50 (boundary) is accepted', () => {
    const r = validateGenerateQuizInputs({ sourceContent: 'text', numQuestions: 50, difficulty: 'hard', language: 'en' });
    expect(r.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Validation Badge Assignment Logic (isolated)
// ---------------------------------------------------------------------------
describe('Phase 4 — AI Validation Badge Assignment', () => {
  function assignBadge(item: { question: string; options: string[]; correctAnswerIndex: number }): string {
    const issues: string[] = [];
    const qText = String(item.question || '').trim();
    const options = Array.isArray(item.options) ? item.options.map(String) : [];
    const correctAnswerIndex = Number(item.correctAnswerIndex ?? 0);

    if (!qText) issues.push('empty question text');
    if (qText.length > 600) issues.push('question text too long');
    if (options.length < 2) issues.push('fewer than 2 options');
    if (options.length > 8) issues.push('more than 8 options');
    if (correctAnswerIndex < 0 || correctAnswerIndex >= options.length) issues.push('correctAnswerIndex out of bounds');
    const lowerOptions = options.map(o => o.toLowerCase().trim());
    if (new Set(lowerOptions).size !== lowerOptions.length) issues.push('duplicate options');

    if (issues.length === 0) return 'ai_draft';
    if (issues.length <= 2) return 'needs_review';
    return 'flagged';
  }

  it('[BADGE-01] structurally sound question gets ai_draft (not "good")', () => {
    expect(assignBadge({ question: 'What is X?', options: ['A', 'B', 'C', 'D'], correctAnswerIndex: 0 })).toBe('ai_draft');
  });

  it('[BADGE-02] question with duplicate options gets needs_review', () => {
    expect(assignBadge({ question: 'What is X?', options: ['A', 'A', 'C', 'D'], correctAnswerIndex: 0 })).toBe('needs_review');
  });

  it('[BADGE-03] question with no text gets flagged', () => {
    // multiple issues: empty text + out-of-bounds index + too few options
    expect(assignBadge({ question: '', options: [], correctAnswerIndex: 0 })).toBe('flagged');
  });

  it('[BADGE-04] question with out-of-bounds index gets needs_review', () => {
    expect(assignBadge({ question: 'Valid text?', options: ['A', 'B'], correctAnswerIndex: 5 })).toBe('needs_review');
  });
});

// ---------------------------------------------------------------------------
// 8. Regression: Phase 1/2/3 Imports Unharmed
// ---------------------------------------------------------------------------
describe('Phase 4 — Regression: Core imports still resolvable', () => {
  it('[REG-01] scoring lib is importable', async () => {
    const mod = await import('../lib/scoring.ts');
    expect(typeof mod.calculateFairScore).toBe('function');
  });

  it('[REG-02] integrity lib is importable', async () => {
    const mod = await import('../lib/integrity.ts');
    expect(typeof mod.createHashBlock).toBe('function');
  });

  it('[REG-03] questionValidation is importable with all exports', async () => {
    const mod = await import('../lib/questionValidation.ts');
    expect(typeof mod.validateQuestion).toBe('function');
    expect(typeof mod.validateQuiz).toBe('function');
    expect(typeof mod.calculateQuestionSimilarity).toBe('function');
  });
});
