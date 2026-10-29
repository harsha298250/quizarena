/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Automated axe-core accessibility audit
 */

const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 3456;
const BASE_URL = `http://localhost:${PORT}`;

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, res => {
          if (res.statusCode >= 200 && res.statusCode < 400) resolve(true);
          else reject(new Error(`Status ${res.statusCode}`));
        });
        req.on('error', reject);
        req.setTimeout(1000, () => req.abort());
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 400));
    }
  }
  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

async function runAxeAudit() {
  const preview = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT)], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
    shell: true,
  });

  let browser;
  try {
    await waitForServer(BASE_URL);
    const chromePath = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : 'C:\\Users\\harsh\\AppData\\Local\\ms-playwright\\chromium-1097\\chrome-win\\chrome.exe';

    browser = await chromium.launch({
      headless: true,
      executablePath: chromePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Inject axe-core source
    const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf-8');
    await page.evaluate(axeSource);

    // Run axe on light theme
    const lightResults = await page.evaluate(async () => {
      // @ts-ignore
      return await window.axe.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
        },
      });
    });

    // Run axe on dark theme
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(300);

    const darkResults = await page.evaluate(async () => {
      // @ts-ignore
      return await window.axe.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
        },
      });
    });

    console.log('\n=== AXE-CORE ACCESSIBILITY AUDIT RESULTS ===');
    console.log(`Light Theme: ${lightResults.passes.length} rules passed, ${lightResults.violations.length} violations.`);
    console.log(`Dark Theme:  ${darkResults.passes.length} rules passed, ${darkResults.violations.length} violations.`);

    if (lightResults.violations.length > 0) {
      console.log('\nLight Violations:');
      lightResults.violations.forEach(v => console.log(`- [${v.id}] ${v.help}: ${v.nodes.length} nodes`));
    }
    if (darkResults.violations.length > 0) {
      console.log('\nDark Violations:');
      darkResults.violations.forEach(v => console.log(`- [${v.id}] ${v.help}: ${v.nodes.length} nodes`));
    }

    const totalViolations = lightResults.violations.length + darkResults.violations.length;
    console.log(`\nAudit Complete: ${totalViolations === 0 ? 'Zero WCAG AA Violations!' : `${totalViolations} violations found.`}\n`);
    
  } catch (err) {
    console.error('Axe audit error:', err);
  } finally {
    if (browser) await browser.close();
    preview.kill();
  }
}

runAxeAudit();

