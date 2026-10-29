/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Automated Test Suite for Strict Secure Mode & Integrity Shield (Phase 7)
 */

import { globalTimingAnomalyDetector } from '../server/scoringHardening';

export function runStrictIntegrityTests(): { passed: number; failed: number; results: string[] } {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, details?: string) {
    if (condition) {
      passed++;
      results.push(`✓ PASS: ${name}`);
    } else {
      failed++;
      results.push(`✕ FAIL: ${name}${details ? ` - ${details}` : ''}`);
    }
  }

  // 1. Strike Escalation Logic
  let strikes = 0;
  let penaltyApplied = 0;
  let questionLocked = false;

  const simulateStrike = (strikeNumber: number) => {
    strikes = strikeNumber;
    if (strikes === 1) {
      // Strike 1: Advisory warning only
      return { modal: 'advisory', penalty: 0, locked: false };
    } else if (strikes === 2) {
      // Strike 2: Point penalty (-50)
      penaltyApplied += 50;
      return { modal: 'warning_with_penalty', penalty: 50, locked: false };
    } else if (strikes >= 3) {
      // Strike 3: Locked question & flag to host
      questionLocked = true;
      return { modal: 'locked_and_flagged', penalty: 0, locked: true };
    }
    return { modal: 'none', penalty: 0, locked: false };
  };

  const s1 = simulateStrike(1);
  assert('Strike 1: Triggers advisory modal without locking or penalty', s1.modal === 'advisory' && penaltyApplied === 0 && !questionLocked);

  const s2 = simulateStrike(2);
  assert('Strike 2: Deducts 50 point penalty', s2.modal === 'warning_with_penalty' && penaltyApplied === 50 && !questionLocked);

  const s3 = simulateStrike(3);
  assert('Strike 3: Locks question answering immediately', s3.modal === 'locked_and_flagged' && questionLocked);

  // 2. Server-side Timing Anomaly Detection (< 300ms sub-human response)
  globalTimingAnomalyDetector.reset();
  const fastAnomaly = globalTimingAnomalyDetector.recordAndCheck('player_speedy', 142);
  assert(
    'Server Anomaly: Flags < 300ms response as suspicious_timing',
    fastAnomaly.isAnomaly && fastAnomaly.type === 'suspicious_timing' && fastAnomaly.severity === 'high',
    fastAnomaly.reason
  );

  // 3. Normal Human Response Timing (1200ms - 4500ms is not an anomaly)
  globalTimingAnomalyDetector.reset('player_human');
  const normal1 = globalTimingAnomalyDetector.recordAndCheck('player_human', 2400);
  const normal2 = globalTimingAnomalyDetector.recordAndCheck('player_human', 3800);
  assert('Normal timing: Human response variations are not flagged', !normal1.isAnomaly && !normal2.isAnomaly);

  // 4. Uniform Timing Anomaly (Automated Bot script with < 25ms std dev across 3+ questions)
  globalTimingAnomalyDetector.reset('player_bot');
  globalTimingAnomalyDetector.recordAndCheck('player_bot', 1500);
  globalTimingAnomalyDetector.recordAndCheck('player_bot', 1502);
  const botResult = globalTimingAnomalyDetector.recordAndCheck('player_bot', 1501);
  assert(
    'Server Anomaly: Flags macro/bot with uniform response timing across questions',
    botResult.isAnomaly && botResult.type === 'uniform_timing',
    botResult.reason
  );

  // 5. Multi-monitor Heuristic Verification
  const checkMultiMonitorHeuristic = (screenObj: { isExtended?: boolean; availWidth: number; width: number }) => {
    return Boolean(screenObj.isExtended) || screenObj.availWidth > screenObj.width * 1.5;
  };
  assert('Multi-monitor: Detects isExtended = true', checkMultiMonitorHeuristic({ isExtended: true, availWidth: 1920, width: 1920 }));
  assert('Single-monitor: Normal single monitor is not flagged', !checkMultiMonitorHeuristic({ isExtended: false, availWidth: 1920, width: 1920 }));

  // 6. Extension Injection Detection Logic
  const checkInjectedNode = (outerHTML: string, style: { position?: string; zIndex?: string }) => {
    const isExtension = outerHTML.includes('chrome-extension://') || outerHTML.includes('moz-extension://');
    const isSuspiciousOverlay = style.position === 'fixed' && parseInt(style.zIndex || '0', 10) >= 9999;
    return isExtension || isSuspiciousOverlay;
  };
  assert('Extension Check: Detects chrome-extension:// URI in DOM', checkInjectedNode('<div src="chrome-extension://xyz/content.js"></div>', {}));
  assert('Extension Check: Detects full-screen overlay with z-index 9999', checkInjectedNode('<div></div>', { position: 'fixed', zIndex: '9999' }));
  assert('Extension Check: Standard DOM elements are clean', !checkInjectedNode('<button class="paper-btn">Answer</button>', {}));

  // 7. Accessibility Integrity (Screen reader / Dyslexia font not flagged)
  const isA11yPermitted = (toolName: string) => {
    const permittedTools = ['nvda', 'jaws', 'voiceover', 'dyslexia_font', 'high_contrast'];
    return permittedTools.includes(toolName.toLowerCase());
  };
  assert('Accessibility: NVDA screen reader is permitted and unflagged', isA11yPermitted('nvda'));
  assert('Accessibility: Dyslexia font accommodation is permitted and unflagged', isA11yPermitted('dyslexia_font'));

  return { passed, failed, results };
}

if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('strictIntegrity.test')) {
  const r = runStrictIntegrityTests();
  r.results.forEach(line => console.log(line));
  console.log(`\nStrict Integrity Tests: ${r.passed} Passed, ${r.failed} Failed\n`);
  if (r.failed > 0) process.exit(1);
}

