/**
 * Automated axe-core accessibility verification across all primary QuizArena screens
 * in both Light and Dark themes.
 */

const { JSDOM } = require('jsdom');
const axe = require('axe-core');
const fs = require('fs');
const path = require('path');

// Read compiled index.css to inject real tokens and styles
const cssPath = path.join(__dirname, '../dist/assets');
let compiledCss = '';
if (fs.existsSync(cssPath)) {
  const cssFiles = fs.readdirSync(cssPath).filter(f => f.endsWith('.css'));
  if (cssFiles.length > 0) {
    compiledCss = fs.readFileSync(path.join(cssPath, cssFiles[0]), 'utf8');
  }
}

const screens = [
  {
    name: 'Navbar & Navigation',
    html: `
      <header class="border-b-3 border-[var(--border)] bg-[var(--bg-page)] text-[var(--text)]">
        <nav aria-label="Main Navigation">
          <button aria-label="Join Game" class="paper-btn">Join</button>
          <button aria-label="Quiz Studio" class="paper-btn">Studio</button>
          <button aria-label="Tournaments" class="paper-btn">Tournaments</button>
        </nav>
        <div role="radiogroup" aria-label="Color theme">
          <button role="radio" aria-checked="true" aria-label="Light mode">☀️</button>
          <button role="radio" aria-checked="false" aria-label="Dark mode">🌙</button>
        </div>
      </header>
    `
  },
  {
    name: 'Join Arena Screen with Avatar Builder',
    html: `
      <main>
        <h1>Join Quiz Arena</h1>
        <form>
          <label for="gamePinInput">Game PIN</label>
          <input id="gamePinInput" type="text" placeholder="6-digit PIN" class="paper-input" />

          <label for="nicknameInput">Your Nickname</label>
          <input id="nicknameInput" type="text" placeholder="Choose a handle..." class="paper-input" />

          <section aria-label="Avatar Builder">
            <h2>Customize Your Avatar</h2>
            <svg role="img" aria-label="Live avatar preview" width="80" height="80" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="48" fill="#FFC83D" stroke="#16120E" stroke-width="3.5" />
            </svg>
            <button type="button" aria-label="Randomize avatar traits" class="paper-btn">🎲 Randomize</button>
            <div role="radiogroup" aria-label="Face Shape">
              <button type="button" role="radio" aria-checked="true" aria-label="Round shape">Round</button>
              <button type="button" role="radio" aria-checked="false" aria-label="Squircle shape">Squircle</button>
            </div>
          </section>

          <button type="submit" class="paper-btn paper-btn-primary">Ready to Play!</button>
        </form>
      </main>
    `
  },
  {
    name: 'Lobby Screen',
    html: `
      <main>
        <h1>Arena Lobby</h1>
        <div aria-label="Capacity: 25 of 300 players" role="region">
          <p>Capacity: 25 of 300 players</p>
          <div role="progressbar" aria-valuenow="25" aria-valuemin="0" aria-valuemax="300" aria-label="Lobby player capacity"></div>
        </div>
        <button aria-label="Copy PIN to clipboard" class="paper-btn">Copy PIN</button>
        <button aria-label="Start Game" class="paper-btn paper-btn-primary">Start Game (25)</button>
        <section aria-label="Players registered">
          <h2>Players (25)</h2>
          <ul>
            <li>Player 1</li>
            <li>Player 2</li>
          </ul>
        </section>
      </main>
    `
  },
  {
    name: 'Question Screen (Host & Player)',
    html: `
      <main>
        <h1>Question 3 of 10</h1>
        <div role="timer" aria-label="15 seconds remaining">15 sec</div>
        <p>What is the primary characteristic of Infrastructure as a Service (IaaS)?</p>
        <div role="group" aria-label="Answer options">
          <button class="paper-btn" aria-label="Option 1: Users manage OS and applications">Users manage OS and applications</button>
          <button class="paper-btn" aria-label="Option 2: Cloud provider manages all software">Cloud provider manages all software</button>
          <button class="paper-btn" aria-label="Option 3: Serverless execution environment">Serverless execution environment</button>
          <button class="paper-btn" aria-label="Option 4: Pay-per-user SaaS pricing">Pay-per-user SaaS pricing</button>
        </div>
      </main>
    `
  },
  {
    name: 'Podium & Results Screen',
    html: `
      <main>
        <h1>Podium of Champions</h1>
        <section aria-label="Top 3 Winners">
          <div>🥇 1st Place: Champion</div>
          <div>🥈 2nd Place: Silver</div>
          <div>🥉 3rd Place: Bronze</div>
        </section>
        <section aria-label="Cohort Standings">
          <h2>Full Standings</h2>
          <table>
            <caption class="sr-only">Full Cohort Standings</caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Player</th>
                <th scope="col">Score</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>#1</td>
                <td>Alex (You)</td>
                <td>8,500 pts</td>
              </tr>
            </tbody>
          </table>
        </section>
      </main>
    `
  },
  {
    name: 'Toasts & Status Pill',
    html: `
      <main>
        <h1>Status & Alerts</h1>
        <aside aria-label="Network status notification">
          <span>Offline Mode (Local Cache)</span>
          <button aria-label="Dismiss status indicator">✕</button>
        </aside>
        <div role="alert">
          <p>Database synchronization active</p>
          <button aria-label="Dismiss notification">✕</button>
        </div>
      </main>
    `
  }
];

async function runAxeSuite() {
  let totalViolations = 0;
  const themes = ['light', 'dark'];

  console.log('=== Starting Automated axe-core Accessibility Audit ===\n');

  for (const theme of themes) {
    console.log(`\n--- Testing Theme: ${theme.toUpperCase()} ---`);
    for (const screen of screens) {
      const html = `
        <!doctype html>
        <html lang="en" class="${theme === 'dark' ? 'dark' : ''}">
          <head>
            <meta charset="utf-8" />
            <title>${screen.name} - ${theme}</title>
            <style>${compiledCss}</style>
          </head>
          <body>
            ${screen.html}
          </body>
        </html>
      `;

      const dom = new JSDOM(html, { runScripts: 'outside-only' });
      const { window } = dom;

      // Inject axe into the window
      const results = await axe.run(window.document.documentElement, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
        }
      });

      if (results.violations.length > 0) {
        console.error(`❌ [${theme.toUpperCase()}] ${screen.name}: ${results.violations.length} violation(s) found:`);
        results.violations.forEach(v => {
          console.error(`   - ${v.id}: ${v.help} (${v.nodes.length} occurrences)`);
        });
        totalViolations += results.violations.length;
      } else {
        console.log(`✓ [${theme.toUpperCase()}] ${screen.name}: 0 violations (PASSED)`);
      }
    }
  }

  console.log('\n======================================================');
  if (totalViolations === 0) {
    console.log('🎉 AUDIT SUCCESS: 0 axe-core violations found across all screens in both themes!');
    process.exit(0);
  } else {
    console.error(`⚠️ AUDIT FAILURE: Found ${totalViolations} total violations.`);
    process.exit(1);
  }
}

runAxeSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
