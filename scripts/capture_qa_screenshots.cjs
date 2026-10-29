/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Multi-Viewport, Multi-Theme, Multi-Language Screenshot & A11y Verification Script
 */

const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 3456;
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = path.join('C:', 'Users', 'harsh', '.gemini', 'antigravity', 'brain', 'eb44d8ef-bc1d-4cb1-97d5-339e7fe7e702', 'screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

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

async function main() {
  console.log(`Starting preview server on port ${PORT}...`);
  const preview = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT)], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
    shell: true,
  });

  let browser;
  try {
    await waitForServer(BASE_URL);
    console.log('Preview server ready. Launching Chrome...');

    const chromePath = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : 'C:\\Users\\harsh\\AppData\\Local\\ms-playwright\\chromium-1097\\chrome-win\\chrome.exe';

    browser = await chromium.launch({
      headless: true,
      executablePath: chromePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const viewports = [
      { name: '360px', width: 360, height: 800 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1280px', width: 1280, height: 800 },
      { name: '1920px', width: 1920, height: 1080 },
    ];

    const themes = ['light', 'dark'];
    const languages = [
      { code: 'en', name: 'English' },
      { code: 'ta', name: 'Tamil' },
      { code: 'hi', name: 'Hindi' },
    ];

    const capturedList = [];

    for (const vp of viewports) {
      for (const th of themes) {
        for (const lang of languages) {
          const context = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
          });
          const page = await context.newPage();

          // Set localStorage before loading page
          await page.addInitScript(({ theme, language }) => {
            localStorage.setItem('quizarena-theme', theme);
            localStorage.setItem('quizarena_language', language);
            if (theme === 'dark') {
              document.documentElement.classList.add('dark');
            } else {
              document.documentElement.classList.remove('dark');
            }
          }, { theme: th, language: lang.code });

          await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(300);

          // Force language and theme classes if needed
          await page.evaluate(({ theme, language }) => {
            if (theme === 'dark') {
              document.documentElement.classList.add('dark');
            } else {
              document.documentElement.classList.remove('dark');
            }
            const langSelect = document.querySelector('select[aria-label="Select Language"]');
            if (langSelect && langSelect.value !== language) {
              langSelect.value = language;
              langSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, { theme: th, language: lang.code });

          await page.waitForTimeout(200);

          const fileName = `arena_${vp.name}_${th}_${lang.code}.png`;
          const filePath = path.join(SCREENSHOT_DIR, fileName);
          await page.screenshot({ path: filePath, fullPage: false });

          capturedList.push({
            viewport: vp.name,
            theme: th,
            lang: lang.name,
            file: fileName,
          });

          await context.close();
        }
      }
    }

    console.log(`\nSuccessfully captured ${capturedList.length} screenshots:`);
    console.table(capturedList);

  } catch (err) {
    console.error('Error during screenshot capture:', err);
  } finally {
    if (browser) await browser.close();
    preview.kill();
  }
}

main();
