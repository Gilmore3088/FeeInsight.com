"use client";
import { useState } from "react";
import { Download } from "lucide-react";

type PageSize = "LETTER" | "A4";

/**
 * Downloads the packet as a PDF, Letter or A4. The browser sends only the selection (institution,
 * the fee for price and yield, the page size); the server reloads every figure from the same readers.
 */
export function CommitteePacketDownload({ institutionId, yieldFee }: { institutionId: number; yieldFee: string | null }) {
  const [busy, setBusy] = useState<PageSize | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function download(pageSize: PageSize) {
    if (busy) return;
    setBusy(pageSize);
    setError(null);
    try {
      const response = await fetch("/api/pro/report-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "committee_packet", institutionId, yieldFee, pageSize }),
      });
      if (!response.ok) throw new Error("The PDF could not be prepared. Retry the download.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `pricing-committee-packet${pageSize === "A4" ? "-a4" : ""}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The PDF could not be prepared. Retry the download.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-col items-center gap-1 sm:items-end">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => void download("LETTER")}
          disabled={busy !== null}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:opacity-60"
        >
          <Download size={16} aria-hidden />
          {busy === "LETTER" ? "Preparing PDF…" : "Download PDF"}
        </button>
        <button
          type="button"
          onClick={() => void download("A4")}
          disabled={busy !== null}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-warm-300 bg-white px-3 py-2 text-sm font-medium text-warm-800 hover:border-warm-500 disabled:opacity-60"
          aria-label="Download PDF on A4 paper"
        >
          {busy === "A4" ? "Preparing A4…" : "A4"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-terra-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
