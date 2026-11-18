/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getAnswerOptionState, OptionStateInput } from '../lib/answerUiState';
import { extractSecretAnswerForQuestion } from '../server/scoringHardening';

describe('Answer UI and Reveal Integrity Verification', () => {
  describe('Server Secret Extraction on Reveal', () => {
    it('correctly extracts correctAnswers from nested answers map (gameSessionHandler structure)', () => {
      const storedSecret = {
        answers: {
          '0': {
            type: 'multiple_choice',
            options: ['True', 'False'],
            correctAnswers: [0],
            acceptedTextAnswers: [],
            points: 1000,
          },
          '1': {
            type: 'multiple_choice',
            options: ['A', 'B', 'C', 'D'],
            correctAnswers: [2],
            acceptedTextAnswers: [],
            points: 1000,
          },
        },
        hostId: 'host_123',
        createdAt: { _seconds: 1700000000, _nanoseconds: 0 },
      };

      const q0 = extractSecretAnswerForQuestion(storedSecret, 0);
      expect(q0).not.toBeNull();
      expect(q0?.correctAnswers).toEqual([0]);

      const q1 = extractSecretAnswerForQuestion(storedSecret, 1);
      expect(q1).not.toBeNull();
      expect(q1?.correctAnswers).toEqual([2]);
    });

    it('correctly extracts correctAnswers from answers array', () => {
      const storedSecret = {
        answers: [
          {
            questionIndex: 0,
            type: 'multiple_choice',
            options: ['True', 'False'],
            correctAnswers: [0],
          },
          {
            questionIndex: 1,
            type: 'multiple_choice',
            options: ['Alpha', 'Beta'],
            correctAnswers: [1],
          },
        ],
      };

      const q0 = extractSecretAnswerForQuestion(storedSecret, 0);
      expect(q0?.correctAnswers).toEqual([0]);

      const q1 = extractSecretAnswerForQuestion(storedSecret, 1);
      expect(q1?.correctAnswers).toEqual([1]);
    });

    it('correctly extracts correctAnswers from flat answer key map', () => {
      const flatSecret = {
        '0': {
          correctAnswers: [0],
          type: 'multiple_choice',
          options: ['True', 'False'],
        },
        '1': {
          correctAnswers: [3],
          type: 'multiple_choice',
          options: ['A', 'B', 'C', 'D'],
        },
      };

      const q0 = extractSecretAnswerForQuestion(flatSecret, 0);
      expect(q0?.correctAnswers).toEqual([0]);

      const q1 = extractSecretAnswerForQuestion(flatSecret, 1);
      expect(q1?.correctAnswers).toEqual([3]);
    });
  });

  describe('Client Answer Option Visual State Model', () => {
    describe('True/False Questions (2 options)', () => {
      it('marks True as CORRECT and False as EXPIRED when student selected True (Option 0) correctly', () => {
        const option0State = getAnswerOptionState({
          optionIndex: 0,
          selectedIndices: [0],
          isRevealed: true,
          correctAnswers: [0],
          hasSubmitted: true,
          isSubmitting: false,
          isLocked: true,
          isExpired: false,
          isServerConfirmedCorrect: true,
        });

        const option1State = getAnswerOptionState({
          optionIndex: 1,
          selectedIndices: [0],
          isRevealed: true,
          correctAnswers: [0],
          hasSubmitted: true,
          isSubmitting: false,
          isLocked: true,
          isExpired: false,
          isServerConfirmedCorrect: true,
        });

        expect(option0State).toBe('CORRECT');
        expect(option1State).toBe('EXPIRED');
      });

      it('marks False as INCORRECT and True as CORRECT when student selected False (Option 1) incorrectly', () => {
        const option0State = getAnswerOptionState({
          optionIndex: 0,
          selectedIndices: [1],
          isRevealed: true,
          correctAnswers: [0],
          hasSubmitted: true,
          isSubmitting: false,
          isLocked: true,
          isExpired: false,
          isServerConfirmedCorrect: false,
        });

        const option1State = getAnswerOptionState({
          optionIndex: 1,
          selectedIndices: [1],
          isRevealed: true,
          correctAnswers: [0],
          hasSubmitted: true,
          isSubmitting: false,
          isLocked: true,
          isExpired: false,
          isServerConfirmedCorrect: false,
        });

        expect(option0State).toBe('CORRECT');
        expect(option1State).toBe('INCORRECT');
      });
    });

    describe('Single-Choice Questions across all positions (A, B, C, D)', () => {
      const positions = [
        { name: 'Option A (0)', correctIndex: 0 },
        { name: 'Option B (1)', correctIndex: 1 },
        { name: 'Option C (2)', correctIndex: 2 },
        { name: 'Option D (3)', correctIndex: 3 },
      ];

      for (const pos of positions) {
        it(`correctly flags ${pos.name} as CORRECT when selected`, () => {
          for (let i = 0; i < 4; i++) {
            const state = getAnswerOptionState({
              optionIndex: i,
              selectedIndices: [pos.correctIndex],
              isRevealed: true,
              correctAnswers: [pos.correctIndex],
              hasSubmitted: true,
              isSubmitting: false,
              isLocked: true,
              isExpired: false,
              isServerConfirmedCorrect: true,
            });

            if (i === pos.correctIndex) {
              expect(state).toBe('CORRECT');
            } else {
              expect(state).toBe('EXPIRED');
            }
          }
        });
      }
    });

    describe('Multi-Select Questions (Multiple Correct Answers)', () => {
      it('marks both selected correct options as CORRECT', () => {
        const correctAnswers = [0, 2];
        const selectedIndices = [0, 2];

        const states = [0, 1, 2, 3].map(i =>
          getAnswerOptionState({
            optionIndex: i,
            selectedIndices,
            isRevealed: true,
            correctAnswers,
            hasSubmitted: true,
            isSubmitting: false,
            isLocked: true,
            isExpired: false,
            isServerConfirmedCorrect: true,
          })
        );

        expect(states[0]).toBe('CORRECT');
        expect(states[1]).toBe('EXPIRED');
        expect(states[2]).toBe('CORRECT');
        expect(states[3]).toBe('EXPIRED');
      });

      it('marks unselected correct option as CORRECT, selected incorrect option as INCORRECT', () => {
        const correctAnswers = [0, 2];
        const selectedIndices = [0, 1]; // Player chose 0 and 1; 1 is wrong, 2 was missed

        const states = [0, 1, 2, 3].map(i =>
          getAnswerOptionState({
            optionIndex: i,
            selectedIndices,
            isRevealed: true,
            correctAnswers,
            hasSubmitted: true,
            isSubmitting: false,
            isLocked: true,
            isExpired: false,
            isServerConfirmedCorrect: false,
          })
        );

        expect(states[0]).toBe('CORRECT');
        expect(states[1]).toBe('INCORRECT');
        expect(states[2]).toBe('CORRECT');
        expect(states[3]).toBe('EXPIRED');
      });
    });

    describe('Fallback & Latency Immunity', () => {
      it('never flags a confirmed correct selection as INCORRECT even if correctAnswers array is temporarily empty', () => {
        const state = getAnswerOptionState({
          optionIndex: 0,
          selectedIndices: [0],
          isRevealed: true,
          correctAnswers: [], // Empty due to network transit or delay
          hasSubmitted: true,
          isSubmitting: false,
          isLocked: true,
          isExpired: false,
          isServerConfirmedCorrect: true, // Authoritative confirmation from submit-answer response
        });

        expect(state).toBe('CORRECT');
      });
    });

    describe('Pre-Reveal Visual States', () => {
      it('correctly transitions through DEFAULT -> SELECTED -> SUBMITTING -> SUBMITTED', () => {
        const defaultState = getAnswerOptionState({
          optionIndex: 0,
          selectedIndices: [],
          isRevealed: false,
          hasSubmitted: false,
          isSubmitting: false,
          isLocked: false,
          isExpired: false,
        });
        expect(defaultState).toBe('DEFAULT');

        const selectedState = getAnswerOptionState({
          optionIndex: 0,
          selectedIndices: [0],
          isRevealed: false,
          hasSubmitted: false,
          isSubmitting: false,
          isLocked: false,
          isExpired: false,
        });
        expect(selectedState).toBe('SELECTED');

        const submittingSelected = getAnswerOptionState({
          optionIndex: 0,
          selectedIndices: [0],
          isRevealed: false,
          hasSubmitted: false,
          isSubmitting: true,
          isLocked: false,
          isExpired: false,
        });
        expect(submittingSelected).toBe('SUBMITTING');

        const submittingUnselected = getAnswerOptionState({
          optionIndex: 1,
          selectedIndices: [0],
          isRevealed: false,
          hasSubmitted: false,
          isSubmitting: true,
          isLocked: false,
          isExpired: false,
        });
        expect(submittingUnselected).toBe('LOCKED');

        const submittedSelected = getAnswerOptionState({
          optionIndex: 0,
          selectedIndices: [0],
          isRevealed: false,
          hasSubmitted: true,
          isSubmitting: false,
          isLocked: true,
          isExpired: false,
        });
        expect(submittedSelected).toBe('SUBMITTED');
      });
    });
  });
});
