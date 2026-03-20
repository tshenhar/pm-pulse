/**
 * Performance regression tests.
 *
 * Thresholds (adjust in THRESHOLDS below if your machine is consistently slower):
 *   API response  < 500 ms   — dashboard query + JSON serialization, no ingestion blocking
 *   Interactive   < 1500 ms  — time from navigation start until summary cards are visible
 *   Navigation    < 800 ms   — soft nav between pages (client-side routing)
 *
 * Run: npx playwright test performance --reporter=list
 */

import { test, expect } from "@playwright/test";

const THRESHOLDS = {
  apiResponseMs: 500,
  interactiveMs: 1500,
  softNavMs: 800,
};

test.describe("Performance — latency regression", () => {
  test("GET /api/dashboard responds in < 500 ms", async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/dashboard")),
      page.goto("/"),
    ]);

    const timing = response.request().timing();
    const responseTime = timing.responseEnd - timing.requestStart;

    console.log(`/api/dashboard response time: ${Math.round(responseTime)}ms`);
    expect(responseTime, `API responded in ${Math.round(responseTime)}ms — threshold ${THRESHOLDS.apiResponseMs}ms`).toBeLessThan(
      THRESHOLDS.apiResponseMs
    );
  });

  test("dashboard is interactive in < 1500 ms", async ({ page }) => {
    const t0 = Date.now();

    await page.goto("/");

    // "Interactive" = summary cards rendered (data from API has arrived)
    await page.waitForSelector('main [class*="CardTitle"], main h1, main [class*="text-2xl"]', {
      timeout: THRESHOLDS.interactiveMs + 500, // give a little extra for the assertion message
    });

    const tti = Date.now() - t0;
    console.log(`Time to interactive: ${tti}ms`);
    expect(tti, `Interactive in ${tti}ms — threshold ${THRESHOLDS.interactiveMs}ms`).toBeLessThan(
      THRESHOLDS.interactiveMs
    );
  });

  test("soft navigation dashboard → settings is < 800 ms", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const t0 = Date.now();
    await page.getByRole("link", { name: /settings/i }).click();
    // Settings page shows a skeleton or loaded content
    await page.waitForSelector("main", { timeout: THRESHOLDS.softNavMs + 500 });
    const navTime = Date.now() - t0;

    console.log(`Settings soft-nav time: ${navTime}ms`);
    expect(navTime, `Navigation in ${navTime}ms — threshold ${THRESHOLDS.softNavMs}ms`).toBeLessThan(
      THRESHOLDS.softNavMs
    );
  });

  test("soft navigation settings → dashboard is < 800 ms (cached settings)", async ({ page }) => {
    // Pre-warm the settings cache by visiting settings first
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const t0 = Date.now();
    await page.getByRole("link", { name: /pm pulse|back/i }).first().click();
    await page.waitForSelector("main", { timeout: THRESHOLDS.softNavMs + 500 });
    const navTime = Date.now() - t0;

    console.log(`Dashboard soft-nav time (cached): ${navTime}ms`);
    expect(navTime, `Navigation in ${navTime}ms — threshold ${THRESHOLDS.softNavMs}ms`).toBeLessThan(
      THRESHOLDS.softNavMs
    );
  });

  test("GET /api/categories responds in < 200 ms (or from cache)", async ({ page }) => {
    const responses: number[] = [];

    page.on("response", (r) => {
      if (r.url().includes("/api/categories")) {
        const timing = r.request().timing();
        responses.push(timing.responseEnd - timing.requestStart);
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    if (responses.length === 0) {
      // Served from client cache — that's a pass
      console.log("/api/categories: served from client cache (no network request)");
      return;
    }

    const ms = responses[0];
    console.log(`/api/categories response time: ${Math.round(ms)}ms`);
    expect(ms).toBeLessThan(200);
  });
});
