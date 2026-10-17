"use client";
import { useState } from "react";
import { Download } from "lucide-react";

/**
 * Downloads the packet as a PDF. The browser sends only the selection (institution, the fee for
 * price and yield, a proposed fee); the server reloads every figure from the same readers.
 */
export function CommitteePacketDownload({
  institutionId,
  yieldFee,
  positionFee,
  positionPrice,
}: {
  institutionId: number;
  yieldFee: string | null;
  positionFee: string | null;
  positionPrice: number | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/pro/report-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "committee_packet", institutionId, yieldFee, positionFee, positionPrice }),
      });
      if (!response.ok) throw new Error("The PDF could not be prepared. Retry the download.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "pricing-committee-packet.pdf";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-center gap-1 sm:items-end">
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:opacity-60 sm:min-h-9"
      >
        <Download size={16} aria-hidden />
        {busy ? "Preparing PDF…" : "Download PDF"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-terra-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
