import { test, expect } from '@playwright/test';
import { navigateTo } from './helpers/app';

test.describe('Training Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, '/training');
  });

  test('page loads at /training', async ({ page }) => {
    await expect(page).toHaveURL(/\/training/);
    // The training page renders a div with min-h-screen (either loading spinner or content)
    await expect(page.locator('div.min-h-screen')).toBeVisible();
  });

  test('back button is present', async ({ page }) => {
    // Wait for loading state to clear first
    await page.waitForSelector('.animate-spin', { state: 'detached', timeout: 10_000 }).catch(() => {});
    await expect(page.getByRole('button', { name: /back/i })).toBeVisible({ timeout: 10_000 });
  });

  test('page heading mentions Classification Training', async ({ page }) => {
    await expect(page.getByText(/classification training/i)).toBeVisible();
  });

  test('start batch card is shown when no active batch', async ({ page }) => {
    // If no active batch, the start card should be visible
    const startCard = page.getByText(/start a training batch/i);
    const batchStatus = page.getByText(/collecting|reviewing/i);
    const hasStart = await startCard.isVisible().catch(() => false);
    const hasBatch = await batchStatus.isVisible().catch(() => false);
    // One of the two should be visible
    expect(hasStart || hasBatch).toBe(true);
  });

  test('batch size buttons are visible (25/50/100)', async ({ page }) => {
    const startCard = page.getByText(/start a training batch/i);
    if (await startCard.isVisible()) {
      await expect(page.getByRole('button', { name: '25 activities' })).toBeVisible();
      await expect(page.getByRole('button', { name: '50 activities' })).toBeVisible();
      await expect(page.getByRole('button', { name: '100 activities' })).toBeVisible();
    }
  });
});
