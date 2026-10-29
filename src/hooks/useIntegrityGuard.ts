/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { GameSession, Player, IntegrityFlag } from '../types/quiz';
import { GameEngine } from '../services/gameEngine';
import { sound } from '../lib/sound';

export interface IntegrityWarningModalState {
  open: boolean;
  strike: number;
  title: string;
  message: string;
  penaltyPoints?: number;
  isLocked?: boolean;
}

export interface UseIntegrityGuardProps {
  game: GameSession;
  player: Player;
  currentQuestionIndex: number;
  hasSubmitted: boolean;
  onApplyPenalty?: (points: number) => void;
  onQuestionLock?: () => void;
}

export function useIntegrityGuard({
  game,
  player,
  currentQuestionIndex,
  hasSubmitted,
  onApplyPenalty,
  onQuestionLock,
}: UseIntegrityGuardProps) {
  // Strict Secure Mode is permanent and always on (no host or player opt-out)
  const isSecure = true;
  const requireFullscreen = true;
  const lockOnStrike3 = true;
  const strike2Penalty = game.settings?.strike2PointPenalty ?? 50;

  const [strikes, setStrikes] = useState<number>(player.strikes || 0);
  const [warningModal, setWarningModal] = useState<IntegrityWarningModalState | null>(null);
  const [isQuestionLocked, setIsQuestionLocked] = useState<boolean>(false);
  const [blockedByExtension, setBlockedByExtension] = useState<boolean>(false);
  const [extensionReason, setExtensionReason] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );

  const lastEventTimeRef = useRef<Record<string, number>>({});
  const strikesRef = useRef<number>(strikes);
  strikesRef.current = strikes;

  // Reset question lock state on each new question
  useEffect(() => {
    setIsQuestionLocked(false);
  }, [currentQuestionIndex]);

  const sendIntegrityFlag = useCallback(
    (
      type: IntegrityFlag['type'],
      severity: IntegrityFlag['severity'],
      reason: string
    ) => {
      const now = Date.now();
      const last = lastEventTimeRef.current[type] || 0;
      // Instantaneous dispatch: deduplicate only exact duplicate events within 150ms
      if (now - last < 150) return;
      lastEventTimeRef.current[type] = now;

      const flag: IntegrityFlag = {
        id: `flag_${now}_${Math.random().toString(36).substring(2, 7)}`,
        playerId: player.id,
        playerNickname: player.nickname,
        type,
        severity,
        reason,
        timestamp: new Date().toISOString(),
        questionIndex: currentQuestionIndex,
      };

      GameEngine.recordFlag(game.id, flag).catch(err => {
        console.warn('[IntegrityGuard] Failed to record flag:', err);
      });
    },
    [game.id, player.id, player.nickname, currentQuestionIndex]
  );

  // Helper to handle 3-strike escalation synchronously (< 300ms)
  const registerStrike = useCallback(
    (reason: string, eventType: 'tab_switch' | 'window_blur' | 'fullscreen_exit') => {
      if (hasSubmitted || game.status !== 'question_active') return;

      const now = Date.now();
      const last = lastEventTimeRef.current['any_strike'] || 0;
      // Fast deduplication window (250ms) to ensure instantaneous < 300ms reaction
      if (now - last < 250) return;
      lastEventTimeRef.current['any_strike'] = now;

      const nextStrike = strikesRef.current + 1;
      setStrikes(nextStrike);

      // (c) 3-Strike Escalation:
      // Strike 1: friendly warning modal
      // Strike 2: stronger warning with -50 point penalty
      // Strike 3: locks answering for that question and flags to host audit panel
      if (nextStrike === 1) {
        sound.playWrong();
        sendIntegrityFlag(eventType, 'low', `Strike 1: ${reason}`);
        setWarningModal({
          open: true,
          strike: 1,
          title: 'Advisory Notice: Window Focus Shifted',
          message:
            'A tab switch or window focus loss was noticed. Please keep this assessment window focused while answering. Note: All assistive tools and accommodations are fully allowed, and flags are reviewed by your host.',
        });
      } else if (nextStrike === 2) {
        sound.playWrong();
        sendIntegrityFlag(eventType, 'medium', `Strike 2: ${reason}`);

        if (strike2Penalty > 0 && onApplyPenalty) {
          onApplyPenalty(strike2Penalty);
        }

        setWarningModal({
          open: true,
          strike: 2,
          title: 'Second Advisory Warning: Focus Loss Detected',
          message: `You have switched away from the arena a second time. An advisory penalty of -${strike2Penalty} points has been applied. Please stay focused on the question. Screen readers and approved accommodations remain fully permitted.`,
          penaltyPoints: strike2Penalty,
        });
      } else {
        // Strike 3+
        sound.playWrong();
        sendIntegrityFlag(eventType, 'high', `Strike 3 (Final): ${reason}`);

        if (lockOnStrike3) {
          setIsQuestionLocked(true);
          onQuestionLock?.();
        }

        setWarningModal({
          open: true,
          strike: nextStrike,
          title: 'Strike 3: Locked & Flagged to Host',
          message:
            'Repeated window switches have been recorded and flagged live in the host audit panel. Answering for this question has been locked. Remember: all records are advisory and your host reviews all flags.',
          isLocked: lockOnStrike3,
        });
      }
    },
    [hasSubmitted, game.status, sendIntegrityFlag, strike2Penalty, onApplyPenalty, lockOnStrike3, onQuestionLock]
  );

  // (a) Instantaneous event listeners: visibilitychange, blur, fullscreenchange
  useEffect(() => {
    if (game.status !== 'question_active') return;

    const handleVisibilityChange = () => {
      if (document.hidden && !hasSubmitted) {
        registerStrike('Switched browser tab or minimized window', 'tab_switch');
      }
    };

    const handleBlur = () => {
      if (!hasSubmitted && document.activeElement?.tagName !== 'IFRAME') {
        registerStrike('Window lost focus to another application', 'window_blur');
      }
    };

    const handleFullscreenChange = () => {
      const isNowFullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen(isNowFullscreen);

      if (requireFullscreen && !isNowFullscreen && !hasSubmitted) {
        registerStrike('Exited full-screen arena mode', 'fullscreen_exit');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange, { passive: true });
    window.addEventListener('blur', handleBlur, { passive: true });
    document.addEventListener('fullscreenchange', handleFullscreenChange, { passive: true });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [game.status, hasSubmitted, requireFullscreen, registerStrike]);

  // (e) Multi-monitor check
  useEffect(() => {
    if (game.status !== 'question_active' || hasSubmitted) return;

    const checkMultiMonitor = () => {
      try {
        const isExtended = Boolean((window.screen as any)?.isExtended);
        const hasSpanning =
          window.screenLeft < -20 ||
          window.screenLeft > window.screen.width + 20 ||
          window.screen.availWidth > window.screen.width * 1.5;

        if (isExtended || hasSpanning) {
          sendIntegrityFlag(
            'multi_monitor' as any,
            'medium',
            'Multiple active displays or window spanning across monitors detected'
          );
        }
      } catch {}
    };

    checkMultiMonitor();
    const multiMonitorTimer = setInterval(checkMultiMonitor, 10000);

    return () => clearInterval(multiMonitorTimer);
  }, [game.status, hasSubmitted, sendIntegrityFlag]);

  // (f) Suspicious-environment checks: navigator.webdriver, MutationObserver, devtools heuristic
  useEffect(() => {
    // 1. navigator.webdriver check
    if (typeof navigator !== 'undefined' && (navigator as any).webdriver) {
      sendIntegrityFlag(
        'webdriver_detected',
        'high',
        'Automated testing environment detected (navigator.webdriver = true)'
      );
    }

    // 2. Devtools open heuristic
    const checkDevtools = () => {
      const threshold = 160;
      const widthDiff = window.outerWidth - window.innerWidth > threshold;
      const heightDiff = window.outerHeight - window.innerHeight > threshold;
      if ((widthDiff || heightDiff) && game.status === 'question_active' && !hasSubmitted) {
        sendIntegrityFlag(
          'devtools_open',
          'medium',
          'Heuristic developer tools inspection window detected'
        );
      }
    };

    const devtoolsTimer = setInterval(checkDevtools, 6000);

    // 3. MutationObserver for injected extensions
    let observer: MutationObserver | null = null;
    try {
      observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node instanceof HTMLElement) {
              const html = node.outerHTML || '';
              const isExtensionRef =
                html.includes('chrome-extension://') ||
                html.includes('moz-extension://') ||
                node.getAttribute('data-extension-id') ||
                (node.className && typeof node.className === 'string' && node.className.includes('quiz-solver'));

              const rect = node.getBoundingClientRect?.() || { width: 0, height: 0 };
              const isSuspiciousOverlay =
                node.style.position === 'fixed' &&
                (parseInt(node.style.zIndex || '0', 10) >= 9999 || rect.width > 250);

              if (isExtensionRef || isSuspiciousOverlay) {
                sendIntegrityFlag(
                  'extension_injection',
                  'high',
                  `Injected browser extension node detected: <${node.tagName.toLowerCase()}>`
                );

                // Strong signal: block interaction and prompt reload
                if (isExtensionRef) {
                  setBlockedByExtension(true);
                  setExtensionReason(
                    'An active browser extension is modifying this assessment page. Please disable extensions for this site and reload.'
                  );
                }
              }
            }
          }
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    } catch (e) {
      console.warn('[IntegrityGuard] MutationObserver unavailable:', e);
    }

    return () => {
      clearInterval(devtoolsTimer);
      observer?.disconnect();
    };
  }, [game.status, hasSubmitted, sendIntegrityFlag]);

  // (d) Prevent copy, paste, cut, context menu, text selection, and print
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      sendIntegrityFlag('copy_paste_attempt', 'low', 'Copy attempt intercepted on assessment text');
    };

    const handleCut = (e: ClipboardEvent) => {
      e.preventDefault();
      sendIntegrityFlag('copy_paste_attempt', 'low', 'Cut attempt intercepted');
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      sendIntegrityFlag('copy_paste_attempt', 'low', 'Right-click context menu intercepted');
    };

    const handleSelectStart = (e: Event) => {
      const target = e.target as HTMLElement | null;
      // Allow selection inside inputs / textareas for type_answer
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      // Block Ctrl+P / Cmd+P (Print)
      if ((e.ctrlKey || e.metaKey) && key === 'p') {
        e.preventDefault();
        sendIntegrityFlag('print_attempt' as any, 'medium', 'Print shortcut (Ctrl+P) intercepted');
      }
      // Block Ctrl+U (View Source)
      if ((e.ctrlKey || e.metaKey) && key === 'u') {
        e.preventDefault();
        sendIntegrityFlag('devtools_open', 'low', 'View source shortcut (Ctrl+U) intercepted');
      }
      // Block F12
      if (e.key === 'F12') {
        e.preventDefault();
        sendIntegrityFlag('devtools_open', 'low', 'F12 developer tools shortcut intercepted');
      }
    };

    const handleBeforePrint = (e: Event) => {
      e.preventDefault();
      sendIntegrityFlag('print_attempt' as any, 'medium', 'Browser print dialogue intercepted');
    };

    document.addEventListener('copy', handleCopy);
    document.addEventListener('cut', handleCut);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('selectstart', handleSelectStart);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('beforeprint', handleBeforePrint);

    return () => {
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('cut', handleCut);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('selectstart', handleSelectStart);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('beforeprint', handleBeforePrint);
    };
  }, [sendIntegrityFlag]);

  const handlePasteAttempt = useCallback(
    (e?: React.ClipboardEvent | ClipboardEvent | React.SyntheticEvent) => {
      if (e) {
        e.preventDefault();
      }
      sendIntegrityFlag('copy_paste_attempt', 'low', 'Paste attempt intercepted');
    },
    [sendIntegrityFlag]
  );

  const requestFullscreen = async () => {
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch (err) {
      console.warn('Fullscreen request rejected by user/browser:', err);
    }
  };

  const dismissWarningModal = () => {
    setWarningModal(null);
  };

  return {
    strikes,
    isQuestionLocked,
    warningModal,
    dismissWarningModal,
    blockedByExtension,
    extensionReason,
    isFullscreen,
    requestFullscreen,
    requireFullscreen,
    isSecure,
    handlePasteAttempt,
  };
}
