"use client";

import { useState } from "react";

import { huntRowForFile, parseHuntCsv, type HuntRow } from "@/lib/agents/magellan/hand-supplied-files";

const ENDPOINT = "/api/admin/magellan/hand-supplied";

interface FileResult {
  fileName: string;
  outcome: string;
  message: string;
  runId: number | null;
}

interface LinkResult {
  line: number;
  institutionId: number | null;
  institution: string;
  outcome: string;
  message: string;
}

interface CsvResult {
  runId: number;
  counts: Record<string, number>;
  results: LinkResult[];
}

async function postForm(form: FormData): Promise<Record<string, unknown>> {
  const response = await fetch(ENDPOINT, { method: "POST", body: form });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
  return body;
}

export function HandSuppliedForm() {
  const [files, setFiles] = useState<File[]>([]);
  const [csv, setCsv] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fileResults, setFileResults] = useState<FileResult[]>([]);
  const [csvResult, setCsvResult] = useState<CsvResult | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFileResults([]);
    setCsvResult(null);
    try {
      let rows: HuntRow[] = [];
      let csvText = "";
      if (csv) {
        csvText = await csv.text();
        const parsed = parseHuntCsv(csvText);
        if (!parsed.ok) throw new Error(parsed.error);
        rows = parsed.rows;
      }
      const loaded: string[] = [];
      const results: FileResult[] = [];
      // One file per request, in order, so hundreds of files never meet the request size limit.
      for (const [index, file] of files.entries()) {
        setProgress(`File ${index + 1} of ${files.length}: ${file.name}`);
        const row = huntRowForFile(rows, file.name);
        const form = new FormData();
        form.set("kind", "file");
        form.set("file", file);
        form.set("source_url", row?.foundUrl ?? "");
        form.set("effective_date", row?.effectiveDate ?? "");
        form.set("notes", row?.notes ?? "");
        let result: FileResult;
        try {
          const body = await postForm(form);
          result = {
            fileName: file.name,
            outcome: String(body.outcome ?? "refused"),
            message: String(body.message ?? ""),
            runId: typeof body.runId === "number" ? body.runId : null,
          };
        } catch (failure) {
          result = { fileName: file.name, outcome: "refused", message: failure instanceof Error ? failure.message : String(failure), runId: null };
        }
        if (result.outcome === "loaded" || result.outcome === "already_loaded") loaded.push(file.name);
        results.push(result);
        setFileResults([...results]);
      }
      if (csv) {
        setProgress("Adding the CSV's found links");
        const form = new FormData();
        form.set("kind", "csv");
        form.set("csv", csvText);
        form.set("uploaded", JSON.stringify(loaded));
        setCsvResult((await postForm(form)) as unknown as CsvResult);
      }
      setProgress("Done");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  const counts = fileResults.reduce<Record<string, number>>((total, result) => {
    total[result.outcome] = (total[result.outcome] ?? 0) + 1;
    return total;
  }, {});

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3 rounded-md border border-black/10 p-4 dark:border-white/10">
        <label className="block text-sm">
          <span className="font-medium">Fee schedule PDFs</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            className="mt-1 block w-full text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Browser hunt CSV (optional)</span>
          <input
            type="file"
            accept="text/csv,.csv"
            onChange={(event) => setCsv(event.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy || (files.length === 0 && !csv)}
          className="rounded-md bg-[#1d1d1b] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-[#1d1d1b]"
        >
          {busy ? "Loading" : `Load ${files.length} ${files.length === 1 ? "file" : "files"}${csv ? " and the CSV" : ""}`}
        </button>
        {progress && <p className="text-xs text-ink-muted">{progress}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </form>

      {fileResults.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Files</h2>
          <p className="text-sm text-ink-muted">
            {Object.entries(counts)
              .map(([outcome, count]) => `${count} ${outcome.replace(/_/g, " ")}`)
              .join(", ")}
          </p>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-ink-muted">
                <th className="py-1 pr-3 font-medium">File</th>
                <th className="py-1 pr-3 font-medium">Result</th>
                <th className="py-1 pr-3 font-medium">Run</th>
                <th className="py-1 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {fileResults.map((result) => (
                <tr key={result.fileName} className="border-t border-black/5 align-top dark:border-white/10">
                  <td className="py-1 pr-3 break-all">{result.fileName}</td>
                  <td className="py-1 pr-3">{result.outcome.replace(/_/g, " ")}</td>
                  <td className="py-1 pr-3">{result.runId ?? "none"}</td>
                  <td className="py-1">{result.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {csvResult && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">CSV rows</h2>
          <p className="text-sm text-ink-muted">
            {csvResult.counts.added ?? 0} added, {csvResult.counts.already_on_file ?? 0} already on file,{" "}
            {csvResult.counts.other_institution_site ?? 0} on another institution&rsquo;s site, {csvResult.counts.invalid ?? 0} invalid,{" "}
            {csvResult.counts.file ?? 0} loaded from files, {csvResult.counts.skipped ?? 0} skipped. Run {csvResult.runId}.
          </p>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-ink-muted">
                <th className="py-1 pr-3 font-medium">Line</th>
                <th className="py-1 pr-3 font-medium">Institution</th>
                <th className="py-1 pr-3 font-medium">Result</th>
                <th className="py-1 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {csvResult.results
                .filter((row) => row.outcome !== "skipped")
                .map((row) => (
                  <tr key={row.line} className="border-t border-black/5 align-top dark:border-white/10">
                    <td className="py-1 pr-3">{row.line}</td>
                    <td className="py-1 pr-3">
                      {row.institution || "unnamed"} ({row.institutionId ?? "no id"})
                    </td>
                    <td className="py-1 pr-3">{row.outcome.replace(/_/g, " ")}</td>
                    <td className="py-1">{row.message}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
