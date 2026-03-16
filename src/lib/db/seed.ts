import { getDb } from "../db";
import { DEFAULT_SETTINGS } from "../types";

interface CategoryDef {
  slug: string;
  name: string;
  description: string;
  color: string;
  subcategories: {
    slug: string;
    name: string;
    description: string;
    example_prompts: string[];
  }[];
}

const CATEGORIES: CategoryDef[] = [
  {
    slug: "strategy",
    name: "Strategy & Planning",
    description:
      "Deciding what to build and why. Forward-looking work that shapes direction.",
    color: "#6366F1", // indigo
    subcategories: [
      {
        slug: "roadmap",
        name: "Roadmap & Prioritization",
        description: "Feature sequencing, backlog ordering, priority frameworks",
        example_prompts: [
          "Help me prioritize these 5 features for Q3",
          "Apply RICE scoring to this list",
        ],
      },
      {
        slug: "okr",
        name: "Goals & Metrics Definition",
        description: "OKRs, KPIs, success criteria, north star metrics",
        example_prompts: [
          "Draft OKRs for the platform team",
          "Define success metrics for the onboarding flow",
        ],
      },
      {
        slug: "research",
        name: "Market & Competitive Research",
        description: "Competitive analysis, market sizing, trend analysis",
        example_prompts: [
          "Analyze competitor X's pricing model",
          "Summarize the TAM for developer tools",
        ],
      },
      {
        slug: "vision",
        name: "Vision & Strategy Docs",
        description: "Strategy narratives, vision docs, positioning",
        example_prompts: [
          "Write a strategy memo for our AI capabilities",
          "Frame our positioning vs incumbent",
        ],
      },
    ],
  },
  {
    slug: "requirements",
    name: "Requirements & Specifications",
    description:
      "Defining what gets built. Translating needs into buildable artifacts.",
    color: "#F59E0B", // amber
    subcategories: [
      {
        slug: "prd",
        name: "PRDs & Feature Specs",
        description: "Product requirements documents, feature definitions",
        example_prompts: [
          "Write a PRD for the notification system",
          "Define requirements for bulk export",
        ],
      },
      {
        slug: "epic",
        name: "Epics & Stories",
        description: "JIRA epics, user stories, acceptance criteria",
        example_prompts: [
          "Break this feature into user stories",
          "Write acceptance criteria for the search epic",
        ],
      },
      {
        slug: "technical",
        name: "Technical Specs",
        description: "API contracts, data models, architecture decisions",
        example_prompts: [
          "Define the API contract for the search endpoint",
          "Review this database schema",
        ],
      },
      {
        slug: "ux",
        name: "UX & Design Requirements",
        description: "User flows, wireframe descriptions, design briefs",
        example_prompts: [
          "Describe the user flow for onboarding",
          "Write a design brief for the settings page",
        ],
      },
    ],
  },
  {
    slug: "communication",
    name: "Communication & Alignment",
    description:
      "Sharing information with stakeholders. Written and verbal communication.",
    color: "#10B981", // emerald
    subcategories: [
      {
        slug: "stakeholder",
        name: "Stakeholder Updates",
        description: "Executive updates, board memos, status reports",
        example_prompts: [
          "Draft a weekly status update for leadership",
          "Write an executive summary of Q2 progress",
        ],
      },
      {
        slug: "meetings",
        name: "Meeting Notes & Prep",
        description: "Meeting summaries, agendas, action items",
        example_prompts: [
          "Synthesize these meeting notes",
          "Prepare an agenda for the product review",
        ],
      },
      {
        slug: "presentation",
        name: "Presentations & Demos",
        description: "Slide decks, demo scripts, talking points",
        example_prompts: [
          "Create a slide outline for the quarterly review",
          "Write demo talking points",
        ],
      },
      {
        slug: "alignment",
        name: "Cross-Functional Alignment",
        description: "RACI matrices, team coordination, decision logs",
        example_prompts: [
          "Create a RACI for the launch",
          "Draft a decision log for the migration approach",
        ],
      },
    ],
  },
  {
    slug: "writing",
    name: "Writing & Documentation",
    description: "Long-form writing and knowledge artifacts.",
    color: "#EC4899", // pink
    subcategories: [
      {
        slug: "prfaq",
        name: "PRFAQ & Narratives",
        description: "Amazon-style PRFAQs, press releases, narrative memos",
        example_prompts: [
          "Write a PRFAQ for the new pricing tier",
          "Draft a 6-pager for the platform initiative",
        ],
      },
      {
        slug: "process",
        name: "Process Documentation",
        description: "Runbooks, playbooks, onboarding guides, how-tos",
        example_prompts: [
          "Write onboarding documentation for new PMs",
          "Create a runbook for incident response",
        ],
      },
      {
        slug: "general",
        name: "General Writing",
        description:
          "Emails, proposals, blog posts, any writing not above",
        example_prompts: [
          "Draft an email declining this meeting",
          "Write a blog post about our API launch",
        ],
      },
    ],
  },
  {
    slug: "analytics",
    name: "Analytics & Experimentation",
    description: "Working with data, metrics, and experiments.",
    color: "#3B82F6", // blue
    subcategories: [
      {
        slug: "data",
        name: "Data Analysis",
        description: "SQL queries, data exploration, funnel analysis",
        example_prompts: [
          "Write a SQL query for churn by cohort",
          "Analyze this conversion funnel data",
        ],
      },
      {
        slug: "reporting",
        name: "Reporting & Dashboards",
        description: "Report creation, dashboard specs, metric summaries",
        example_prompts: [
          "Create a dashboard spec for customer health",
          "Summarize this week's metrics",
        ],
      },
      {
        slug: "experimentation",
        name: "Experimentation",
        description:
          "A/B test design, hypothesis formulation, results analysis",
        example_prompts: [
          "Design an A/B test for the new checkout flow",
          "Analyze these experiment results",
        ],
      },
    ],
  },
  {
    slug: "development",
    name: "Development & Technical",
    description: "Hands-on technical work — code, architecture, tooling.",
    color: "#EF4444", // red
    subcategories: [
      {
        slug: "coding",
        name: "Coding & Debugging",
        description: "Writing code, fixing bugs, code review",
        example_prompts: [
          "Fix this React component",
          "Debug why this API returns 500",
        ],
      },
      {
        slug: "architecture",
        name: "Architecture & Design",
        description:
          "System design, technical architecture, infrastructure",
        example_prompts: [
          "Design the event streaming architecture",
          "Review this microservices proposal",
        ],
      },
      {
        slug: "tooling",
        name: "Tooling & Automation",
        description:
          "Internal tools, scripts, CI/CD, developer experience",
        example_prompts: [
          "Build a Slack bot for standup reports",
          "Set up the deployment pipeline",
        ],
      },
      {
        slug: "bugs",
        name: "Bug Triage",
        description: "Bug investigation, reproduction, prioritization",
        example_prompts: [
          "Investigate this customer-reported crash",
          "Triage these P1 bugs",
        ],
      },
    ],
  },
  {
    slug: "productivity",
    name: "Personal Productivity",
    description: "Meta-work: learning, planning, tool configuration.",
    color: "#8B5CF6", // violet
    subcategories: [
      {
        slug: "learning",
        name: "Learning & Research",
        description:
          "Reading summaries, skill development, exploring concepts",
        example_prompts: [
          "Summarize this paper on product-led growth",
          "Explain how event sourcing works",
        ],
      },
      {
        slug: "admin",
        name: "Planning & Admin",
        description:
          "Calendar management, todo lists, personal organization",
        example_prompts: [
          "Help me plan my week",
          "Organize my TODO list by priority",
        ],
      },
      {
        slug: "meta",
        name: "AI & Tooling Setup",
        description:
          "Claude configuration, prompt engineering, tool setup",
        example_prompts: [
          "Configure my Claude hooks",
          "Create a new Claude skill",
        ],
      },
    ],
  },
];

export function seedDatabase(): void {
  const db = getDb();

  // Check if categories already seeded
  const count = db
    .prepare("SELECT COUNT(*) as count FROM categories")
    .get() as { count: number };
  if (count.count > 0) return;

  const insertCategory = db.prepare(
    "INSERT INTO categories (slug, name, description, color, sort_order) VALUES (?, ?, ?, ?, ?)"
  );
  const insertSubcategory = db.prepare(
    "INSERT INTO subcategories (slug, name, description, category_id, sort_order, example_prompts) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertSetting = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
  );

  const seedAll = db.transaction(() => {
    for (let i = 0; i < CATEGORIES.length; i++) {
      const cat = CATEGORIES[i];
      const result = insertCategory.run(
        cat.slug,
        cat.name,
        cat.description,
        cat.color,
        i + 1
      );
      const categoryId = result.lastInsertRowid;

      for (let j = 0; j < cat.subcategories.length; j++) {
        const sub = cat.subcategories[j];
        insertSubcategory.run(
          sub.slug,
          sub.name,
          sub.description,
          categoryId,
          j + 1,
          JSON.stringify(sub.example_prompts)
        );
      }
    }

    // Seed default settings
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insertSetting.run(key, JSON.stringify(value));
    }
  });

  seedAll();
}
