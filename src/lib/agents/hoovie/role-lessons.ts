import type { AgentLesson } from "@/lib/agents/learning/lesson-types";

/**
 * Hoovie's role lessons: how to load public data better, each from an issue whose root cause was
 * here. A PR that closes such an issue adds its lesson in the same PR (AGENTS.md, "How work runs").
 */
export const HOOVIE_LESSONS: AgentLesson[] = [
  {
    id: "issue-2306",
    agent: "hoovie",
    stage: "registry load",
    lesson: "A partition whose every page answered 404 or an error is a failed load, not an empty one: record it as failed with the pages tried, and name that partition in the source's health. Only a page that answered and held no rows is an empty check.",
    why: "The NCUA mergers partition (run 8051) got 404 from both addresses, was recorded empty and counted as a successful check, and the source's other families kept it looking fresh, so no credit union mergers ever loaded and nothing flagged it.",
    evidence: { issues: [2306], prs: [2307, 2412], files: ["src/lib/agents/hoovie/source-health.ts", "src/lib/data-store/feed-freshness.ts"] },
    appliesTo: "all",
    since: "2026-10-20",
  },
  {
    id: "issue-2228",
    agent: "hoovie",
    stage: "source health",
    lesson: "A finished fetch is not loaded data. Report whether the newest expected period is complete separately from whether the last fetch succeeded, and never let a backfill, partial or empty success stand in for the newest period.",
    why: "Fetch freshness was the only signal: it took the latest successful or allowed-empty fetch, and irregular sources (daily-polled feeds among them) were allowed 90 days, so a recent old-period or empty partition could look healthy while the newest data was missing.",
    evidence: { issues: [2228], prs: [2412], files: ["src/lib/data-store/feed-freshness.ts", "src/lib/agents/hoovie/source-health.ts"] },
    appliesTo: "all",
    since: "2026-10-20",
  },
  {
    id: "issue-2315",
    agent: "hoovie",
    stage: "archived reads",
    lesson: "A blank or missing number in a source file is missing, never zero: leave the value out and name the file, and keep a reported zero as zero.",
    why: "The generic archived call-report reader called Number(row.value) before checking it, so a null or blank value in an archive could become 0.",
    evidence: { issues: [2315], prs: [2316, 2412], files: ["src/lib/data-catalog/cold-reads.ts"] },
    appliesTo: "all",
    since: "2026-10-20",
  },
  {
    id: "issue-2200",
    agent: "hoovie",
    stage: "registry load",
    lesson: "Every loader failure leaves a receipt on its partition (the error, the attempt count, the next attempt, and whether the publisher refused, the input was invalid or the network failed), so source health can explain it. Never record a failure as a success, and keep the scheduler's retry pacing.",
    why: "Loaders failed before they recorded a terminal partition, so BEA, CRA, UBPR, branch tracts and RPW showed as scheduled but never loaded while the failed steps held the real errors.",
    evidence: { issues: [2200], prs: [2243], files: ["src/lib/agents/magellan/registry/failure.ts"] },
    appliesTo: "all",
    since: "2026-10-19",
  },
  {
    id: "issue-2202",
    agent: "hoovie",
    stage: "registry load",
    lesson: "Check each record's input before sending it to a publisher's service, and record a bad record as invalid on its own, so one bad row never discards the rest of the batch or retries forever. Never swap or repair a value the source does not support.",
    why: "One branch with an impossible latitude (138.097) made the Census coordinate geocoder answer HTTP 400, and the whole tract geocoding batch failed each time it ran.",
    evidence: { issues: [2202], prs: [2244], files: ["src/lib/regulatory/census-geocoder.ts", "src/lib/regulatory/coordinates.ts"] },
    appliesTo: "all",
    since: "2026-10-19",
  },
];
