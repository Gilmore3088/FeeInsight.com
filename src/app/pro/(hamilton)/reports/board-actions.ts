"use server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { sql } from "@/lib/data-store/connection";
import { getHamiltonReportById, saveHamiltonReport } from "@/lib/hamilton/pro-tables";
import { loadAnalysisRecord } from "../analyze/actions";
import { boardBriefFromAnalysis, editBoardBrief, type BoardBriefEdits } from "@/lib/hamilton/board-brief";
import { recordProRequest } from "@/lib/agents/run-store";

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
    const reportId = await saveHamiltonReport({ userId: user.id, institutionId: saved.institutionId ?? "", reportType: "board_brief", reportJson: report, evidencePolicy: "source-diligence", selectedSource: "manual", selectedSourceLabel: "Original saved analysis", peerBaselineLabel: saved.responseJson.identityContext?.peerBaselineLabel ?? null, peerFallbackReason: "Reused the saved analysis; no new research or cohort substitution." });
    await recordProRequest({ operation: "report", title: report.title, status: "completed", summary: "Created board brief from saved research without a provider call", userId: user.id, institutionId: Number(saved.institutionId) || null, detail: { report_id: reportId, analysis_id: saved.id, provider_call_queued: false, evidence_policy: "source-diligence" } });
    return { success: true, reportId };
  } catch (error) {
    console.error("[board-brief] save failed", error);
    return { success: false, error: "The board brief could not be saved. Your edits remain here; retry." };
  }
}
