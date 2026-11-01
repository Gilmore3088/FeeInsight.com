import { addDailyCapVerdicts, emptyDailyCapSummary, finishDailyCapSummary, judgeDailyCaps, type CapLines, type DailyCapSummary } from "./daily-cap";
import { addDashDocument, DASH_LIST_NOT_REPLAYED, emptyDashListSummary, replayDashDocument, type DashListSummary } from "./dash-list";
import { summarizeExcerptAtPublish, type ExcerptAtPublishSummary } from "./excerpt-at-publish";
import { liveAccuracyFrom, type LiveAccuracy } from "./live-accuracy";
import { bounded, type Bounded, type LiveFeeRow, type SwitchAuditOptions, type SwitchAuditReader } from "./types";

/**
 * One read-only pass over every pending switch count (#1092). The reader does the reads; this file
 * only orders them, loads texts a chunk of documents at a time, and hands rows to the pure counters.
 */

export interface SwitchDryRunReport {
  generatedAt: string;
  options: SwitchAuditOptions;
  dailyCapLines: { switch: "DAILY_CAP_LINES_LIVE"; issue: number; rowsRead: Bounded; summary: DailyCapSummary };
  dashListRows: {
    switch: "DASH_LIST_ROWS_LIVE";
    issue: number;
    /** Steps the replay leaves out; each can move the counts. */
    notReplayed: readonly string[];
    documentsRead: Bounded;
    summary: DashListSummary;
  };
  excerptAtPublish: {
    experiment: "excerpt-at-publish";
    mapsToSwitch: false;
    liveRowsRead: Bounded;
    takedownsRead: Bounded;
    summary: ExcerptAtPublishSummary;
  };
  liveAccuracy: LiveAccuracy;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

const ids = (values: ReadonlyArray<number | string | null>): number[] =>
  [...new Set(values.filter((value): value is number | string => value != null).map(Number))];

async function dailyCapLines(reader: SwitchAuditReader, options: SwitchAuditOptions) {
  const rows = await reader.dailyCapRows(options.rowCap);
  const summary = emptyDailyCapSummary();
  const lines: CapLines = new Map();
  const byDocument = new Map<number | null, typeof rows>();
  for (const row of rows) {
    const key = row.source_document_id == null ? null : Number(row.source_document_id);
    byDocument.set(key, [...(byDocument.get(key) ?? []), row]);
  }
  addDailyCapVerdicts(summary, judgeDailyCaps(byDocument.get(null) ?? [], new Map()), options.sampleCap, lines);
  for (const documentIds of chunks(ids([...byDocument.keys()]), options.chunkSize)) {
    const texts = await reader.sourceTexts(documentIds);
    const chunkRows = documentIds.flatMap((id) => byDocument.get(id) ?? []);
    addDailyCapVerdicts(summary, judgeDailyCaps(chunkRows, texts), options.sampleCap, lines);
  }
  return {
    switch: "DAILY_CAP_LINES_LIVE" as const,
    issue: 2768,
    rowsRead: bounded(rows.length, options.rowCap),
    summary: finishDailyCapSummary(summary, lines, options.sampleCap),
  };
}

async function dashListRows(reader: SwitchAuditReader, options: SwitchAuditOptions) {
  const documents = await reader.dashListDocuments(options.maxDocuments);
  const summary = emptyDashListSummary();
  for (const chunk of chunks(documents, options.chunkSize)) {
    const texts = await reader.sourceTexts(ids(chunk.map((doc) => doc.source_document_id)));
    const live = await reader.liveFeesAt(ids(chunk.map((doc) => doc.institution_id)));
    const byInstitution = new Map<number, LiveFeeRow[]>();
    for (const fee of live) byInstitution.set(Number(fee.institution_id), [...(byInstitution.get(Number(fee.institution_id)) ?? []), fee]);
    for (const doc of chunk) {
      const text = texts.get(Number(doc.source_document_id));
      if (!text) continue;
      addDashDocument(summary, replayDashDocument(doc, text, byInstitution.get(Number(doc.institution_id)) ?? []), options.sampleCap);
    }
  }
  return {
    switch: "DASH_LIST_ROWS_LIVE" as const,
    issue: 2834,
    notReplayed: DASH_LIST_NOT_REPLAYED,
    documentsRead: bounded(documents.length, options.maxDocuments),
    summary,
  };
}

async function excerptAtPublish(reader: SwitchAuditReader, options: SwitchAuditOptions) {
  const live = await reader.limitRows(options.rowCap);
  const takedowns = await reader.excerptLimitTakedowns(options.rowCap);
  return {
    experiment: "excerpt-at-publish" as const,
    mapsToSwitch: false as const,
    liveRowsRead: bounded(live.length, options.rowCap),
    takedownsRead: bounded(takedowns.length, options.rowCap),
    summary: summarizeExcerptAtPublish(live, takedowns, options.sampleCap),
  };
}

export async function runSwitchDryRuns(reader: SwitchAuditReader, options: SwitchAuditOptions, now: Date = new Date()): Promise<SwitchDryRunReport> {
  return {
    generatedAt: now.toISOString(),
    options,
    dailyCapLines: await dailyCapLines(reader, options),
    dashListRows: await dashListRows(reader, options),
    excerptAtPublish: await excerptAtPublish(reader, options),
    liveAccuracy: liveAccuracyFrom(await reader.freshAudit(options.accuracySample)),
  };
}
