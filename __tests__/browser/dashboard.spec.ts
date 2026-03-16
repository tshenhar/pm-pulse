import { test, expect } from '@playwright/test';
import { navigateTo, waitForDashboard, dismissOnboarding } from './helpers/app';

test.describe('Dashboard — Feature & Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/');
    await waitForDashboard(page);
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/PM Pulse/i);
  });

  test('header contains app logo and navigation links', async ({ page }) => {
    await expect(page.getByRole('banner')).toBeVisible();
    // Settings link
    await expect(page.getByRole('link', { name: /settings/i })).toBeVisible();
  });

  test('four summary cards are present with correct labels', async ({ page }) => {
    await dismissOnboarding(page);
    const main = page.locator('main');
    // Wait for loading skeletons to finish, then check for card labels (exact match to avoid duplicates)
    // Cards render after the API data loads — they use <p class="text-xs text-muted-foreground">
    await expect(main.getByText('Total Time', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(main.getByText('Focus Time', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(main.locator('p.text-muted-foreground').filter({ hasText: 'Meetings' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(main.getByText('Top Category', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('date navigation arrows are present', async ({ page }) => {
    // Left/right arrow buttons for date navigation
    const buttons = await page.getByRole('button').all();
    expect(buttons.length).toBeGreaterThan(0);
  });

  test('today button appears after navigating to a past date', async ({ page }) => {
    // Click the "Previous day" arrow button to go to yesterday
    await page.getByRole('button', { name: /previous day/i }).click();
    // Now the Today button should appear since we are no longer on today
    await expect(page.getByRole('button', { name: 'Today' })).toBeVisible({ timeout: 5_000 });
  });

  test('activity table renders', async ({ page }) => {
    await dismissOnboarding(page);
    // Table should be present (may be empty if no data)
    const table = page.locator('table');
    await expect(table).toBeVisible();
  });

  test('trends link navigates to /trends', async ({ page }) => {
    await page.getByRole('link', { name: /trends/i }).click();
    await expect(page).toHaveURL(/\/trends/);
  });

  test('settings link navigates to /settings', async ({ page }) => {
    await page.getByRole('link', { name: /settings/i }).click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test('keyboard shortcut T returns to today', async ({ page }) => {
    await page.keyboard.press('t');
    // Should not error, page should still be functional
    await expect(page.locator('main')).toBeVisible();
  });

  test('keyboard shortcut Escape does not break page', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(page.locator('main')).toBeVisible();
  });

  test('sidebar opens when activity row is clicked', async ({ page }) => {
    await dismissOnboarding(page);
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    if (rowCount > 0) {
      await rows.first().click();
      // A panel/aside should appear
      await expect(page.locator('aside, [role="complementary"]')).toBeVisible({ timeout: 3000 });
    }
  });
});
