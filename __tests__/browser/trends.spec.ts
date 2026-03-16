import { test, expect } from '@playwright/test';
import { navigateTo } from './helpers/app';

test.describe('Trends Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/trends');
  });

  test('page loads at /trends', async ({ page }) => {
    await expect(page).toHaveURL(/\/trends/);
    await expect(page.locator('main')).toBeVisible();
  });

  test('back button navigates to dashboard', async ({ page }) => {
    // The back button is a Link wrapping an icon-only Button (no text label)
    // It's the first link in the header
    await page.locator('header a').first().click();
    await expect(page).toHaveURL('http://localhost:3000/');
  });

  test('week and month toggle buttons present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /week/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /month/i })).toBeVisible();
  });

  test('period toggle switches between week and month', async ({ page }) => {
    const monthBtn = page.getByRole('button', { name: /month/i });
    await monthBtn.click();
    // Should not error
    await expect(page.locator('main')).toBeVisible();
    const weekBtn = page.getByRole('button', { name: /week/i });
    await weekBtn.click();
    await expect(page.locator('main')).toBeVisible();
  });

  test('SVG charts are rendered', async ({ page }) => {
    const svgs = page.locator('svg');
    const svgCount = await svgs.count();
    expect(svgCount).toBeGreaterThan(0);
  });

  test('summary cards are present', async ({ page }) => {
    await expect(page.getByText('Total Time')).toBeVisible();
  });

  test.fail('TERMINOLOGY BUG: Total Prompts should be Total Activities', async ({ page }) => {
    // This test is marked .fail to document the known terminology gap.
    // When the label is fixed to "Total Activities", remove .fail and update the assertion.
    await expect(page.getByText('Total Activities')).toBeVisible();
  });
});
