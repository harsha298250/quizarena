/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * QuizArena — Authoritative Quiz Validation Engine
 * Enforces quiz validity rules across frontend authoring and backend session creation.
 */

import { Quiz } from '../types/quiz';

export interface QuizValidationResult {
  valid: boolean;
  errors: string[];
}

export const DEFAULT_UNTITLED_QUIZ_TITLE = 'Untitled Interactive Arena Quiz';

/**
 * Validates whether a quiz meets all structural and domain requirements for hosting.
 * 
 * Mandatory criteria:
 * 1. Non-empty, customized title (rejects empty or default untitled placeholder).
 * 2. At least one valid question.
 * 3. Each question must have non-empty prompt text (checking 'text' or 'question').
 * 4. Option-based questions must provide at least 2 non-empty choices.
 * 5. Evaluated questions must have at least one valid correct answer indicated.
 * 6. Valid positive time limit (>= 5s if provided, or 0 for info slides).
 * 7. Valid points value (>= 0 if provided).
 */
export function validateQuizForHosting(quiz: unknown): QuizValidationResult {
  const errors: string[] = [];

  if (!quiz || typeof quiz !== 'object') {
    return { valid: false, errors: ['Quiz payload must be a valid object.'] };
  }

  const qObj = quiz as Partial<Quiz>;

  // 1. Title validation
  const rawTitle = typeof qObj.title === 'string' ? qObj.title.trim() : '';
  if (!rawTitle) {
    errors.push('Quiz title is required and cannot be empty.');
  } else if (rawTitle.toLowerCase() === DEFAULT_UNTITLED_QUIZ_TITLE.toLowerCase()) {
    errors.push(`Default title "${DEFAULT_UNTITLED_QUIZ_TITLE}" cannot be hosted. Please enter a descriptive title.`);
  }

  // 2. Question count validation
  if (!Array.isArray(qObj.questions) || qObj.questions.length === 0) {
    errors.push('Quiz must contain at least one question.');
  } else {
    qObj.questions.forEach((q: any, idx: number) => {
      const qNum = idx + 1;
      if (!q || typeof q !== 'object') {
        errors.push(`Question ${qNum} has an invalid structure.`);
        return;
      }

      // 3. Question text ('text' or 'question')
      const rawText =
        typeof q.text === 'string'
          ? q.text.trim()
          : typeof q.question === 'string'
          ? q.question.trim()
          : '';

      if (!rawText) {
        errors.push(`Question ${qNum} is missing question prompt text.`);
      }

      const qType = q.type || 'multiple_choice';

      // 4. Option validation for choice-based questions
      const choiceTypes = ['multiple_choice', 'multi_select', 'true_false', 'image_based', 'poll', 'ordering'];
      if (choiceTypes.includes(qType)) {
        if (!Array.isArray(q.options) || q.options.length < 2) {
          errors.push(`Question ${qNum} (${qType}) must have at least 2 answer options.`);
        } else {
          const hasEmptyOption = q.options.some((opt: any) => typeof opt !== 'string' || !opt.trim());
          if (hasEmptyOption) {
            errors.push(`Question ${qNum} contains one or more empty answer options.`);
          }
        }
      }

      // 5. Correct answer validation (exempting polls and informative slides)
      const nonEvaluatedTypes = ['poll', 'word_cloud', 'open_ended', 'info_slide'];
      if (!nonEvaluatedTypes.includes(qType)) {
        const hasCorrectIndices =
          Array.isArray(q.correctAnswers) &&
          q.correctAnswers.length > 0 &&
          q.correctAnswers.every((ans: any) => typeof ans === 'number' && !isNaN(ans) && ans >= 0);

        const hasAcceptedText =
          Array.isArray(q.acceptedTextAnswers) &&
          q.acceptedTextAnswers.length > 0 &&
          q.acceptedTextAnswers.some((ans: any) => typeof ans === 'string' && ans.trim().length > 0);

        if (!hasCorrectIndices && !hasAcceptedText) {
          errors.push(`Question ${qNum} (${qType}) must mark at least one correct answer option.`);
        }
      }

      // 6. Time limit validation
      if (qType !== 'info_slide') {
        if (q.timeLimit !== undefined && (typeof q.timeLimit !== 'number' || isNaN(q.timeLimit) || q.timeLimit < 5)) {
          errors.push(`Question ${qNum} has an invalid time limit (must be at least 5 seconds).`);
        }
      }

      // 7. Points value validation
      if (q.points !== undefined) {
        if (typeof q.points !== 'number' || isNaN(q.points) || q.points < 0) {
          errors.push(`Question ${qNum} has an invalid points value (must be >= 0).`);
        }
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
