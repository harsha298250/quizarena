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
  const isSecure = game.settings.secureMode !== false && game.settings.antiCheatDetection !== false;
  const requireFullscreen = Boolean(game.settings.requireFullscreen);
  const lockOnStrike3 = game.settings.lockAnswerOnStrike3 !== false;
  const strike2Penalty = game.settings.strike2PointPenalty ?? 50;

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

  // Reset question lock and check state on new question
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
      // Debounce events of the same type within 3.5 seconds
      if (now - last < 3500) return;
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

  // Helper to handle strike escalation
  const registerStrike = useCallback(
    (reason: string, eventType: 'tab_switch' | 'window_blur' | 'fullscreen_exit') => {
      if (!isSecure || hasSubmitted || game.status !== 'question_active') return;

      const now = Date.now();
      const last = lastEventTimeRef.current['any_strike'] || 0;
      if (now - last < 3000) return;
      lastEventTimeRef.current['any_strike'] = now;

      const nextStrike = strikesRef.current + 1;
      setStrikes(nextStrike);

      // (a) Escalating warnings:
      // Strike 1: friendly warning modal
      // Strike 2: stronger warning with optional point penalty
      // Strike 3: flags to host and locks answering for that question
      if (nextStrike === 1) {
        sound.playWrong();
        sendIntegrityFlag(eventType, 'low', `Strike 1: ${reason}`);
        setWarningModal({
          open: true,
          strike: 1,
          title: 'Advisory Notice: Stay Focused in the Arena',
          message:
            'A tab switch or window blur was noticed. Please keep this browser window focused while answering. Note: All assistive tools and accommodations are fully allowed, and flags are reviewed by your host.',
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
          title: 'Second Advisory Warning: Distraction Detected',
          message: `You have switched away from the arena a second time. ${
            strike2Penalty > 0 ? `An advisory penalty of -${strike2Penalty} points may apply.` : ''
          } Please stay focused on the question. Accommodations and screen readers remain fully permitted.`,
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
          title: 'Strike 3: Flagged to Host',
          message:
            'Repeated window switches have been recorded and flagged in the host audit panel. Answering for this question has been locked. Remember: everything is advisory and your host reviews all records.',
          isLocked: lockOnStrike3,
        });
      }
    },
    [isSecure, hasSubmitted, game.status, sendIntegrityFlag, strike2Penalty, onApplyPenalty, lockOnStrike3, onQuestionLock]
  );

  // (a) Tab Switch, Window Blur & Fullscreen Exit Listeners
  useEffect(() => {
    if (!isSecure || game.status !== 'question_active') return;

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

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isSecure, game.status, hasSubmitted, requireFullscreen, registerStrike]);

  // (b) Suspicious-Environment Checks: webdriver, MutationObserver, devtools heuristic
  useEffect(() => {
    if (!isSecure) return;

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

    const devtoolsTimer = setInterval(checkDevtools, 8000);

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

              // Check if overlay covers the main quiz viewport
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
  }, [isSecure, game.status, hasSubmitted, sendIntegrityFlag]);

  // (c) Copy, Paste & Right-Click Disabling in Secure Mode
  useEffect(() => {
    if (!isSecure || game.settings.preventCopyPaste === false) return;

    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      sendIntegrityFlag('copy_paste_attempt', 'low', 'Copy attempt intercepted on assessment text');
    };

    const handleCut = (e: ClipboardEvent) => {
      e.preventDefault();
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      sendIntegrityFlag('copy_paste_attempt', 'low', 'Right-click context menu intercepted');
    };

    document.addEventListener('copy', handleCopy);
    document.addEventListener('cut', handleCut);
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('cut', handleCut);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [isSecure, game.settings.preventCopyPaste, sendIntegrityFlag]);

  const handlePasteAttempt = useCallback(
    (e?: React.ClipboardEvent | ClipboardEvent | React.SyntheticEvent) => {
      if (e && isSecure && game.settings.preventCopyPaste !== false) {
        e.preventDefault();
      }
      sendIntegrityFlag('copy_paste_attempt', 'low', 'Copy or paste attempted');
    },
    [isSecure, game.settings.preventCopyPaste, sendIntegrityFlag]
  );

  const requestFullscreen = async () => {
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
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
