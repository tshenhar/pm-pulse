import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shiftDate, getDayBounds, currentWorkday } from "@/lib/date-utils";

describe("Date Utils", () => {
  describe("shiftDate", () => {
    it("shifts forward by 1 day", () => {
      expect(shiftDate("2026-03-14", 1)).toBe("2026-03-15");
    });

    it("shifts backward across month boundary", () => {
      expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    });

    it("shifts forward across year boundary", () => {
      expect(shiftDate("2025-12-31", 1)).toBe("2026-01-01");
    });
  });

  describe("getDayBounds", () => {
    it("returns 12:00 UTC start for March date (EDT, UTC-4)", () => {
      // March 14 2026 is EDT (UTC-4). 8am ET = 12:00 UTC
      const bounds = getDayBounds("2026-03-14");
      expect(bounds.start).toContain("2026-03-14T12:00:00");
    });

    it("returns 13:00 UTC start for January date (EST, UTC-5)", () => {
      // January 15 2026 is EST (UTC-5). 8am ET = 13:00 UTC
      const bounds = getDayBounds("2026-01-15");
      expect(bounds.start).toContain("2026-01-15T13:00:00");
    });

    it("handles DST spring forward (March 2026 transition)", () => {
      // 2026 spring forward: March 8. Day before is EST, day of is EDT
      const beforeDST = getDayBounds("2026-03-07"); // still EST
      const afterDST = getDayBounds("2026-03-09"); // now EDT

      // EST: 8am = 13:00 UTC; EDT: 8am = 12:00 UTC
      expect(beforeDST.start).toContain("T13:00:00");
      expect(afterDST.start).toContain("T12:00:00");
    });

    it("handles DST fall back (November 2025 transition)", () => {
      // 2025 fall back: November 2. Before is EDT, after is EST
      const beforeDST = getDayBounds("2025-11-01"); // still EDT
      const afterDST = getDayBounds("2025-11-03"); // now EST

      expect(beforeDST.start).toContain("T12:00:00");
      expect(afterDST.start).toContain("T13:00:00");
    });

    it("end is 24h minus 1ms after start", () => {
      const bounds = getDayBounds("2026-03-14");
      const startMs = new Date(bounds.start).getTime();
      const endMs = new Date(bounds.end).getTime();
      expect(endMs - startMs).toBe(24 * 60 * 60 * 1000 - 1);
    });
  });

  describe("currentWorkday", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns yesterday when it is 7:59am ET", () => {
      // 7:59am EDT = 11:59 UTC (March, EDT)
      vi.setSystemTime(new Date("2026-03-14T11:59:00.000Z"));
      expect(currentWorkday()).toBe("2026-03-13");
    });

    it("returns today when it is 8:01am ET", () => {
      // 8:01am EDT = 12:01 UTC (March, EDT)
      vi.setSystemTime(new Date("2026-03-14T12:01:00.000Z"));
      expect(currentWorkday()).toBe("2026-03-14");
    });

    it("returns previous day at midnight ET", () => {
      // Midnight EDT = 04:00 UTC (March, EDT)
      vi.setSystemTime(new Date("2026-03-15T04:00:00.000Z"));
      expect(currentWorkday()).toBe("2026-03-14");
    });

    it("returns same day at 11:59pm ET", () => {
      // 11:59pm EDT = 03:59 UTC next day (March, EDT)
      vi.setSystemTime(new Date("2026-03-15T03:59:00.000Z"));
      expect(currentWorkday()).toBe("2026-03-14");
    });
  });
});
