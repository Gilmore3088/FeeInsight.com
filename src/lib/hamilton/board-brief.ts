import { getDisplayName } from "@/lib/fee-taxonomy";
import type { AnalyzeResponse, ReportSummaryResponse } from "./types";
import type { SourceRef } from "./workspace/types";

export interface BoardBriefEdits { title: string; teamNote: string; includeEvidence: boolean }

/** Reformat a saved answer; never recompute observations or invoke research. */
export function boardBriefFromAnalysis(analysis: AnalyzeResponse, analysisId: string, edits: BoardBriefEdits): ReportSummaryResponse {
  const sources: SourceRef[] = analysis.storyline ? [
    ...analysis.storyline.keyFigures.map(f => f.source),
    ...analysis.storyline.situation.map(f => f.source),
    ...analysis.storyline.complication.map(f => f.source),
    ...analysis.storyline.lenses.finance.map(f => f.source),
    ...analysis.storyline.lenses.market.map(f => f.source),
    ...analysis.storyline.watch.map(f => f.source),
  ] : [];
  const unique = [...new Map(sources.map(s => [`${s.label}|${s.asOf ?? ""}|${s.url ?? ""}`, s])).values()];
  const title = edits.title.trim().slice(0,200) || `${analysis.title} — board brief`;
  return {
    title,
    ...(analysis.identityContext ? { identityContext: analysis.identityContext } : {}),
    boardBrief: { ...(analysis.researchSelection ? { researchSelection: analysis.researchSelection } : {}), sourceAnalysisId: analysisId, teamNote: edits.teamNote.slice(0,5000), includeEvidence: edits.includeEvidence, ...(analysis.factEvidence ? { factEvidence: analysis.factEvidence } : {}) },
    answer: { headline: analysis.hamiltonView, decisions: analysis.exploreFurther.map(action => ({ action, why: "Follow-up from the original saved analysis", confidence: null, confidenceReason: null })) },
    executiveSummary: [analysis.hamiltonView],
    snapshot: [],
    strategicRationale: [analysis.whatThisMeans, ...analysis.whyItMatters].filter(Boolean).join("\n\n"),
    tradeoffs: analysis.confidence.basis.map(value => ({ label: "Evidence limitation", value })),
    recommendation: "Review the source evidence and unresolved questions before deciding.",
    implementationNotes: [...(analysis.researchSelection ? [`Original research scope: ${analysis.researchSelection.scope.kind === "state" ? analysis.researchSelection.scope.stateCode : analysis.researchSelection.scope.kind === "national" ? "United States" : `Institution ${analysis.researchSelection.scope.institutionId}`} · ${analysis.researchSelection.charter === "all" ? "banks and credit unions" : analysis.researchSelection.charter.replace("_", " ")} · ${analysis.researchSelection.categories.map(getDisplayName).join(", ")}`] : []), ...analysis.confidence.basis.map(b => `Evidence limitation: ${b}`), ...analysis.exploreFurther, ...(edits.teamNote.trim() ? [`Team note (user-authored): ${edits.teamNote.trim().slice(0,5000)}`] : [])],
    exhibits: edits.includeEvidence && analysis.evidence.metrics.length ? [{ id: "statistical_appendix", title: "Evidence from the saved answer", subtitle: "Original values and source notes; not refreshed", columns: ["Measure", "Value", "Source / note"], rows: analysis.evidence.metrics.map(m => [m.label, m.value, m.note ?? "Not recorded"]), note: "Reused from the original saved analysis. This conversion does not perform a new verification or change reporting periods." }] : [],
    sources: unique.length ? unique.map(s => ({ label: s.label, detail: `Reporting period: ${s.asOf ?? "not recorded"}`, url: s.url ?? null })) : [{ label: "Saved Hamilton analysis", detail: "Detailed source provenance was not recorded with this historical answer. Inspect the original answer; no current sources were substituted.", url: null }],
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
