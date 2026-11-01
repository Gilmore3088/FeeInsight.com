import { CAP_TIERS } from "./daily-cap";
import type { SwitchDryRunReport } from "./run";
import type { Bounded } from "./types";

/** The report as plain text for James's terminal: totals first, then capped samples. Pure. */

const money = (value: number | null | undefined): string => (value == null ? "?" : `$${value.toFixed(2)}`);
const cents = (value: number | null | undefined): string => (value == null ? "?" : money(value / 100));
const pct = (value: number | null | undefined): string => (value == null ? "n/a" : `${(value * 100).toFixed(2)}%`);
const clip = (value: string | null | undefined, length = 140): string => {
  const flat = (value ?? "").replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
};
const cap = (b: Bounded, noun: string): string =>
  `${b.read} ${noun} read${b.truncated ? ` (CAP ${b.cap} REACHED: totals may be short; re-run with a higher cap)` : ""}`;
const counts = (record: Partial<Record<string, number>>): string =>
  Object.entries(record).map(([key, value]) => `${key} ${value}`).join(", ") || "none";

function dailyCap(report: SwitchDryRunReport): string[] {
  const { rowsRead, summary } = report.dailyCapLines;
  const lines = [
    "## 1. DAILY_CAP_LINES_LIVE (#2768, Knox v146)",
    "Method: checkFeeAgainstSource on each od_daily_cap / nsf_daily_cap row against its own document's newest completed text, dailyCapLines off vs on.",
    cap(rowsRead, "cap rows"),
    `Not-ok -> ok with the switch on: ${summary.nowTraces} rows (${summary.nowTracesFees} distinct fees). Ok -> not-ok (a live one would come down): ${summary.stopsTracing}. No stored text: ${summary.noText}.`,
    "By tier (rows / not-ok->ok / ok->not-ok / no text):",
    ...CAP_TIERS.map((tier) => {
      const t = summary.byTier[tier];
      return `  ${tier.padEnd(21)} ${t.rows} / ${t.nowTraces} / ${t.stopsTracing} / ${t.noText}`;
    }),
  ];
  const row = (v: (typeof summary.nowTracesSamples)[number]) =>
    `  [${v.tier}] raw ${v.feeRawId}${v.feePublishedId ? ` pub ${v.feePublishedId}` : ""} | ${v.institutionName ?? "?"} (${v.institutionId}) | doc ${v.sourceDocumentId ?? "?"} | ${v.category} ${money(v.amount)} "${clip(v.name, 60)}" | ${v.failure ?? ""} | line: "${clip(v.line)}"`;
  if (summary.nowTracesSamples.length) lines.push(`Rows that now trace (first ${summary.nowTracesSamples.length}; failure is the switch-off reason):`, ...summary.nowTracesSamples.map(row));
  if (summary.stopsTracingSamples.length) lines.push(`Rows that stop tracing (first ${summary.stopsTracingSamples.length}; failure is the switch-on reason, line is today's):`, ...summary.stopsTracingSamples.map(row));
  return lines;
}

function dashList(report: SwitchDryRunReport): string[] {
  const { documentsRead, summary } = report.dashListRows;
  const lines = [
    "## 2. DASH_LIST_ROWS_LIVE (#2834, Knox v148)",
    "Method: each document with a live fee whose newest text prints a \"$X - Name\" line, replayed through the shadow lab stages (Knox free read, Darwin verify checks, Hamilton publish gate) as today and with the switch on.",
    cap(documentsRead, "candidate documents"),
    `Documents with dash list runs: ${summary.documentsWithRuns}; whose published reads change: ${summary.documentsChanged}.`,
    `Live fees today's reading reads and the switch-on reading no longer reads: ${summary.lost}.`,
    `Switch-on reads that are new: ${summary.added} (decidePriorFee: ${counts(summary.addedByDecision)}).`,
    `New reads that would publish beside a same-named live fee of the category at another price: ${summary.beside}.`,
    `(Context, not the switch: live fees on these documents neither reading matches: ${summary.unmatchedLive}.)`,
  ];
  if (summary.lostSamples.length) {
    lines.push(`No longer read (first ${summary.lostSamples.length}):`, ...summary.lostSamples.map((f) =>
      `  pub ${f.feePublishedId} | ${f.institutionName ?? "?"} (${f.institutionId}) | doc ${f.sourceDocumentId ?? "?"} | ${f.canonicalFeeKey} ${cents(f.amountCents)} "${clip(f.feeName, 70)}"`));
  }
  if (summary.besideSamples.length) {
    lines.push(`Would publish beside (first ${summary.besideSamples.length}):`, ...summary.besideSamples.map((r) =>
      `  ${r.institutionName ?? "?"} (${r.institutionId}) | doc ${r.sourceDocumentId} | ${r.canonicalFeeKey} ${cents(r.amountCents)} "${clip(r.feeName, 60)}" [${r.decision}] beside ${r.sameNamed.map((f) => `pub ${f.feePublishedId} ${cents(f.amountCents)}`).join(", ")}`));
  }
  lines.push(summary.watch.length
    ? `State key 10272 check, live "Stop Payment (single check)" $35 rows found: ${summary.watch.length}`
    : "State key 10272 check: no live \"Stop Payment (single check)\" $35 on any document read.");
  for (const w of summary.watch) {
    lines.push(`  pub ${w.live.feePublishedId} | ${w.live.institutionName ?? "?"} (${w.live.institutionId}) | doc ${w.live.sourceDocumentId ?? "?"} | read today: ${w.readToday ? "yes" : "no"} | read switch on: ${w.readSwitchOn ? "yes" : "no"} | switch-on price(s): ${w.switchOnCents.map(cents).join(", ") || "none"}`);
  }
  return lines;
}

function excerpt(report: SwitchDryRunReport): string[] {
  const { liveRowsRead, takedownsRead, summary } = report.excerptAtPublish;
  return [
    "## 3. excerpt-at-publish (shadow lab experiment)",
    "Maps to no live switch: the publish step selects no raw `conditions`, so the publish-time limit guard never reads Knox's excerpt; only the live limit sweep does. Turning it on is a code change.",
    cap(liveRowsRead, "live rows the excerpt could affect"),
    `Live fees the publish-time guard would hold if it read the excerpt: ${summary.liveHeld} (${counts(summary.liveByCode)}).`,
    ...summary.liveSamples.map((h) => `  pub ${h.feePublishedId} | ${h.institutionName ?? "?"} (${h.institutionId}) | doc ${h.sourceDocumentId ?? "?"} | ${h.canonicalFeeKey} ${money(h.amount)} "${clip(h.feeName, 60)}" | ${h.code}: ${clip(h.detail, 80)}`),
    cap(takedownsRead, "limit takedowns"),
    `Fees now down that the live sweep took down with an excerpt-only reading (held at publish instead): ${summary.takenDown} (${counts(summary.takenDownByCode)}).`,
    ...summary.takenDownSamples.map((t) => `  pub ${t.feePublishedId} | ${t.institutionName ?? "?"} (${t.institutionId}) | ${t.canonicalFeeKey} ${money(t.amount)} "${clip(t.feeName, 60)}" | ${t.code}`),
  ];
}

function accuracy(report: SwitchDryRunReport): string[] {
  const a = report.liveAccuracy;
  if (!a.readable) return ["## 4. Live accuracy", "The fresh audit could not read the live fees: accuracy is unknown."];
  return [
    "## 4. Live accuracy (stored source, not the bank's current schedule)",
    `Method: ${a.method}`,
    `Seed ${a.seed}; source check v${a.sourceCheckVersion}; category guard v${a.categoryGuardVersion}.`,
    `Sampled ${a.sampled}; scorable ${a.scorable}; no stored text ${a.noText}.`,
    `Amount and category match the stored source: ${a.amountAndCategory} / ${a.scorable} = ${pct(a.share)}` +
      (a.range ? ` (95% Wilson ${pct(a.range.low)} - ${pct(a.range.high)})` : "") +
      `; amount not supported ${a.amountMiss}, category not supported ${a.categoryMiss}.`,
    `Fresh audit's stricter "right" (also the bank's own document, a priced line, a clean name): ${a.right} / ${a.scorable} = ${pct(a.rightShare)}.`,
  ];
}

export function formatSwitchDryRuns(report: SwitchDryRunReport): string {
  return [
    `# Switch dry runs (read-only), ${report.generatedAt}`,
    `Samples capped at ${report.options.sampleCap} per list; totals count every row read.`,
    "",
    ...dailyCap(report),
    "",
    ...dashList(report),
    "",
    ...excerpt(report),
    "",
    ...accuracy(report),
    "",
  ].join("\n");
}
