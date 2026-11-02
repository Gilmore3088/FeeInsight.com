import { addAtmHeadingRows, emptyAtmHeadingSummary, replayLiveNonNetwork, type AtmHeadingSummary } from "./atm-heading";
import { addDailyCapVerdicts, emptyDailyCapSummary, finishDailyCapSummary, judgeDailyCaps, type CapLines, type DailyCapSummary } from "./daily-cap";
import { addDashDocument, DASH_LIST_NOT_REPLAYED, emptyDashListSummary, replayDashDocument, type DashListSummary } from "./dash-list";
import { summarizeExcerptAtPublish, type ExcerptAtPublishSummary } from "./excerpt-at-publish";
import { liveAccuracyFrom, type LiveAccuracy } from "./live-accuracy";
import { addHeldVocabularyDocument, emptyHeldVocabularySummary, replayHeldVocabularyDocument, type HeldVocabularySummary } from "./held-vocabulary";
import { addSectionPathDocument, emptySectionPathSummary, replaySectionPathDocument, type SectionPathSummary } from "./section-path";
import { summarizeHtmlExposure, type HtmlRowPairingSummary } from "./html-row-pairing";
import { addZeroWaiverRows, emptyZeroWaiverRowSummary, type ZeroWaiverRowSummary } from "./zero-waiver-row";
import { ZERO_WAIVER_ROW_MAX_ROWS, type ZeroWaiverRowLiveRow } from "@/lib/agents/darwin/zero-waiver-row-check";
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
    /**
     * The scan's bound, applied before any text is read: candidates `offset` to `offset + bound` were
     * scanned. When `truncated`, more candidates remain; the next batch starts at `nextOffset`.
     */
    scan: { offset: number; bound: number; scanned: number; truncated: boolean; nextOffset: number };
    /** Scanned documents whose text prints a dash list line, all replayed. */
    documentsMatched: number;
    summary: DashListSummary;
  };
  excerptAtPublish: {
    experiment: "excerpt-at-publish";
    mapsToSwitch: false;
    liveRowsRead: Bounded;
    takedownsRead: Bounded;
    summary: ExcerptAtPublishSummary;
  };
  sectionPath: {
    switch: "SECTION_PATH_LIVE";
    issue: number;
    /** The same scan bound as the dash list section, applied before any text is read. */
    scan: { offset: number; bound: number; scanned: number; truncated: boolean; nextOffset: number };
    documentsMatched: number;
    summary: SectionPathSummary;
  };
  footnotedAtmHeading: { switch: "FOOTNOTED_ATM_HEADING_LIVE"; issue: number; rowsRead: Bounded; liveFeesRead: Bounded; summary: AtmHeadingSummary };
  heldVocabulary: {
    switch: "HELD_VOCABULARY_RELABEL_LIVE";
    issue: number;
    /** The same scan bound as the dash list section, applied before any text is read. */
    scan: { offset: number; bound: number; scanned: number; truncated: boolean; nextOffset: number };
    documentsMatched: number;
    summary: HeldVocabularySummary;
  };
  zeroWaiverRow: { switch: "ZERO_WAIVER_ROW_TAKEDOWN_LIVE"; issue: number; rowsRead: Bounded; summary: ZeroWaiverRowSummary };
  htmlRowPairing: { switch: "HTML_ROW_PAIRING_LIVE"; issue: number; summary: HtmlRowPairingSummary };
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
  const { scanned, documents } = await reader.dashListDocuments(options.maxDocuments, options.scanOffset);
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
    scan: {
      offset: options.scanOffset,
      bound: options.maxDocuments,
      scanned,
      truncated: scanned >= options.maxDocuments,
      nextOffset: options.scanOffset + scanned,
    },
    documentsMatched: documents.length,
    summary,
  };
}

async function sectionPath(reader: SwitchAuditReader, options: SwitchAuditOptions) {
  const { scanned, documents } = await reader.sectionPathDocuments(options.maxDocuments, options.scanOffset);
  const summary = emptySectionPathSummary();
  for (const chunk of chunks(documents, options.chunkSize)) {
    const texts = await reader.sourceTexts(ids(chunk.map((doc) => doc.source_document_id)));
    const live = await reader.liveFeesAt(ids(chunk.map((doc) => doc.institution_id)));
    for (const doc of chunk) {
      const text = texts.get(Number(doc.source_document_id));
      if (!text) continue;
      const own = live.filter((fee) => Number(fee.source_document_id) === Number(doc.source_document_id));
      addSectionPathDocument(summary, replaySectionPathDocument(doc, text, own), options.sampleCap);
    }
  }
  return {
    switch: "SECTION_PATH_LIVE" as const,
    issue: 1092,
    scan: { offset: options.scanOffset, bound: options.maxDocuments, scanned, truncated: scanned >= options.maxDocuments, nextOffset: options.scanOffset + scanned },
    documentsMatched: documents.length,
    summary,
  };
}

async function heldVocabulary(reader: SwitchAuditReader, options: SwitchAuditOptions) {
  const { scanned, documents } = await reader.heldVocabularyDocuments(options.maxDocuments, options.scanOffset);
  const summary = emptyHeldVocabularySummary();
  for (const chunk of chunks(documents, options.chunkSize)) {
    const texts = await reader.sourceTexts(ids(chunk.map((doc) => doc.source_document_id)));
    const live = await reader.liveFeesAt(ids(chunk.map((doc) => doc.institution_id)));
    for (const doc of chunk) {
      const text = texts.get(Number(doc.source_document_id));
      if (!text) continue;
      const own = live.filter((fee) => Number(fee.source_document_id) === Number(doc.source_document_id));
      addHeldVocabularyDocument(summary, doc, replayHeldVocabularyDocument(doc, text, own), options.sampleCap);
    }
  }
  return {
    switch: "HELD_VOCABULARY_RELABEL_LIVE" as const,
    issue: 1092,
    scan: { offset: options.scanOffset, bound: options.maxDocuments, scanned, truncated: scanned >= options.maxDocuments, nextOffset: options.scanOffset + scanned },
    documentsMatched: documents.length,
    summary,
  };
}

async function footnotedAtmHeading(reader: SwitchAuditReader, options: SwitchAuditOptions) {
  const rows = await reader.atmHeadingRows(options.rowCap);
  const summary = emptyAtmHeadingSummary();
  const withDocument = rows.filter((row) => row.source_document_id != null);
  addAtmHeadingRows(summary, rows.filter((row) => row.source_document_id == null), new Map(), options.sampleCap);
  for (const documentIds of chunks(ids(withDocument.map((row) => row.source_document_id)), options.chunkSize)) {
    const texts = await reader.sourceTexts(documentIds);
    const wanted = new Set(documentIds);
    addAtmHeadingRows(summary, withDocument.filter((row) => wanted.has(Number(row.source_document_id))), texts, options.sampleCap);
  }
  const live = await reader.liveNonNetworkFees(options.rowCap);
  const byDocument = new Map<number | null, typeof live>();
  for (const fee of live) {
    const key = fee.source_document_id == null ? null : Number(fee.source_document_id);
    byDocument.set(key, [...(byDocument.get(key) ?? []), fee]);
  }
  replayLiveNonNetwork(summary.liveNonNetwork, null, byDocument.get(null) ?? [], [], options.sampleCap);
  for (const documentIds of chunks(ids([...byDocument.keys()]), options.chunkSize)) {
    const texts = await reader.documentTexts(documentIds);
    for (const id of documentIds) replayLiveNonNetwork(summary.liveNonNetwork, id, byDocument.get(id) ?? [], texts.get(id) ?? [], options.sampleCap);
  }
  return {
    switch: "FOOTNOTED_ATM_HEADING_LIVE" as const,
    issue: 1092,
    rowsRead: bounded(rows.length, options.rowCap),
    liveFeesRead: bounded(live.length, options.rowCap),
    summary,
  };
}

/** Darwin's waiver-row re-check over every live $0 it selects, a chunk of Knox's texts at a time. */
async function zeroWaiverRow(reader: SwitchAuditReader, options: SwitchAuditOptions) {
  const limit = Math.min(options.rowCap, ZERO_WAIVER_ROW_MAX_ROWS);
  const rows = await reader.zeroWaiverRowRows(limit);
  const summary = emptyZeroWaiverRowSummary();
  const institutions = new Set<number>();
  const byArtifact = new Map<number | null, ZeroWaiverRowLiveRow[]>();
  for (const row of rows) {
    const key = row.artifact_id == null ? null : Number(row.artifact_id);
    byArtifact.set(key, [...(byArtifact.get(key) ?? []), row]);
  }
  addZeroWaiverRows(summary, institutions, byArtifact.get(null) ?? [], new Map(), options.sampleCap);
  for (const artifactIds of chunks(ids([...byArtifact.keys()]), options.chunkSize)) {
    const texts = await reader.zeroWaiverRowTexts(artifactIds);
    addZeroWaiverRows(summary, institutions, artifactIds.flatMap((id) => byArtifact.get(id) ?? []), texts, options.sampleCap);
  }
  return { switch: "ZERO_WAIVER_ROW_TAKEDOWN_LIVE" as const, issue: 1092, rowsRead: bounded(rows.length, limit), summary };
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
    sectionPath: await sectionPath(reader, options),
    footnotedAtmHeading: await footnotedAtmHeading(reader, options),
    heldVocabulary: await heldVocabulary(reader, options),
    zeroWaiverRow: await zeroWaiverRow(reader, options),
    htmlRowPairing: { switch: "HTML_ROW_PAIRING_LIVE", issue: 1092, summary: summarizeHtmlExposure(await reader.htmlReaderExposure()) },
    liveAccuracy: liveAccuracyFrom(await reader.freshAudit(options.accuracySample)),
  };
}
