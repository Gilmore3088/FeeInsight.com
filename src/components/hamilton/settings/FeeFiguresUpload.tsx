"use client";

/**
 * The bank's own figures, uploaded: a CSV or XLSX of fee income, item counts, waivers and
 * affected accounts. Hamilton shows what it read first; nothing is used until the reader
 * saves it (POST /api/hamilton/uploads, then /uploads/apply).
 */
import { useState, type FormEvent } from "react";
import type { UploadPreview } from "@/lib/hamilton/uploads/map";

type Stage =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "preview"; uploadId: string; preview: UploadPreview }
  | { kind: "saving"; uploadId: string; preview: UploadPreview }
  | { kind: "saved"; saved: number; fees: string[] };

const fmtCount = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const fmtDollars = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const fmtRate = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

export function FeeFiguresUpload({ institutionId }: { institutionId: string | null }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  async function read(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setStage({ kind: "reading" });
    const form = new FormData();
    form.set("file", file);
    if (institutionId) form.set("institutionId", institutionId);
    try {
      const res = await fetch("/api/hamilton/uploads", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { uploadId?: string; preview?: UploadPreview; error?: string };
      if (!res.ok || !json.uploadId || !json.preview) throw new Error(json.error ?? "The file could not be read.");
      setStage({ kind: "preview", uploadId: json.uploadId, preview: json.preview });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The file could not be read.");
      setStage({ kind: "idle" });
    }
  }

  async function apply() {
    if (stage.kind !== "preview") return;
    setError(null);
    setStage({ ...stage, kind: "saving" });
    try {
      const res = await fetch("/api/hamilton/uploads/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: stage.uploadId }),
      });
      const json = (await res.json().catch(() => ({}))) as { saved?: number; fees?: string[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "The figures could not be saved.");
      setStage({ kind: "saved", saved: json.saved ?? 0, fees: json.fees ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The figures could not be saved.");
      setStage({ ...stage, kind: "preview" });
    }
  }

  const preview = stage.kind === "preview" || stage.kind === "saving" ? stage.preview : null;
  const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.08em] text-warm-600";
  const td = "px-3 py-2 text-right text-warm-900 [font-variant-numeric:tabular-nums]";

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-warm-300 bg-warm-50 p-5">
      <p className="text-sm leading-relaxed text-warm-800">
        Upload a spreadsheet of your fee income by line, with item counts, waivers or refunds, and affected accounts if you have
        them. Hamilton shows what it read before using any of it, and your figures are never shown to anyone outside your
        workspace.
      </p>
      <form onSubmit={read} className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setStage({ kind: "idle" });
          }}
          className="text-sm text-warm-800 file:mr-3 file:rounded-md file:border file:border-warm-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-warm-900 hover:file:border-terra"
        />
        <button
          type="submit"
          disabled={!file || stage.kind === "reading"}
          className="rounded-md border border-warm-300 bg-white px-3.5 py-2 text-sm font-medium text-warm-900 hover:border-terra hover:text-terra-text disabled:opacity-50"
        >
          {stage.kind === "reading" ? "Reading..." : "Read the file"}
        </button>
        <span className="text-xs text-warm-600">CSV or XLSX, up to 2 MB.</span>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-terra-text">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="flex flex-col gap-3">
          {preview.problem ? (
            <p className="text-sm text-terra-text">{preview.problem}</p>
          ) : (
            <p className="text-sm text-warm-800">
              Read {preview.rowsRead.toLocaleString("en-US")} rows
              {preview.periods ? ` covering ${preview.periods} ${preview.periods === 1 ? "month" : "months"}, scaled to a year` : ""}. Here is
              what Hamilton found:
            </p>
          )}
          {preview.fees.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-warm-200 bg-white">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-warm-200">
                    <th className={th} scope="col">Fee</th>
                    <th className={`${th} text-right`} scope="col">Items a year</th>
                    <th className={`${th} text-right`} scope="col">Fee income a year</th>
                    <th className={`${th} text-right`} scope="col">Waived or refunded</th>
                    <th className={`${th} text-right`} scope="col">Accounts</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.fees.map((f) => (
                    <tr key={f.feeCategory} className="border-b border-warm-100 last:border-0">
                      <th scope="row" className="px-3 py-2 text-left font-normal text-warm-900">
                        {f.feeName}
                        <span className="block text-xs text-warm-600">From: {f.labels.join(", ")}</span>
                        {f.notes.map((n) => (
                          <span key={n} className="block text-xs text-warm-600">
                            {n}
                          </span>
                        ))}
                      </th>
                      <td className={td}>{fmtCount(f.annualItems)}</td>
                      <td className={td}>{fmtDollars(f.annualIncome)}</td>
                      <td className={td}>{fmtRate(f.waiverRate)}</td>
                      <td className={td}>{fmtCount(f.affectedAccounts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {preview.unmatched.length > 0 ? (
            <p className="text-xs text-warm-600">
              Not matched to a fee, so left out:{" "}
              {preview.unmatched.map((u) => `${u.label} (${u.rows} ${u.rows === 1 ? "row" : "rows"})`).join(", ")}.
            </p>
          ) : null}
          {preview.fees.length > 0 ? (
            <div>
              <button
                type="button"
                onClick={apply}
                disabled={stage.kind === "saving"}
                className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:opacity-50"
              >
                {stage.kind === "saving" ? "Saving..." : "Use these figures"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {stage.kind === "saved" ? (
        <p role="status" className="text-sm text-warm-900">
          Saved {stage.saved} {stage.saved === 1 ? "figure" : "figures"}
          {stage.fees.length ? ` for ${stage.fees.join(", ")}` : ""}. Try a price and Ask now use them, labelled as your own figures.
        </p>
      ) : null}
    </div>
  );
}
