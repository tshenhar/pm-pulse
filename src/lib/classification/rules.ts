export interface ClassificationRule {
  pattern: RegExp;
  category: string;
  subcategory: string;
  baseConfidence: number;
  boost?: {
    cwdPattern?: RegExp;
    lengthMin?: number;
  };
}

export const RULES: ClassificationRule[] = [
  // === STRATEGY ===
  {
    pattern: /\b(roadmap|prioriti[sz]e|backlog|feature.*(rank|order|sequence))\b/i,
    category: "strategy",
    subcategory: "roadmap",
    baseConfidence: 0.85,
  },
  {
    pattern: /\b(RICE|ICE.scor|MoSCoW|priority.*(matrix|framework))\b/i,
    category: "strategy",
    subcategory: "roadmap",
    baseConfidence: 0.85,
  },
  {
    pattern: /\b(OKRs?|KPIs?|north.star|success.metric|key.result)\b/i,
    category: "strategy",
    subcategory: "okr",
    baseConfidence: 0.9,
  },
  {
    pattern: /\b(competitor|competitive|market.siz|TAM|SAM|SOM)\b/i,
    category: "strategy",
    subcategory: "research",
    baseConfidence: 0.85,
  },
  {
    pattern: /\b(vision.doc|strategy.memo|positioning|strategic.narrative)\b/i,
    category: "strategy",
    subcategory: "vision",
    baseConfidence: 0.85,
  },

  // === REQUIREMENTS ===
  {
    pattern: /\b(PRD|product.requirement|feature.spec|requirement.doc)\b/i,
    category: "requirements",
    subcategory: "prd",
    baseConfidence: 0.9,
  },
  {
    pattern: /\b(user.stor|epic|acceptance.criteria|story.point|sprint.plan)\b/i,
    category: "requirements",
    subcategory: "epic",
    baseConfidence: 0.85,
  },
  {
    pattern: /\b(API.contract|schema|data.model|endpoint.design|system.design)\b/i,
    category: "requirements",
    subcategory: "technical",
    baseConfidence: 0.8,
  },
  {
    pattern: /\b(user.flow|wireframe|design.brief|UX.spec|mockup)\b/i,
    category: "requirements",
    subcategory: "ux",
    baseConfidence: 0.85,
  },

  // === COMMUNICATION ===
  {
    pattern: /\b(status.update|executive.summary|board.memo|stakeholder.update)\b/i,
    category: "communication",
    subcategory: "stakeholder",
    baseConfidence: 0.85,
  },
  {
    pattern: /\b(meeting.notes?|agenda|action.items?|synthesize.*notes|meeting.prep)\b/i,
    category: "communication",
    subcategory: "meetings",
    baseConfidence: 0.85,
  },
  {
    pattern: /\b(slide|presentation|demo.script|talking.points|quarterly.review)\b/i,
    category: "communication",
    subcategory: "presentation",
    baseConfidence: 0.85,
  },
  {
    pattern: /\b(RACI|cross.functional|decision.log|alignment)\b/i,
    category: "communication",
    subcategory: "alignment",
    baseConfidence: 0.8,
  },

  // === WRITING ===
  {
    pattern: /\b(PRFAQ|PR.FAQ|press.release|6.pager|six.pager|narrative.memo)\b/i,
    category: "writing",
    subcategory: "prfaq",
    baseConfidence: 0.9,
  },
  {
    pattern: /\b(runbook|playbook|onboarding.*(doc|guide)|how.to.guide|SOP)\b/i,
    category: "writing",
    subcategory: "process",
    baseConfidence: 0.85,
  },
  {
    pattern: /\b(draft.*(email|blog|proposal)|write.*(email|blog|post|letter))\b/i,
    category: "writing",
    subcategory: "general",
    baseConfidence: 0.8,
  },

  // === ANALYTICS ===
  {
    pattern: /\b(SQL|query|churn|cohort|funnel|conversion.rate)\b/i,
    category: "analytics",
    subcategory: "data",
    baseConfidence: 0.8,
  },
  {
    pattern: /\b(dashboard.spec|metric.summary|report.*(create|build|design))\b/i,
    category: "analytics",
    subcategory: "reporting",
    baseConfidence: 0.8,
  },
  {
    pattern: /\b(A\/B.test|experiment|hypothesis|control.group|variant)\b/i,
    category: "analytics",
    subcategory: "experimentation",
    baseConfidence: 0.85,
  },

  // === DEVELOPMENT ===
  {
    pattern: /\b(fix|debug|bug|error|crash|stack.trace|undefined|TypeError|null.pointer)\b/i,
    category: "development",
    subcategory: "coding",
    baseConfidence: 0.8,
  },
  {
    pattern: /\b(function|component|import|export|class |const |let |var |=>|async |await )\b/i,
    category: "development",
    subcategory: "coding",
    baseConfidence: 0.7,
  },
  {
    pattern: /\b(implement|refactor|code.review|pull.request|merge|commit)\b/i,
    category: "development",
    subcategory: "coding",
    baseConfidence: 0.75,
  },
  {
    pattern: /\b(architect|infrastructure|microservice|event.stream|scaling)\b/i,
    category: "development",
    subcategory: "architecture",
    baseConfidence: 0.8,
  },
  {
    pattern: /\b(CI\/CD|pipeline|deploy|internal.tool|automation|script|cron)\b/i,
    category: "development",
    subcategory: "tooling",
    baseConfidence: 0.8,
  },
  {
    pattern: /\b(triage|investigate.*crash|reproduce.*bug|P[0-2].bug)\b/i,
    category: "development",
    subcategory: "bugs",
    baseConfidence: 0.85,
  },

  // === PRODUCTIVITY ===
  {
    pattern: /\b(summarize.*(paper|article|book)|explain.*(how|what|concept)|learn|tutorial)\b/i,
    category: "productivity",
    subcategory: "learning",
    baseConfidence: 0.75,
  },
  {
    pattern: /\b(plan.my.(week|day)|TODO|to.do.list|organize.*priority|calendar)\b/i,
    category: "productivity",
    subcategory: "admin",
    baseConfidence: 0.8,
  },
  {
    pattern: /\bclaude\b.*(config|hook|skill|setting)|prompt.engineering|\bMCP.server\b/i,
    category: "productivity",
    subcategory: "meta",
    baseConfidence: 0.9,
  },
];
