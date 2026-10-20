import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Gutenberg's role lessons: how to keep the live fee catalog better, each from an issue whose root
 * cause was in publishing. A PR that closes such an issue adds its lesson in the same PR
 * (AGENTS.md, "How work runs").
 */
export const GUTENBERG_LESSONS: AgentLesson[] = [
  {
    id: "issue-2356",
    agent: "gutenberg",
    stage: "publish",
    lesson: "Check that the verified row chosen for publishing is still the current one before any early exit on its category; a caller holding an older snapshot defers instead of writing.",
    why: "In the international publication adapter the non-international category exit came before the snapshot check, so a caller holding the prior international row reached its ordinary write after the verified category had changed to domestic.",
    evidence: { issues: [2356], prs: [2386], files: ["src/lib/agents/knox/international-wire-scope.db.test.ts"] },
    appliesTo: ["publish", "publish-sweeps"],
    since: "2026-10-19",
  },
  {
    id: "issue-1069",
    agent: "gutenberg",
    stage: "publish",
    lesson: "Refuse at publish any fee a live sweep would take down under a rule that already exists (a duplicate of a live fee, a product page, another bank's or an unconfirmed host's document, a business schedule), reading the same rule function the sweep uses. A sweep is for old rows caught by a new rule, not a second gate.",
    why: "The publish check and the later sweeps disagreed on the same rules, so about 7,900 fees a week went live and were taken down within hours or days: 5,943 duplicates, 832 other-bank or unconfirmed-host documents, 745 product pages and 366 business schedules (Oct 12 review).",
    evidence: { issues: [1069, 975], prs: [1224, 1620, 1737, 1789], files: ["docs/plans/hamilton-review-2026-10-12.md", "src/lib/agents/hamilton/publish-sweep-rules.ts"] },
    appliesTo: ["publish", "publish-sweeps"],
    since: "2026-10-20",
  },
  {
    id: "issue-1068",
    agent: "gutenberg",
    stage: "refresh",
    lesson: "When a newer copy of a page carries the same fee at the same amount, move the live row to the newer copy in place; write a new row only when the price really changed.",
    why: "Every re-read published a new row and closed the old one even when nothing changed: 32,556 refreshed-by closures in 7 days and 11,994 institution-fee-amount combinations with three or more rows, inflating every published count, the daily email and the take-down rate (Oct 12 review).",
    evidence: { issues: [1068, 975], prs: [1223], files: ["docs/plans/hamilton-review-2026-10-12.md", "src/lib/agents/hamilton/refresh-copy.ts"] },
    appliesTo: ["publish", "publish-sweeps"],
    since: "2026-10-17",
  },
];
