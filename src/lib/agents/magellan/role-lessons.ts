import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Magellan's role lessons: how to find and fetch fee schedules better, each from an issue whose
 * root cause was here. A PR that closes such an issue adds its lesson in the same PR (AGENTS.md,
 * "How work runs").
 */
export const MAGELLAN_LESSONS: AgentLesson[] = [
  {
    id: "issue-1033",
    agent: "magellan",
    stage: "discover",
    lesson: "Before storing a document, confirm it is this bank's own fee document: refuse a link on another institution's or an unconfirmed host, and a CRA public file, annual report or flyer, unless the file itself is the bank's schedule of fees.",
    why: "Wrong-bank and non-fee documents passed discovery and were caught only after publishing: 815 live fees were taken down in 7 days as another bank's or an unconfirmed host's document, and the largest stored files included CRA public files and a marketing flyer (Oct 12 review).",
    evidence: { issues: [1033, 1027], prs: [1151], files: ["docs/plans/magellan-review-2026-10-12.md", "src/lib/agents/magellan/link-coverage.ts", "src/lib/agents/magellan/other-bank-host.ts"] },
    appliesTo: "all",
    since: "2026-10-13",
  },
  {
    id: "issue-1031",
    agent: "magellan",
    stage: "paid search",
    lesson: "Time a bank's next paid search from its own last try, not the calendar: leave a bank whose schedule was found for 90 days and retry a miss after 30 (longer once a bank has missed twice), so the budget goes to banks that are due rather than to everyone on the 1st.",
    why: "Each paid try was limited to once per calendar month, so found or not, every institution became due again on the 1st (Oct 12 review). The longer hold after a second miss came with #1032.",
    evidence: { issues: [1031, 1032, 1027], prs: [1219], files: ["docs/plans/magellan-review-2026-10-12.md", "src/lib/agents/magellan/cooldowns.ts", "src/lib/agents/magellan/escalation.ts"] },
    appliesTo: ["discover-paid"],
    since: "2026-10-13",
  },
];
