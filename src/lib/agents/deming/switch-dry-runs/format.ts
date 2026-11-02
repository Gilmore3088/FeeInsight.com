import type { AtmHeadingChange } from "./atm-heading";
import type { CapPriceChange } from "./cap-lines";
import { CAP_TIERS, type CapVerdict } from "./daily-cap";
import type { SwitchDryRunReport } from "./run";
import type { HeldVocabularyCandidate } from "./held-vocabulary";
import type { SectionPathFee } from "./section-path";
import type { Bounded } from "./types";

/** The report as plain text for James's terminal: totals first, then capped samples. Pure. */

const money = (value: number | null | undefined): string => (value == null ? "?" : `$${value.toFixed(2)}`);
const cents = (value: number | null | undefined): string => (value == null ? "?" : money(value / 100));
const pct = (value: number | null | undefined): string => (value == null ? "n/a" : `${(value * 100).toFixed(2)}%`);
const range = (r: { low: number; high: number } | null): string => (r ? ` (95% Wilson ${pct(r.low)} - ${pct(r.high)})` : "");
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
    "Method: each od_daily_cap / nsf_daily_cap row against its own document's newest completed text, dailyCapLines off vs on. " +
      "Published rows (live, removed) as Hamilton's source check reads them (checkFeeAgainstSource on the whole text, a tiered price traced); " +
      "other rows as Darwin's verify reads them (statedInOwnSource: the same check on an ancillary product's own block).",
    cap(rowsRead, "cap rows"),
    `Gains: ${summary.gainLines} fee lines newly trace with nothing of that name live at the institution (what the switch could add). ` +
      `${summary.alreadyLiveSamePriceLines} more lines newly trace but are already live at the same price.`,
    `LIVE PRICE WOULD CHANGE: ${summary.priceChangeLines} lines newly trace at a price other than the page's live cap of that name, ` +
      `and Hamilton would replace it or publish beside it (decidePriorFee: ${counts(summary.priceChangeByDecision)}).`,
    `Would publish beside a live price elsewhere: ${summary.besideElsewhereLines} lines whose only same-named live cap is on another page of the institution, at another price.`,
    `Live price stays: ${summary.livePriceStaysLines} lines newly trace but Hamilton keeps the live cap as it is (decidePriorFee: ${counts(summary.livePriceStaysByDecision)}).`,
    `Of the gains, ${summary.gainLinesPublishGateNotReplayed} are verified but unpublished rows: Darwin's judgement, publish gate not replayed.`,
    `Rows: ${summary.nowTraces} not-live rows go not-ok -> ok; ${summary.liveNowTraces} live rows go not-ok -> ok (no gain); ` +
      `${summary.stopsTracing} go ok -> not-ok (a live one would come down); ${summary.noText} have no stored text.`,
    `Darwin's verified recheck on those ${summary.liveNowTraces} live rows, judged on their switch-on line: ` +
      `${summary.liveRecheck.kept} kept, ${summary.liveRecheck.takedown} would come down because of the switch (kept today; flagged, then down at the 12-hour second look)` +
      (summary.liveRecheck.takedown ? ` (${counts(summary.liveRecheck.byReason)})` : "") +
      `; ${summary.liveRecheck.alreadyFailing} already fail today on Knox's excerpt (not caused by the switch).`,
    "A gain traces with the switch on; it still has every other verify and publish check to pass.",
    "By tier (rows / not-ok->ok / ok->not-ok / no text):",
    ...CAP_TIERS.map((tier) => {
      const t = summary.byTier[tier];
      return `  ${tier.padEnd(21)} ${t.rows} / ${t.nowTraces} / ${t.stopsTracing} / ${t.noText}`;
    }),
  ];
  const row = (v: CapVerdict) =>
    `  [${v.tier}] raw ${v.feeRawId}${v.feePublishedId ? ` pub ${v.feePublishedId}` : ""} | ${v.institutionName ?? "?"} (${v.institutionId}) | doc ${v.sourceDocumentId ?? "?"} | ${v.category} ${money(v.amount)} "${clip(v.name, 60)}" | ${v.failure ?? ""} | line: "${clip(v.line)}"`;
  if (summary.gainSamples.length) lines.push(`Gained lines (first ${summary.gainSamples.length}, one row each; failure is the switch-off reason):`, ...summary.gainSamples.map(row));
  const changes = (title: string, list: readonly CapPriceChange[]) => {
    if (!list.length) return;
    lines.push(`${title} (first ${list.length}): new price, then the live price it meets:`,
      ...list.flatMap((change) => [
        row(change.verdict),
        `    live ${change.live.map((fee) => `pub ${fee.feePublishedId ?? "?"} ${money(fee.amount)} (doc ${fee.sourceDocumentId ?? "?"})`).join(", ")}` +
          ` -> ${money(change.verdict.amount)} [decidePriorFee: ${change.decision}]`,
      ]));
  };
  changes("Live price would change", summary.priceChangeSamples);
  changes("Would publish beside a live price elsewhere", summary.besideElsewhereSamples);
  changes("Live price stays", summary.livePriceStaysSamples);
  const recheck = (v: CapVerdict) =>
    `    recheck today: ${v.recheck?.today.outcome ?? "?"}${v.recheck?.today.reason ? ` (${v.recheck.today.reason})` : ""}` +
    ` | switch on: ${v.recheck?.switchOn.outcome ?? "?"}${v.recheck?.switchOn.reason ? ` (${v.recheck.switchOn.reason})` : ""} on "${clip(v.recheck?.switchOn.line, 100)}"`;
  if (summary.liveNowTracesSamples.length) {
    lines.push(`Live rows that newly trace (first ${summary.liveNowTracesSamples.length}), with the recheck's verdict:`,
      ...summary.liveNowTracesSamples.flatMap((v) => [row(v), recheck(v)]));
  }
  if (summary.stopsTracingSamples.length) lines.push(`Rows that stop tracing (first ${summary.stopsTracingSamples.length}; failure is the switch-on reason, line is today's):`, ...summary.stopsTracingSamples.map(row));
  return lines;
}

function dashList(report: SwitchDryRunReport): string[] {
  const { scan, documentsMatched, summary, notReplayed } = report.dashListRows;
  const lines = [
    "## 2. DASH_LIST_ROWS_LIVE (#2834, Knox v148)",
    "Method: every current copy (and every document a live fee cites) whose newest text prints a \"$X - Name\" line, institutions with live fees first, " +
      "replayed through the shadow lab stages (Knox free read, Darwin verify checks, Hamilton publish gate) as today and with the switch on. " +
      "New reads are compared with the institution's live fees of the same category and audience, as Hamilton's prior-fee read does.",
    "NOT REPLAYED (each can move these counts):",
    ...notReplayed.map((step) => `  - ${step}`),
    `Scan bound (--max-documents, applied before any text is read): candidates ${scan.offset} to ${scan.offset + scan.bound}; ` +
      `${scan.scanned} scanned, ${documentsMatched} print a dash list line.` +
      (scan.truncated ? ` BOUND REACHED: more candidates may remain; the next batch is --scan-offset ${scan.nextOffset}.` : " Every candidate was scanned."),
    `Documents with dash list runs: ${summary.documentsWithRuns}; whose published reads change: ${summary.documentsChanged}.`,
    `Live fees today's reading reads and the switch-on reading no longer reads: ${summary.lost}.`,
    `Live fees on these documents NOT ASSESSED (neither reading reproduces them, so the replay cannot say what the switch does): ${summary.notAssessed}.`,
    `Switch-on reads that are new: ${summary.added} (decidePriorFee: ${counts(summary.addedByDecision)}).`,
    `New reads that would publish beside a same-named live fee of the category and audience at another price: ${summary.beside}.`,
  ];
  const fee = (f: (typeof summary.lostSamples)[number]) =>
    `  pub ${f.feePublishedId} | ${f.institutionName ?? "?"} (${f.institutionId}) | doc ${f.sourceDocumentId ?? "?"} | ${f.canonicalFeeKey} ${cents(f.amountCents)} [${f.feeAudience}] "${clip(f.feeName, 70)}"`;
  if (summary.lostSamples.length) lines.push(`No longer read (first ${summary.lostSamples.length}):`, ...summary.lostSamples.map(fee));
  if (summary.notAssessedSamples.length) lines.push(`Not assessed (first ${summary.notAssessedSamples.length}):`, ...summary.notAssessedSamples.map(fee));
  if (summary.besideSamples.length) {
    lines.push(`Would publish beside (first ${summary.besideSamples.length}):`, ...summary.besideSamples.map((r) =>
      `  ${r.institutionName ?? "?"} (${r.institutionId}) | doc ${r.sourceDocumentId} | ${r.canonicalFeeKey} ${cents(r.amountCents)} [${r.feeAudience}] "${clip(r.feeName, 60)}" [${r.decision}] beside ${r.sameNamed.map((f) => `pub ${f.feePublishedId} ${cents(f.amountCents)}`).join(", ")}`));
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
    `Fees still down that the live sweep took down with an excerpt-only reading (held at publish instead): ${summary.takenDown} (${counts(summary.takenDownByCode)}); ` +
      `${summary.republished} more are live again (republished) and not counted.`,
    ...summary.takenDownSamples.map((t) => `  pub ${t.feePublishedId} | ${t.institutionName ?? "?"} (${t.institutionId}) | ${t.canonicalFeeKey} ${money(t.amount)} "${clip(t.feeName, 60)}" | ${t.code}`),
  ];
}

function sectionPath(report: SwitchDryRunReport): string[] {
  const { scan, documentsMatched, summary } = report.sectionPath;
  const fee = (f: SectionPathFee) =>
    `  pub ${f.feePublishedId} | ${f.institutionName ?? "?"} (${f.institutionId}) | doc ${f.sourceDocumentId} | ${f.canonicalFeeKey} ${money(f.amount)} [${f.feeAudience}] "${clip(f.feeName, 60)}"`;
  const lines = [
    "## 4. SECTION_PATH_LIVE (#1092)",
    "Method: every candidate document (the dash list section's scan, institutions with live fees first) whose newest text names an audience; " +
      " each live dollar fee on it read against that text with the switch off and on by Darwin's audience decision " +
      "(darwinAudience, own-price clause on). The switch holds and refuses nothing, so there is no takedown count.",
    `Scan bound (--max-documents, applied before any text is read): candidates ${scan.offset} to ${scan.offset + scan.bound}; ` +
      `${scan.scanned} scanned, ${documentsMatched} name an audience.` +
      (scan.truncated ? ` BOUND REACHED: more candidates may remain; the next batch is --scan-offset ${scan.nextOffset}.` : " Every candidate was scanned."),
    `Live dollar fees read: ${summary.feesRead} on ${summary.documents} documents; documents that change: ${summary.documentsChanged}.`,
    `Darwin's audience decision changes on ${summary.relabels} live fees (published -> switch on: ${counts(summary.relabelsByChange)}); ` +
      `the audience relabel would write ${summary.relabelsWritten} of them (from unknown; from both only for a title source, which section_path is not yet).`,
  ];
  if (summary.relabelSamples.length) {
    lines.push(`Audience changes (first ${summary.relabelSamples.length}): published, Darwin off -> on, evidence:`,
      ...summary.relabelSamples.map((r) => `${fee(r)} | ${r.off} -> ${r.on}${r.relabelWrites ? " (relabel writes)" : ""} | ${clip(r.evidence, 100)}`));
  }
  return lines;
}

function atmHeading(report: SwitchDryRunReport): string[] {
  const { rowsRead, liveFeesRead, summary } = report.footnotedAtmHeading;
  const live = summary.liveNonNetwork;
  const row = (c: AtmHeadingChange) =>
    `  [${c.tier}] raw ${c.feeRawId}${c.feePublishedId ? ` pub ${c.feePublishedId}` : ""} | ${c.institutionName ?? "?"} (${c.institutionId}) | doc ${c.sourceDocumentId} | ${c.today} ${money(c.amount)} "${clip(c.feeName, 60)}" | ${c.off} -> ${c.on}${c.accepted ? "" : " (guard or amount checks refuse it)"} | above: "${clip(c.context, 120)}"`;
  const lines = [
    "## 5. FOOTNOTED_ATM_HEADING_LIVE (#1092, the fold's marked ATM heading read)",
    "Method: every balance inquiry (Knox's hint, or a verified or published balance_inquiry) re-filed against its own document's newest stored text, " +
      "switch off and on, as Darwin's verify, Hamilton's rules re-check and Hamilton's fold step file it (refileCategory with foldContext).",
    cap(rowsRead, "balance inquiry rows"),
    `Rows whose filing changes: ${summary.changed} (${counts(summary.byChange)}); ${summary.noText} have no stored text, ${summary.notFound} name a line the text does not print.`,
    `LIVE RE-FILE: ${summary.wouldRefileIn} live or verified fees would be re-filed into atm_non_network by Hamilton's fold step (${summary.liveWouldRefileIn} of them live).`,
    "A raw-only row changes only what Knox's next read of its document files.",
    "Takedown count: every live atm_non_network fee Hamilton's rules re-check reads (Knox's free rules, flat amounts), its document's texts read as the re-check reads them " +
      "(the fee's own text_hash, else the newest), switch off and on, judged by the re-check's own pairing and verdict (claimDocumentLines, liveRowVerdict).",
    cap(liveFeesRead, "live atm_non_network fees"),
    `LIVE TAKEDOWN RISK: ${live.wouldLeave} live atm_non_network fees pass the re-check today and fail it with the switch on (flagged, then down at the second look).`,
    `Kept live by the second look with the switch on (disputed): ${live.wouldDispute}. Verdict changes: ${counts(live.byChange)}.`,
    `Of ${live.fees} live fees on ${live.documents} documents: ${live.alreadyFailing} already fail the re-check today (not caused by the switch), ${live.noText} with no stored text.`,
  ];
  if (summary.samples.length) lines.push(`Changes (first ${summary.samples.length}):`, ...summary.samples.map(row));
  if (live.samples.length) {
    lines.push(`Would come down (first ${live.samples.length}):`, ...live.samples.map((f) =>
      `  pub ${f.feePublishedId} | ${f.institutionName ?? "?"} (${f.institutionId}) | doc ${f.sourceDocumentId} | atm_non_network ${money(f.amount)} "${clip(f.feeName, 60)}" | ${f.off} -> ${f.on}${f.secondLook ? ` (${f.secondLook})` : ""}`));
  }
  return lines;
}

function heldVocabulary(report: SwitchDryRunReport): string[] {
  const { scan, documentsMatched, summary } = report.heldVocabulary;
  const fee = (f: HeldVocabularyCandidate) =>
    `  pub ${f.feePublishedId} | ${f.institutionName ?? "?"} (${f.institutionId}) | doc ${f.sourceDocumentId} | ${f.canonicalFeeKey} ${money(f.amount)} "${clip(f.feeName, 60)}"`;
  const lines = [
    "## 6. HELD_VOCABULARY_RELABEL_LIVE (#1092, Knox v161)",
    "Method: every candidate document (the dash list section's scan, institutions with live fees first) whose newest text prints a word " +
      "the v161 vocabulary reads; that text read by today's free team with the vocabulary off and on. A live dollar fee of the document " +
      "with an added read at its price is one the live-correction paths could re-file (another category) or rename (its own) with the " +
      "switch on: an upper bound, since those paths also need a re-read request, a fragment name or one proper read on the line.",
    `Scan bound (--max-documents, applied before any text is read): candidates ${scan.offset} to ${scan.offset + scan.bound}; ` +
      `${scan.scanned} scanned, ${documentsMatched} print a vocabulary word.` +
      (scan.truncated ? ` BOUND REACHED: more candidates may remain; the next batch is --scan-offset ${scan.nextOffset}.` : " Every candidate was scanned."),
    `Live dollar fees read: ${summary.feesRead} on ${summary.documents} documents; documents the vocabulary adds a read to: ${summary.documentsChanged}.`,
    `Switch on, the live-correction paths could re-file at most ${summary.refiles} live fees and rename ${summary.renames} (live -> added read: ${counts(summary.byChange)}). ` +
      "Switch off (today), none: those paths read as main. Publish never adds a vocabulary read onto a printed line a live fee already holds, " +
      "in any category (`selectLiveFeeOnLine`), so these moves are the switch's alone.",
    `New reads at a category and price no live fee of the document has (published through Darwin whatever the switch says, unless a live fee holds the same printed line): ` +
      `${summary.newReads} (${counts(summary.newReadsByCategory)}).`,
  ];
  if (summary.candidateSamples.length) {
    lines.push(`Live fees the switch could move (first ${summary.candidateSamples.length}): live, then the added read:`,
      ...summary.candidateSamples.map((c) => `${fee(c)} | ${c.shape}: ${c.added.canonicalFeeKey} "${clip(c.added.feeName, 60)}"`));
  }
  if (summary.newReadSamples.length) {
    lines.push(`New reads (first ${summary.newReadSamples.length}):`,
      ...summary.newReadSamples.map((r) => `  doc ${r.sourceDocumentId} | ${r.institutionName ?? "?"} | ${r.canonicalFeeKey} ${money(r.amount)} "${clip(r.feeName, 60)}"`));
  }
  return lines;
}

function zeroWaiverRow(report: SwitchDryRunReport): string[] {
  const { rowsRead, summary } = report.zeroWaiverRow;
  const lines = [
    "## 7. ZERO_WAIVER_ROW_TAKEDOWN_LIVE (#1092, Knox v163)",
    "Method: every live flat $0 fee Darwin's waiver-row re-check selects (its own SQL: the stored line opens \"no fee for / no charge on\" or says \"to avoid / to waive\"), " +
      "judged by the re-check's own function (findZeroWaiverRows) on the text Knox read: Knox's line and the line checkFeeAgainstSource traces the fee to " +
      "must both be a no-fee item of a list of free items or a balance row that avoids a fee. Admin-corrected fees are never selected.",
    cap(rowsRead, "live $0 rows"),
    `LIVE TAKEDOWN: switched on, ${summary.wouldTakeDown} of ${summary.checked} selected live $0 fees at ${summary.institutions} institutions would come down ` +
      `(each after its 12-hour second look): ${counts(summary.byKind)}; by category: ${counts(summary.byCategory)}. ${summary.noText} selected fees have no stored text and are not judged.`,
  ];
  if (summary.samples.length) {
    lines.push(`Would come down (first ${summary.samples.length}):`,
      ...summary.samples.map((m) => `  pub ${m.feePublishedId} | inst ${m.institutionId} | ${m.canonicalFeeKey ?? "?"} "${clip(m.feeName, 60)}" | ${m.kind} | line: "${clip(m.sourceLine)}" | traced: "${clip(m.tracedLine)}"`));
  }
  return lines;
}

function accuracy(report: SwitchDryRunReport): string[] {
  const a = report.liveAccuracy;
  if (!a.readable) return ["## 8. Live accuracy", "The fresh audit could not read the live fees: accuracy is unknown."];
  return [
    "## 8. Live accuracy (stored source, not the bank's current schedule)",
    `Method: ${a.method}`,
    `Seed ${a.seed}; source check v${a.sourceCheckVersion}; category guard v${a.categoryGuardVersion}.`,
    `Sampled ${a.sampled}; scorable ${a.scorable}; no stored text ${a.noText}.`,
    `Daily receipt's figure (right on amount, category, source, fee line and name): ${a.right} / ${a.scorable} = ${pct(a.rightShare)}${range(a.rightRange)}.`,
    `Amount and category only (not the receipt's figure): ${a.amountAndCategory} / ${a.scorable} = ${pct(a.share)}${range(a.range)}` +
      `; amount not supported ${a.amountMiss}, category not supported ${a.categoryMiss}.`,
  ];
}

export function formatSwitchDryRuns(report: SwitchDryRunReport): string {
  return [
    `# Switch dry runs (read-only), ${report.generatedAt}`,
    "One read-only snapshot for the whole run: it holds back vacuum while it runs, so run it off-peak (or on a replica).",
    `Samples capped at ${report.options.sampleCap} per list; totals count every row read.` +
      (report.options.institutionIds ? ` Sections 1-7 limited to institutions ${report.options.institutionIds.join(", ")}.` : ""),
    "",
    ...dailyCap(report),
    "",
    ...dashList(report),
    "",
    ...excerpt(report),
    "",
    ...sectionPath(report),
    "",
    ...atmHeading(report),
    "",
    ...heldVocabulary(report),
    "",
    ...zeroWaiverRow(report),
    "",
    ...accuracy(report),
    "",
  ].join("\n");
}
