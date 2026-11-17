/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import {
  isInputFocused,
  handleKeyboardShortcut,
  ShortcutHandlerContext,
  UseGlobalShortcutsOptions,
} from '../hooks/useGlobalShortcuts';
import { KeyboardShortcutsModal } from '../components/common/KeyboardShortcutsModal';

function renderToDoc(element: React.ReactElement): Document {
  const html = renderToString(element);
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  return dom.window.document;
}

describe('Phase 6 — Keyboard Shortcuts & Discoverability Tests', () => {
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    vi.useFakeTimers();
    dom = new JSDOM(`<!doctype html><html><body></body></html>`);
    document = dom.window.document;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('[KEY-01] Input Focus Guard (isInputFocused)', () => {
    it('accurately identifies input, textarea, select, and contenteditable elements', () => {
      const input = document.createElement('input');
      const textarea = document.createElement('textarea');
      const select = document.createElement('select');
      const editableDiv = document.createElement('div');
      editableDiv.setAttribute('contenteditable', 'true');
      (editableDiv as any).isContentEditable = true;

      const childOfEditable = document.createElement('span');
      editableDiv.appendChild(childOfEditable);
      document.body.appendChild(editableDiv);

      const button = document.createElement('button');
      const standardDiv = document.createElement('div');

      expect(isInputFocused(input)).toBe(true);
      expect(isInputFocused(textarea)).toBe(true);
      expect(isInputFocused(select)).toBe(true);
      expect(isInputFocused(editableDiv)).toBe(true);
      expect(isInputFocused(childOfEditable)).toBe(true);

      expect(isInputFocused(button)).toBe(false);
      expect(isInputFocused(standardDiv)).toBe(false);
      expect(isInputFocused(null)).toBe(false);
    });
  });

  describe('[KEY-02] handleKeyboardShortcut execution', () => {
    function createMockContext(initialPending = false): {
      ctx: ShortcutHandlerContext;
      getState: () => boolean;
      triggerExpire: () => void;
    } {
      let pending = initialPending;
      let expireCb: (() => void) | null = null;

      const ctx: ShortcutHandlerContext = {
        get sequencePending() {
          return pending;
        },
        setSequencePending: (val: boolean) => {
          pending = val;
        },
        resetTimer: vi.fn(() => {
          expireCb = null;
        }),
        startTimer: vi.fn((_ms: number, cb: () => void) => {
          expireCb = cb;
        }),
      };

      return {
        ctx,
        getState: () => pending,
        triggerExpire: () => {
          if (expireCb) expireCb();
        },
      };
    }

    it('opens shortcut help on ? keypress when outside input elements', () => {
      const onOpenShortcutsHelp = vi.fn();
      const onNavigate = vi.fn();
      const onOpenCommandPalette = vi.fn();
      const { ctx } = createMockContext();

      const handled = handleKeyboardShortcut(
        {
          target: document.createElement('div'),
          key: '?',
          preventDefault: vi.fn(),
        },
        {
          onNavigate,
          onOpenCommandPalette,
          onOpenShortcutsHelp,
        },
        ctx
      );

      expect(handled).toBe(true);
      expect(onOpenShortcutsHelp).toHaveBeenCalledTimes(1);
    });

    it('suppresses shortcut actions when event target is an input element', () => {
      const onOpenShortcutsHelp = vi.fn();
      const onNavigate = vi.fn();
      const onOpenCommandPalette = vi.fn();
      const { ctx, getState } = createMockContext();

      const input = document.createElement('input');

      const handledHelp = handleKeyboardShortcut(
        {
          target: input,
          key: '?',
          preventDefault: vi.fn(),
        },
        {
          onNavigate,
          onOpenCommandPalette,
          onOpenShortcutsHelp,
        },
        ctx
      );
      expect(handledHelp).toBe(false);
      expect(onOpenShortcutsHelp).not.toHaveBeenCalled();

      const handledG = handleKeyboardShortcut(
        {
          target: input,
          key: 'g',
          preventDefault: vi.fn(),
        },
        {
          onNavigate,
          onOpenCommandPalette,
          onOpenShortcutsHelp,
        },
        ctx
      );
      expect(handledG).toBe(false);
      expect(getState()).toBe(false);
    });

    it('suppresses all navigation and help shortcuts when isLiveGame is true', () => {
      const onOpenShortcutsHelp = vi.fn();
      const onNavigate = vi.fn();
      const onOpenCommandPalette = vi.fn();
      const { ctx, getState } = createMockContext();

      const options: UseGlobalShortcutsOptions = {
        onNavigate,
        onOpenCommandPalette,
        onOpenShortcutsHelp,
        isLiveGame: true,
      };

      // Help modal should NOT open
      const helpResult = handleKeyboardShortcut(
        { target: document.body, key: '?', preventDefault: vi.fn() },
        options,
        ctx
      );
      expect(helpResult).toBe(false);
      expect(onOpenShortcutsHelp).not.toHaveBeenCalled();

      // Command palette should NOT open
      const paletteResult = handleKeyboardShortcut(
        { target: document.body, key: 'k', ctrlKey: true, preventDefault: vi.fn() },
        options,
        ctx
      );
      expect(paletteResult).toBe(false);
      expect(onOpenCommandPalette).not.toHaveBeenCalled();

      // Two-key sequence should NOT start
      const gResult = handleKeyboardShortcut(
        { target: document.body, key: 'g', preventDefault: vi.fn() },
        options,
        ctx
      );
      expect(gResult).toBe(false);
      expect(getState()).toBe(false);
    });

    it('handles two-key sequence navigation (G then D for host_dashboard)', () => {
      const onNavigate = vi.fn();
      const { ctx, getState } = createMockContext(false);

      const options: UseGlobalShortcutsOptions = {
        onNavigate,
        onOpenCommandPalette: vi.fn(),
        onOpenShortcutsHelp: vi.fn(),
        userRole: 'host',
      };

      // Step 1: press 'g'
      const gHandled = handleKeyboardShortcut(
        { target: document.body, key: 'g', preventDefault: vi.fn() },
        options,
        ctx
      );
      expect(gHandled).toBe(true);
      expect(getState()).toBe(true);

      // Step 2: press 'd'
      const dHandled = handleKeyboardShortcut(
        { target: document.body, key: 'd', preventDefault: vi.fn() },
        options,
        ctx
      );
      expect(dHandled).toBe(true);
      expect(getState()).toBe(false);
      expect(onNavigate).toHaveBeenCalledWith('host_dashboard');
    });

    it('routes G then D to student_dashboard when userRole is student', () => {
      const onNavigate = vi.fn();
      const { ctx } = createMockContext(true); // already pressed 'g'

      const options: UseGlobalShortcutsOptions = {
        onNavigate,
        onOpenCommandPalette: vi.fn(),
        onOpenShortcutsHelp: vi.fn(),
        userRole: 'student',
      };

      const dHandled = handleKeyboardShortcut(
        { target: document.body, key: 'd', preventDefault: vi.fn() },
        options,
        ctx
      );
      expect(dHandled).toBe(true);
      expect(onNavigate).toHaveBeenCalledWith('student_dashboard');
    });

    it('navigates to all standard destinations via G + letter sequences', () => {
      const keyMap: Record<string, string> = {
        a: 'arena',
        s: 'builder',
        i: 'ai',
        t: 'competitions',
        l: 'analytics',
        c: 'certificates',
        o: 'outbox',
      };

      for (const [letter, expectedTab] of Object.entries(keyMap)) {
        const onNavigate = vi.fn();
        const { ctx } = createMockContext(true);

        const handled = handleKeyboardShortcut(
          { target: document.body, key: letter, preventDefault: vi.fn() },
          {
            onNavigate,
            onOpenCommandPalette: vi.fn(),
            onOpenShortcutsHelp: vi.fn(),
          },
          ctx
        );

        expect(handled).toBe(true);
        expect(onNavigate).toHaveBeenCalledWith(expectedTab);
      }
    });

    it('resets two-key sequence after timer expires', () => {
      const onNavigate = vi.fn();
      const { ctx, getState, triggerExpire } = createMockContext(false);

      const options: UseGlobalShortcutsOptions = {
        onNavigate,
        onOpenCommandPalette: vi.fn(),
        onOpenShortcutsHelp: vi.fn(),
      };

      handleKeyboardShortcut(
        { target: document.body, key: 'g', preventDefault: vi.fn() },
        options,
        ctx
      );
      expect(getState()).toBe(true);

      // Trigger timer expiration
      triggerExpire();
      expect(getState()).toBe(false);

      // Now pressing 'd' alone should not navigate
      const handled = handleKeyboardShortcut(
        { target: document.body, key: 'd', preventDefault: vi.fn() },
        options,
        ctx
      );
      expect(handled).toBe(false);
      expect(onNavigate).not.toHaveBeenCalled();
    });
  });

  describe('[KEY-03] KeyboardShortcutsModal component', () => {
    it('renders with accessibility attributes and contains all required categories', () => {
      const doc = renderToDoc(
        React.createElement(KeyboardShortcutsModal, {
          isOpen: true,
          onClose: vi.fn(),
        })
      );

      const dialog = doc.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog?.getAttribute('aria-label')).toBe('Keyboard Shortcuts');

      const text = doc.body.textContent || '';
      expect(text).toContain('Keyboard Shortcuts');
      expect(text).toContain('Navigate to Dashboard');
      expect(text).toContain('Navigate to Live Arena / Join Quiz');
      expect(text).toContain('Navigate to Quiz Studio (Builder)');
      expect(text).toContain('Navigate to AI Quiz Generator');
      expect(text).toContain('Navigate to Tournaments & Brackets');
      expect(text).toContain('Navigate to Cohort Analytics');
      expect(text).toContain('Navigate to Digital Certificates');
      expect(text).toContain('Navigate to Email Delivery Outbox');
      expect(text).toContain('Intelligent Input & Live Game Protection');
      expect(text).toContain('Live Player Arena');
    });

    it('returns null when isOpen is false', () => {
      const doc = renderToDoc(
        React.createElement(KeyboardShortcutsModal, {
          isOpen: false,
          onClose: vi.fn(),
        })
      );
      expect(doc.body.innerHTML).toBe('');
    });
  });
});
