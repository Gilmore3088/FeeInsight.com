"use server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { sql } from "@/lib/data-store/connection";
import { getHamiltonReportById, saveHamiltonReport } from "@/lib/hamilton/pro-tables";
import { readSavedOutputFeeRefs } from "@/lib/data-store/saved-output-fee-refs";
import { loadAnalysisRecord } from "../analyze/actions";
import { boardBriefFromAnalysis, editBoardBrief, type BoardBriefEdits } from "@/lib/hamilton/board-brief";
import { recordProRequest } from "@/lib/agents/run-store";
import { redirect } from "next/navigation";
import { boardBriefFromMarket } from "@/lib/hamilton/board-brief";
import { decodeLandingResearch } from "@/lib/hamilton/landing-research-handoff";
import { INTELLIGENCE_LENSES, type Lens } from "@/lib/hamilton/market-question";
import { assetSizeFor } from "@/lib/hamilton/asset-size";
import { loadIntelligence } from "@/components/hamilton/intelligence/IntelligenceWorkspace";
import { marketBoardBriefInput } from "@/components/hamilton/intelligence/market-board-brief";

/** Source IDs are user-scoped on every save; browser evidence/identity is never accepted. */
export async function saveBoardBrief(input: { analysisId?: string; reportId?: string; edits: BoardBriefEdits }): Promise<{ success: true; reportId: string } | { success: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) return { success: false, error: "Hamilton access required." };
  if (!input?.edits || typeof input.edits.title !== "string" || typeof input.edits.teamNote !== "string" || typeof input.edits.includeEvidence !== "boolean" || input.edits.title.length > 200 || input.edits.teamNote.length > 5000) return { success: false, error: "Check the title and team note lengths." };
  try {
    if (input.reportId) {
      const saved = await getHamiltonReportById(input.reportId, user.id);
      if (!saved || saved.report_type !== "board_brief" || !saved.report_json.boardBrief) return { success: false, error: "Editable board brief not found." };
      const report = editBoardBrief(saved.report_json, input.edits);
      const rows = await sql<{ id: string }[]>`UPDATE hamilton_reports SET report_json = ${JSON.stringify(report)} WHERE id::text = ${input.reportId} AND user_id = ${user.id} AND report_type = 'board_brief' AND status = 'generated' RETURNING id::text`;
      if (!rows[0]) return { success: false, error: "This report is no longer editable." };
      await recordProRequest({ operation: "report", title: report.title, status: "completed", summary: "Edited saved board brief; original evidence retained", userId: user.id, institutionId: Number(saved.institution_id) || null, detail: { report_id: input.reportId, provider_call_queued: false } });
      return { success: true, reportId: input.reportId };
    }
    if (!input.analysisId) return { success: false, error: "Choose a saved answer first." };
    const saved = await loadAnalysisRecord(input.analysisId);
    if (!saved) return { success: false, error: "Saved analysis not found." };
    const report = boardBriefFromAnalysis(saved.responseJson, saved.id, input.edits);
    // H03-T09: the brief reuses the answer's findings, so it carries the fee rows the answer recorded.
    const feeRefs = (await readSavedOutputFeeRefs(sql, "analysis", saved.id)) ?? undefined;
    const reportId = await saveHamiltonReport({ feeRefs, userId: user.id, institutionId: saved.institutionId ?? "", reportType: "board_brief", reportJson: report, evidencePolicy: "source-diligence", selectedSource: "manual", selectedSourceLabel: "Original saved analysis", peerBaselineLabel: saved.responseJson.identityContext?.peerBaselineLabel ?? null, peerFallbackReason: "Reused the saved analysis; no new research or cohort substitution." });
    await recordProRequest({ operation: "report", title: report.title, status: "completed", summary: "Created board brief from saved research without a provider call", userId: user.id, institutionId: Number(saved.institutionId) || null, detail: { report_id: reportId, analysis_id: saved.id, provider_call_queued: false, evidence_policy: "source-diligence" } });
    return { success: true, reportId };
  } catch (error) {
    console.error("[board-brief] save failed", error);
    return { success: false, error: "The board brief could not be saved. Your edits remain here; retry." };
  }
}

/**
 * "Build board brief" on Overview, Research and a market brief: reloads the same governed readers
 * on the server (the browser sends only the selection), saves a board brief and opens its editor.
 */
export async function createMarketBoardBrief(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) redirect("/subscribe");
  let selection;
  try { selection = decodeLandingResearch(String(form.get("research") ?? "")); } catch { selection = null; }
  if (!selection || selection.scope.kind === "local") redirect("/pro/hamilton");
  const asked = String(form.get("lenses") ?? "").split(",");
  const lenses: Lens[] = INTELLIGENCE_LENSES.map(l => l.id).filter(id => asked.includes(id));
  const size = assetSizeFor(String(form.get("size") ?? ""));
  const compare = { ...selection, task: "compare" as const };
  const chosen = lenses.length ? lenses : INTELLIGENCE_LENSES.map(l => l.id);
  let reportId: string;
  try {
    const data = await loadIntelligence(compare, chosen, { compact: false, segment: size.id === "all" ? null : size });
    const input = marketBoardBriefInput(compare, data, chosen, size);
    // Nothing loaded: say so rather than save an empty brief.
    if (!input.findings.length && !input.exhibits.length) throw new Error("no market data loaded");
    const report = boardBriefFromMarket(input);
    reportId = await saveHamiltonReport({ userId: user.id, institutionId: "", reportType: "board_brief", reportJson: report, evidencePolicy: "source-diligence", selectedSource: "manual", selectedSourceLabel: "Market research", peerBaselineLabel: null, peerFallbackReason: "Market view; no institution peer group." });
    await recordProRequest({ operation: "report", title: report.title, status: "completed", summary: "Created board brief from market research without a provider call", userId: user.id, institutionId: null, detail: { report_id: reportId, provider_call_queued: false, evidence_policy: "source-diligence", lenses: chosen } });
  } catch (error) {
    console.error("[board-brief] market save failed", error);
    redirect("/pro/reports?board_error=1");
  }
  redirect(`/pro/reports?report_id=${encodeURIComponent(reportId)}`);
}
