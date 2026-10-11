"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Download, Save } from "lucide-react";
import { saveBoardBrief } from "@/app/pro/(hamilton)/reports/board-actions";
import { boardBriefFromAnalysis, editBoardBrief } from "@/lib/hamilton/board-brief";
import type { AnalyzeResponse, ReportSummaryResponse, ReportArtifactMetadata } from "@/lib/hamilton/types";
import { ReportOutput } from "./ReportOutput";

export function BoardBriefEditor({ analysis, analysisId, initialReport, reportId, metadata }: {
  analysis?: AnalyzeResponse; analysisId?: string; initialReport?: ReportSummaryResponse; reportId?: string; metadata?: ReportArtifactMetadata;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialReport?.title ?? `${analysis?.title ?? "Research"} — board brief`);
  const [teamNote, setTeamNote] = useState(initialReport?.boardBrief?.teamNote ?? "");
  const [includeEvidence, setIncludeEvidence] = useState(initialReport?.boardBrief?.includeEvidence ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [savedId, setSavedId] = useState(reportId ?? null);
  const [savedFingerprint, setSavedFingerprint] = useState(reportId ? JSON.stringify([title, teamNote, includeEvidence]) : null);
  const saving = useRef(false);
  const fingerprint = JSON.stringify([title, teamNote, includeEvidence]);
  const dirty = savedFingerprint !== fingerprint;
  const edits = { title, teamNote, includeEvidence };
  const report = initialReport ? editBoardBrief(initialReport, edits) : analysis && analysisId ? boardBriefFromAnalysis(analysis, analysisId, edits) : null;
  async function save() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try {
      const result = await saveBoardBrief({ ...(savedId ? { reportId: savedId } : { analysisId }), edits });
      if (!result.success) { setError(result.error); return; }
      setSavedId(result.reportId); setSavedFingerprint(fingerprint);
      router.replace(`/pro/reports?report_id=${encodeURIComponent(result.reportId)}`);
    } catch {
      setError("The brief could not be saved. Your edits remain here; retry.");
    } finally { saving.current = false; setBusy(false); }
  }
  async function download() {
    if (!savedId || dirty || downloadBusy) return;
    setDownloadBusy(true); setError(null);
    try {
      const response = await fetch("/api/pro/report-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "report", reportId: savedId }) });
      if (!response.ok) throw new Error("The PDF could not be prepared. Retry the download.");
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = "hamilton-board-brief.pdf"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : "PDF download failed."); }
    finally { setDownloadBusy(false); }
  }
  if (!report) return <p role="alert">Choose a saved analysis to create a board brief.</p>;
  return <div className="mx-auto flex max-w-6xl flex-col gap-6">
    <header className="flex flex-wrap justify-between gap-4"><div><h1 className="text-3xl font-semibold">Board brief</h1><p className="mt-2 text-sm text-warm-600">Reused research. Edit your presentation and team note, then save and export.</p></div><div className="flex flex-wrap gap-3">
      <button className="flex items-center gap-2 rounded-md bg-terra px-4 py-3 text-sm text-white disabled:opacity-50" disabled={busy || !dirty} onClick={() => void save()}><Save size={17} aria-hidden />{busy ? "Saving…" : "Save brief"}</button>
      <button className="flex items-center gap-2 rounded-md border border-warm-300 bg-white px-4 py-3 text-sm disabled:opacity-50" disabled={!savedId || dirty || downloadBusy} onClick={() => void download()}><Download size={17} aria-hidden />{downloadBusy ? "Preparing…" : "Export PDF"}</button>
    </div></header>
    {error ? <p role="alert" className="rounded border border-red-300 p-3 text-sm text-red-800">{error}</p> : null}
    <p role="status" className="text-xs text-warm-600">{dirty ? "Unsaved changes · save before exporting" : "Saved · PDF uses this saved version"}</p>
    <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]"><section className="intelligence-panel flex flex-col gap-5" aria-label="Edit board brief">
      <h2 className="!text-base">Report details</h2><label className="text-sm">Title<input className="mt-2 w-full rounded border border-warm-300 p-2" value={title} maxLength={200} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
      <label className="text-sm">Team note<textarea className="mt-2 w-full rounded border border-warm-300 p-2" rows={6} value={teamNote} maxLength={5000} disabled={busy} onChange={e => setTeamNote(e.target.value)} /><span className="mt-1 block text-xs text-warm-600">Shown as user-authored commentary, separately from Hamilton’s findings.</span></label>
      {!initialReport ? <label className="text-sm"><input type="checkbox" checked={includeEvidence} disabled={busy} onChange={e => setIncludeEvidence(e.target.checked)} /> Include original evidence exhibit</label> : null}
      <p className="text-xs leading-relaxed text-warm-600">Source facts, reporting dates and institution identity stay with the original research. This action makes no new AI request.</p>
      <Link href={`/pro/analyze?analysis=${encodeURIComponent(report.boardBrief!.sourceAnalysisId)}`} className="flex items-center gap-2 text-sm text-terra-text underline"><FileText size={16} aria-hidden />Open original analysis</Link>
    </section><ReportOutput report={report} reportType="board_brief" artifactMetadata={metadata} editable /></div>
  </div>;
}
