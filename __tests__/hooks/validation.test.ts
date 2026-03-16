import { describe, it, expect } from "vitest";

// Tests for hook field validation logic
// Since hooks are standalone .mjs scripts that read from stdin,
// we test the validation patterns they use.

describe("Hook Validation Patterns", () => {
  function validatePromptFields(input: Record<string, unknown>): string | null {
    if (!input.prompt || typeof input.prompt !== "string") {
      return "Missing or invalid 'prompt' field";
    }
    if (!input.session_id || typeof input.session_id !== "string") {
      return "Missing or invalid 'session_id' field";
    }
    if (!input.cwd || typeof input.cwd !== "string") {
      return "Missing or invalid 'cwd' field";
    }
    return null;
  }

  function validateSessionFields(input: Record<string, unknown>): string | null {
    if (!input.session_id || typeof input.session_id !== "string") {
      return "Missing or invalid 'session_id' field";
    }
    if (!input.cwd || typeof input.cwd !== "string") {
      return "Missing or invalid 'cwd' field";
    }
    return null;
  }

  describe("on-prompt validation", () => {
    it("accepts valid prompt input", () => {
      expect(
        validatePromptFields({
          prompt: "help me write code",
          session_id: "abc-123",
          cwd: "/Users/test/project",
        })
      ).toBeNull();
    });

    it("rejects missing prompt", () => {
      expect(
        validatePromptFields({
          session_id: "abc-123",
          cwd: "/Users/test/project",
        })
      ).toContain("prompt");
    });

    it("rejects empty prompt", () => {
      expect(
        validatePromptFields({
          prompt: "",
          session_id: "abc-123",
          cwd: "/Users/test/project",
        })
      ).toContain("prompt");
    });

    it("rejects missing session_id", () => {
      expect(
        validatePromptFields({
          prompt: "help",
          cwd: "/Users/test/project",
        })
      ).toContain("session_id");
    });

    it("rejects missing cwd", () => {
      expect(
        validatePromptFields({
          prompt: "help",
          session_id: "abc-123",
        })
      ).toContain("cwd");
    });

    it("rejects numeric prompt", () => {
      expect(
        validatePromptFields({
          prompt: 42,
          session_id: "abc-123",
          cwd: "/Users/test/project",
        })
      ).toContain("prompt");
    });
  });

  describe("on-session-start/end validation", () => {
    it("accepts valid session input", () => {
      expect(
        validateSessionFields({
          session_id: "abc-123",
          cwd: "/Users/test/project",
        })
      ).toBeNull();
    });

    it("rejects missing session_id", () => {
      expect(
        validateSessionFields({
          cwd: "/Users/test/project",
        })
      ).toContain("session_id");
    });

    it("rejects missing cwd", () => {
      expect(
        validateSessionFields({
          session_id: "abc-123",
        })
      ).toContain("cwd");
    });
  });
});
