import type { MissCount, ReplayDelta, SideScore, SourceReplaySummary } from "./source-replay";

/** The source-bytes replay as markdown (`source-replay.md`). Every number is read from the summary. */

const MAX_REASONS = 12;

function percent(part: number, whole: number): string {
  return whole === 0 ? "not measured" : `${((part / whole) * 100).toFixed(1)}% (${part}/${whole})`;
}

function falsePublication(s: SideScore): string {
  return s.forbidden === 0 ? "none forbidden" : percent(s.falsePublished, s.forbidden);
}

function reasons(frozen: SideScore, reread: SideScore): string[] {
  const count = (side: SideScore, miss: MissCount) =>
    side.misses.find((m) => m.stage === miss.stage && m.reason === miss.reason)?.count ?? 0;
  const rows: MissCount[] = [];
  for (const miss of [...reread.misses, ...frozen.misses]) {
    if (!rows.some((row) => row.stage === miss.stage && row.reason === miss.reason)) rows.push(miss);
  }
  rows.sort((a, b) => count(reread, b) - count(reread, a) || a.stage.localeCompare(b.stage) || a.reason.localeCompare(b.reason));
  return [
    "| Missed at | Reason | Frozen text | Re-read |",
    "|---|---|---|---|",
    ...rows.slice(0, MAX_REASONS).map((row) => `| ${row.stage} | ${row.reason} | ${count(frozen, row)} | ${count(reread, row)} |`),
  ];
}

function archiveTried(rejected: SourceReplaySummary["rejected"][number]): string {
  const tried = rejected.archiveTried ?? [];
  if (tried.length === 0) return "";
  const scores = tried.map((c) => `${c.timestamp} (token ${c.similarity.tokens}, number ${c.similarity.numbers})`);
  return `; Internet Archive captures also fail: ${scores.join(", ")}`;
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
    "## Not reproduced, and copies rejected",
    "",
    ...summary.rejected.map(
      (r) => `- ${r.caseKey} (${r.institution})${summary.documents.some((d) => d.caseKey === r.caseKey) ? " [another copy is accepted]" : ""}: ${r.reason}${r.similarity ? `; token ${r.similarity.tokens}, number ${r.similarity.numbers}, dollars ${r.similarity.dollarsEqual ? "equal" : "differ"}` : ""}${archiveTried(r)}.`,
    ),
    ...summary.notFetched.map((r) => `- ${r.caseKey} (${r.institution}): ${r.reason}.`),
    "",
  ].join("\n");
}

const listed = (items: string[]) => (items.length ? items.map((item) => `- ${item}`) : ["- none"]);

/** A reader experiment on the re-read (`source-replay-<experiment>.md`): today's readers against the switch held on. */
export function renderReplayDelta(experiment: string, base: SourceReplaySummary, switched: SourceReplaySummary, delta: ReplayDelta): string {
  const a = base.total.reread;
  const b = switched.total.reread;
  const changed = switched.documents.filter((d, index) => d.reread.found !== base.documents[index]?.reread.found || d.reread.unexpected !== base.documents[index]?.reread.unexpected);
  return [
    `# Source replay: experiment ${experiment}`,
    "",
    "Both sides re-read the same documents' bytes and run today's pipeline; only the reader switch differs.",
    "",
    "| Measure | Today's readers | Experiment |",
    "|---|---|---|",
    `| Recall: answer-key fees published | ${percent(a.found, a.expected)} | ${percent(b.found, b.expected)} |`,
    `| Published fees not in the answer key | ${a.unexpected} | ${b.unexpected} |`,
    `| Documents whose score moved | | ${changed.length} |`,
    "",
    `## Keys gained (${delta.gained.length})`,
    ...listed(delta.gained),
    "",
    `## Keys lost (${delta.lost.length})`,
    ...listed(delta.lost),
    "",
    `## Published outside the key, added (${delta.unexpectedAdded.length}); check each by hand against the page`,
    ...listed(delta.unexpectedAdded),
    "",
    `## Published outside the key, no longer (${delta.unexpectedRemoved.length})`,
    ...listed(delta.unexpectedRemoved),
    "",
  ].join("\n");
}
