/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { sound } from '../lib/sound';

export interface UseGlobalShortcutsOptions {
  onNavigate: (tabId: string) => void;
  onOpenCommandPalette: () => void;
  onOpenShortcutsHelp: () => void;
  userRole?: 'host' | 'student';
  isLiveGame?: boolean;
  enabled?: boolean;
}

export function isInputFocused(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as Partial<HTMLElement>;
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  if (typeof (el as HTMLElement).closest === 'function') {
    if ((el as HTMLElement).closest('[contenteditable="true"]')) return true;
  }
  return false;
}

export interface ShortcutHandlerContext {
  sequencePending: boolean;
  setSequencePending: (val: boolean) => void;
  resetTimer: () => void;
  startTimer: (ms: number, onExpire: () => void) => void;
}

export function handleKeyboardShortcut(
  e: {
    target: EventTarget | null;
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    preventDefault?: () => void;
  },
  options: UseGlobalShortcutsOptions,
  ctx: ShortcutHandlerContext
): boolean {
  const {
    onNavigate,
    onOpenCommandPalette,
    onOpenShortcutsHelp,
    userRole = 'host',
    isLiveGame = false,
  } = options;

  // 1. Guard against firing inside input, textarea, select, or contenteditable
  if (isInputFocused(e.target)) {
    return false;
  }

  // 2. Command Palette (Ctrl+K or Cmd+K) - allowed everywhere except active live match
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    if (!isLiveGame) {
      e.preventDefault?.();
      onOpenCommandPalette();
      return true;
    }
    return false;
  }

  // 3. If in active live player game, disable all navigation & help shortcuts
  // so keys 1-4 and Enter operate purely in PlayerArena without interference
  if (isLiveGame) {
    return false;
  }

  // 4. Help Modal Trigger: '?' (Shift + '/')
  if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
    e.preventDefault?.();
    sound.playClick();
    onOpenShortcutsHelp();
    return true;
  }

  // 5. Two-key sequence handling ('G' then letter)
  const key = e.key.toLowerCase();
  const hasModifiers = Boolean(e.ctrlKey || e.metaKey || e.altKey);

  if (!hasModifiers && ctx.sequencePending) {
    // Second key received
    ctx.resetTimer();
    ctx.setSequencePending(false);

    let targetTab: string | null = null;
    switch (key) {
      case 'd':
        targetTab = userRole === 'host' ? 'host_dashboard' : 'student_dashboard';
        break;
      case 'a':
        targetTab = 'arena';
        break;
      case 's':
        targetTab = 'builder';
        break;
      case 'i':
        targetTab = 'ai';
        break;
      case 't':
        targetTab = 'competitions';
        break;
      case 'l':
        targetTab = 'analytics';
        break;
      case 'c':
        targetTab = 'certificates';
        break;
      case 'o':
        targetTab = 'outbox';
        break;
      default:
        targetTab = null;
    }

    if (targetTab) {
      e.preventDefault?.();
      sound.playClick();
      onNavigate(targetTab);
      return true;
    }
    return false;
  }

  // First key: 'g' or 'G' without modifier keys
  if (!hasModifiers && key === 'g') {
    e.preventDefault?.();
    ctx.setSequencePending(true);
    ctx.resetTimer();
    ctx.startTimer(1200, () => {
      ctx.setSequencePending(false);
    });
    return true;
  }

  return false;
}

export function useGlobalShortcuts(options: UseGlobalShortcutsOptions) {
  const { enabled = true } = options;
  const [sequencePending, setSequencePending] = useState(false);
  const sequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const ctx: ShortcutHandlerContext = {
      sequencePending,
      setSequencePending,
      resetTimer: () => {
        if (sequenceTimerRef.current) {
          clearTimeout(sequenceTimerRef.current);
          sequenceTimerRef.current = null;
        }
      },
      startTimer: (ms, onExpire) => {
        if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
        sequenceTimerRef.current = setTimeout(() => {
          onExpire();
          sequenceTimerRef.current = null;
        }, ms);
      },
    };

    const onKeyDown = (e: KeyboardEvent) => {
      handleKeyboardShortcut(e, options, ctx);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      ctx.resetTimer();
    };
  }, [
    enabled,
    options.isLiveGame,
    options.onNavigate,
    options.onOpenCommandPalette,
    options.onOpenShortcutsHelp,
    options.userRole,
    sequencePending,
  ]);

  return { sequencePending };
}
