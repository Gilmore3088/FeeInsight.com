import type { sql as sqlTag } from "@/lib/data-store/connection";
import { loadResearchInputs } from "@/lib/data-store/research-database";
import { getReportArtifactStore, reportArtifactKey, type ReportStepResult } from "@/lib/report-engine/render-job";
import { assembleResearchSnapshot, researchTitle, validateResearchSnapshot } from "./assemble";
import { renderResearchHtml } from "./presentation";
import { parseResearchRequest, RESEARCH_EDITION } from "./types";
import { readResearchManifest } from "./manifest";
import { buildHamiltonInstitutionBriefingSnapshot } from "@/lib/hamilton/institution-briefing";

type Db = typeof sqlTag;

export async function runResearchRender(db: Db, jobId: string | null | undefined, deps = { load: loadResearchInputs, store: getReportArtifactStore }) : Promise<ReportStepResult> {
  if (!jobId) throw new Error("Research run needs a report job.");
  const [job] = await db`SELECT status, params, report_type FROM report_jobs WHERE id = ${jobId}`;
  if (!job) throw new Error("Research job not found.");
  if (["cancel_requested", "cancelled", "complete"].includes(job.status)) return { status: "skipped", summary: "Research job is already closed or cancelled.", detail: { report_job_id: jobId } };
  if (job.status === "rendering") return { status: "skipped", summary: "Research evidence is already stored; verification is next.", detail: { report_job_id: jobId } };
  try {
    const params = typeof job.params === "string" ? JSON.parse(job.params) : job.params;
    if (params?.edition !== RESEARCH_EDITION) throw new Error("Research edition is required.");
    const request = parseResearchRequest(params.research);
    const expectedType = request.cadence === "monthly" ? "monthly_pulse" : "national_index";
    if (job.report_type !== expectedType) throw new Error("Research cadence does not match report type.");
    const store = deps.store();
    if (!store) throw new Error("Report artifact storage is not configured.");
    const [claimed] = await db`UPDATE report_jobs SET status = 'assembling', error = NULL WHERE id = ${jobId} AND status IN ('pending', 'assembling') RETURNING id`;
    if (!claimed) throw new Error("Research job is no longer pending.");
    const input = await deps.load(request);
    const snapshot = assembleResearchSnapshot(request, input);
    if (!snapshot.cells.some(c => c.value !== null)) throw new Error("Research has no publishable figures. Check source readiness and coverage.");
    const briefing = request.institutionId ? await buildHamiltonInstitutionBriefingSnapshot({ institutionId: request.institutionId, audience: params.audience === "pro" ? "pro" : "admin", intent: "market-research", evidencePolicy: "verified-only" }, { writtenAnswer: true }) : null;
    const manifest = { research_snapshot: snapshot, research_inputs: input, research_verification: null,
      selected_institution_context: briefing ? { institutionId: request.institutionId, evidencePolicy: "verified-only", source: params.selectedInstitutionSource ?? "manual", sourceLabel: params.selectedInstitutionSourceLabel ?? "Research institution selection", verifiedEvidenceCount: briefing.evidence.filter(e => e.evidence_tier === "verified").length, regulatoryEvidenceCount: briefing.evidence.filter(e => e.evidence_tier === "regulatory").length } : null };
    // Bound the saved replay evidence rather than silently truncating a national report.
    if (Buffer.byteLength(JSON.stringify(manifest)) > 25 * 1024 * 1024) throw new Error("Research evidence exceeds the 25 MB snapshot limit; narrow the report modules.");
    const key = reportArtifactKey("research", jobId);
    await store.put(key, renderResearchHtml(snapshot, researchTitle(snapshot)), "text/html; charset=utf-8");
    const [saved] = await db`
      UPDATE report_jobs SET status = 'rendering', artifact_key = ${key}, data_manifest = ${db.json(JSON.parse(JSON.stringify(manifest)))}
       WHERE id = ${jobId} AND status = 'assembling' RETURNING id`;
    if (!saved) return { status: "skipped", summary: "Research job changed during assembly; stored artifact was not attached.", detail: { report_job_id: jobId, unattached_artifact_key: key } };
    return { status: "completed", summary: "Research snapshot and report stored; frozen evidence replay is next. Human publication approval is required.", detail: { report_job_id: jobId, snapshot_hash: snapshot.snapshotHash, figures: snapshot.cells.length } };
  } catch (error) {
    await db`UPDATE report_jobs SET status = 'failed', error = ${error instanceof Error ? error.message : String(error)} WHERE id = ${jobId} AND status IN ('pending', 'assembling', 'rendering')`;
    throw error;
  }
}

export async function runResearchVerify(db: Db, jobId: string | null | undefined): Promise<ReportStepResult> {
  if (!jobId) throw new Error("Research verification needs a report job.");
  const [job] = await db`SELECT status, data_manifest FROM report_jobs WHERE id = ${jobId}`;
  if (!job) throw new Error("Research job not found.");
  if (["cancel_requested", "cancelled", "complete"].includes(job.status)) return { status: "skipped", summary: "Research job is already closed or cancelled.", detail: { report_job_id: jobId } };
  const manifest = readResearchManifest(job.data_manifest);
  const verified = !!manifest && validateResearchSnapshot(manifest.research_snapshot, manifest.research_inputs);
  if (!verified || !manifest) {
    await db`UPDATE report_jobs SET status = 'failed', error = 'Frozen research evidence did not reproduce the report.' WHERE id = ${jobId} AND status = 'rendering'`;
    throw new Error("Frozen research evidence did not reproduce the report.");
  }
  // Keep the originally selected JSON unchanged: it is the compare-and-swap preimage.
  const verifiedManifest = { ...manifest, research_verification: { verified: true, checkedAt: new Date().toISOString(), snapshotHash: manifest.research_snapshot.snapshotHash, kind: "frozen_input_replay" as const } };
  const [saved] = await db`
    UPDATE report_jobs SET status = 'complete', completed_at = NOW(), error = NULL,
           data_manifest = ${db.json(JSON.parse(JSON.stringify(verifiedManifest)))}
     WHERE id = ${jobId} AND status = 'rendering' AND data_manifest = ${db.json(job.data_manifest)} RETURNING id`;
  if (!saved) throw new Error("Research job changed during verification; no completion was recorded.");
  return { status: "completed", summary: "Frozen inputs reproduce the report. Ready for human editorial review; nothing was published.", detail: { report_job_id: jobId, snapshot_hash: manifest.research_snapshot.snapshotHash } };
}
