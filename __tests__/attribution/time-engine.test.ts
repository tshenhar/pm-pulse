import { describe, it, expect } from "vitest";
import {
  attributeSession,
  attributeSingle,
} from "../../src/lib/attribution/time-engine";
import { detectSessions } from "../../src/lib/attribution/session-detector";

function makePrompt(timestamp: string, session_id: string = "s1") {
  return { timestamp, session_id };
}

describe("time-engine", () => {
  describe("attributeSession — raw gap attribution", () => {
    it("measured gap: 5 min → 5 min, explained quality", () => {
      const prompts = [
        makePrompt("2026-03-12T09:00:00Z"),
        makePrompt("2026-03-12T09:05:00Z"),
      ];
      const results = attributeSession(prompts);
      // First prompt: 5 min gap, measured
      expect(results[0].attributed_minutes).toBe(5);
      expect(results[0].attribution_method).toBe("measured");
      expect(results[0].time_confidence).toBe("explained");
      expect(results[0].gap_to_next_seconds).toBe(300);
    });

    it("large gap: 90 min → 90 min raw (no cap), unexplained quality", () => {
      const prompts = [
        makePrompt("2026-03-12T09:00:00Z"),
        makePrompt("2026-03-12T10:30:00Z"),
      ];
      const results = attributeSession(prompts);
      expect(results[0].attributed_minutes).toBe(90);
      expect(results[0].attribution_method).toBe("measured");
      expect(results[0].time_confidence).toBe("unexplained");
    });

    it("small gap: 30 sec → 0.5 min raw (no floor)", () => {
      const prompts = [
        makePrompt("2026-03-12T09:00:00Z"),
        makePrompt("2026-03-12T09:00:30Z"),
      ];
      const results = attributeSession(prompts);
      expect(results[0].attributed_minutes).toBe(0.5);
      expect(results[0].attribution_method).toBe("measured");
      expect(results[0].time_confidence).toBe("explained");
    });

    it("last prompt: pending with 0 minutes", () => {
      const prompts = [
        makePrompt("2026-03-12T09:00:00Z"),
        makePrompt("2026-03-12T09:05:00Z"),
        makePrompt("2026-03-12T09:10:00Z"),
      ];
      const results = attributeSession(prompts);
      expect(results[2].attribution_method).toBe("pending");
      expect(results[2].time_confidence).toBe("pending");
      expect(results[2].attributed_minutes).toBe(0);
      expect(results[2].gap_to_next_seconds).toBeNull();
    });

    it("single prompt session → pending with 0 min", () => {
      const prompts = [makePrompt("2026-03-12T09:00:00Z")];
      const results = attributeSession(prompts);
      expect(results[0].attributed_minutes).toBe(0);
      expect(results[0].attribution_method).toBe("pending");
      expect(results[0].time_confidence).toBe("pending");
    });

    it("15 min gap is explained, 16 min is unexplained", () => {
      const prompts15 = [
        makePrompt("2026-03-12T09:00:00Z"),
        makePrompt("2026-03-12T09:15:00Z"),
      ];
      expect(attributeSession(prompts15)[0].time_confidence).toBe("explained");

      const prompts16 = [
        makePrompt("2026-03-12T09:00:00Z"),
        makePrompt("2026-03-12T09:16:00Z"),
      ];
      expect(attributeSession(prompts16)[0].time_confidence).toBe("unexplained");
    });
  });

  describe("attributeSingle", () => {
    it("retroactive fix-up: computes from raw gap", () => {
      const result = attributeSingle(10, false, 600);
      expect(result.attributed_minutes).toBe(10);
      expect(result.attribution_method).toBe("measured");
      expect(result.time_confidence).toBe("explained");
      expect(result.gap_to_next_seconds).toBe(600);
    });

    it("last prompt: returns pending", () => {
      const result = attributeSingle(0, true, null);
      expect(result.attributed_minutes).toBe(0);
      expect(result.attribution_method).toBe("pending");
      expect(result.time_confidence).toBe("pending");
    });
  });
});

describe("session-detector", () => {
  it("keeps prompts within gap threshold in same session", () => {
    const prompts = [
      makePrompt("2026-03-12T09:00:00Z"),
      makePrompt("2026-03-12T09:10:00Z"),
      makePrompt("2026-03-12T09:20:00Z"),
    ];
    const sessions = detectSessions(prompts, 30);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toHaveLength(3);
  });

  it("splits sessions at 31 min gap", () => {
    const prompts = [
      makePrompt("2026-03-12T09:00:00Z"),
      makePrompt("2026-03-12T09:10:00Z"),
      makePrompt("2026-03-12T09:41:00Z"), // 31 min gap
      makePrompt("2026-03-12T09:50:00Z"),
    ];
    const sessions = detectSessions(prompts, 30);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toHaveLength(2);
    expect(sessions[1]).toHaveLength(2);
  });

  it("handles empty input", () => {
    expect(detectSessions([], 30)).toHaveLength(0);
  });

  it("single prompt = single session", () => {
    const sessions = detectSessions([makePrompt("2026-03-12T09:00:00Z")], 30);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toHaveLength(1);
  });

  it("sorts unsorted prompts correctly", () => {
    const prompts = [
      makePrompt("2026-03-12T09:20:00Z"),
      makePrompt("2026-03-12T09:00:00Z"),
      makePrompt("2026-03-12T09:10:00Z"),
    ];
    const sessions = detectSessions(prompts, 30);
    expect(sessions).toHaveLength(1);
    expect(sessions[0][0].timestamp).toBe("2026-03-12T09:00:00Z");
  });
});
