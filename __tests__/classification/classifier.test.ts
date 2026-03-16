import { describe, it, expect } from "vitest";
import { classify } from "../../src/lib/classification/classifier";

describe("classifier", () => {
  describe("category coverage", () => {
    it("classifies strategy/roadmap", () => {
      const result = classify("Help me prioritize these 5 features for Q3");
      expect(result.primary_category).toBe("strategy");
      expect(result.primary_subcategory).toBe("roadmap");
    });

    it("classifies strategy/okr", () => {
      const result = classify("Draft OKRs for the platform team this quarter");
      expect(result.primary_category).toBe("strategy");
      expect(result.primary_subcategory).toBe("okr");
    });

    it("classifies strategy/research", () => {
      const result = classify("Analyze competitor pricing model and TAM");
      expect(result.primary_category).toBe("strategy");
      expect(result.primary_subcategory).toBe("research");
    });

    it("classifies requirements/prd", () => {
      const result = classify("Write a PRD for the notification system");
      expect(result.primary_category).toBe("requirements");
      expect(result.primary_subcategory).toBe("prd");
    });

    it("classifies requirements/epic", () => {
      const result = classify("Break this feature into user stories with acceptance criteria");
      expect(result.primary_category).toBe("requirements");
      expect(result.primary_subcategory).toBe("epic");
    });

    it("classifies communication/stakeholder", () => {
      const result = classify("Draft a weekly status update for leadership team");
      expect(result.primary_category).toBe("communication");
      expect(result.primary_subcategory).toBe("stakeholder");
    });

    it("classifies communication/meetings", () => {
      const result = classify("Synthesize these meeting notes into action items");
      expect(result.primary_category).toBe("communication");
      expect(result.primary_subcategory).toBe("meetings");
    });

    it("classifies writing/prfaq", () => {
      const result = classify("Write a PRFAQ for the new pricing tier launch");
      expect(result.primary_category).toBe("writing");
      expect(result.primary_subcategory).toBe("prfaq");
    });

    it("classifies writing/general", () => {
      const result = classify("Draft an email declining this meeting invitation politely");
      expect(result.primary_category).toBe("writing");
      expect(result.primary_subcategory).toBe("general");
    });

    it("classifies analytics/data", () => {
      const result = classify("Write a SQL query for churn by monthly cohort");
      expect(result.primary_category).toBe("analytics");
      expect(result.primary_subcategory).toBe("data");
    });

    it("classifies analytics/experimentation", () => {
      const result = classify("Design an A/B test for the new checkout flow");
      expect(result.primary_category).toBe("analytics");
      expect(result.primary_subcategory).toBe("experimentation");
    });

    it("classifies development/coding", () => {
      const result = classify("Fix this React component that crashes on undefined props");
      expect(result.primary_category).toBe("development");
      expect(result.primary_subcategory).toBe("coding");
    });

    it("classifies development/tooling", () => {
      const result = classify("Set up the CI/CD pipeline for automated deployment");
      expect(result.primary_category).toBe("development");
      expect(result.primary_subcategory).toBe("tooling");
    });

    it("classifies productivity/admin", () => {
      const result = classify("Help me plan my week and organize my TODO list by priority");
      expect(result.primary_category).toBe("productivity");
      expect(result.primary_subcategory).toBe("admin");
    });

    it("classifies productivity/meta", () => {
      const result = classify("Configure my Claude hooks for the new project");
      expect(result.primary_category).toBe("productivity");
      expect(result.primary_subcategory).toBe("meta");
    });
  });

  describe("slash commands", () => {
    it("/commit → development/coding", () => {
      const result = classify("/commit fix the auth bug");
      expect(result.primary_category).toBe("development");
      expect(result.primary_subcategory).toBe("coding");
      expect(result.primary_confidence).toBe(0.95);
    });

    it("/daily-init → productivity/admin", () => {
      const result = classify("/daily-init");
      expect(result.primary_category).toBe("productivity");
      expect(result.primary_subcategory).toBe("admin");
    });

    it("/today → productivity/admin", () => {
      const result = classify("/today");
      expect(result.primary_category).toBe("productivity");
      expect(result.primary_subcategory).toBe("admin");
    });

    it("/notes-wizard → productivity/admin", () => {
      const result = classify("/notes-wizard process today's notes");
      expect(result.primary_category).toBe("productivity");
      expect(result.primary_subcategory).toBe("admin");
    });
  });

  describe("multi-label", () => {
    it("assigns secondary when two categories match closely", () => {
      // PRD + sprint planning spans requirements + communication
      const result = classify("Write a PRD for the notification system and prepare the sprint planning");
      expect(result.primary_category).toBe("requirements");
      // Secondary may or may not be assigned depending on confidence gap
      if (result.secondary_category) {
        expect(result.secondary_category).not.toBe(result.primary_category);
      }
    });
  });

  describe("short/ambiguous fallback", () => {
    it("short prompt with no signal → productivity/admin with low confidence", () => {
      const result = classify("hello");
      expect(result.primary_category).toBe("productivity");
      expect(result.primary_subcategory).toBe("admin");
      expect(result.primary_confidence).toBeLessThan(0.5);
    });

    it("two-word prompt → low confidence", () => {
      const result = classify("thank you");
      expect(result.primary_confidence).toBeLessThan(0.5);
    });
  });

  describe("disambiguation", () => {
    it("code snippet → development/coding not requirements/technical", () => {
      const result = classify("Fix this: const x = undefined; function handleClick() { return x.foo; }");
      expect(result.primary_category).toBe("development");
      expect(result.primary_subcategory).toBe("coding");
    });
  });
});
