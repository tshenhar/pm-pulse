export const CATEGORIES = [
  "strategy",
  "requirements",
  "communication",
  "writing",
  "analytics",
  "development",
  "productivity",
] as const;

export type CategorySlug = (typeof CATEGORIES)[number];

export const SUBCATEGORIES: Record<CategorySlug, string[]> = {
  strategy: ["roadmap", "okr", "research", "vision"],
  requirements: ["prd", "epic", "technical", "ux"],
  communication: ["stakeholder", "meetings", "presentation", "alignment"],
  writing: ["prfaq", "process", "general"],
  analytics: ["data", "reporting", "experimentation"],
  development: ["coding", "architecture", "tooling", "bugs"],
  productivity: ["learning", "admin", "meta"],
};

export function isValidCategory(slug: string): slug is CategorySlug {
  return CATEGORIES.includes(slug as CategorySlug);
}

export function isValidSubcategory(
  category: string,
  subcategory: string
): boolean {
  if (!isValidCategory(category)) return false;
  return SUBCATEGORIES[category].includes(subcategory);
}
