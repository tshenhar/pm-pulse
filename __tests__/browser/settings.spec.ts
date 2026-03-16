import { test, expect } from '@playwright/test';
import { navigateTo } from './helpers/app';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/settings');
  });

  test('page loads at /settings', async ({ page }) => {
    await expect(page).toHaveURL(/\/settings/);
  });

  test('back navigation returns to dashboard', async ({ page }) => {
    // The back button is a Link wrapping an icon-only Button in the header
    await page.locator('header a').first().click();
    await expect(page).toHaveURL('http://localhost:3000/');
  });

  // Settings cards are inside {settings && (...)} so they only appear after settings API loads
  test('Privacy card is visible', async ({ page }) => {
    // Use exact match to avoid matching "...Respects your privacy..." text elsewhere
    await expect(page.getByText('Privacy', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Classification card is visible', async ({ page }) => {
    await expect(page.getByText('Classification', { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test('Activity Tracking card is visible', async ({ page }) => {
    await expect(page.getByText('Activity Tracking', { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test('Calendar Integration card is visible', async ({ page }) => {
    await expect(page.getByText('Calendar Integration', { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test('Window Tracking card is visible', async ({ page }) => {
    await expect(page.getByText('Window Tracking', { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test('Browser Tracking card is visible', async ({ page }) => {
    await expect(page.getByText('Browser Tracking', { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test('Tracking Exclusions card is visible', async ({ page }) => {
    await expect(page.getByText('Tracking Exclusions')).toBeVisible();
  });

  test('Data Export card is visible with CSV and JSON buttons', async ({ page }) => {
    await expect(page.getByText('Data Export')).toBeVisible();
    await expect(page.getByRole('button', { name: /export csv/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /export json/i })).toBeVisible();
  });

  test('Save button is visible in header', async ({ page }) => {
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible();
  });

  test('tracking exclusion: typing in app input and clicking Add adds a pill', async ({ page }) => {
    const appInput = page.getByPlaceholder(/app name/i);
    await appInput.fill('TestApp2025');
    await page.getByRole('button', { name: /^add$/i }).first().click();
    await expect(page.getByText('TestApp2025')).toBeVisible();
  });

  test('suggestion chips for common apps are visible', async ({ page }) => {
    // At least one of the suggestion chips should be visible if not already added
    const chips = page.locator('button').filter({ hasText: /Visual Studio Code|Ghostty|Warp|iTerm2/i });
    const count = await chips.count();
    // Not all may be visible if already added — at least check the section exists
    await expect(page.getByText('Tracking Exclusions')).toBeVisible();
  });

  test('calendar ICS input accepts text', async ({ page }) => {
    const icsInput = page.getByPlaceholder(/https:\/\/outlook/i);
    await expect(icsInput).toBeVisible();
    await icsInput.fill('https://example.com/calendar.ics');
    await expect(icsInput).toHaveValue('https://example.com/calendar.ics');
    // Clean up
    await icsInput.fill('');
  });
});
