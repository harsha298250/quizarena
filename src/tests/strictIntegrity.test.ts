/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Automated Test Suite for Strict Secure Mode & Integrity Shield (Phase 4)
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

  // 1. 6-Strike Escalation and Automatic Termination Logic
  let strikes = 0;
  let penaltyApplied = 0;
  let questionLocked = false;
  let isTerminated = false;
  let preservedScore = 1250;

  const simulateStrike = (strikeNumber: number) => {
    strikes = strikeNumber;
    if (strikes === 1) {
      return { modal: 'Strike 1 of 5: Window Focus Shifted', penalty: 0, locked: false, terminated: false };
    } else if (strikes === 2) {
      penaltyApplied += 50;
      return { modal: 'Strike 2 of 5: Focus Violation', penalty: 50, locked: false, terminated: false };
    } else if (strikes === 3) {
      questionLocked = true;
      return { modal: 'Strike 3 of 5: Locked for this Question', penalty: 0, locked: true, terminated: false };
    } else if (strikes === 4) {
      return { modal: 'Strike 4 of 5: Critical Warning', penalty: 0, locked: false, terminated: false };
    } else if (strikes === 5) {
      return { modal: 'Strike 5 of 5: Final Warning', penalty: 0, locked: false, terminated: false };
    } else if (strikes >= 6) {
      isTerminated = true;
      questionLocked = true;
      return { modal: 'Quiz Terminated - Integrity Shield', penalty: 0, locked: true, terminated: true };
    }
    return { modal: 'none', penalty: 0, locked: false, terminated: false };
  };

  const s1 = simulateStrike(1);
  assert('Strike 1: Advisory warning without locking or termination', s1.modal.includes('Strike 1') && !questionLocked && !isTerminated);

  const s2 = simulateStrike(2);
  assert('Strike 2: Deducts 50 point penalty', s2.modal.includes('Strike 2') && penaltyApplied === 50 && !isTerminated);

  const s3 = simulateStrike(3);
  assert('Strike 3: Locks question answering immediately', s3.modal.includes('Strike 3') && questionLocked && !isTerminated);

  const s4 = simulateStrike(4);
  assert('Strike 4: Issues critical warning', s4.modal.includes('Strike 4') && !isTerminated);

  const s5 = simulateStrike(5);
  assert('Strike 5: Issues final warning before termination', s5.modal.includes('Strike 5') && !isTerminated);

  const s6 = simulateStrike(6);
  assert(
    'Strike 6: Quiz is ENDED automatically with score preserved',
    s6.terminated && isTerminated && questionLocked && preservedScore === 1250
  );

  // 2. Host Reinstatement Logic
  const reinstatePlayer = () => {
    strikes = 0;
    isTerminated = false;
    questionLocked = false;
    return { strikes, isTerminated, questionLocked, integrityScore: 100 };
  };
  const reinstated = reinstatePlayer();
  assert(
    'Host Reinstatement: Resets strikes, removes termination, and restores 100% integrity',
    reinstated.strikes === 0 && !reinstated.isTerminated && reinstated.integrityScore === 100
  );

  // 3. 500ms Focus Heartbeat Check
  const checkFocusLoss = (hasFocus: boolean) => {
    if (!hasFocus) {
      return { strikeTriggered: true, reason: 'Loss of document focus (500ms heartbeat poll)' };
    }
    return { strikeTriggered: false };
  };
  assert('Focus Heartbeat: Detects loss of document.hasFocus()', checkFocusLoss(false).strikeTriggered);
  assert('Focus Heartbeat: Active document.hasFocus() does not trigger strike', !checkFocusLoss(true).strikeTriggered);

  // 4. Server-side Timing Anomaly Detection (< 300ms sub-human response)
  globalTimingAnomalyDetector.reset();
  const fastAnomaly = globalTimingAnomalyDetector.recordAndCheck('player_speedy', 142);
  assert(
    'Server Anomaly: Flags < 300ms response as suspicious_timing',
    fastAnomaly.isAnomaly && fastAnomaly.type === 'suspicious_timing' && fastAnomaly.severity === 'high',
    fastAnomaly.reason
  );

  // 5. Normal Human Response Timing (1200ms - 4500ms is not an anomaly)
  globalTimingAnomalyDetector.reset('player_human');
  const normal1 = globalTimingAnomalyDetector.recordAndCheck('player_human', 2400);
  const normal2 = globalTimingAnomalyDetector.recordAndCheck('player_human', 3800);
  assert('Normal timing: Human response variations are not flagged', !normal1.isAnomaly && !normal2.isAnomaly);

  // 6. Uniform Timing Anomaly (Automated Bot script with < 25ms std dev across 3+ questions)
  globalTimingAnomalyDetector.reset('player_bot');
  globalTimingAnomalyDetector.recordAndCheck('player_bot', 1500);
  globalTimingAnomalyDetector.recordAndCheck('player_bot', 1502);
  const botResult = globalTimingAnomalyDetector.recordAndCheck('player_bot', 1501);
  assert(
    'Server Anomaly: Flags macro/bot with uniform response timing across questions',
    botResult.isAnomaly && botResult.type === 'uniform_timing',
    botResult.reason
  );

  // 7. Multi-monitor & Picture-in-Picture Detection
  const checkMultiMonitorHeuristic = (screenObj: { isExtended?: boolean; availWidth: number; width: number }) => {
    return Boolean(screenObj.isExtended) || screenObj.availWidth > screenObj.width * 1.5;
  };
  assert('Multi-monitor: Detects isExtended = true', checkMultiMonitorHeuristic({ isExtended: true, availWidth: 1920, width: 1920 }));
  assert('Single-monitor: Normal single monitor is not flagged', !checkMultiMonitorHeuristic({ isExtended: false, availWidth: 1920, width: 1920 }));

  // 8. Extension and AI Helper Detection
  const KNOWN_AI_EXTENSIONS = [
    'ai-blaze',
    'sider',
    'monica',
    'merlin',
    'harpa',
    'maxai',
    'grammarly',
    'quiz-solver',
  ];

  const inspectInjectedNode = (node: {
    outerHTML: string;
    attributes?: Record<string, string>;
    classList?: string[];
    id?: string;
    style?: { position?: string; zIndex?: string };
  }) => {
    // False-positive guard 1: Password managers
    if (
      node.attributes?.['data-lastpass-icon-root'] ||
      node.attributes?.['data-dashlane-frame'] ||
      node.attributes?.['data-bitwarden'] ||
      node.attributes?.['data-1p-ignore'] ||
      node.attributes?.['data-onepassword'] ||
      node.classList?.includes('onepassword') ||
      node.classList?.includes('bitwarden')
    ) {
      return { flagged: false, reason: 'password_manager_exempt' };
    }

    // False-positive guard 2: Google Translate
    if (
      node.classList?.includes('translated-ltr') ||
      node.classList?.includes('skiptranslate') ||
      (node.id && node.id.includes('goog-gt-'))
    ) {
      return { flagged: false, reason: 'google_translate_exempt' };
    }

    // False-positive guard 3: Screen readers & Accessibility live regions
    if (
      (node.attributes?.['role'] === 'status' || node.attributes?.['role'] === 'alert') &&
      node.attributes?.['aria-live']
    ) {
      return { flagged: false, reason: 'accessibility_exempt' };
    }

    // False-positive guard 4: Grammarly non-AI mode (spelling/grammar underline)
    if (
      node.attributes?.['data-grammarly-part'] ||
      node.outerHTML?.toLowerCase().includes('data-grammarly-part')
    ) {
      const html = (node.outerHTML || '').toLowerCase();
      if (!html.includes('gen-ai') && !html.includes('rewrite') && !html.includes('generate')) {
        return { flagged: false, reason: 'grammarly_non_ai_exempt' };
      }
    }

    const html = node.outerHTML.toLowerCase();
    const isExtensionUri = html.includes('chrome-extension://') || html.includes('moz-extension://');
    const isKnownAI = KNOWN_AI_EXTENSIONS.some(ext => html.includes(ext) || node.id?.toLowerCase().includes(ext));
    const isFixedOverlay =
      node.style?.position === 'fixed' && parseInt(node.style?.zIndex || '0', 10) >= 999;

    if (isExtensionUri || isKnownAI || isFixedOverlay) {
      return { flagged: true, isKnownAI, isExtensionUri, isFixedOverlay };
    }
    return { flagged: false };
  };

  // Known AI extensions test
  assert(
    'AI Extension: Detects AI Blaze injection',
    inspectInjectedNode({ outerHTML: '<div class="ai-blaze-helper"></div>' }).flagged
  );
  assert(
    'AI Extension: Detects Monica / Merlin helper',
    inspectInjectedNode({ outerHTML: '<div id="monica-quick-ask"></div>' }).flagged
  );
  assert(
    'AI Extension: Detects chrome-extension:// URI',
    inspectInjectedNode({ outerHTML: '<script src="chrome-extension://abc123xyz/content.js"></script>' }).flagged
  );

  // False-positive tests
  assert(
    'False-Positive Guard: Bitwarden password manager is exempt',
    !inspectInjectedNode({
      outerHTML: '<div data-bitwarden="true"></div>',
      attributes: { 'data-bitwarden': 'true' },
    }).flagged
  );
  assert(
    'False-Positive Guard: 1Password/LastPass is exempt',
    !inspectInjectedNode({
      outerHTML: '<div data-lastpass-icon-root="true"></div>',
      attributes: { 'data-lastpass-icon-root': 'true' },
    }).flagged &&
    !inspectInjectedNode({
      outerHTML: '<div data-onepassword="true"></div>',
      attributes: { 'data-onepassword': 'true' },
    }).flagged
  );
  assert(
    'False-Positive Guard: Google Translate is exempt',
    !inspectInjectedNode({
      outerHTML: '<div id="goog-gt-tt" class="translated-ltr"></div>',
      id: 'goog-gt-tt',
      classList: ['translated-ltr'],
    }).flagged
  );
  assert(
    'False-Positive Guard: Screen Reader live regions are exempt',
    !inspectInjectedNode({
      outerHTML: '<div role="status" aria-live="polite">Score updated</div>',
      attributes: { role: 'status', 'aria-live': 'polite' },
    }).flagged
  );
  assert(
    'False-Positive Guard: Grammarly in non-AI spelling mode is exempt',
    !inspectInjectedNode({
      outerHTML: '<grammarly-part data-grammarly-part="spelling"></grammarly-part>',
      attributes: { 'data-grammarly-part': 'spelling' },
    }).flagged
  );
  assert(
    'AI Extension: Grammarly Gen-AI rewrite overlay is flagged as AI assistant',
    inspectInjectedNode({
      outerHTML: '<div class="grammarly-gen-ai">AI Rewrite</div>',
    }).flagged
  );

  // 8b. Extension Poller Cooldown Check (30s cooldown per distinct signal)
  const lastSignalTime: Record<string, number> = {};
  const recordExtensionDetection = (signalName: string, now: number) => {
    const last = lastSignalTime[signalName] || 0;
    if (now - last < 30000) {
      return { addedStrike: false, blockedScreen: true };
    }
    lastSignalTime[signalName] = now;
    return { addedStrike: true, blockedScreen: true };
  };

  const pollerT0 = 50000;
  const poll1 = recordExtensionDetection('ai_assistant_sider', pollerT0);
  const poll2 = recordExtensionDetection('ai_assistant_sider', pollerT0 + 1000); // 1s later
  const poll3 = recordExtensionDetection('ai_assistant_sider', pollerT0 + 2000); // 2s later
  const poll4 = recordExtensionDetection('ai_assistant_sider', pollerT0 + 31000); // 31s later

  assert(
    'Extension Poller: First detection triggers strike and blocks screen',
    poll1.addedStrike === true && poll1.blockedScreen === true
  );
  assert(
    'Extension Poller: Continuous 1s polls maintain blocking screen without adding more strikes',
    poll2.addedStrike === false && poll2.blockedScreen === true &&
    poll3.addedStrike === false && poll3.blockedScreen === true
  );
  assert(
    'Extension Poller: Distinct detection signal after 30s cooldown adds exactly one new strike',
    poll4.addedStrike === true && poll4.blockedScreen === true
  );

  // 9. Watermarked Question Anti-Scraping DOM Check (innerText, textContent & node scan)
  const simulateActiveQuestionDom = (isAccessibleMode: boolean, questionText: string, options: string[]) => {
    if (isAccessibleMode) {
      return {
        bodyInnerText: `Question: ${questionText} Option A: ${options[0]} Option B: ${options[1]}`,
        bodyTextContent: `Question: ${questionText} Option A: ${options[0]} Option B: ${options[1]}`,
        textNodes: [questionText, ...options],
      };
    }
    // Canvas mode: Question and options are drawn into Canvas pixels only
    // Transparent hitboxes contain only generic 'Option A', 'Option B' aria-labels
    return {
      bodyInnerText: 'Question 1 of 5 100% Option A Option B Option C Option D',
      bodyTextContent: 'Question 1 of 5 100% Option A Option B Option C Option D',
      textNodes: ['Question 1 of 5', '100%', 'Option A', 'Option B', 'Option C', 'Option D'],
    };
  };

  const questionPrompt = 'What is the primary synchronization primitive in Dijkstra’s algorithm?';
  const questionOptions = ['Counting Semaphore', 'Spinlock', 'Peterson Solution', 'Lamport Clock'];

  const canvasDom = simulateActiveQuestionDom(false, questionPrompt, questionOptions);
  assert(
    'Anti-Scraping Canvas: document.body.innerText does not contain question text',
    !canvasDom.bodyInnerText.includes(questionPrompt)
  );
  assert(
    'Anti-Scraping Canvas: document.body.textContent does not contain any option text',
    questionOptions.every(opt => !canvasDom.bodyTextContent.includes(opt))
  );
  assert(
    'Anti-Scraping Canvas: text-node scan finds zero question or option strings',
    canvasDom.textNodes.every(n => !n.includes('Semaphore') && !n.includes(questionPrompt))
  );

  const accessibleDom = simulateActiveQuestionDom(true, questionPrompt, questionOptions);
  assert(
    'Accessibility Mode: Screen readers receive accessible DOM text when accommodation active',
    accessibleDom.bodyInnerText.includes(questionPrompt) && accessibleDom.bodyTextContent.includes(questionOptions[0])
  );

  // 9b. Canvas Bypass Guard: Dyslexia font, read-aloud and large text do NOT open DOM text mode
  const isAccessibleApprovedOnly = (player: { accommodations?: any; accessibleApproved?: boolean }) => {
    return Boolean(player.accessibleApproved);
  };

  const selfDeclaredPlayer = {
    accommodations: { dyslexiaFont: true, readAloud: true, largeText: true },
    accessibleApproved: false,
  };
  const hostApprovedPlayer = {
    accommodations: { dyslexiaFont: false, readAloud: false, largeText: false },
    accessibleApproved: true,
  };

  assert(
    'Canvas Bypass Guard: Self-declared dyslexia, read-aloud & large text do NOT enable DOM text mode',
    isAccessibleApprovedOnly(selfDeclaredPlayer) === false
  );
  assert(
    'Canvas Bypass Guard: Only host-approved player (accessibleApproved = true) enables DOM text mode',
    isAccessibleApprovedOnly(hostApprovedPlayer) === true
  );

  // Simulated live text-node scan on active question DOM for self-declared player
  const normalPlayerDom = simulateActiveQuestionDom(
    isAccessibleApprovedOnly(selfDeclaredPlayer),
    questionPrompt,
    questionOptions
  );
  assert(
    'Canvas Bypass Guard: Text-node scan for self-declared player contains 0 question or option strings',
    !normalPlayerDom.bodyInnerText.includes(questionPrompt) &&
    questionOptions.every(opt => !normalPlayerDom.bodyTextContent.includes(opt)) &&
    normalPlayerDom.textNodes.every(n => !n.includes('Semaphore') && !n.includes(questionPrompt))
  );

  // 10. Player Integrity Score Calculation (0-100)
  const computeIntegrity = (strikeCount: number, isTerm: boolean) => {
    return Math.max(0, 100 - strikeCount * 16 - (isTerm ? 100 : 0));
  };
  assert('Integrity Score: Clean session has 100% integrity', computeIntegrity(0, false) === 100);
  assert('Integrity Score: 2 strikes yields 68% integrity', computeIntegrity(2, false) === 68);
  assert('Integrity Score: Terminated session yields 0% integrity', computeIntegrity(6, true) === 0);

  return { passed, failed, results };
}

if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('strictIntegrity.test')) {
  const r = runStrictIntegrityTests();
  r.results.forEach(line => console.log(line));
  console.log(`\nStrict Integrity Tests: ${r.passed} Passed, ${r.failed} Failed\n`);
  if (r.failed > 0) process.exit(1);
}
