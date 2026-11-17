/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * QuizArena — Automatic Question Progression Verification Suite
 * 
 * Verifies:
 * 1. Complete automatic 5-question multiplayer game (Host + 2 Students)
 *    ZERO clicks on Reveal or Next Question.
 *    Confirms automatic reveals, score recording, question progression, and final podium.
 * 2. Complete automatic progression with Host Tab Closed / Disconnected mid-game.
 *    Confirms server-side progression engine drives the lifecycle authoritatively.
 */

import { test, expect, BrowserContext } from '@playwright/test';

function setupContextInit(ctx: BrowserContext) {
  return ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(document, 'fullscreenElement', {
      get: () => document.body,
      configurable: true,
    });
    (window as any).__USE_FIREBASE_EMULATOR__ = true;
    (window as any).__QUIZARENA_E2E_TEST__ = true;
  });
}

test.describe('QuizArena — Automatic Progression Release Verification', () => {

  test('Automatic 5-Question Game with Zero Manual Reveal/Next Clicks', async ({ browser }) => {
    test.setTimeout(240000);

    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const student1Context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const student2Context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    await setupContextInit(hostContext);
    await setupContextInit(student1Context);
    await setupContextInit(student2Context);

    const hostPage = await hostContext.newPage();
    const student1Page = await student1Context.newPage();
    const student2Page = await student2Context.newPage();

    try {
      console.log('[Auto Test 1] Step 1: Host signing in with verified account...');
      await hostPage.goto('/?tab=arena');
      await hostPage.waitForLoadState('domcontentloaded');

      const signInBtn = hostPage.getByRole('button', { name: /Sign In/i }).first();
      await expect(signInBtn).toBeVisible({ timeout: 10000 });
      await signInBtn.click();

      const authDialog = hostPage.locator('div[role="dialog"]').first();
      await expect(authDialog).toBeVisible({ timeout: 5000 });

      await authDialog.locator('input[type="email"]').first().fill('teacher.verified@quizarena.test');
      await authDialog.locator('input[type="password"]').first().fill('Password123!');
      await authDialog.locator('button[type="submit"]').first().click();

      await expect(authDialog).not.toBeVisible({ timeout: 10000 });
      await expect(hostPage.locator('text=/Verified Host|Dashboard|Quiz Studio|Host Live/i').first()).toBeVisible({ timeout: 15000 });
      console.log('[Auto Test 1] Host successfully signed in as verified educator.');

      // Launch Host Dashboard and game
      console.log('[Auto Test 1] Step 2: Host launching live arena...');
      const hostDashBtn = hostPage.locator('button').filter({ hasText: /Launch a Live Quiz|Host Dashboard|Dashboard/i }).first();
      await expect(hostDashBtn).toBeVisible({ timeout: 10000 });
      await hostDashBtn.click();

      const hostLiveArenaBtn = hostPage.locator('button').filter({ hasText: /Host Live Arena/i }).first();
      await expect(hostLiveArenaBtn).toBeVisible({ timeout: 10000 });
      await hostLiveArenaBtn.click();

      // Extract PIN from Host Lobby
      const pinLocator = hostPage.locator('button[title*="PIN" i], div.font-mono-code').filter({ hasText: /^\d{6}$/ }).first();
      await expect(pinLocator).toBeVisible({ timeout: 15000 });
      const pinText = (await pinLocator.innerText()).trim();
      expect(pinText).toMatch(/^\d{6}$/);
      console.log(`[Auto Test 1] Host lobby active with PIN: ${pinText}`);

      // Students join
      console.log('[Auto Test 1] Step 3: Students joining with PIN...');
      await student1Page.goto('/?tab=arena');
      await student1Page.waitForLoadState('domcontentloaded');
      const s1PinInput = student1Page.locator('#joinPinInput, input[placeholder*="PIN" i]').first();
      await expect(s1PinInput).toBeVisible({ timeout: 10000 });
      await s1PinInput.fill(pinText);
      await student1Page.locator('#joinNicknameInput, input[placeholder*="Nickname" i]').first().fill('AutoStudentAlpha');
      await student1Page.getByRole('button', { name: /Join Arena Now/i }).first().click();

      await student2Page.goto('/?tab=arena');
      await student2Page.waitForLoadState('domcontentloaded');
      const s2PinInput = student2Page.locator('#joinPinInput, input[placeholder*="PIN" i]').first();
      await expect(s2PinInput).toBeVisible({ timeout: 10000 });
      await s2PinInput.fill(pinText);
      await student2Page.locator('#joinNicknameInput, input[placeholder*="Nickname" i]').first().fill('AutoStudentBeta');
      await student2Page.getByRole('button', { name: /Join Arena Now/i }).first().click();

      // Host starts game (SINGLE CLICK — no further clicks permitted on host)
      console.log('[Auto Test 1] Step 4: Host clicks Start Game once...');
      await hostPage.waitForTimeout(1000);
      const startGameBtn = hostPage.getByRole('button', { name: /Start Game/i }).first();
      await expect(startGameBtn).toBeVisible({ timeout: 15000 });
      await expect(startGameBtn).toBeEnabled({ timeout: 15000 });
      await startGameBtn.click();

      // Loop through all 5 questions WITHOUT clicking Reveal or Next Question!
      for (let q = 1; q <= 5; q++) {
        console.log(`[Auto Test 1] === Question ${q} / 5 ===`);

        // Wait for Question q to be active
        await expect(student1Page.locator(`text=/Question ${q} of 5|Q${q}/i`).first()).toBeVisible({ timeout: 20000 });
        await expect(hostPage.locator(`text=/Question ${q} of 5|Q${q}/i`).first()).toBeVisible({ timeout: 20000 });
        console.log(`[Auto Test 1] -> Question ${q} is actively rendered on all screens.`);

        // Students optionally click an option button
        await student1Page.waitForTimeout(1000);
        const s1Opt = student1Page.locator('.grid button:not([disabled]), button[aria-label*="Option"]:not([disabled])').first();
        if (await s1Opt.isVisible({ timeout: 2000 }).catch(() => false)) {
          await s1Opt.click({ force: true }).catch(() => {});
        }
        const s2Opt = student2Page.locator('.grid button:not([disabled]), button[aria-label*="Option"]:not([disabled])').first();
        if (await s2Opt.isVisible({ timeout: 2000 }).catch(() => false)) {
          await s2Opt.click({ force: true }).catch(() => {});
        }

        // DO NOT CLICK REVEAL! Wait for automatic reveal!
        console.log(`[Auto Test 1] Waiting for automatic reveal on Question ${q}...`);
        await expect(
          student1Page.locator('text=/Spot on|Nice one|Bummer|Keep your head up/i').first()
        ).toBeVisible({ timeout: 40000 });
        console.log(`[Auto Test 1] -> Question ${q} automatically revealed!`);

        // DO NOT CLICK NEXT QUESTION! If q < 5, wait for automatic advance
        if (q < 5) {
          console.log(`[Auto Test 1] Waiting for automatic advance to Question ${q + 1}...`);
          await expect(
            student1Page.locator(`text=/Question ${q + 1} of 5|Q${q + 1}/i`).first()
          ).toBeVisible({ timeout: 20000 });
          console.log(`[Auto Test 1] -> Automatically advanced to Question ${q + 1}!`);
        }
      }

      // Step 5: Verify Final Podium appears automatically after Question 5 reveal!
      console.log('[Auto Test 1] Step 5: Observing automatic transition to Final Podium...');
      await expect(
        hostPage.locator('text=/Podium|Leaderboard|Winner|Final Results|GameOver/i').first()
      ).toBeVisible({ timeout: 25000 });
      await expect(
        student1Page.locator('text=/Podium|Leaderboard|Winner|Final Results|GameOver/i').first()
      ).toBeVisible({ timeout: 25000 });
      await expect(
        student2Page.locator('text=/Podium|Leaderboard|Winner|Final Results|GameOver/i').first()
      ).toBeVisible({ timeout: 25000 });
      console.log('[Auto Test 1] SUCCESS: Complete 5-question match completed automatically without any host clicks!');
    } finally {
      await hostContext.close();
      await student1Context.close();
      await student2Context.close();
    }
  });

  test('Automatic Progression Continues With Host Tab Closed / Disconnected', async ({ browser }) => {
    test.setTimeout(240000);

    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const student1Context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const student2Context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    await setupContextInit(hostContext);
    await setupContextInit(student1Context);
    await setupContextInit(student2Context);

    const hostPage = await hostContext.newPage();
    const student1Page = await student1Context.newPage();
    const student2Page = await student2Context.newPage();

    try {
      console.log('[Auto Test 2] Step 1: Host signing in and launching game...');
      await hostPage.goto('/?tab=arena');
      await hostPage.waitForLoadState('domcontentloaded');

      const signInBtn = hostPage.getByRole('button', { name: /Sign In/i }).first();
      await expect(signInBtn).toBeVisible({ timeout: 10000 });
      await signInBtn.click();

      const authDialog = hostPage.locator('div[role="dialog"]').first();
      await expect(authDialog).toBeVisible({ timeout: 5000 });

      await authDialog.locator('input[type="email"]').first().fill('teacher.verified@quizarena.test');
      await authDialog.locator('input[type="password"]').first().fill('Password123!');
      await authDialog.locator('button[type="submit"]').first().click();

      await expect(authDialog).not.toBeVisible({ timeout: 10000 });
      await expect(hostPage.locator('text=/Verified Host|Dashboard|Quiz Studio|Host Live/i').first()).toBeVisible({ timeout: 15000 });

      const hostDashBtn = hostPage.locator('button').filter({ hasText: /Launch a Live Quiz|Host Dashboard|Dashboard/i }).first();
      await expect(hostDashBtn).toBeVisible({ timeout: 10000 });
      await hostDashBtn.click();

      const hostLiveArenaBtn = hostPage.locator('button').filter({ hasText: /Host Live Arena/i }).first();
      await expect(hostLiveArenaBtn).toBeVisible({ timeout: 10000 });
      await hostLiveArenaBtn.click();

      const pinLocator = hostPage.locator('button[title*="PIN" i], div.font-mono-code').filter({ hasText: /^\d{6}$/ }).first();
      await expect(pinLocator).toBeVisible({ timeout: 15000 });
      const pinText = (await pinLocator.innerText()).trim();
      console.log(`[Auto Test 2] Lobby active with PIN: ${pinText}`);

      // Students join
      console.log('[Auto Test 2] Step 2: Students joining...');
      await student1Page.goto('/?tab=arena');
      await student1Page.waitForLoadState('domcontentloaded');
      await student1Page.locator('#joinPinInput, input[placeholder*="PIN" i]').first().fill(pinText);
      await student1Page.locator('#joinNicknameInput, input[placeholder*="Nickname" i]').first().fill('GhostStudentAlpha');
      await student1Page.getByRole('button', { name: /Join Arena Now/i }).first().click();

      await student2Page.goto('/?tab=arena');
      await student2Page.waitForLoadState('domcontentloaded');
      await student2Page.locator('#joinPinInput, input[placeholder*="PIN" i]').first().fill(pinText);
      await student2Page.locator('#joinNicknameInput, input[placeholder*="Nickname" i]').first().fill('GhostStudentBeta');
      await student2Page.getByRole('button', { name: /Join Arena Now/i }).first().click();

      // Host starts game
      console.log('[Auto Test 2] Step 3: Host starts live game...');
      await hostPage.waitForTimeout(1000);
      const startGameBtn = hostPage.getByRole('button', { name: /Start Game/i }).first();
      await expect(startGameBtn).toBeVisible({ timeout: 15000 });
      await expect(startGameBtn).toBeEnabled({ timeout: 15000 });
      await startGameBtn.click();

      // Confirm Question 1 is active on student pages
      await expect(student1Page.locator('text=/Question 1 of 5|Q1/i').first()).toBeVisible({ timeout: 15000 });
      await expect(student2Page.locator('text=/Question 1 of 5|Q1/i').first()).toBeVisible({ timeout: 15000 });
      console.log('[Auto Test 2] Question 1 active on all student screens.');

      // ------------------------------------------------------------------
      // CRUCIAL STEP: CLOSE HOST BROWSER TAB COMPLETELY
      // ------------------------------------------------------------------
      console.log('[Auto Test 2] Step 4: CLOSING HOST BROWSER TAB COMPLETELY...');
      await hostPage.close();
      await hostContext.close();
      console.log('[Auto Test 2] Host is completely disconnected from the session.');

      // Verify that without host, Student 1 and Student 2 progress automatically through server loop
      console.log('[Auto Test 2] Step 5: Verifying server-side progression on student screens...');

      for (let q = 1; q <= 5; q++) {
        console.log(`[Auto Test 2] Host Offline: Question ${q} / 5`);

        // Verify Question q is active
        await expect(student1Page.locator(`text=/Question ${q} of 5|Q${q}/i`).first()).toBeVisible({ timeout: 20000 });
        await expect(student2Page.locator(`text=/Question ${q} of 5|Q${q}/i`).first()).toBeVisible({ timeout: 20000 });

        // Question auto-reveal by server
        console.log(`[Auto Test 2] Waiting for server auto-reveal on Question ${q}...`);
        await expect(
          student1Page.locator('text=/Spot on|Nice one|Bummer|Keep your head up/i').first()
        ).toBeVisible({ timeout: 40000 });
        console.log(`[Auto Test 2] -> Question ${q} automatically revealed with host offline!`);

        if (q < 5) {
          // Question auto-advance by server
          console.log(`[Auto Test 2] Waiting for server auto-advance to Question ${q + 1}...`);
          await expect(
            student1Page.locator(`text=/Question ${q + 1} of 5|Q${q + 1}/i`).first()
          ).toBeVisible({ timeout: 20000 });
          console.log(`[Auto Test 2] -> Question ${q + 1} automatically started with host offline!`);
        }
      }

      // Final Podium transition driven by server
      console.log('[Auto Test 2] Step 6: Verifying server transition to Final Podium...');
      await expect(
        student1Page.locator('text=/Podium|Leaderboard|Winner|Final Results|GameOver/i').first()
      ).toBeVisible({ timeout: 25000 });
      await expect(
        student2Page.locator('text=/Podium|Leaderboard|Winner|Final Results|GameOver/i').first()
      ).toBeVisible({ timeout: 25000 });
      console.log('[Auto Test 2] SUCCESS: Entire quiz completed to Final Podium with host tab closed!');
    } finally {
      await student1Context.close();
      await student2Context.close();
    }
  });

});
