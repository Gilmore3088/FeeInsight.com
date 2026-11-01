"use client";
import { useRef, useState } from "react";
import { Download, Pencil, RotateCcw, Save } from "lucide-react";
import { saveMonthlyBriefing } from "@/app/pro/(hamilton)/reports/monthly/actions";
import {
  MAX_BRIEFING_TITLE,
  MAX_SECTION_TEXT,
  isSectionEdited,
  type BriefingRow,
  type MonthlyBriefing,
  type MonthlyBriefingSectionId,
} from "@/lib/hamilton/monthly-briefing";

const btn = "inline-flex min-h-11 items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium disabled:opacity-50 sm:min-h-9";
const primary = `${btn} bg-terra text-white hover:bg-terra-dark`;
const secondary = `${btn} border border-warm-300 bg-warm-50 text-warm-800 hover:border-warm-500`;

function Rows({ rows, heading }: { rows: BriefingRow[]; heading: string }) {
  if (rows.length === 0) return null;
  return (
    <ul aria-label={`${heading}: figures and sources`} className="flex flex-col divide-y divide-warm-200 rounded-md border border-warm-300 bg-warm-50 text-sm">
      {rows.map((row, i) => (
        <li key={`${row.label}-${i}`} className="flex flex-col gap-0.5 px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <span className="min-w-0 text-warm-900">{row.label}</span>
            {row.value ? <span className="font-semibold text-warm-900 [font-variant-numeric:tabular-nums]">{row.value}</span> : null}
          </div>
          <span className="text-xs text-warm-600">
            {row.url ? (
              <a href={row.url} className="text-terra-text underline" rel="noopener noreferrer" target="_blank">{row.source}</a>
            ) : row.source}
            {" · "}
            {row.period}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The saved monthly briefing (#1897): six fixed sections, each with its words, its figures with
 * source and period, and what Hamilton could not show. The subscriber edits the words, saves,
 * then downloads the PDF; the figures stay as built.
 */
export function MonthlyBriefingEditor({ reportId, title: savedTitle, briefing }: { reportId: string; title: string; briefing: MonthlyBriefing }) {
  const [title, setTitle] = useState(savedTitle);
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(briefing.sections.map((s) => [s.id, s.text])));
  const [editing, setEditing] = useState<MonthlyBriefingSectionId | null>(null);
  const [saved, setSaved] = useState(() => JSON.stringify([savedTitle, briefing.sections.map((s) => s.text)]));
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const fingerprint = JSON.stringify([title, briefing.sections.map((s) => texts[s.id] ?? "")]);
  const dirty = fingerprint !== saved;

  async function save() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try {
      const result = await saveMonthlyBriefing({ reportId, edits: { title, sections: texts } });
      if (!result.success) { setError(result.error); return; }
      // An emptied section goes back to Hamilton's words, as the server saved it.
      const next = Object.fromEntries(briefing.sections.map((s) => [s.id, (texts[s.id] ?? "").trim() ? texts[s.id] : s.draft]));
      setTexts(next); setEditing(null);
      setSaved(JSON.stringify([title, briefing.sections.map((s) => next[s.id])]));
    } catch {
      setError("The briefing could not be saved. Your edits are still here; try again.");
    } finally { saving.current = false; setBusy(false); }
  }

  async function download() {
    if (dirty || downloading) return;
    setDownloading(true); setError(null);
    try {
      const response = await fetch("/api/pro/report-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "report", reportId }) });
      if (!response.ok) throw new Error("The PDF could not be prepared. Try the download again.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `monthly-briefing-${briefing.month}.pdf`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : "The PDF could not be downloaded."); }
    finally { setDownloading(false); }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 text-warm-800">
      <header className="flex flex-col items-center gap-4 border-b border-warm-300 pb-5 text-center sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:text-left">
        <div className="min-w-0 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-terra-text">Monthly briefing · {briefing.monthLabel}</p>
          <h1 className="mt-1.5 text-3xl leading-tight text-warm-900 sm:text-4xl">{title.trim() || briefing.institutionName}</h1>
          <p className="mt-2 text-pretty text-base leading-relaxed text-warm-700">
            Built {new Date(briefing.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}. Each figure shows its source and period. Edit the words in any section, save, then download the PDF.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
          <button type="button" className={primary} disabled={busy || !dirty} onClick={() => void save()}><Save size={16} aria-hidden />{busy ? "Saving…" : "Save briefing"}</button>
          <button type="button" className={secondary} disabled={dirty || downloading} onClick={() => void download()}><Download size={16} aria-hidden />{downloading ? "Preparing…" : "Download PDF"}</button>
        </div>
      </header>

      {error ? <p role="alert" className="rounded-md border border-[var(--fi-brick)] p-3 text-sm text-[var(--fi-brick)]">{error}</p> : null}
      <p role="status" className="-mt-4 text-xs text-warm-600">{dirty ? "Unsaved changes. Save before you download the PDF." : "Saved. The PDF uses this version."}</p>

      <label className="flex flex-col gap-1 text-sm text-warm-700">
        Title
        <input className="w-full rounded-md border border-warm-300 bg-white p-2 text-warm-900" value={title} maxLength={MAX_BRIEFING_TITLE} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
      </label>

      {briefing.peerGroupLabel ? (
        <p className="-mt-4 text-sm text-warm-700">Peer group for fee comparisons: {briefing.peerGroupLabel}.</p>
      ) : null}

      {briefing.sections.map((section) => {
        const text = texts[section.id] ?? "";
        const edited = isSectionEdited({ draft: section.draft, text });
        const open = editing === section.id;
        return (
          <section key={section.id} id={`section-${section.id}`} aria-labelledby={`heading-${section.id}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`heading-${section.id}`} className="text-xl font-bold text-warm-900 sm:text-2xl">{section.heading}</h2>
              <div className="flex flex-wrap gap-2">
                {edited ? (
                  <button type="button" className={secondary} disabled={busy} onClick={() => setTexts({ ...texts, [section.id]: section.draft })}>
                    <RotateCcw size={15} aria-hidden />Use Hamilton&apos;s words
                  </button>
                ) : null}
                <button type="button" className={secondary} disabled={busy} aria-expanded={open} aria-controls={`text-${section.id}`} onClick={() => setEditing(open ? null : section.id)}>
                  <Pencil size={15} aria-hidden />{open ? "Done" : "Edit words"}
                </button>
              </div>
            </div>
            {open ? (
              <label className="flex flex-col gap-1 text-sm text-warm-700">
                <span className="sr-only">{section.heading} words</span>
                <textarea id={`text-${section.id}`} className="w-full rounded-md border border-warm-300 bg-white p-2 text-base leading-relaxed text-warm-900" rows={6} maxLength={MAX_SECTION_TEXT} value={text} disabled={busy} onChange={(e) => setTexts({ ...texts, [section.id]: e.target.value })} />
                <span className="text-xs text-warm-600">The figures below stay as Hamilton built them. Left empty, the section goes back to Hamilton&apos;s words when you save.</span>
              </label>
            ) : text.trim() ? (
              <p id={`text-${section.id}`} className="whitespace-pre-line text-pretty text-base leading-relaxed text-warm-900">{text}</p>
            ) : null}
            {edited ? <p className="text-xs text-warm-600">Words edited by your team. The figures and sources are Hamilton&apos;s.</p> : null}
            <Rows rows={section.rows} heading={section.heading} />
            {section.gaps.length ? (
              <ul className="flex flex-col gap-1 text-sm text-warm-700">
                {section.gaps.map((gap) => <li key={gap}>{gap}</li>)}
              </ul>
            ) : null}
          </section>
        );
      })}

      <p className="border-t border-warm-300 pt-4 text-xs leading-relaxed text-warm-600">
        Built when you asked for it. Figures are as of the period shown beside each and are not refreshed after the briefing is built; build a new one for current figures.
      </p>
    </div>
  );
}
