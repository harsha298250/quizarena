/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Question } from '../types/quiz';
import { speechService, buildQuestionSpeechScript } from '../lib/speechService';

export interface UseQuestionSpeechOptions {
  question: Partial<Question> | null | undefined;
  questionIndex: number;
  gameStatus: string;
  autoRead: boolean;
  hiddenOptionIndices?: number[];
  initialRate?: number;
}

export function useQuestionSpeech({
  question,
  questionIndex,
  gameStatus,
  autoRead,
  hiddenOptionIndices = [],
  initialRate,
}: UseQuestionSpeechOptions) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speechRate, setSpeechRateState] = useState<number>(() => {
    return initialRate || speechService.getRate();
  });

  // Track the question index that was already auto-read to prevent re-reading on Firestore snapshots
  const lastAutoReadQuestionRef = useRef<number | null>(null);

  // Sync speech rate change
  const setSpeechRate = useCallback((rate: number) => {
    setSpeechRateState(rate);
    speechService.setRate(rate);
  }, []);

  // Stop speech
  const stop = useCallback(() => {
    speechService.stop();
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  // Pause speech
  const pause = useCallback(() => {
    speechService.pause();
    setIsPaused(true);
  }, []);

  // Resume speech
  const resume = useCallback(() => {
    speechService.resume();
    setIsPaused(false);
  }, []);

  // Speak the current question text & visible options
  const speakCurrentQuestion = useCallback(() => {
    if (!question || gameStatus !== 'question_active') {
      return;
    }

    const script = buildQuestionSpeechScript(question, hiddenOptionIndices);
    if (!script) return;

    speechService.speak(script, {
      rate: speechRate,
      onStart: () => {
        setIsSpeaking(true);
        setIsPaused(false);
      },
      onEnd: () => {
        setIsSpeaking(false);
        setIsPaused(false);
      },
      onError: () => {
        setIsSpeaking(false);
        setIsPaused(false);
      },
    });
  }, [question, gameStatus, hiddenOptionIndices, speechRate]);

  // Handle auto-read when a new question becomes active
  useEffect(() => {
    // If not in active question round, cancel speech immediately
    if (gameStatus !== 'question_active') {
      stop();
      return;
    }

    // If new question index and autoRead is true and hasn't been read yet
    if (autoRead && question && lastAutoReadQuestionRef.current !== questionIndex) {
      lastAutoReadQuestionRef.current = questionIndex;
      speakCurrentQuestion();
    }
  }, [gameStatus, questionIndex, autoRead, question, speakCurrentQuestion, stop]);

  // Cancel speech on unmount or question advance
  useEffect(() => {
    return () => {
      speechService.stop();
    };
  }, [questionIndex]);

  return {
    isSpeaking,
    isPaused,
    speechRate,
    setSpeechRate,
    speakCurrentQuestion,
    pause,
    resume,
    stop,
    supported: speechService.isSupported(),
  };
}
