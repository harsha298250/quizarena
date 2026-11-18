/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { speechService } from '../lib/speechService';
import { sound } from '../lib/sound';

export type TextSizeMode = 'normal' | 'large' | 'xlarge';

export interface AccessibilitySettings {
  textSize: TextSizeMode;
  dyslexiaFont: boolean;
  readAloud: boolean;
  speechRate: number;
}

const STORAGE_KEY = 'quizarena_accessibility_settings';

const DEFAULT_SETTINGS: AccessibilitySettings = {
  textSize: 'normal',
  dyslexiaFont: false,
  readAloud: false,
  speechRate: 1.0,
};

function readInitialSettings(): AccessibilitySettings {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      textSize: ['normal', 'large', 'xlarge'].includes(parsed.textSize) ? parsed.textSize : 'normal',
      dyslexiaFont: Boolean(parsed.dyslexiaFont),
      readAloud: Boolean(parsed.readAloud),
      speechRate: typeof parsed.speechRate === 'number' && parsed.speechRate >= 0.5 && parsed.speechRate <= 2.0
        ? parsed.speechRate
        : 1.0,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function applyDomSettings(settings: AccessibilitySettings) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  // Apply text size attribute (normal: 100%, large: 115%, xlarge: 130%)
  root.setAttribute('data-text-size', settings.textSize);

  // Apply dyslexia attribute and body class
  root.setAttribute('data-dyslexia', settings.dyslexiaFont ? 'true' : 'false');
  if (settings.dyslexiaFont) {
    document.body.classList.add('dyslexia-font');
  } else {
    document.body.classList.remove('dyslexia-font');
  }

  // Sync speech service rate
  try {
    speechService.setRate(settings.speechRate);
  } catch {}
}

export function useAccessibilitySettings() {
  const [settings, setSettingsState] = useState<AccessibilitySettings>(readInitialSettings);

  // Synchronize DOM on initial mount & setting changes
  useEffect(() => {
    applyDomSettings(settings);
  }, [settings]);

  // Persist and apply updates
  const updateSettings = useCallback((updates: Partial<AccessibilitySettings>) => {
    setSettingsState(prev => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      applyDomSettings(next);
      return next;
    });
  }, []);

  const setTextSize = useCallback((textSize: TextSizeMode) => {
    updateSettings({ textSize });
  }, [updateSettings]);

  const setDyslexiaFont = useCallback((dyslexiaFont: boolean) => {
    updateSettings({ dyslexiaFont });
  }, [updateSettings]);

  const setReadAloud = useCallback((readAloud: boolean) => {
    updateSettings({ readAloud });
  }, [updateSettings]);

  const setSpeechRate = useCallback((speechRate: number) => {
    updateSettings({ speechRate });
  }, [updateSettings]);

  const resetAccessibilitySettings = useCallback(() => {
    sound.playClick();
    setSettingsState(DEFAULT_SETTINGS);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
    } catch {}
    applyDomSettings(DEFAULT_SETTINGS);
  }, []);

  return {
    settings,
    textSize: settings.textSize,
    dyslexiaFont: settings.dyslexiaFont,
    readAloud: settings.readAloud,
    speechRate: settings.speechRate,
    setTextSize,
    setDyslexiaFont,
    setReadAloud,
    setSpeechRate,
    resetAccessibilitySettings,
  };
}
