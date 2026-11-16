/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import DOMPurify from 'dompurify';

/**
 * Narrowly scoped whitelist of CSS property names safe for email previews.
 * Forbids layout positioning (fixed, absolute), sizing tricks, z-index,
 * expressions, external imports, and behavioral bindings.
 */
const ALLOWED_CSS_PROPERTIES = new Set([
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-align',
  'text-decoration',
  'line-height',
  'margin',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'padding',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'border',
  'border-top',
  'border-bottom',
  'border-left',
  'border-right',
  'border-color',
  'border-style',
  'border-width',
  'border-radius',
  'border-collapse'
]);

/**
 * Strictly sanitizes inline style strings:
 * - Drops any property not on the strict whitelist.
 * - Forbids url(), expression, javascript, eval, behavioral bindings, and -moz-binding.
 */
export function sanitizeInlineCss(styleString: string): string {
  if (!styleString || typeof styleString !== 'string') {
    return '';
  }

  const declarations = styleString.split(';');
  const safeDeclarations: string[] = [];

  for (const decl of declarations) {
    const trimmed = decl.trim();
    if (!trimmed) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const prop = trimmed.slice(0, colonIndex).trim().toLowerCase();
    const val = trimmed.slice(colonIndex + 1).trim();

    if (!ALLOWED_CSS_PROPERTIES.has(prop)) {
      continue;
    }

    // Disallow dangerous CSS expressions, external resources, or script bindings
    if (/url\s*\(|expression|javascript|eval|-moz-binding|behavior|@import/i.test(val)) {
      continue;
    }

    safeDeclarations.push(`${prop}: ${val}`);
  }

  return safeDeclarations.join('; ');
}

/**
 * Strict DOMPurify configuration for email HTML previews in EmailOutbox.
 * Whitelists only necessary semantic markup, tables, typography, and images.
 * Explicitly blocks execution vectors, forms, scripts, styles, iframes, and embeds.
 */
export const EMAIL_PREVIEW_PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'a', 'b', 'blockquote', 'br', 'caption', 'center', 'code', 'div', 'em',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol',
    'p', 'pre', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody',
    'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
  ],
  ALLOWED_ATTR: [
    'align', 'alt', 'bgcolor', 'border', 'cellpadding', 'cellspacing',
    'class', 'color', 'colspan', 'dir', 'height', 'href', 'id', 'rowspan',
    'src', 'style', 'target', 'title', 'valign', 'width'
  ],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  FORBID_TAGS: [
    'script', 'iframe', 'object', 'embed', 'form', 'input', 'button',
    'textarea', 'select', 'option', 'meta', 'link', 'style', 'base',
    'svg', 'math', 'template', 'applet', 'dialog'
  ],
  FORBID_ATTR: [
    'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur',
    'onchange', 'onsubmit', 'onreset', 'onkeydown', 'onkeypress', 'onkeyup',
    'action', 'formaction', 'data', 'srcdoc'
  ],
  ALLOW_DATA_ATTR: false,
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false
};

// Map to track hook registration per DOMPurify instance
const hookedInstances = new WeakSet<object>();

function ensurePurifyHooks(purifyInstance: any): void {
  if (!purifyInstance || typeof purifyInstance.addHook !== 'function') {
    return;
  }
  if (typeof purifyInstance === 'object' && hookedInstances.has(purifyInstance)) {
    return;
  }
  try {
    purifyInstance.addHook('afterSanitizeAttributes', (node: any) => {
      if (node && typeof node.hasAttribute === 'function' && node.hasAttribute('style')) {
        const rawStyle = node.getAttribute('style') || '';
        const safeStyle = sanitizeInlineCss(rawStyle);
        if (safeStyle) {
          node.setAttribute('style', safeStyle);
        } else {
          node.removeAttribute('style');
        }
      }
    });
    if (typeof purifyInstance === 'object') {
      hookedInstances.add(purifyInstance);
    }
  } catch {
    // Fail closed or graceful no-op
  }
}

/**
 * Universal sanitizer that works safely in both browser and test environments.
 * Fails closed: if DOMPurify cannot initialize or throws, returns an empty string.
 * Never executes raw HTML or regex-fallback HTML.
 */
export function sanitizeEmailHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return '';
  }

  try {
    // 1. Browser environment: DOMPurify hooks onto window automatically
    if (typeof (DOMPurify as any)?.sanitize === 'function') {
      ensurePurifyHooks(DOMPurify);
      return (DOMPurify as any).sanitize(rawHtml, EMAIL_PREVIEW_PURIFY_CONFIG);
    }

    // 2. Node.js environment with jsdom global window set (e.g. tests)
    if (typeof (DOMPurify as any) === 'function') {
      const activeWindow = typeof window !== 'undefined' ? window : (globalThis as any).window;
      if (activeWindow) {
        const purifyInstance = (DOMPurify as any)(activeWindow);
        if (purifyInstance && typeof purifyInstance.sanitize === 'function') {
          ensurePurifyHooks(purifyInstance);
          return purifyInstance.sanitize(rawHtml, EMAIL_PREVIEW_PURIFY_CONFIG);
        }
      }
    }

    // Fail closed: fail safe by returning empty preview
    return '';
  } catch {
    // Fail closed on any runtime sanitizer error
    return '';
  }
}
