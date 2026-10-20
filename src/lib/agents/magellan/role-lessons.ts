import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Magellan's role lessons: how to find and fetch fee schedules better, each from an issue whose
 * root cause was here. A PR that closes such an issue adds its lesson in the same PR (AGENTS.md,
 * "How work runs").
 */
export const MAGELLAN_LESSONS: AgentLesson[] = [
  {
    id: "issue-1051",
    agent: "magellan",
    stage: "discover",
    lesson: "A page opened for its links passes the same check as a candidate link before it is accepted as the schedule: a page quoting a few fees is a product page until its address and content prove otherwise, and a page is judged by where it landed, not the address asked for.",
    why: "The hub and crawl finders accepted any page with 3 fee lines, nav and footer included, without the product-page, business-only or host checks: 523 of 526 thin-bank finds in the week to Oct 20 were such pages, 478 at product addresses, and redirect aliases of pages Rosetta had rejected were saved again.",
    evidence: { issues: [1051], prs: [], files: ["src/lib/agents/magellan/finders.ts", "src/lib/agents/magellan/find-validate.ts"] },
    appliesTo: "all",
    since: "2026-10-20",
  },
];
