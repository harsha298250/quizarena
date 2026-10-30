/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { GameSession, Player, IntegrityFlag } from '../types/quiz';
import { GameEngine } from '../services/gameEngine';
import { sound } from '../lib/sound';
import { scanEnvironmentForExtensions, isExemptNode, KNOWN_AI_EXTENSIONS } from '../lib/extensionDetector';

export interface IntegrityWarningModalState {
  open: boolean;
  strike: number;
  title: string;
  message: string;
  penaltyPoints?: number;
  isLocked?: boolean;
  isTerminated?: boolean;
}

export interface UseIntegrityGuardProps {
  game: GameSession;
  player: Player;
  currentQuestionIndex: number;
  hasSubmitted: boolean;
  onApplyPenalty?: (points: number) => void;
  onQuestionLock?: () => void;
}

const MAX_STRIKES_BEFORE_TERMINATION = 6;

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
  const strike2Penalty = game.settings?.strike2PointPenalty ?? 50;

  const [strikes, setStrikes] = useState<number>(player.strikes || 0);
  const [isTerminated, setIsTerminated] = useState<boolean>(
    Boolean(player.isTerminated || player.status === 'terminated_integrity')
  );
  const [warningModal, setWarningModal] = useState<IntegrityWarningModalState | null>(null);
  const [isQuestionLocked, setIsQuestionLocked] = useState<boolean>(false);
  const [blockedByExtension, setBlockedByExtension] = useState<boolean>(false);
  const [extensionReason, setExtensionReason] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );
  const [fullscreenPaused, setFullscreenPaused] = useState<boolean>(false);

  const lastEventTimeRef = useRef<Record<string, number>>({});
  const strikesRef = useRef<number>(strikes);
  strikesRef.current = strikes;

  // Sync state if player was reinstated or updated by host
  useEffect(() => {
    if (player.strikes !== undefined && player.strikes !== strikesRef.current) {
      setStrikes(player.strikes);
    }
    const term = Boolean(player.isTerminated || player.status === 'terminated_integrity');
    setIsTerminated(term);
    if (!term && warningModal?.isTerminated) {
      setWarningModal(null);
    }
  }, [player.strikes, player.isTerminated, player.status]);

  // Reset per-question temporary locks when question advances
  useEffect(() => {
    if (!isTerminated) {
      setIsQuestionLocked(false);
    }
  }, [currentQuestionIndex, isTerminated]);

  const sendIntegrityFlag = useCallback(
    (
      type: IntegrityFlag['type'],
      severity: IntegrityFlag['severity'],
      reason: string
    ) => {
      const now = Date.now();
      const last = lastEventTimeRef.current[type] || 0;
      // Deduplicate rapid duplicate events of same type within 500ms
      if (now - last < 500) return;
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

  // Core Strike System with 500ms debounce and automatic termination at Strike 6
  const registerStrike = useCallback(
    (reason: string, eventType: 'tab_switch' | 'window_blur' | 'fullscreen_exit') => {
      if (hasSubmitted || game.status !== 'question_active' || isTerminated) return;

      const now = Date.now();
      const last = lastEventTimeRef.current['any_strike'] || 0;
      // 500ms debounce window so a single window-loss / blur counts as exactly ONE strike
      if (now - last < 500) return;
      lastEventTimeRef.current['any_strike'] = now;

      const nextStrike = strikesRef.current + 1;
      setStrikes(nextStrike);

      // Persist to server / Firestore immediately so refresh cannot wipe strikes
      const willTerminate = nextStrike >= MAX_STRIKES_BEFORE_TERMINATION;
      GameEngine.updatePlayerStrikes(game.id, player.id, nextStrike, reason, willTerminate);

      if (willTerminate) {
        // Strike 6: END quiz automatically, preserve score, mark Terminated - integrity
        setIsTerminated(true);
        setIsQuestionLocked(true);
        sound.playWrong();
        sendIntegrityFlag(eventType, 'high', `Strike 6: Quiz terminated automatically - ${reason}`);

        setWarningModal({
          open: true,
          strike: 6,
          title: 'Quiz Terminated - Integrity Shield',
          message:
            'Six focus/window loss violations were recorded on your session. Your quiz has been ended automatically. Your score earned so far has been preserved and logged on the server. Your host reviews all flags and can reinstate your session if this was an error.',
          isLocked: true,
          isTerminated: true,
        });
        return;
      }

      // Strikes 1 to 5: Escalating advisory warnings
      if (nextStrike === 1) {
        sound.playWrong();
        sendIntegrityFlag(eventType, 'low', `Strike 1 of 5: ${reason}`);
        setWarningModal({
          open: true,
          strike: 1,
          title: 'Strike 1 of 5: Window Focus Shifted',
          message:
            'A tab switch or window focus shift was detected. Please keep the quiz window focused during questions. Note: Assistive accommodations (screen readers, dyslexia tools) are strictly allowed and flags are reviewed by your host.',
        });
      } else if (nextStrike === 2) {
        sound.playWrong();
        sendIntegrityFlag(eventType, 'medium', `Strike 2 of 5: ${reason}`);
        if (strike2Penalty > 0 && onApplyPenalty) {
          onApplyPenalty(strike2Penalty);
        }
        setWarningModal({
          open: true,
          strike: 2,
          title: 'Strike 2 of 5: Focus Violation',
          message: `Second window switch detected. An advisory penalty of -${strike2Penalty} points has been logged. Please stay on this screen. Assistive tools remain fully permitted.`,
          penaltyPoints: strike2Penalty,
        });
      } else if (nextStrike === 3) {
        sound.playWrong();
        sendIntegrityFlag(eventType, 'high', `Strike 3 of 5: ${reason}`);
        setIsQuestionLocked(true);
        onQuestionLock?.();
        setWarningModal({
          open: true,
          strike: 3,
          title: 'Strike 3 of 5: Locked for this Question',
          message:
            'Third window switch recorded. Answering has been locked for this question and flagged live to your host. Play will resume on the next question.',
          isLocked: true,
        });
      } else if (nextStrike === 4) {
        sound.playWrong();
        sendIntegrityFlag(eventType, 'high', `Strike 4 of 5: ${reason}`);
        setWarningModal({
          open: true,
          strike: 4,
          title: 'Strike 4 of 5: Critical Warning',
          message:
            'Fourth violation recorded. You are two strikes away from automatic assessment termination. Please remain focused on the exam.',
        });
      } else if (nextStrike === 5) {
        sound.playWrong();
        sendIntegrityFlag(eventType, 'high', `Strike 5 of 5: Final Warning Before Termination`);
        setWarningModal({
          open: true,
          strike: 5,
          title: 'Strike 5 of 5: Final Warning',
          message:
            'One more window switch will permanently end your assessment. Keep this window focused and full screen.',
        });
      }
    },
    [hasSubmitted, game.status, isTerminated, game.id, player.id, sendIntegrityFlag, strike2Penalty, onApplyPenalty, onQuestionLock]
  );

  // Trigger blocking screen for detected extensions
  const triggerExtensionBlock = useCallback((reason: string, signalName?: string) => {
    setBlockedByExtension(true);
    setExtensionReason(reason);
    sendIntegrityFlag('extension_injection', 'high', `${signalName || 'extension_detected'}: ${reason}`);
    registerStrike(`Extension violation: ${signalName || 'injected_tool'}`, 'tab_switch');
  }, [sendIntegrityFlag, registerStrike]);

  // (1) Event Listeners: visibilitychange, blur, fullscreenchange
  useEffect(() => {
    if (game.status !== 'question_active' || isTerminated) return;

    const handleVisibilityChange = () => {
      if (document.hidden && !hasSubmitted) {
        registerStrike('Switched browser tab or minimized window', 'tab_switch');
      }
    };

    const handleBlur = () => {
      // Avoid false-positive if focus shifted into an allowed safe element
      if (!hasSubmitted && document.activeElement?.tagName !== 'IFRAME') {
        registerStrike('Window lost focus (Alt+Tab, window or desktop switch)', 'window_blur');
      }
    };

    const handleFullscreenChange = () => {
      const isNowFullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen(isNowFullscreen);

      if (!isNowFullscreen && !hasSubmitted) {
        setFullscreenPaused(true);
        registerStrike('Exited mandatory fullscreen arena mode', 'fullscreen_exit');
      } else {
        setFullscreenPaused(false);
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
  }, [game.status, hasSubmitted, isTerminated, registerStrike]);

  // (1b) 500 ms document.hasFocus() Polling
  useEffect(() => {
    if (game.status !== 'question_active' || hasSubmitted || isTerminated) return;

    const focusPollInterval = setInterval(() => {
      if (typeof document !== 'undefined' && typeof document.hasFocus === 'function') {
        if (!document.hasFocus() && !hasSubmitted) {
          registerStrike('Loss of document focus (500ms heartbeat poll)', 'window_blur');
        }
      }
    }, 500);

    return () => clearInterval(focusPollInterval);
  }, [game.status, hasSubmitted, isTerminated, registerStrike]);

  // (2) Continuous 1-Second Environment Scanner & MutationObserver
  useEffect(() => {
    if (game.status !== 'question_active' || hasSubmitted || isTerminated) return;

    // Check getDisplayMedia screen capture
    if (typeof navigator !== 'undefined' && navigator.mediaDevices && (navigator.mediaDevices as any).getDisplayMedia) {
      const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async function (...args: any[]) {
        triggerExtensionBlock('Screen capture attempted via getDisplayMedia', 'screen_capture');
        return originalGetDisplayMedia(...args);
      };
    }

    // 1-Second Continuous Environment Poller
    const scanInterval = setInterval(() => {
      const result = scanEnvironmentForExtensions();
      if (result.detected) {
        triggerExtensionBlock(result.reason || 'Unauthorized extension detected', result.signalName);
      } else if (blockedByExtension) {
        // Clean re-scan allows unblocking
        setBlockedByExtension(false);
        setExtensionReason('');
      }
    }, 1000);

    // Initial immediate scan
    const initialCheck = scanEnvironmentForExtensions();
    if (initialCheck.detected) {
      triggerExtensionBlock(initialCheck.reason || 'Unauthorized extension detected', initialCheck.signalName);
    }

    // MutationObserver to scan for dynamically injected nodes, iframes, overlays
    let observer: MutationObserver | null = null;
    try {
      observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node instanceof HTMLElement) {
              if (isExemptNode(node)) continue;

              const html = (node.outerHTML || '').toLowerCase();
              const isExtensionUri = html.includes('chrome-extension://') || html.includes('moz-extension://');
              const isKnownAIExtension = KNOWN_AI_EXTENSIONS.some(
                ext => html.includes(ext) || node.id.toLowerCase().includes(ext) || node.className.toLowerCase().includes(ext)
              );

              const style = window.getComputedStyle(node);
              const isFixedOverlay =
                style.position === 'fixed' &&
                (parseInt(style.zIndex || '0', 10) >= 999 || node.getBoundingClientRect().width > 300);

              if (isExtensionUri || isKnownAIExtension || isFixedOverlay) {
                triggerExtensionBlock(
                  `Browser overlay or assistant detected: <${node.tagName.toLowerCase()}>`,
                  isKnownAIExtension ? 'ai_extension' : isExtensionUri ? 'extension_uri' : 'fixed_overlay'
                );
              }
            }
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}

    return () => {
      clearInterval(scanInterval);
      observer?.disconnect();
    };
  }, [game.status, hasSubmitted, isTerminated, triggerExtensionBlock, blockedByExtension]);

  // (3) Disable copy, cut, paste, selection, printing, right-click, and hotkeys
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      sendIntegrityFlag('copy_paste_attempt', 'low', 'Copy attempt intercepted');
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
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      // Block F12
      if (e.key === 'F12') {
        e.preventDefault();
        sendIntegrityFlag('devtools_open', 'low', 'F12 hotkey blocked');
      }

      // Block Ctrl+Shift+I / J / C (Devtools)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'i' || key === 'j' || key === 'c')) {
        e.preventDefault();
        sendIntegrityFlag('devtools_open', 'medium', 'Devtools shortcut blocked');
      }

      // Block Ctrl+U (View Source)
      if ((e.ctrlKey || e.metaKey) && key === 'u') {
        e.preventDefault();
        sendIntegrityFlag('devtools_open', 'low', 'View-source shortcut (Ctrl+U) blocked');
      }

      // Block Ctrl+S (Save Page)
      if ((e.ctrlKey || e.metaKey) && key === 's') {
        e.preventDefault();
      }

      // Block Ctrl+P (Print)
      if ((e.ctrlKey || e.metaKey) && key === 'p') {
        e.preventDefault();
        sendIntegrityFlag('print_attempt' as any, 'medium', 'Print shortcut (Ctrl+P) blocked');
      }

      // Block PrintScreen
      if (e.key === 'PrintScreen') {
        sendIntegrityFlag('print_attempt' as any, 'medium', 'PrintScreen key intercepted');
      }
    };

    document.addEventListener('copy', handleCopy);
    document.addEventListener('cut', handleCut);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('selectstart', handleSelectStart);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('cut', handleCut);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('selectstart', handleSelectStart);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sendIntegrityFlag]);

  const handlePasteAttempt = useCallback(
    (e?: React.ClipboardEvent | ClipboardEvent | React.SyntheticEvent) => {
      if (e) e.preventDefault();
      sendIntegrityFlag('copy_paste_attempt', 'low', 'Paste attempt intercepted');
    },
    [sendIntegrityFlag]
  );

  const requestFullscreen = async () => {
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
        setFullscreenPaused(false);
      }
    } catch (err) {
      console.warn('Fullscreen request rejected by user/browser:', err);
    }
  };

  const dismissWarningModal = () => {
    if (!isTerminated) {
      setWarningModal(null);
    }
  };

  const reScanClean = () => {
    const res = scanEnvironmentForExtensions();
    if (!res.detected) {
      setBlockedByExtension(false);
      setExtensionReason('');
    } else {
      setExtensionReason(res.reason || 'Extension or overlay still detected.');
    }
  };

  return {
    isSecure,
    strikes,
    isTerminated,
    warningModal,
    dismissWarningModal,
    isQuestionLocked,
    blockedByExtension,
    extensionReason,
    reScanClean,
    requireFullscreen: true,
    isFullscreen,
    fullscreenPaused,
    requestFullscreen,
    handlePasteAttempt,
  };
}
