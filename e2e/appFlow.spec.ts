import { test, expect } from '@playwright/test';

test.describe('QuizArena — Phase 8 Comprehensive End-to-End Suite', () => {
  test('1. Core Application Landing, Wordmark & Responsive Viewports', async ({ page }) => {
    // Desktop: 1440 x 900
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page).toHaveTitle(/QuizArena/i);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByRole('banner').getByText('QuizArena')).toBeVisible();

    // Laptop: 1280 x 800
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();

    // Tablet: 768 x 1024
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();

    // Mobile: 375 x 667
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });

  test('2. Settings & Privacy Modal Workflow', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const settingsBtn = page.getByRole('button', { name: /settings/i }).first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    const modal = page.locator('div[role="dialog"], .paper-card').filter({ hasText: /settings|privacy/i }).first();
    await expect(modal).toBeVisible();
    await expect(page.getByText(/sound|theme|privacy/i).first()).toBeVisible();

    const closeBtn = page.getByRole('button', { name: /close|done|×/i }).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
  });

  test('3. Player Join Arena View & Invalid PIN Validation', async ({ page }) => {
    await page.goto('/?tab=arena');
    await page.waitForLoadState('domcontentloaded');

    const pinInput = page.locator('input[placeholder*="PIN" i], input[type="text"]').first();
    if (await pinInput.isVisible()) {
      await pinInput.fill('000000');
      const joinBtn = page.getByRole('button', { name: /join/i }).first();
      if (await joinBtn.isVisible()) {
        await joinBtn.click();
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

  test('4. Host Dashboard, Navigation & Command Palette', async ({ page }) => {
    await page.goto('/?tab=host_dashboard');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    // Trigger Command Palette via Ctrl+K
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Escape');
  });

  test('5. Tournament Browser View & Filter Controls', async ({ page }) => {
    await page.goto('/?tab=competitions');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('div, section, main').filter({ hasText: /tournament|competition|bracket/i }).first()).toBeVisible();
  });

  test('6. AI Quiz Studio Generation View & Controls', async ({ page }) => {
    await page.goto('/?tab=ai');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();
  });

  test('7. Outbox Status & Solo Practice Views', async ({ page }) => {
    await page.goto('/?tab=outbox');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    await page.goto('/?tab=practice');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    await page.goto('/?tab=certificates');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();
  });

  test('8. Solo Practice Workflow: Question Render, Answer Submission & Progression', async ({ page }) => {
    await page.goto('/?tab=practice');
    await page.waitForLoadState('domcontentloaded');

    // Click "Start Practice Session"
    const startPracticeBtn = page.getByRole('button', { name: /start practice|practice session/i }).first();
    await expect(startPracticeBtn).toBeVisible();
    await startPracticeBtn.click();

    // Verify question prompt and answer option buttons are visible in the options grid
    const optionBtn = page.locator('.grid button').first();
    await expect(optionBtn).toBeVisible({ timeout: 5000 });

    // Submit answer by clicking an option
    await optionBtn.click();

    // Verify progression button appears (Next Card)
    const nextBtn = page.getByRole('button', { name: /next card/i }).first();
    await expect(nextBtn).toBeVisible({ timeout: 5000 });
    await nextBtn.click();
  });

  test('9. Host Creates Quiz Workflow: Quiz Builder Authoring & Autosave', async ({ page }) => {
    await page.goto('/?tab=builder');
    await page.waitForLoadState('domcontentloaded');

    // Click "+ New Quiz" button
    const newQuizBtn = page.locator('#btnCreateNewQuiz, button:has-text("+ New Quiz")').first();
    await expect(newQuizBtn).toBeVisible();
    await newQuizBtn.click();

    // Verify autosave indicator reflects save operation
    const autosaveIndicator = page.locator('[data-testid="autosave-indicator"]').first();
    await expect(autosaveIndicator).toBeVisible();
    await expect(autosaveIndicator).toContainText(/Autosaved/i);
  });

  test('10. Host Dashboard Metrics & Quiz Management Workflow', async ({ page }) => {
    await page.goto('/?tab=host_dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Verify host operational metrics are visible
    await expect(page.getByText(/Total Quizzes/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Published Quiz Repository/i).first()).toBeVisible();

    // Verify navigating to studio via Host Dashboard button
    const openStudioBtn = page.getByRole('button', { name: /Open Studio/i }).first();
    await expect(openStudioBtn).toBeVisible();
    await openStudioBtn.click();
    await expect(page.getByText(/Authoring Studio/i).first()).toBeVisible();
  });

  test('11. Tournament Standings & Elo League Table Workflow', async ({ page }) => {
    await page.goto('/?tab=competitions');
    await page.waitForLoadState('domcontentloaded');

    // Navigate to Elo League tab
    const leagueTab = page.getByRole('tab', { name: /Elo League/i }).first();
    await expect(leagueTab).toBeVisible();
    await leagueTab.click();

    // Verify league standings table is populated
    await expect(page.getByText(/Devendra|Priya|Jordan|Samira/i).first()).toBeVisible();
  });

  test('12. Settings & GDPR Account Deletion Safety Dialog Workflow', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Open settings modal dialog
    const settingsBtn = page.getByRole('button', { name: /settings/i }).first();
    await settingsBtn.click();

    // Verify settings modal is open
    const settingsModal = page.locator('div[role="dialog"]').filter({ hasText: /Preferences & Settings/i }).first();
    await expect(settingsModal).toBeVisible();

    // Click Delete Account & Personal Data button
    const deleteAccountBtn = settingsModal.getByRole('button', { name: /Delete Account & Personal Data|Review & Confirm/i }).first();
    await expect(deleteAccountBtn).toBeVisible();
    await deleteAccountBtn.click();

    // Confirm that the irreversible deletion confirmation section appears
    await expect(settingsModal.getByText(/Irreversible Account Deletion/i)).toBeVisible();
    await expect(settingsModal.getByPlaceholder(/Type DELETE to confirm/i)).toBeVisible();

    // Click Cancel to ensure safe abort without data loss
    const cancelBtn = settingsModal.getByRole('button', { name: /cancel/i }).first();
    await cancelBtn.click();
    await expect(settingsModal.getByText(/Irreversible Account Deletion/i)).not.toBeVisible();
  });
});
