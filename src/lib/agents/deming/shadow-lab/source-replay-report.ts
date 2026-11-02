import type { SideScore, SourceReplaySummary } from "./source-replay";

/** The source-bytes replay as markdown (`source-replay.md`). Every number is read from the summary. */

const MAX_REASONS = 12;

function percent(part: number, whole: number): string {
  return whole === 0 ? "not measured" : `${((part / whole) * 100).toFixed(1)}% (${part}/${whole})`;
}

function falsePublication(s: SideScore): string {
  return s.forbidden === 0 ? "none forbidden" : percent(s.falsePublished, s.forbidden);
}

function reasons(frozen: SideScore, reread: SideScore): string[] {
  const keys = [...new Set([...Object.keys(frozen.missesByReason), ...Object.keys(reread.missesByReason)])].sort(
    (a, b) => (reread.missesByReason[b] ?? 0) - (reread.missesByReason[a] ?? 0) || (a < b ? -1 : 1),
  );
  return [
    "| Missed at | Reason | Frozen text | Re-read |",
    "|---|---|---|---|",
    ...keys.slice(0, MAX_REASONS).map((key) => `| ${key} | ${frozen.missesByReason[key] ?? 0} | ${reread.missesByReason[key] ?? 0} |`),
  ];
}

export function renderSourceReplay(summary: SourceReplaySummary): string {
  const { frozen, reread } = summary.total;
  const changed = summary.documents.filter((d) => d.textChanged).length;
  return [
    "# Shadow lab: answer-key documents re-read from their source bytes",
    "",
    `- ${summary.reproduced} of ${summary.holdoutDocuments} holdout documents reproduced (${summary.reproduced} of the ${summary.labCases} the lab replays as answer-key cases).`,
    `- Today's readers give a different text from the frozen one on ${changed} of ${summary.reproduced}.`,
    "- Same keys on both sides; misses charged by `whereMissed`. Measures only: no gate reads it.",
    "",
    "## Total",
    "",
    "| Measure | Frozen text | Re-read |",
    "|---|---|---|",
    `| Recall: answer-key fees published | ${percent(frozen.found, frozen.expected)} | ${percent(reread.found, reread.expected)} |`,
    `| False publication: known-wrong fees published | ${falsePublication(frozen)} | ${falsePublication(reread)} |`,
    `| Published fees not in the answer key | ${frozen.unexpected} | ${reread.unexpected} |`,
    "",
    ...reasons(frozen, reread),
    "",
    `Keys published on the frozen text but missed on the re-read: ${summary.lost.length}${summary.lost.length ? ` (${summary.lost.join(", ")})` : ""}.`,
    `Keys missed on the frozen text but published on the re-read: ${summary.gained.length}${summary.gained.length ? ` (${summary.gained.join(", ")})` : ""}.`,
    "",
    "## By document",
    "",
    "| Case | Reader | Token / number similarity | Text changed | Frozen recall | Re-read recall | Not in key (frozen / re-read) |",
    "|---|---|---|---|---|---|---|",
    ...summary.documents.map(
      (d) =>
        `| ${d.caseKey} | ${d.reader} | ${d.similarity.tokens} / ${d.similarity.numbers} | ${d.textChanged ? "yes" : "no"} | ${percent(d.frozen.found, d.frozen.expected)} | ${percent(d.reread.found, d.reread.expected)} | ${d.frozen.unexpected} / ${d.reread.unexpected} |`,
    ),
    "",
    "## Not reproduced",
    "",
    ...summary.rejected.map(
      (r) => `- ${r.caseKey} (${r.institution}): ${r.reason}${r.similarity ? `; token ${r.similarity.tokens}, number ${r.similarity.numbers}, dollars ${r.similarity.dollarsEqual ? "equal" : "differ"}` : ""}.`,
    ),
    ...summary.notFetched.map((r) => `- ${r.caseKey} (${r.institution}): ${r.reason}.`),
    "",
  ].join("\n");
}
