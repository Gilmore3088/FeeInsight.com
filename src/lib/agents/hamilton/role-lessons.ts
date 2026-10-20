import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Hamilton's role lessons: how to analyse and answer better, each from an issue whose root cause
 * was here. `written-answer` is Hamilton's written answer (`hamilton/written-answer-read.ts`),
 * which adds these to its instructions. A PR that closes such an issue adds its lesson in the same
 * PR (AGENTS.md, "How work runs").
 */
export const HAMILTON_LESSONS: AgentLesson[] = [
  {
    id: "issue-2190",
    agent: "hamilton",
    stage: "analysis",
    lesson: "Every count and median Hamilton shows reads active institutions only; an institution the regulator lists as inactive is left out of every reader, not just the headline figure.",
    why: "State market medians, the directory's per-state counts and several other public readers counted every institution, including inactive ones, beside figures that did filter.",
    evidence: { issues: [2190], prs: [2172, 2390], files: ["src/lib/data-store/fee-stats.ts"] },
    appliesTo: "all",
    since: "2026-10-19",
  },
  {
    id: "issue-2373",
    agent: "hamilton",
    stage: "written answer",
    lesson: "When a coverage count could not be read, say it is unknown; never state zero observations, categories or institutions from a failed lookup.",
    why: "An optional published-fee count query timed out, getPublicStats returned zeros, and the cached zeros let Hamilton's instructions claim zero coverage for ten minutes.",
    evidence: { issues: [2373], prs: [2353], files: ["src/lib/public-stats.ts"] },
    appliesTo: ["written-answer"],
    since: "2026-10-19",
  },
  {
    id: "issue-2327",
    agent: "hamilton",
    stage: "written answer",
    lesson: "The institution briefing you are given is evidence, like a tool result: a figure taken correctly from it is supported, so use it and cite it as you would a tool result.",
    why: "The written-answer check was passed only tool results, so a correct Navy Federal answer built from the briefing's fee-income figures was withheld as unsupported.",
    evidence: { issues: [2327], prs: [2337], files: ["src/lib/hamilton/written-answer-read.ts"] },
    appliesTo: ["written-answer"],
    since: "2026-10-19",
  },
  {
    id: "pr-985-subject-not-account",
    agent: "hamilton",
    stage: "written answer",
    lesson: "The institution being researched is not the account's own: \"this institution\" is the research subject, and \"we\", \"our\" or \"your institution\" mean the account institution only when its current membership identifies one; browsing or a saved research preference never does. A saved answer keeps the subject it was written about.",
    why: "The written-answer request named the profile's institution only when no research institution was selected, a URL visit saved the viewed institution as the workspace preference when none was saved, saved answers took the browsed institution from the URL over their own, and public NCUA filing cards for a researched credit union were labelled YOUR OWN FIGURES.",
    evidence: { issues: [976], prs: [985], files: ["docs/project/findings/2026-10-10-hamilton-account-versus-research-context.md", "docs/project/findings/2026-10-10-hamilton-browse-is-not-workspace-selection.md", "docs/project/findings/2026-10-10-hamilton-saved-answer-subject.md", "docs/project/findings/2026-10-10-hamilton-preview-acceptance.md", "src/lib/hamilton/request-contract.ts"] },
    appliesTo: "all",
    since: "2026-10-10",
  },
  {
    id: "pr-985-peer-list-task",
    agent: "hamilton",
    stage: "analysis",
    lesson: "A request to list institutions, such as ten similarly sized credit unions, is answered as an institution list from each institution's latest dated filing, not turned into a fee question. Regulators' asset figures are stored in thousands, and a missing latest figure is never filled from an older filing or from deposits.",
    why: "The segment path asked about one fee and could default a segment with no named fee to overdraft, and the local-market answer had no dated total assets; the first draft also followed a stale comment that called stored assets dollars, where FDIC keeps reported assets in thousands and NCUA's are divided by 1,000.",
    evidence: { issues: [977], prs: [985], files: ["docs/project/findings/2026-10-10-hamilton-peer-list-task.md"] },
    appliesTo: "all",
    since: "2026-10-10",
  },
  {
    id: "pr-995-record-bound-evidence",
    agent: "hamilton",
    stage: "evidence",
    lesson: "A figure is supported only when it is bound to its institution, fee category, unit and source record; a number that merely matches some value in the evidence never earns high confidence, and a storyline with no record bindings is at most medium.",
    why: "The figure checker accepted a narrative number when its magnitude matched any payload value or difference, and deterministic storylines were saved as high confidence with no claim-level record bindings.",
    evidence: { issues: [981], prs: [995], files: ["docs/project/findings/2026-10-10-hamilton-evidence-contract.md", "src/lib/hamilton/evidence-contract.ts"] },
    appliesTo: "all",
    since: "2026-10-10",
  },
  {
    id: "pr-1526-verified-peers-only",
    agent: "hamilton",
    stage: "analysis",
    lesson: "A peer statistic from a linked source, such as CFPB complaints, counts only peers whose link is verified and says how many that is; an institution with no verified match has an unknown count, never zero, and too few verified peers means no comparison.",
    why: "On Oct 15 only 210 of 8,497 institutions eligible for the complaint comparison had an accepted CFPB match, yet every peer with no CFPB link counted as zero complaints, pulling peer medians toward 0, and an unmatched bank was told it had 0 CFPB fee complaints.",
    evidence: { issues: [1523], prs: [1526], files: ["docs/project/findings/2026-10-15-cfpb-unmatched-peers-as-zero.md", "src/lib/data-store/complaints.ts"] },
    appliesTo: "all",
    since: "2026-10-15",
  },
];
