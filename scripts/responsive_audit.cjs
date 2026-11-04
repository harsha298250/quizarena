/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Comprehensive Responsive Layout & Viewport Overflow Audit
 */

const { chromium } = require('@playwright/test');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 3899;
const BASE_URL = `http://localhost:${PORT}`;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function runResponsiveAudit() {
  console.log(`Starting static server for dist on port ${PORT}...`);
  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || !path.extname(reqPath)) reqPath = '/index.html';
    const filePath = path.join(__dirname, '..', 'dist', reqPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      fs.createReadStream(filePath).pipe(res);
    } else {
      const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
      res.setHeader('Content-Type', 'text/html');
      fs.createReadStream(indexPath).pipe(res);
    }
  });

  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`✓ Server listening on ${BASE_URL}`);

  const chromePath = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : undefined;

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const requestedViewports = [
    { width: 320, height: 568, label: '320px Mobile' },
    { width: 375, height: 667, label: '375px Mobile' },
    { width: 430, height: 932, label: '430px Large Mobile' },
    { width: 768, height: 1024, label: '768px Tablet' },
    { width: 1024, height: 768, label: '1024px Laptop' },
    { width: 1366, height: 768, label: '1366px Desktop' },
    { width: 1920, height: 1080, label: '1920px Wide Display' },
  ];

  const zoomLevels = [
    { factor: 0.8, label: '80% Zoom' },
    { factor: 1.0, label: '100% Zoom' },
    { factor: 1.25, label: '125% Zoom' },
  ];

  const tabsToAudit = [
    { id: 'arena', label: 'Join & Arena' },
    { id: 'builder', label: 'Quiz Studio' },
    { id: 'ai', label: 'AI Quiz Generator' },
    { id: 'competitions', label: 'Tournament Manager' },
    { id: 'analytics', label: 'Analytics Dashboard' },
    { id: 'outbox', label: 'Email Outbox' },
    { id: 'practice', label: 'Solo Practice' },
  ];

  console.log('\n=============================================================');
  console.log('   RUNNING QUIZARENA RESPONSIVE & OVERFLOW AUDIT SUITE       ');
  console.log('=============================================================\n');

  let totalTests = 0;
  let overflowViolations = 0;

  for (const vp of requestedViewports) {
    for (const zoom of zoomLevels) {
      process.stdout.write(`Testing ${vp.label} @ ${zoom.label}... `);

      const context = await browser.newContext({
        viewport: {
          width: Math.round(vp.width / zoom.factor),
          height: Math.round(vp.height / zoom.factor),
        },
        deviceScaleFactor: zoom.factor,
        isMobile: vp.width <= 768,
      });

      const page = await context.newPage();
      let vpOverflows = 0;

      for (const tab of tabsToAudit) {
        totalTests++;

        try {
          await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(300);

          // Click navigation item (via drawer if mobile)
          const mobileDrawerBtn = page.locator('button[aria-label="Toggle mobile navigation menu"]:visible').first();
          if (await mobileDrawerBtn.isVisible()) {
            await mobileDrawerBtn.click({ timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(150);
          }

          const tabBtn = page.locator(`button[data-tab="${tab.id}"]:visible`).first();
          if (await tabBtn.isVisible()) {
            await tabBtn.click({ timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(250);
          }

          // Evaluate document overflow
          const overflow = await page.evaluate(() => {
            const docEl = document.documentElement;
            const body = document.body;
            const scrollW = Math.max(docEl.scrollWidth, body.scrollWidth);
            const clientW = docEl.clientWidth;
            let culprits = [];
            if (scrollW > clientW + 2) {
              document.querySelectorAll('*').forEach(el => {
                if (el.scrollWidth > clientW + 2 || el.getBoundingClientRect().right > clientW + 2) {
                  culprits.push({
                    tag: el.tagName,
                    id: el.id,
                    cls: (el.className || '').toString().slice(0, 50),
                    scrollW: el.scrollWidth,
                    right: Math.round(el.getBoundingClientRect().right),
                    text: (el.textContent || '').trim().slice(0, 30)
                  });
                }
              });
            }
            return {
              isOverflowing: scrollW > clientW + 2,
              scrollW,
              clientW,
              culprits: culprits.slice(0, 5)
            };
          });

          if (overflow.isOverflowing) {
            vpOverflows++;
            overflowViolations++;
            console.warn(`\n  ⚠️ Overflow on tab "${tab.label}" at ${vp.label} (${zoom.label}): scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW}`);
            if (overflow.culprits.length > 0) {
              console.warn('     Culprits:', JSON.stringify(overflow.culprits));
            }
          }
        } catch (tabErr) {
          console.warn(`Error on tab ${tab.id}:`, tabErr.message);
        }
      }

      await context.close();

      if (vpOverflows === 0) {
        console.log('✅ Pass (Zero horizontal overflow)');
      }
    }
  }

  console.log('\n=============================================================');
  console.log(`Audit Complete: ${totalTests} viewport/zoom combinations tested.`);
  console.log(`Total Horizontal Overflows Detected: ${overflowViolations}`);
  console.log('=============================================================\n');

  await browser.close();
  server.close();

  if (overflowViolations > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runResponsiveAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
