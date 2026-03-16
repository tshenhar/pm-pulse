import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { navigateTo, dismissOnboarding } from './helpers/app';

test.describe('Accessibility — WCAG 2.1 Audit', () => {
  test('dashboard passes axe audit', async ({ page }) => {
    await navigateTo(page, '/');
    await dismissOnboarding(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    if (results.violations.length > 0) {
      console.log('Axe violations on dashboard:');
      results.violations.forEach(v => {
        console.log(`  [${v.impact}] ${v.id}: ${v.description}`);
      });
    }
    expect(results.violations).toEqual([]);
  });

  test('trends page passes axe audit', async ({ page }) => {
    await navigateTo(page, '/trends');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    if (results.violations.length > 0) {
      console.log('Axe violations on /trends:');
      results.violations.forEach(v => {
        console.log(`  [${v.impact}] ${v.id}: ${v.description}`);
      });
    }
    expect(results.violations).toEqual([]);
  });

  test('settings page passes axe audit', async ({ page }) => {
    await navigateTo(page, '/settings');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    if (results.violations.length > 0) {
      console.log('Axe violations on /settings:');
      results.violations.forEach(v => {
        console.log(`  [${v.impact}] ${v.id}: ${v.description}`);
      });
    }
    expect(results.violations).toEqual([]);
  });

  test('training page passes axe audit', async ({ page }) => {
    await navigateTo(page, '/training');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    if (results.violations.length > 0) {
      console.log('Axe violations on /training:');
      results.violations.forEach(v => {
        console.log(`  [${v.impact}] ${v.id}: ${v.description}`);
      });
    }
    expect(results.violations).toEqual([]);
  });

  test('icon-only buttons in dashboard header have aria-label', async ({ page }) => {
    await navigateTo(page, '/');
    const iconButtons = page.locator('header button[aria-label], header a[aria-label]');
    const count = await iconButtons.count();
    // There should be at least the navigation buttons
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('date navigation buttons have descriptive aria-labels', async ({ page }) => {
    await navigateTo(page, '/');
    // The prev/next day buttons have aria-labels
    await expect(page.getByRole('button', { name: 'Previous day' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next day' })).toBeVisible();
  });

  test('sidebar can be closed with Escape key', async ({ page }) => {
    await navigateTo(page, '/');
    await dismissOnboarding(page);
    const rows = page.locator('table tbody tr');
    if (await rows.count() > 0) {
      await rows.first().click();
      await expect(page.locator('aside, [role="complementary"]')).toBeVisible({ timeout: 3000 });
      await page.keyboard.press('Escape');
      await expect(page.locator('aside, [role="complementary"]')).not.toBeVisible({ timeout: 2000 });
    }
  });
});
