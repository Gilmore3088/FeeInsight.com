"use server";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { reportStartError } from "@/lib/report-access";
import { redirectWithoutPremium } from "@/lib/team-billing";
import { sql } from "@/lib/data-store/connection";
import { recordProRequest } from "@/lib/agents/run-store";
import { getHamiltonReportById, saveHamiltonReport } from "@/lib/hamilton/pro-tables";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { readMonthlyBriefing } from "@/lib/hamilton/monthly-briefing-read";
import {
  MONTHLY_BRIEFING_REPORT_TYPE,
  editMonthlyBriefing,
  monthlyBriefingEditsError,
  monthlyBriefingReport,
  type MonthlyBriefingEdits,
} from "@/lib/hamilton/monthly-briefing";

const PATH = "/pro/reports/monthly";

/**
 * "Build this month's briefing": reads the institution's sourced figures on the server (the browser
 * sends only the institution), saves the briefing as a Hamilton report and opens it. On request
 * only: nothing schedules or emails a briefing. No model call.
 */
export async function createMonthlyBriefing(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  await redirectWithoutPremium(user, PATH);
  if (!user) redirect(`/login?from=${encodeURIComponent(PATH)}`);
  const blocked = await reportStartError(user, PATH);
  if (blocked) redirect(`${PATH}?error=access`);
  const instId = String(form.get("instId") ?? "").trim() || null;
  const { institution } = await resolveHamiltonInstitutionContext({ userId: user.id, instId, intent: "reports", persistUrlSelection: false, transientSource: instId ? "artifact" : undefined });
  if (!institution) redirect(PATH);
  let reportId: string;
  try {
    const read = await readMonthlyBriefing({ institutionId: institution.id, userId: user.id });
    if (!read) throw new Error("institution not found");
    const report = monthlyBriefingReport(read.briefing);
    reportId = await saveHamiltonReport({
      feeRefs: read.feeRefs,
      userId: user.id,
      institutionId: String(institution.id),
      reportType: MONTHLY_BRIEFING_REPORT_TYPE,
      reportJson: report,
      evidencePolicy: "verified-only",
      selectedSource: "manual",
      selectedSourceLabel: "Monthly briefing",
      peerSetId: read.peerIndex?.peerSetId ?? null,
      peerBaselineSource: read.peerIndex?.source ?? null,
      peerBaselineLabel: read.peerIndex?.label ?? null,
      peerFallbackReason: read.peerIndex?.fallbackReason ?? null,
    });
    await recordProRequest({ operation: "report", title: report.title, status: "completed", summary: "Built a monthly institution briefing from sourced figures without a provider call", userId: user.id, institutionId: institution.id, detail: { report_id: reportId, report_type: MONTHLY_BRIEFING_REPORT_TYPE, provider_call_queued: false, month: read.briefing.month } });
  } catch (error) {
    console.error("[monthly-briefing] build failed", error);
    redirect(`${PATH}?${new URLSearchParams({ instId: String(institution.id), error: "build" })}`);
  }
  redirect(`${PATH}?report_id=${encodeURIComponent(reportId)}`);
}

/** Saves the subscriber's words over a saved briefing; its figures and sources never change. */
export async function saveMonthlyBriefing(input: { reportId: string; edits: MonthlyBriefingEdits }): Promise<{ success: true } | { success: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Hamilton access required." };
  // A lapsed account keeps its saved briefings read-only (#1999).
  const blocked = await reportStartError(user, PATH);
  if (blocked) return { success: false, error: blocked };
  if (typeof input?.reportId !== "string" || !input.reportId) return { success: false, error: "Briefing not found." };
  const invalid = monthlyBriefingEditsError(input.edits);
  if (invalid) return { success: false, error: invalid };
  try {
    const saved = await getHamiltonReportById(input.reportId, user.id);
    if (!saved || saved.report_type !== MONTHLY_BRIEFING_REPORT_TYPE || !saved.report_json.monthlyBriefing) return { success: false, error: "Briefing not found." };
    const report = editMonthlyBriefing(saved.report_json, input.edits);
    const rows = await sql<{ id: string }[]>`UPDATE hamilton_reports SET report_json = ${JSON.stringify(report)} WHERE id::text = ${input.reportId} AND user_id = ${user.id} AND report_type = ${MONTHLY_BRIEFING_REPORT_TYPE} AND status = 'generated' RETURNING id::text`;
    if (!rows[0]) return { success: false, error: "This briefing can no longer be edited." };
    await recordProRequest({ operation: "report", title: report.title, status: "completed", summary: "Edited a saved monthly briefing; its figures and sources kept as built", userId: user.id, institutionId: Number(saved.institution_id) || null, detail: { report_id: input.reportId, report_type: MONTHLY_BRIEFING_REPORT_TYPE, provider_call_queued: false } });
    return { success: true };
  } catch (error) {
    console.error("[monthly-briefing] save failed", error);
    return { success: false, error: "The briefing could not be saved. Your edits are still here; try again." };
  }
}
