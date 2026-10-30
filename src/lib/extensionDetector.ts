/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Comprehensive Client-Side Extension & Injection Detector
 */

export interface ScanResult {
  detected: boolean;
  signalName?: string;
  reason?: string;
  severity: 'low' | 'medium' | 'high';
}

export const KNOWN_AI_EXTENSIONS = [
  'ai-blaze',
  'aiblaze',
  'sider',
  'monica',
  'merlin',
  'harpa',
  'maxai',
  'grammarly',
  'compose-ai',
  'composeai',
  'copilot',
  'quiz-solver',
  'quizsolver',
  'chatgpt',
];

/**
 * Checks if a DOM node belongs to an approved/essential category (password managers, Google Translate, or standard app elements).
 */
export function isExemptNode(node: HTMLElement): boolean {
  // 1. Password managers exemption
  if (
    node.hasAttribute('data-lastpass-icon-root') ||
    node.hasAttribute('data-dashlane-frame') ||
    node.hasAttribute('data-bitwarden') ||
    node.hasAttribute('data-1p-ignore') ||
    node.getAttribute('id')?.includes('bitwarden') ||
    node.getAttribute('id')?.includes('lastpass') ||
    node.closest('input, textarea, form')
  ) {
    return true;
  }

  // 2. Google Translate & language translation wrappers
  if (
    node.classList.contains('translated-ltr') ||
    node.classList.contains('translated-rtl') ||
    node.id.includes('goog-gt-') ||
    node.classList.contains('skiptranslate')
  ) {
    return true;
  }

  // 3. Accessibility tools exemption
  if (
    node.getAttribute('role') === 'status' &&
    node.getAttribute('aria-live')
  ) {
    return true;
  }

  return false;
}

/**
 * Comprehensive DOM and environment scan
 */
export function scanEnvironmentForExtensions(): ScanResult {
  if (typeof document === 'undefined') {
    return { detected: false, severity: 'low' };
  }

  // 1. Check navigator.webdriver
  if (typeof navigator !== 'undefined' && (navigator as any).webdriver) {
    return {
      detected: true,
      signalName: 'webdriver_detected',
      reason: 'Automated browser environment detected (navigator.webdriver = true)',
      severity: 'high',
    };
  }

  // 2. Check Picture-in-Picture
  if ((document as any).pictureInPictureElement) {
    return {
      detected: true,
      signalName: 'picture_in_picture',
      reason: 'Picture-in-Picture floating video window active during assessment',
      severity: 'medium',
    };
  }

  // 3. Multi-monitor detection
  try {
    const isExtended = Boolean((window.screen as any)?.isExtended);
    if (isExtended) {
      return {
        detected: true,
        signalName: 'multi_monitor',
        reason: 'Multiple monitors detected (screen.isExtended = true)',
        severity: 'medium',
      };
    }
  } catch {}

  // 4. Devtools outer vs inner heuristic
  try {
    const threshold = 160;
    const widthDiff = window.outerWidth - window.innerWidth > threshold;
    const heightDiff = window.outerHeight - window.innerHeight > threshold;
    if (widthDiff || heightDiff) {
      return {
        detected: true,
        signalName: 'devtools_open',
        reason: 'Devtools inspection window opened',
        severity: 'medium',
      };
    }
  } catch {}

  // 5. Scan elements added outside #root
  const root = document.getElementById('root');
  if (root) {
    const bodyChildren = Array.from(document.body.children);
    for (const child of bodyChildren) {
      if (child === root) continue;
      if (child.tagName === 'SCRIPT' && !child.getAttribute('src')?.includes('extension')) continue;
      if (child.id === 'vite-plugin-pwa-register') continue;

      if (child instanceof HTMLElement) {
        if (isExemptNode(child)) continue;

        const tag = child.tagName.toLowerCase();
        const html = (child.outerHTML || '').toLowerCase();

        // Check for extension URI in child
        if (html.includes('chrome-extension://') || html.includes('moz-extension://')) {
          return {
            detected: true,
            signalName: 'extension_uri_outside_root',
            reason: `Browser extension element <${tag}> injected outside app container`,
            severity: 'high',
          };
        }

        // Check for known AI assistants
        for (const ai of KNOWN_AI_EXTENSIONS) {
          if (html.includes(ai) || child.id.toLowerCase().includes(ai) || child.className.toLowerCase().includes(ai)) {
            return {
              detected: true,
              signalName: `ai_assistant_${ai}`,
              reason: `AI helper overlay detected: ${ai}`,
              severity: 'high',
            };
          }
        }

        // Check for fixed or absolute overlays placed over the viewport
        const style = window.getComputedStyle(child);
        const isOverlay = (style.position === 'fixed' || style.position === 'absolute') &&
          parseInt(style.zIndex || '0', 10) >= 999;
        if (isOverlay) {
          return {
            detected: true,
            signalName: 'overlay_outside_root',
            reason: `Suspicious fixed/absolute overlay <${tag}> outside root with high z-index (${style.zIndex})`,
            severity: 'high',
          };
        }
      }
    }
  }

  // 6. Check for custom elements / shadow roots on documentElement and body
  const allElements = document.querySelectorAll('*');
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i];
    if (el instanceof HTMLElement) {
      if (isExemptNode(el)) continue;

      // Check shadowRoot if open
      if (el.shadowRoot) {
        const shadowHtml = el.shadowRoot.innerHTML.toLowerCase();
        if (shadowHtml.includes('chrome-extension://') || shadowHtml.includes('moz-extension://')) {
          return {
            detected: true,
            signalName: 'shadow_root_extension',
            reason: `Shadow root containing extension resources found on <${el.tagName.toLowerCase()}>`,
            severity: 'high',
          };
        }
      }

      // Check for iframes or images pointing to extension schemes
      if (el.tagName === 'IFRAME') {
        const src = (el.getAttribute('src') || '').toLowerCase();
        if (src.startsWith('chrome-extension://') || src.startsWith('moz-extension://')) {
          return {
            detected: true,
            signalName: 'extension_iframe',
            reason: `Extension iframe detected: ${src.slice(0, 32)}...`,
            severity: 'high',
          };
        }
      }

      if (el.tagName === 'IMG') {
        const src = (el.getAttribute('src') || '').toLowerCase();
        if (src.startsWith('chrome-extension://') || src.startsWith('moz-extension://')) {
          return {
            detected: true,
            signalName: 'extension_image',
            reason: `Extension asset icon injected: ${src.slice(0, 32)}...`,
            severity: 'high',
          };
        }
      }

      // Check for injected style tags with extension URLs
      if (el.tagName === 'STYLE' || el.tagName === 'LINK') {
        const content = (el.textContent || el.getAttribute('href') || '').toLowerCase();
        if (content.includes('chrome-extension://') || content.includes('moz-extension://')) {
          return {
            detected: true,
            signalName: 'extension_stylesheet',
            reason: 'Injected stylesheet referencing extension schema',
            severity: 'high',
          };
        }
      }
    }
  }

  return { detected: false, severity: 'low' };
}

