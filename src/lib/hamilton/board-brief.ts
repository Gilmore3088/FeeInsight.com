import type { AnalyzeResponse, ReportExhibit, ReportSummaryResponse } from "./types";
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { EvidenceBoundAnalyzeResponse, HamiltonEvidenceBundle } from "./evidence-contract";
import {
  CLAIM_BINDING_LIMITATION,
  LEGACY_HIGH_CONFIDENCE_LIMITATION,
  OWN_AGGREGATE_LIMITATION,
  PEER_AGGREGATE_LIMITATION,
  PEER_MEDIAN_RECORDS_LIMITATION,
  STORED_SNAPSHOT_LIMITATION,
} from "./evidence-contract";
import {
  APPENDIX_LINEAGE_LIMITATION,
  INCOMPLETE_RECORDS_LIMITATION,
  NO_RECORD_EVIDENCE_LIMITATION,
  savedEvidenceAppendix,
  type SavedEvidenceDerivationRow,
  type SavedEvidenceFactRow,
} from "./evidence-export";
import type { SourceRef } from "./workspace/types";
import { exportedAnswer } from "./written-answer-binding";
import { datasetPassage, readStampedFigures, type StampedFigure } from "@/lib/dataset-note";

/** A source date as a board reads it: "2026-10-12T00:00:00.000Z" -> "Oct 12, 2026"; anything else as saved. */
export function readerAsOf(asOf: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(asOf.trim());
  if (!m) return asOf;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The saved answer's evidence limits in a board's words. The stored wording stays as the audit record. */
export function readerLimitation(text: string): string {
  if (text === CLAIM_BINDING_LIMITATION || text === APPENDIX_LINEAGE_LIMITATION) return "Each figure is tied to its source; the sentences around the figures were not checked one by one.";
  if (text === LEGACY_HIGH_CONFIDENCE_LIMITATION) return "This answer was saved before Hamilton kept a source for each figure, so treat it as directional.";
  if (/^\d+ structured evidence records? saved with explicit identity\/source context\.$/.test(text)) return "Hamilton saved the figures behind this answer with the institution and source each came from.";
  if (text === "Deterministic storyline saved without claim-level structured evidence records." || text === NO_RECORD_EVIDENCE_LIMITATION) return "This answer was saved without a source for each individual figure.";
  if (text === STORED_SNAPSHOT_LIMITATION) return "Each figure matches the bank document Hamilton had stored when the answer was saved. It was not re-checked against the bank's current live schedule.";
  if (text === OWN_AGGREGATE_LIMITATION) return "The institution's figure combines fee lines that differ in product, frequency or source document, so it is not tied to one listed fee.";
  if (text === INCOMPLETE_RECORDS_LIMITATION) return "Some records behind this answer are incomplete; the records table marks which.";
  if (text === PEER_AGGREGATE_LIMITATION) return "Peer figures are medians with no single fee record behind them; read them as directional.";
  if (text === PEER_MEDIAN_RECORDS_LIMITATION) return "The peer median is worked out from each peer's own published fee, listed in the records table. The other peer figures, such as the middle half and wider-market medians, are directional.";
  return text;
}

function money(value: number): string {
  const digits = Number.isInteger(value) ? 0 : 2;
  const amount = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value < 0 ? "-" : ""}$${amount}`;
}

function recordValue(value: number | string | null, unit: SavedEvidenceFactRow["unit"]): string {
  if (value === null) return "Not recorded";
  if (typeof value === "string") return value;
  if (unit === "usd") return money(value);
  if (unit === "percent") return `${value}%`;
  return value.toLocaleString("en-US");
}

function recordProblems(problems: string[]): string {
  return problems.map((p) => p.replace(/_/g, " ")).join("; ");
}

// A board reads the fee first; the record ID stays in the source line so an auditor can match it.
function factRow(fact: SavedEvidenceFactRow, names: ReadonlyMap<number, string>): string[] {
  const { scope, source } = fact;
  const name = scope.feeCategory ? getDisplayName(scope.feeCategory) : null;
  // A product that only repeats the fee's name ("Overdraft fee") adds nothing.
  const product = scope.product && !(name && scope.product.toLowerCase().includes(name.split(/[\s(]/)[0].toLowerCase())) ? scope.product : null;
  const fee = [name, product].filter(Boolean).join(", ") || "Recorded figure";
  const value = [recordValue(fact.value, fact.unit), fact.frequency].filter(Boolean).join(" ");
  const institution = scope.institutionId === null ? "Institution not recorded" : names.get(scope.institutionId) ?? `Institution ${scope.institutionId}`;
  const detail = [
    source.recordId === null ? `record ${fact.id}; fee record not recorded` : `record ${fact.id}`,
    source.sourceDocumentIds.length ? `document ${source.sourceDocumentIds.join(", ")}` : "document not recorded",
    // The document's content fingerprint is its version: a changed schedule gets a new one.
    source.documentContentHash ? `version ${source.documentContentHash.slice(0, 12)}` : "version not recorded",
    `reporting date ${scope.reportingDate ? readerAsOf(scope.reportingDate) : "not recorded"}`,
    ...(source.asOf ? [`published ${readerAsOf(source.asOf)}`] : []),
    ...(source.retrievedAt ? [`retrieved ${readerAsOf(source.retrievedAt)}`] : []),
    ...(source.lastCheckedAt ? [`source last checked ${readerAsOf(source.lastCheckedAt)}`] : []),
    ...(source.location ? [source.location] : []),
  ].join(" · ");
  return [`${fee}, ${institution}`, value, detail, fact.problems.length ? `Incomplete record: ${recordProblems(fact.problems)}` : "Matches the stored source"];
}

/** The two calculations Hamilton records, in words; any other formula prints as recorded. */
const FORMULA_WORDS: Record<string, string> = {
  "median of published peer amounts": "the median of the peers' published fees, one per peer",
  "left - right": "the first record minus the second",
  "(current - prior) / prior * 100": "the change from the earlier record, as a percent of it",
};

function derivationRow(fact: SavedEvidenceDerivationRow): string[] {
  const denominator = fact.denominatorFactId ? `; divided by ${fact.denominatorFactId}` : "";
  const detail = `record ${fact.id} · ${FORMULA_WORDS[fact.formula] ?? fact.formula}, from ${fact.inputFactIds.length > 2 ? `${fact.inputFactIds.length} records (${fact.inputFactIds.join(", ")})` : fact.inputFactIds.join(" and ") || "no recorded inputs"}${denominator}; rounded to ${fact.rounding.replace(/;/g, ",")}`
    + ` · reporting date ${fact.scope.reportingDate ? readerAsOf(fact.scope.reportingDate) : "not recorded"}`;
  const label = fact.scope.feeCategory ? `${getDisplayName(fact.scope.feeCategory)}, calculated` : "Calculated figure";
  return [label, recordValue(fact.value, fact.unit), detail, fact.problems.length ? `Cannot be recalculated: ${recordProblems(fact.problems)}` : "Recalculated from the saved records"];
}

/**
 * Every saved limit on an answer in a reader's words: its confidence basis, then its evidence
 * records' own (stored source, not a live re-check; incomplete records). Read from the saved answer only.
 */
export function savedAnswerLimits(analysis: EvidenceBoundAnalyzeResponse): string[] {
  return [...new Set([...analysis.confidence.basis, ...savedEvidenceAppendix(analysis).limitations].map(readerLimitation))];
}

/**
 * The saved answer's evidence records as an exhibit (#981, H06-T08): each record keeps its ID, source
 * document and version, dates and calculation, frozen at save time so the screen, a reopened report
 * and the PDF read the same rows. "Matches the stored source" is never a live-source check.
 */
export function evidenceRecordsExhibit(analysis: EvidenceBoundAnalyzeResponse): ReportExhibit | null {
  const appendix = savedEvidenceAppendix(analysis);
  if (!appendix.facts.length && !appendix.derivations.length) return null;
  const identity = analysis.identityContext;
  const names = new Map<number, string>();
  if (identity?.researchInstitutionName && identity.researchInstitutionId) names.set(identity.researchInstitutionId, identity.researchInstitutionName);
  return {
    id: "evidence_records",
    title: "Records behind the saved answer",
    subtitle: `As saved ${appendix.generatedAt ? readerAsOf(appendix.generatedAt) : "on a date not recorded"}; not refreshed`,
    columns: ["Figure", "Value", "Source as saved", "Check"],
    rows: [...appendix.facts.map((fact) => factRow(fact, names)), ...appendix.derivations.map(derivationRow)],
    note: "\"Matches the stored source\" means the figure equals the bank document Hamilton had stored when the answer was saved. Hamilton did not re-check it against the bank's current live schedule for this report.",
  };
}

export interface BoardBriefEdits { title: string; teamNote: string; includeEvidence: boolean }

/** Reformat a saved answer; never recompute observations or invoke research. */
export function boardBriefFromAnalysis(analysis: AnalyzeResponse & { factEvidence?: HamiltonEvidenceBundle }, analysisId: string, edits: BoardBriefEdits): ReportSummaryResponse {
  const sources: SourceRef[] = analysis.storyline ? [
    ...analysis.storyline.keyFigures.map(f => f.source),
    ...analysis.storyline.situation.map(f => f.source),
    ...analysis.storyline.complication.map(f => f.source),
    ...analysis.storyline.lenses.finance.map(f => f.source),
    ...analysis.storyline.lenses.market.map(f => f.source),
    ...analysis.storyline.watch.map(f => f.source),
  ] : [];
  const unique = [...new Map(sources.map(s => [`${s.label}|${s.asOf ?? ""}|${s.url ?? ""}`, s])).values()];
  // #1924: the stamps saved with the answer, carried into the brief as saved; none for an older answer.
  const datasetStamps = readStampedFigures(analysis.datasetStamps);
  const dataset = savedDatasetSource(datasetStamps);
  const subject = analysis.identityContext?.researchInstitutionName;
  const fallback = subject && !analysis.title.includes(subject) ? `${subject}: ${analysis.title}` : analysis.title;
  const title = edits.title.trim().slice(0,200) || fallback;
  const limits = savedAnswerLimits(analysis);
  const records = edits.includeEvidence ? evidenceRecordsExhibit(analysis) : null;
  // The answer as the screen shows it (#981 H06-T08): left-out sentences stay out and Hamilton's
  // reading is printed apart, under its label, never inline with the findings.
  const shown = exportedAnswer(analysis);
  // A reading sentence whose figure is an index statistic keeps its basis line, as on screen.
  const reading = shown.reading.map((sentence) => {
    const basis = shown.readingBasis[sentence.trim()];
    return basis ? `${sentence} ${basis}` : sentence;
  });
  return {
    title,
    ...(analysis.identityContext ? { identityContext: analysis.identityContext } : {}),
    boardBrief: { sourceAnalysisId: analysisId, teamNote: edits.teamNote.slice(0,5000), includeEvidence: edits.includeEvidence, ...(analysis.factEvidence ? { factEvidence: analysis.factEvidence } : {}), ...(reading.length ? { reading } : {}) },
    // A board brief reports findings; it never lists actions for the institution. Ask's follow-up
    // suggestions become questions the committee may want answered.
    answer: { headline: shown.hamiltonView, decisions: [] },
    watchlist: analysis.exploreFurther,
    executiveSummary: [shown.hamiltonView],
    snapshot: [],
    strategicRationale: [shown.whatThisMeans, ...shown.whyItMatters].filter(Boolean).join("\n\n"),
    tradeoffs: limits.map(value => ({ label: "Evidence limitation", value })),
    recommendation: limits.length ? limits.join("\n\n") : "Hamilton recorded no limits for this answer.",
    implementationNotes: ["Built from a saved Hamilton answer. Figures are as first saved and were not refreshed.", ...(edits.teamNote.trim() ? [`Team note (user-authored): ${edits.teamNote.trim().slice(0,5000)}`] : [])],
    exhibits: [
      ...(edits.includeEvidence && analysis.evidence.metrics.length ? [{ id: "statistical_appendix" as const, title: "Evidence from the saved answer", subtitle: "Original values and source notes; not refreshed", columns: ["Measure", "Value", "Source / note"], rows: analysis.evidence.metrics.map(m => [m.label, m.value, m.note ?? ""]), note: "Values as first saved with the answer." }] : []),
      ...(records ? [records] : []),
    ],
    sources: [
      ...(unique.length ? unique.map(s => ({ label: s.label, detail: s.asOf ? `As of ${readerAsOf(s.asOf)}` : "As cited in the saved answer", url: s.url ?? null })) : [{ label: "Saved Hamilton analysis", detail: records ? "Each figure's source is in the records table above." : "Source details were not saved with this answer. Open the saved answer to see its evidence.", url: null }]),
      ...(dataset ? [dataset] : []),
    ],
    ...(datasetStamps.length ? { datasetStamps } : {}),
    exportControls: { pdfEnabled: true, shareEnabled: false },
  };
}

/** The sources entry that carries a saved answer's stamps; a printed brief sets its words as prose instead (#1924 step 4). */
export const SAVED_DATASET_SOURCE_LABEL = "Bank Fee Index figures in this brief";

/** Where a saved answer's reader finds every filter behind its figures. */
export const SAVED_ANSWER_FULL_LIST = "the full list is in the saved answer in Hamilton";

/**
 * The saved answer's dataset stamps as one sources entry, the copy a committee reads
 * (datasetPassage): the summary, the filters that set the group (the standard rules every figure
 * shares are named, not listed), how figures differ, and the reference ids. Null without stamps.
 */
export function savedDatasetSource(figures: readonly StampedFigure[]): { label: string; detail: string; url: null } | null {
  const passage = datasetPassage(figures, SAVED_ANSWER_FULL_LIST);
  if (!passage) return null;
  return { label: SAVED_DATASET_SOURCE_LABEL, detail: passage.join(" "), url: null };
}

/** Editing preserves the frozen report exhibits, source references and original identity. */
export function editBoardBrief(report: ReportSummaryResponse, edits: BoardBriefEdits): ReportSummaryResponse {
  if (!report.boardBrief) throw new Error("This historical report uses its original report workflow.");
  return { ...report, title: edits.title.trim().slice(0,200) || report.title,
    boardBrief: { ...report.boardBrief, teamNote: edits.teamNote.slice(0,5000) },
    implementationNotes: [...report.implementationNotes.filter(n => !n.startsWith("Team note (user-authored):")), ...(edits.teamNote.trim() ? [`Team note (user-authored): ${edits.teamNote.trim().slice(0,5000)}`] : [])],
  };
}

export interface MarketBriefInput {
  /** "Florida", "the United States". */
  place: string;
  /** "Banks & credit unions", plus any size slice. */
  scopeLabel: string;
  topics: string;
  findings: Array<{ title: string; body: string; source: string }>;
  exhibits: ReportExhibit[];
  sources: Array<{ label: string; detail: string; url: string | null }>;
  limits: string[];
  researchHref: string;
}

/** A board brief from a market view: the facts on screen, their exhibits and sources. Lists findings, never actions. */
export function boardBriefFromMarket(input: MarketBriefInput): ReportSummaryResponse {
  const [lead, ...rest] = input.findings;
  const headline = lead ? `${lead.title} ${lead.body}`.trim() : `Hamilton has no finding for ${input.place} at this scope. See the exhibits and limits below.`;
  return {
    title: `${input.place[0].toUpperCase()}${input.place.slice(1)}: ${input.topics}`,
    boardBrief: { sourceResearchHref: input.researchHref, teamNote: "", includeEvidence: true },
    answer: { headline, decisions: [] },
    executiveSummary: [headline],
    snapshot: [],
    strategicRationale: rest.length
      ? rest.map(f => `${f.title} ${f.body} (Source: ${f.source}.)`).join("\n\n")
      : `Scope: ${input.scopeLabel}.`,
    tradeoffs: [],
    recommendation: input.limits.join("\n\n"),
    implementationNotes: [`Scope: ${input.scopeLabel}. Figures are as published when this brief was saved.`],
    exhibits: input.exhibits,
    sources: input.sources,
    exportControls: { pdfEnabled: true, shareEnabled: false },
  };
}
