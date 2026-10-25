import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Deming's role lessons: how to measure the pipeline better, each from an issue whose root cause
 * was here. A PR that closes such an issue adds its lesson in the same PR (AGENTS.md, "How work
 * runs"). Deming's steps run under Atlas's name and `agent_registry` has no `deming` row, so the
 * lesson sync skips these and says so; the steps still read them.
 */
export const DEMING_LESSONS: AgentLesson[] = [
  {
    id: "pr-2119-bound-not-point",
    agent: "deming",
    stage: "accuracy audit",
    lesson: "Call the stored-copy accuracy target met only when the unrounded 95% Wilson lower bound reaches it over at least 3,400 unique scorable fees from one checker series; below that the status is insufficient. Count each published fee once (its newest verdict) and each daily draw once, pool only one checker series, and never judge a change across a change of series.",
    why: "The automated stored-copy audit pooled rolling events across retries and checker versions and declared its 99.5% target met from a point estimate, so a scoring change could look like a data improvement.",
    evidence: { issues: [2071], prs: [2119], files: ["docs/project/findings/2026-10-19-audit-confidence-history.md", "src/lib/agents/deming/accuracy-measure.ts"] },
    appliesTo: "all",
    since: "2026-10-19",
  },
  {
    id: "issue-2466-reference-binding",
    agent: "deming",
    stage: "answer-key eligibility",
    lesson: "Before trusting a fail-closed measurement gate, count how many real keys it admits; a gate that admits none measures nothing. Bind a reference to what stays stable for its kind (PDF bytes, an HTML page's extracted main text and the key's own lines), ask for a consumer heading only where a schedule has a business section to separate, count discovery incomplete only for an unvisited link that could be a newer fee schedule, and clear a stored hash whenever the reference URL changes.",
    why: "The first eligibility run admitted 0 of 62 confirmed keys: HTML pages changed bytes on every fetch, schedules with no consumer heading were always unproven, any unvisited navigation hub made discovery incomplete, and a key whose URL was edited kept the old document's hash.",
    evidence: { issues: [2466], prs: [2468], files: ["docs/project/findings/2026-10-20-answer-key-eligibility-admits-none.md", "src/lib/data-store/answer-key-eligibility.ts"] },
    appliesTo: "all",
    since: "2026-10-20",
  },
  {
    id: "issue-2466-line-content-match",
    agent: "deming",
    stage: "answer-key eligibility",
    lesson: "Compare a reference line to a document as fee content, the words and prices, never as the markup either side was stored in. Decode HTML entities and remove cell separators, dot leaders, bullets and whitespace on both sides before the exact match, and treat a line that is only separators as missing.",
    why: "After the first eligibility fix, 44 of 62 keys still failed because key lines copied from stored table text carried '|' separators, pages wrote apostrophes and registered marks as HTML entities, and dot leaders differed, so the same words and prices never matched.",
    evidence: { issues: [2466], prs: [2552], files: ["docs/project/findings/2026-10-24-answer-key-lines-compared-as-markup.md", "src/lib/data-store/answer-key-eligibility.ts"] },
    appliesTo: "all",
    since: "2026-10-24",
  },
  {
    id: "issue-1048-page-by-key",
    agent: "deming",
    stage: "regression replay",
    lesson: "Page a work list by the last key of each window, never by an OFFSET counted across statements, whenever the run or another run changes the column the list is ordered by. Pass a timestamp key back as text and cast it in SQL, so it keeps Postgres's microseconds, and drop a case seen twice.",
    why: "Corrective replay listed due cases 50 at a time with OFFSET over last_checked_at; a run that rechecked cases moved them to the end, so the next window skipped as many unseen cases as had moved. Passing the key as a timestamptz parameter would have cut it to milliseconds and repeated tied cases.",
    evidence: { issues: [1048], prs: [2414], files: ["src/lib/agents/deming/corrective-source-store.ts", "src/lib/agents/deming/corrective-source.db.test.ts"] },
    appliesTo: "all",
    since: "2026-10-24",
  },
  {
    id: "issue-2055-route-to-owner-queue",
    agent: "deming",
    stage: "fresh audit",
    lesson: "An audit finding is finished only when it sits in a queue its owner's next step reads, in a form that queue can match and act on safely. Send a bad name to Knox's re-read queue, and only a bad name, since the re-read takes any other name on the line as the better one. Let Magellan find a wrong-document miss by bank, never by link: the miss names the stored document's address after redirects, which rarely equals the bank's link. Keeping a finding as a judgement nobody selects is not enough.",
    why: "Deming's audit misses were written as audit_miss feedback with the right stage, but no Knox, Magellan or Rosetta reader selected that kind, so a miss never reached the step that caused it. The first route matched Magellan's link exactly, which redirected documents never do, and sent amount and category misses to a re-read that could rename a correct fee sideways.",
    evidence: { issues: [2055], prs: [2558], files: ["src/lib/agents/deming/audit-misses.ts", "src/lib/agents/magellan/discovery.ts", "src/lib/agents/knox/reread-feedback.ts"] },
    appliesTo: "all",
    since: "2026-10-24",
  },
];
