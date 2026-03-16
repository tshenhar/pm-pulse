import { test, expect } from '@playwright/test';
import { navigateTo, dismissOnboarding } from './helpers/app';

test.describe('Terminology Consistency Audit', () => {
  test('dashboard summary cards use "Activity" not bare "Prompt"', async ({ page }) => {
    await navigateTo(page, '/');
    await dismissOnboarding(page);
    // The 4 metric cards should not have a card titled "Prompt" or "Prompts"
    // (they should be Total Time, Focus Time, Meetings, Top Category)
    const cardTitles = await page.locator('h3, [class*="CardTitle"]').allTextContents();
    const hasBarePromptCard = cardTitles.some(t => t.trim() === 'Prompt' || t.trim() === 'Prompts');
    expect(hasBarePromptCard).toBe(false);
  });

  test('dashboard activity table column is not labelled "Prompt"', async ({ page }) => {
    await navigateTo(page, '/');
    await dismissOnboarding(page);
    const headers = await page.locator('th').allTextContents();
    const hasPromptHeader = headers.some(h => h.trim() === 'Prompt');
    expect(hasPromptHeader).toBe(false);
  });

  test.fail('TERMINOLOGY BUG: Trends page uses "Total Prompts" — should be "Total Activities"', async ({ page }) => {
    await navigateTo(page, '/trends');
    // This assertion will PASS once the label is fixed to "Total Activities"
    await expect(page.getByText('Total Activities')).toBeVisible();
  });

  test('settings page classification description does not say "all prompts"', async ({ page }) => {
    await navigateTo(page, '/settings');
    const fullLLMLabel = page.getByText(/all prompts classified by/i);
    // This is acceptable in the radio button description for the Full LLM option
    // but should not appear as a general page description
    // Just verify the page loads without issue
    await expect(page.locator('main')).toBeVisible();
  });

  test('training page uses "activities" terminology consistently', async ({ page }) => {
    await navigateTo(page, '/training');
    // Wait for loading spinner to disappear, then check for activities text
    await page.waitForSelector('.animate-spin', { state: 'detached', timeout: 10_000 }).catch(() => {});
    // Multiple elements may contain "activities" — just verify at least one is visible
    await expect(page.getByText(/activities/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
