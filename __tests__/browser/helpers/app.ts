import { Page } from '@playwright/test';

export async function navigateTo(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

export async function waitForDashboard(page: Page) {
  // Wait for either the onboarding card OR the summary cards
  await page.waitForSelector('main', { timeout: 10_000 });
}

export async function dismissOnboarding(page: Page) {
  const dismissBtn = page.getByRole('button', { name: /dismiss/i });
  if (await dismissBtn.isVisible()) {
    await dismissBtn.click();
    await page.waitForTimeout(300);
  }
}
