/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Question } from '../types/quiz';

/**
 * Builds a clean, accessible speech transcript strictly containing the question text
 * and visible options.
 *
 * Excludes:
 * - Answer keys, correct answers, accepted text answers, and explanations.
 * - Question metadata (points, timeLimit, topicTag, bloomLevel, courseOutcomeTag).
 * - UI watermarks, timer countdown values, student scores, and streaks.
 */
export function buildQuestionSpeechScript(
  question: Partial<Question> | null | undefined,
  hiddenOptionIndices: number[] = []
): string {
  if (!question || !question.text) {
    return '';
  }

  // Strip HTML tags and markdown formatting for natural reading
  const cleanQuestionText = question.text
    .replace(/<[^>]*>/g, '')
    .replace(/[*_#`~]/g, '')
    .trim();

  let script = `Question: ${cleanQuestionText}. `;

  // Type-in answer questions do not speak options
  if (question.type === 'type_answer') {
    return script.trim();
  }

  // Speak visible options
  if (Array.isArray(question.options) && question.options.length > 0) {
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    question.options.forEach((opt, idx) => {
      if (hiddenOptionIndices.includes(idx)) {
        return; // Skip options hidden by accommodations
      }
      const label = letters[idx] || `Option ${idx + 1}`;
      const cleanOption = String(opt || '')
        .replace(/<[^>]*>/g, '')
        .replace(/[*_#`~]/g, '')
        .trim();
      script += `Option ${label}: ${cleanOption}. `;
    });
  }

  return script.trim();
}

/**
 * Speech Controller for Web Speech API
 */
class SpeechController {
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private isSpeaking = false;
  private isPaused = false;
  private currentRate = 1.0;
  private preferredVoiceUri = '';

  constructor() {
    if (typeof window !== 'undefined' && 'localStorage' in window) {
      try {
        const savedRate = localStorage.getItem('quizarena_speech_rate');
        if (savedRate) {
          const parsed = parseFloat(savedRate);
          if (parsed >= 0.5 && parsed <= 2.0) {
            this.currentRate = parsed;
          }
        }
        const savedVoice = localStorage.getItem('quizarena_speech_voice');
        if (savedVoice) {
          this.preferredVoiceUri = savedVoice;
        }
      } catch {
        // LocalStorage fallback
      }
    }
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  public getVoices(): SpeechSynthesisVoice[] {
    if (!this.isSupported()) return [];
    return window.speechSynthesis.getVoices();
  }

  public getEnglishVoices(): SpeechSynthesisVoice[] {
    const all = this.getVoices();
    const en = all.filter(v => v.lang.toLowerCase().startsWith('en'));
    return en.length > 0 ? en : all;
  }

  public getPreferredVoice(): SpeechSynthesisVoice | null {
    const voices = this.getVoices();
    if (voices.length === 0) return null;

    if (this.preferredVoiceUri) {
      const match = voices.find(v => v.voiceURI === this.preferredVoiceUri);
      if (match) return match;
    }

    // Default to first English voice or first system voice
    const en = voices.find(v => v.lang.toLowerCase().startsWith('en'));
    return en || voices[0] || null;
  }

  public setPreferredVoiceUri(voiceUri: string): void {
    this.preferredVoiceUri = voiceUri;
    try {
      localStorage.setItem('quizarena_speech_voice', voiceUri);
    } catch {
      // LocalStorage fallback
    }
  }

  public getRate(): number {
    return this.currentRate;
  }

  public setRate(rate: number): void {
    if (rate >= 0.5 && rate <= 2.0) {
      this.currentRate = rate;
      try {
        localStorage.setItem('quizarena_speech_rate', rate.toString());
      } catch {
        // LocalStorage fallback
      }
    }
  }

  public stop(): void {
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore
    }
    this.currentUtterance = null;
    this.isSpeaking = false;
    this.isPaused = false;
  }

  public pause(): void {
    if (!this.isSupported()) return;
    try {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        this.isPaused = true;
      }
    } catch {
      // Ignore
    }
  }

  public resume(): void {
    if (!this.isSupported()) return;
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        this.isPaused = false;
      }
    } catch {
      // Ignore
    }
  }

  public speak(
    text: string,
    options?: {
      rate?: number;
      voice?: SpeechSynthesisVoice;
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: any) => void;
    }
  ): void {
    if (!this.isSupported() || !text.trim()) {
      return;
    }

    // Cancel any previous utterance to avoid queue buildup
    this.stop();

    const utterance = new SpeechSynthesisUtterance(text);
    const rate = options?.rate ?? this.currentRate;
    utterance.rate = Math.max(0.5, Math.min(2.0, rate));

    const voice = options?.voice ?? this.getPreferredVoice();
    if (voice) {
      utterance.voice = voice;
    }

    utterance.onstart = () => {
      this.isSpeaking = true;
      this.isPaused = false;
      options?.onStart?.();
    };

    utterance.onend = () => {
      this.isSpeaking = false;
      this.isPaused = false;
      this.currentUtterance = null;
      options?.onEnd?.();
    };

    utterance.onerror = (err) => {
      this.isSpeaking = false;
      this.isPaused = false;
      this.currentUtterance = null;
      options?.onError?.(err);
    };

    this.currentUtterance = utterance;
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      this.isSpeaking = false;
      this.isPaused = false;
      this.currentUtterance = null;
    }
  }

  public getState() {
    return {
      isSpeaking: this.isSpeaking,
      isPaused: this.isPaused,
      rate: this.currentRate,
      supported: this.isSupported(),
    };
  }
}

export const speechService = new SpeechController();
