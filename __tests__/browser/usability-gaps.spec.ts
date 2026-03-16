import { test, expect } from '@playwright/test';
import { navigateTo, dismissOnboarding } from './helpers/app';

/**
 * USABILITY GAP TESTS
 *
 * These tests document known UX gaps. They are expected to FAIL until the
 * corresponding feature is implemented. Each failing test = one backlog item.
 *
 * Gap inventory:
 * 1. No info icons on summary cards (Total Time, Focus Time, Meetings, Top Category)
 * 2. No tooltip/explanation for confidence percentage
 * 3. No tooltip for attribution method pill
 * 4. Source badges have no aria-label
 * 5. No Cmd+S shortcut in Settings
 * 6. No explanation of what "Focus Time" includes vs "Total Time"
 * 7. Low-confidence dimming has no legend
 * 8. "Total Prompts" label on Trends page
 */

test.describe('Usability Gaps — Living Backlog', () => {
  test.fail('GAP #1a: Total Time card has an info icon or help text', async ({ page }) => {
    await navigateTo(page, '/');
    await dismissOnboarding(page);
    // Expect an info icon, tooltip trigger, or aria-describedby near the Total Time card
    await expect(
      page.locator('[aria-label*="total time" i], [data-testid*="total-time-info"], [title*="total time" i]')
    ).toBeVisible();
  });

  test.fail('GAP #1b: Focus Time card has an info icon explaining what it includes', async ({ page }) => {
    await navigateTo(page, '/');
    await dismissOnboarding(page);
    await expect(
      page.locator('[aria-label*="focus time" i], [data-testid*="focus-time-info"], [title*="focus time" i]')
    ).toBeVisible();
  });

  test.fail('GAP #1c: Meetings card has an info icon explaining the count', async ({ page }) => {
    await navigateTo(page, '/');
    await dismissOnboarding(page);
    await expect(
      page.locator('[aria-label*="meetings" i], [data-testid*="meetings-info"]')
    ).toBeVisible();
  });

  test.fail('GAP #2: Confidence column header has a tooltip or explanation', async ({ page }) => {
    await navigateTo(page, '/');
    await dismissOnboarding(page);
    // Confidence header should have some tooltip mechanism
    await expect(
      page.locator('th:has-text("Confidence") [data-testid*="info"], th:has-text("Confidence")[title]')
    ).toBeVisible();
  });

  test.fail('GAP #3: Attribution method in sidebar has tooltip explaining what "measured" means', async ({ page }) => {
    await navigateTo(page, '/');
    await dismissOnboarding(page);
    const rows = page.locator('table tbody tr');
    if (await rows.count() > 0) {
      await rows.first().click();
      await expect(
        page.locator('[data-testid*="attribution-info"], [aria-label*="attribution" i]')
      ).toBeVisible({ timeout: 3000 });
    }
  });

  test.fail('GAP #4: Source badge in activity table has aria-label', async ({ page }) => {
    await navigateTo(page, '/');
    await dismissOnboarding(page);
    const rows = page.locator('table tbody tr');
    if (await rows.count() > 0) {
      // Source badge should have an aria-label identifying the source type
      await expect(
        page.locator('table tbody tr').first().locator('[aria-label]')
      ).toBeVisible();
    }
  });

  test.fail('GAP #5: Settings page responds to Cmd+S keyboard shortcut', async ({ page }) => {
    await navigateTo(page, '/settings');
    await page.keyboard.press('Meta+s');
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 2000 });
  });

  test.fail('GAP #6: Low-confidence dimming has a visible legend or footnote', async ({ page }) => {
    await navigateTo(page, '/');
    await dismissOnboarding(page);
    // The app dims rows with confidence < LOW_CONFIDENCE_THRESHOLD but never explains this to users
    // This test expects a legend, footnote, or dedicated explainer text — not just any "40%" string
    await expect(
      page.locator('[data-testid*="confidence-legend"], [data-testid*="low-confidence-note"]')
        .or(page.getByText(/low confidence|dimmed for confidence/i))
    ).toBeVisible();
  });

  test.fail('GAP #7: Source Breakdown chart has a descriptive heading or tooltip', async ({ page }) => {
    await navigateTo(page, '/');
    await dismissOnboarding(page);
    await expect(page.getByText(/how i worked|source breakdown/i)).toBeVisible();
    // Chart should also have aria-label or role="img"
    await expect(
      page.locator('[aria-label*="source" i], [role="img"][aria-label]')
    ).toBeVisible();
  });
});
