import type { AnalyzeResponse, ReportExhibit, ReportSummaryResponse } from "./types";
import type { HamiltonEvidenceBundle } from "./evidence-contract";
import type { SourceRef } from "./workspace/types";

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
  const title = edits.title.trim().slice(0,200) || `${analysis.title}: board brief`;
  return {
    title,
    ...(analysis.identityContext ? { identityContext: analysis.identityContext } : {}),
    boardBrief: { sourceAnalysisId: analysisId, teamNote: edits.teamNote.slice(0,5000), includeEvidence: edits.includeEvidence, ...(analysis.factEvidence ? { factEvidence: analysis.factEvidence } : {}) },
    // A board brief reports findings; it never lists actions for the institution. Ask's follow-up
    // suggestions become questions the committee may want answered.
    answer: { headline: analysis.hamiltonView, decisions: [] },
    watchlist: analysis.exploreFurther,
    executiveSummary: [analysis.hamiltonView],
    snapshot: [],
    strategicRationale: [analysis.whatThisMeans, ...analysis.whyItMatters].filter(Boolean).join("\n\n"),
    tradeoffs: analysis.confidence.basis.map(value => ({ label: "Evidence limitation", value })),
    recommendation: analysis.confidence.basis.length ? analysis.confidence.basis.join("\n\n") : "Hamilton recorded no limits for this answer.",
    implementationNotes: ["Built from a saved Hamilton answer. Figures are as first saved and were not refreshed.", ...(edits.teamNote.trim() ? [`Team note (user-authored): ${edits.teamNote.trim().slice(0,5000)}`] : [])],
    exhibits: edits.includeEvidence && analysis.evidence.metrics.length ? [{ id: "statistical_appendix", title: "Evidence from the saved answer", subtitle: "Original values and source notes; not refreshed", columns: ["Measure", "Value", "Source / note"], rows: analysis.evidence.metrics.map(m => [m.label, m.value, m.note ?? "Not recorded"]), note: "Values as first saved with the answer." }] : [],
    sources: unique.length ? unique.map(s => ({ label: s.label, detail: `Reporting period: ${s.asOf ?? "not recorded"}`, url: s.url ?? null })) : [{ label: "Saved Hamilton analysis", detail: "Source details were not saved with this answer. Open the saved answer to see its evidence.", url: null }],
    exportControls: { pdfEnabled: true, shareEnabled: false },
  };
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
  const headline = input.findings[0] ? `${input.findings[0].title} ${input.findings[0].body}`.trim() : `The published data for ${input.place} could not load when this brief was made.`;
  return {
    title: `${input.place[0].toUpperCase()}${input.place.slice(1)}: ${input.topics}`,
    boardBrief: { sourceResearchHref: input.researchHref, teamNote: "", includeEvidence: true },
    answer: { headline, decisions: [] },
    executiveSummary: input.findings.map(f => `${f.title} ${f.body}`.trim()),
    snapshot: [],
    strategicRationale: input.findings.length > 1
      ? input.findings.slice(1).map(f => `${f.title} ${f.body} (Source: ${f.source}.)`).join("\n\n")
      : `Scope: ${input.scopeLabel}.`,
    tradeoffs: input.limits.map(value => ({ label: "Evidence limitation", value })),
    recommendation: input.limits.join("\n\n"),
    implementationNotes: [`Scope: ${input.scopeLabel}. Figures are as published when this brief was saved.`],
    exhibits: input.exhibits,
    sources: input.sources,
    exportControls: { pdfEnabled: true, shareEnabled: false },
  };
}
