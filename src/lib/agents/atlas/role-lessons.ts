import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Atlas's role lessons: how to run the crew better, each from an issue whose root cause was here.
 * A PR that closes such an issue adds its lesson in the same PR (AGENTS.md, "How work runs").
 */
export const ATLAS_LESSONS: AgentLesson[] = [
  {
    id: "issue-2198",
    agent: "atlas",
    stage: "scheduling",
    lesson: "A capped optional paid pass is skipped with a receipt and its lane carries on with its free steps; a budget limit never strands deterministic work.",
    why: "Queue selection excluded any lane whose next step was a paid pass while paid steps were not allowed, so the executor's skip was unreachable and three stalled lanes could fill every active lane slot.",
    evidence: { issues: [2198], prs: [2208], files: ["src/lib/agents/run-store.ts"] },
    appliesTo: "all",
    since: "2026-10-19",
  },
  {
    id: "issue-2206",
    agent: "atlas",
    stage: "daily brief",
    lesson: "The brief's headline count matches the problems it lists, and each problem names its error, owner, next action and link; an empty check is never reported as a successful load.",
    why: "The brief headlined the needs-you count and then added health and storage warnings outside it, printed only alert titles, and counted empty checks as successes.",
    evidence: { issues: [2206], prs: [2251, 2267], files: ["src/lib/agents/daily-brief.ts"] },
    appliesTo: "all",
    since: "2026-10-19",
  },
  {
    id: "pr-846-rules-version-reread",
    agent: "atlas",
    stage: "priority runs",
    lesson: "When Knox's rules version changes, a priority bank (a $10B+ or market-leader bank with no live overdraft fee, or a bank named in a request) whose current page the new version has not read runs again through the direct path once per version, without waiting for its state's lane.",
    why: "Knox v57 went live at 05:14 UTC on Oct 9 and an hour later had not read Arvest's or Old National's pages: re-reads ran only inside queued state lanes, a version bump never made a lane due, and the overdraft-gap tier held all 35 such banks for 7 days after any direct run, 34 of them with a current page unread at v57.",
    evidence: { issues: [], prs: [846, 861], files: ["docs/project/findings/2026-10-09-rules-fix-waits-for-queued-lane.md", "src/lib/agents/atlas/priority-institutions.ts"] },
    appliesTo: "all",
    since: "2026-10-09",
  },
  {
    id: "pr-1324-score-key-document",
    agent: "atlas",
    stage: "answer-key score",
    lesson: "Score the answer key's fee stages only on rows read from the key's own document (the same address or the same bytes), and count the bank's other documents' rows on their own, so a real tier from another page is never scored as a wrong prediction.",
    why: "Scorer v1 compared every live row at a bank with one hand-checked document: 11 of the 14 wrong live monthly maintenance predictions on the 46 tuning banks came from another document, among them Wells Fargo's Everyday, Prime and Premier checking pages against a key read from its Clear Access summary.",
    evidence: { issues: [1280], prs: [1324], files: ["docs/project/findings/2026-10-14-answer-key-one-document-scope.md", "src/lib/agents/answer-key-score.ts"] },
    appliesTo: ["score-answer-key"],
    since: "2026-10-14",
  },
  {
    id: "pr-1378-measured-budgets",
    agent: "atlas",
    stage: "scheduling",
    lesson: "Budget each step from its measured time and re-measure when its p90 moves; a step that runs longer than a tick allows, such as hamilton-answer-eval, runs from its own route and is never started by the tick.",
    why: "Step budgets still held the Oct 7 values (publish budgeted 30 s against about 80 s), and hamilton-answer-eval had no entry, so it was budgeted 120 s while it runs 200 to 370 s; when the tick started it, ticks were killed, and runs 6483 and 6552 failed after three tries.",
    evidence: { issues: [], prs: [1378], files: ["docs/project/findings/2026-10-15-lane-tick-budget.md", "src/lib/agents/run-store.ts"] },
    appliesTo: "all",
    since: "2026-10-15",
  },
];
