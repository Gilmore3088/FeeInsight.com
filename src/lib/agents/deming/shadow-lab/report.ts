import type { Comparison } from "./compare";
import type { Failure, FailureKind, FailureStage, VariantMetrics } from "./metrics";
import { SCENARIO_IDS, STAGE_IDS } from "./types";

/** The human-readable shadow lab report. Every number is read from the comparison. */

export const REPORT_SECTIONS = [
  "Run",
  "Headline",
  "Where fees go wrong",
  "What would address it",
  "Where the variants differ",
  "Not replayable",
  "Limits",
] as const;

const MAX_DIFF_ROWS = 25;
const TOP_N = 3;
const FAILURE_STAGES: readonly FailureStage[] = [...STAGE_IDS, "passed_every_stage"];

/** What a group of failures says, by the stage that let it through and the kind of failure. */
const REMEDIES: Partial<Record<`${FailureStage}/${FailureKind}`, string>> = {
  "extract/missed":
    "Knox did not produce these fees at their category and price. read_other_category means a read at the same price under another category; read_other_amount means the category read at another price; not_read means neither.",
  "verify/missed": "Knox read these fees but verification refused them. Check whether the refusing rules below are too broad for these categories.",
  "publish_gate/missed": "Verified fees held back at publish. The skip reasons below name the gate rule to look at.",
  "passed_every_stage/false_publication": "Known-wrong fees passed every stage: no check catches these shapes yet. The scenario with the most is where a new check belongs.",
  "publish_gate/duplicate": "Same-dollar lines published the wrong number of times. The publish gate's same-line decision is where to look.",
  "verify/duplicate": "Same-dollar lines lost at verification before the publish gate could judge them.",
  "extract/duplicate": "Same-dollar lines Knox read more times than the page prints them.",
  "document_gate/wrong_document": "Documents the gate judged wrongly (a product page accepted, or a fee schedule refused).",
  "passed_every_stage/wrong_name":
    "Fees published at the right category and price under a name that does not match the schedule's (fewer than half its own words, or a leading cut or condition fragment). The reasons are the published names.",
};

function percent(part: number, whole: number): string {
  return whole === 0 ? "not measured" : `${((part / whole) * 100).toFixed(1)}% (${part}/${whole})`;
}

function topCounts(values: (string | null)[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value ?? "none", (counts.get(value ?? "none") ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, TOP_N)
    .map(([value, count]) => `${value} (${count})`)
    .join(", ");
}

function headline(current: VariantMetrics, experimental: VariantMetrics): string[] {
  const rows: Array<[string, (m: VariantMetrics) => string]> = [
    ["Recall: answer-key fees published", (m) => percent(m.answerKeyRecall.found, m.answerKeyRecall.expected)],
    ["Recall: all expected fees published (answer keys, category cases and the live audit)", (m) => percent(m.recall.found, m.recall.expected)],
    ["False publication: known-wrong fees published (lower is better)", (m) => percent(m.falsePublication.published, m.falsePublication.forbidden)],
    ["Duplicate prevention", (m) => percent(m.duplicatePrevention.correct, m.duplicatePrevention.cases)],
    ["Source attribution: published fees traced to a line", (m) => percent(m.sourceAttribution.attributed, m.sourceAttribution.published)],
    ["Document gate", (m) => percent(m.documentGate.correct, m.documentGate.cases)],
    ["Names: published fees whose name matches the schedule", (m) => percent(m.names.matched, m.names.expected)],
    ["Published fees not in the answer key", (m) => String(m.unexpectedPublications)],
  ];
  return ["| Measure | Current | Experimental |", "|---|---|---|", ...rows.map(([label, cell]) => `| ${label} | ${cell(current)} | ${cell(experimental)} |`)];
}

function whereWrong(current: VariantMetrics, experimental: VariantMetrics): string[] {
  return [
    "Each failed expectation is charged to the first stage that got it wrong.",
    "",
    "| Stage | Current | Experimental |",
    "|---|---|---|",
    ...FAILURE_STAGES.map((stage) => `| ${stage} | ${current.failuresByStage[stage]} | ${experimental.failuresByStage[stage]} |`),
    "",
    "| Scenario | Cases | Current failures | Experimental failures | Current recall | Current false publication |",
    "|---|---|---|---|---|---|",
    ...SCENARIO_IDS.map((id) => {
      const s = current.byScenario[id];
      return `| ${id} | ${s.cases} | ${s.failures} | ${experimental.byScenario[id].failures} | ${percent(s.found, s.expected)} | ${percent(s.published, s.forbidden)} |`;
    }),
  ];
}

function remedies(current: VariantMetrics, experimental: VariantMetrics): string[] {
  const groups = new Map<string, Failure[]>();
  for (const failure of current.failures) {
    const key = `${failure.stage}/${failure.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), failure]);
  }
  if (groups.size === 0) return ["No failures in the current pipeline on these cases."];
  const experimentalCount = (key: string) => experimental.failures.filter((f) => `${f.stage}/${f.kind}` === key).length;
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .flatMap(([key, failures]) => [
      `### ${key}: ${failures.length} (experimental: ${experimentalCount(key)})`,
      "",
      REMEDIES[key as keyof typeof REMEDIES] ?? "No standing reading for this group yet.",
      "",
      `- Reasons: ${topCounts(failures.map((f) => f.reason))}`,
      `- Categories: ${topCounts(failures.map((f) => f.fee.canonicalFeeKey))}`,
      `- Scenarios: ${topCounts(failures.map((f) => f.scenario))}`,
      "",
    ]);
}

/** Fees in `left` that `right` lacks, counting repeats ("nsf:3000:-" twice against once leaves one). */
function onlyIn(left: string[], right: string[]): string[] {
  const remaining = [...right];
  return left.filter((item) => {
    const at = remaining.indexOf(item);
    if (at < 0) return true;
    remaining.splice(at, 1);
    return false;
  });
}

function diffs(comparison: Comparison): string[] {
  const rows = comparison.caseDiffs.slice(0, MAX_DIFF_ROWS);
  if (rows.length === 0) return ["The two variants published the same fees on every case."];
  return [
    `${comparison.caseDiffs.length} cases publish different fees${comparison.caseDiffs.length > MAX_DIFF_ROWS ? `; the first ${MAX_DIFF_ROWS} by case key` : ""}.`,
    "",
    "| Case | Published only by current | Published only by experimental |",
    "|---|---|---|",
    ...rows.map(
      (row) =>
        `| ${row.caseKey} | ${onlyIn(row.current, row.experimental).join(", ") || "none"} | ${onlyIn(row.experimental, row.current).join(", ") || "none"} |`,
    ),
  ];
}

function totalMs(timing: Comparison["timing"]["current"]): number {
  return Math.round(Object.values(timing).reduce((sum, stage) => sum + stage.totalMs, 0));
}

export function renderReport(comparison: Comparison): string {
  const { current, experimental } = comparison.variants;
  const [run, head, wrong, address, differ, notReplayable, limits] = REPORT_SECTIONS;
  const lines = [
    "# Pipeline shadow lab report",
    "",
    `## ${run}`,
    "",
    `- Lab version ${comparison.labVersion}; stage versions: ${Object.entries(comparison.versions).map(([k, v]) => `${k} ${v}`).join("; ")}.`,
    `- Experiment \`${experimental.config.id}\`: ${experimental.config.description}`,
    `- Cases: ${current.cases.ok} replayed, ${current.cases.corrupt} corrupt (left out); ${comparison.notReplayable.length} known ${comparison.notReplayable.length === 1 ? "failure" : "failures"} not replayable (listed below).`,
    `- Scenarios: ${comparison.scenarios.map((s) => `${s.id} ${s.cases}`).join(", ")}.`,
    `- Paid provider calls: ${current.providerCalls + experimental.providerCalls}; cost $${((current.costMicrousd + experimental.costMicrousd) / 1e6).toFixed(2)}.`,
    `- Execution time: current ${totalMs(comparison.timing.current)} ms, experimental ${totalMs(comparison.timing.experimental)} ms (all stages, first run; varies by machine).`,
    `- Reprocessing stability: ${comparison.stability.identical ? "identical" : "NOT identical"} across ${comparison.stability.runs} runs per variant (sha256 ${comparison.stability.sha256.slice(0, 12)}).`,
    "",
    `## ${head}`,
    "",
    ...headline(current, experimental),
    "",
    `## ${wrong}`,
    "",
    ...whereWrong(current, experimental),
    "",
    `## ${address}`,
    "",
    ...remedies(current, experimental),
    `## ${differ}`,
    "",
    ...diffs(comparison),
    "",
    `## ${notReplayable}`,
    "",
    ...comparison.notReplayable.map((item) => `- ${item.issue}: ${item.failure} (${item.reason}).`),
    "- #2064 tracks giving every error kind a replayable case.",
    "",
    `## ${limits}`,
    "",
    "- The read stage (PDF and HTML to text) is not replayed: the fixtures store text after Rosetta's read.",
    "- No database stage was needed: duplicate prevention is replayed with the pure prior-fee decision.",
    "- Parts that read the database are not replayed: Darwin's audience admission, learned envelopes, peer check and same-batch duplicates, Hamilton's exact-duplicate collapse and twin re-check, and Knox's stored lessons.",
    "- The document gate replays the URL rule (`isProductPage`) on cases written against it; it is not a held-out measure.",
    "- Answer keys may be incomplete, so a published fee not in a key is counted, not called an error.",
    "- Later live sweeps (for example Darwin's hourly pass) are not part of these stages.",
    "",
  ];
  return lines.join("\n");
}
