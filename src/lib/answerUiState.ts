/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type AnswerOptionVisualState =
  | 'DEFAULT'
  | 'SELECTED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'LOCKED'
  | 'CORRECT'
  | 'INCORRECT'
  | 'EXPIRED';

export interface OptionStateInput {
  optionIndex: number;
  selectedIndices: number[];
  isRevealed: boolean;
  correctAnswers?: number[];
  hasSubmitted: boolean;
  isSubmitting: boolean;
  isLocked: boolean;
  isExpired: boolean;
}

/**
 * Determines the explicit visual state for a multiple-choice / multi-select option.
 * Strictly respects the 8-state model:
 * DEFAULT -> SELECTED -> SUBMITTING -> SUBMITTED -> LOCKED -> CORRECT -> INCORRECT -> EXPIRED
 */
export function getAnswerOptionState(input: OptionStateInput): AnswerOptionVisualState {
  const {
    optionIndex,
    selectedIndices,
    isRevealed,
    correctAnswers = [],
    hasSubmitted,
    isSubmitting,
    isLocked,
    isExpired,
  } = input;

  const isSelected = selectedIndices.includes(optionIndex);
  const isCorrect = correctAnswers.includes(optionIndex);

  // When answer is revealed to participants
  if (isRevealed) {
    if (isCorrect) {
      return 'CORRECT';
    }
    if (isSelected && !isCorrect) {
      return 'INCORRECT';
    }
    return 'EXPIRED';
  }

  // When time has expired for active question
  if (isExpired && !hasSubmitted) {
    return 'EXPIRED';
  }

  // When currently transmitting answer to server
  if (isSubmitting) {
    return isSelected ? 'SUBMITTING' : 'LOCKED';
  }

  // When student has successfully locked in their answer
  if (hasSubmitted) {
    return isSelected ? 'SUBMITTED' : 'LOCKED';
  }

  // When student is locked out (e.g. anti-cheat strike, disabled)
  if (isLocked) {
    return isSelected ? 'SUBMITTED' : 'LOCKED';
  }

  // When option is selected before submission
  if (isSelected) {
    return 'SELECTED';
  }

  // Default clickable state
  return 'DEFAULT';
}
