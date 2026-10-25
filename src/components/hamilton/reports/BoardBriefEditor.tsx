"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Download, Save } from "lucide-react";
import { saveBoardBrief } from "@/app/pro/(hamilton)/reports/board-actions";
import { boardBriefFromAnalysis, editBoardBrief, NO_WRITTEN_SOURCES, type WrittenAnswerSources } from "@/lib/hamilton/board-brief";
import type { AnalyzeResponse, ReportSummaryResponse, ReportArtifactMetadata } from "@/lib/hamilton/types";
import { ReportOutput } from "./ReportOutput";

export function BoardBriefEditor({ analysis, analysisId, writtenSources, initialReport, reportId, metadata }: {
  analysis?: AnalyzeResponse; analysisId?: string;
  /** A written answer's source lines, built on the server from its saved claims, which never reach the browser. */
  writtenSources?: WrittenAnswerSources;
  initialReport?: ReportSummaryResponse; reportId?: string; metadata?: ReportArtifactMetadata;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialReport?.title ?? analysis?.title ?? "Board brief");
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
  const report = initialReport ? editBoardBrief(initialReport, edits) : analysis && analysisId ? boardBriefFromAnalysis(analysis, analysisId, edits, writtenSources ?? NO_WRITTEN_SOURCES) : null;
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
  if (!report) return <p role="alert">Choose a saved answer to build a board brief.</p>;
  return <div className="mx-auto flex max-w-6xl flex-col gap-6">
    <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:flex-wrap sm:justify-between sm:text-left"><div><p className="fi-text-label text-[var(--fi-muted)]">Reports</p><h1 className="mt-1 text-3xl font-semibold">Board brief</h1><p className="mt-2 text-sm text-[var(--fi-muted)]">Hamilton&apos;s findings and their sources, ready for your board. Add a title and a note, save, then download the PDF.</p></div><div className="flex flex-wrap items-start gap-3">
      <button className="fi-btn fi-btn-primary disabled:opacity-50" disabled={busy || !dirty} onClick={() => void save()}><Save size={17} aria-hidden />{busy ? "Saving…" : "Save brief"}</button>
      <button className="fi-btn fi-btn-secondary disabled:opacity-50" disabled={!savedId || dirty || downloadBusy} onClick={() => void download()}><Download size={17} aria-hidden />{downloadBusy ? "Preparing…" : "Download PDF"}</button>
    </div></header>
    {error ? <p role="alert" className="rounded-md border border-[var(--fi-brick)] p-3 text-sm text-[var(--fi-brick)]">{error}</p> : null}
    <p role="status" className="text-xs text-[var(--fi-muted)]">{dirty ? "Unsaved changes. Save before you download the PDF." : "Saved. The PDF uses this version."}</p>
    <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]"><section className="intelligence-panel flex flex-col gap-5" aria-label="Edit board brief">
      <h2 className="!text-base">Report details</h2><label className="text-sm">Title<input className="mt-2 w-full rounded-md border border-[var(--fi-control-border)] p-2" value={title} maxLength={200} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
      <label className="text-sm">Team note<textarea className="mt-2 w-full rounded-md border border-[var(--fi-control-border)] p-2" rows={6} value={teamNote} maxLength={5000} disabled={busy} onChange={e => setTeamNote(e.target.value)} /><span className="mt-1 block text-xs text-[var(--fi-muted)]">Shown as your note, kept apart from Hamilton’s findings.</span></label>
      {!initialReport ? <label className="text-sm"><input type="checkbox" checked={includeEvidence} disabled={busy} onChange={e => setIncludeEvidence(e.target.checked)} /> Include the evidence table from the answer</label> : null}
      <p className="text-xs leading-relaxed text-[var(--fi-muted)]">The figures and reporting dates are kept as first saved and are not recalculated.</p>
      {report.boardBrief?.sourceAnalysisId
        ? <Link href={`/pro/analyze?analysis=${encodeURIComponent(report.boardBrief.sourceAnalysisId)}`} className="flex items-center gap-2 text-sm text-[var(--fi-brick)] underline"><FileText size={16} aria-hidden />Open the saved answer</Link>
        : report.boardBrief?.sourceResearchHref ? <Link href={report.boardBrief.sourceResearchHref} className="flex items-center gap-2 text-sm text-[var(--fi-brick)] underline"><FileText size={16} aria-hidden />Open the research</Link> : null}
    </section><ReportOutput report={report} reportType="board_brief" artifactMetadata={metadata} editable /></div>
  </div>;
}
