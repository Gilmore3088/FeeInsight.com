"use client";

import { useState } from "react";
import { UTILITY_LINK } from "@/components/utility/form-style";

/**
 * Downloads one of the account's own saved Hamilton reports as a PDF. The route renders only the
 * signed-in owner's saved record, so a lapsed account can still download what it already has.
 */
export function SavedReportDownload({ reportId, title }: { reportId: string; title: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/pro/report-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "report", reportId }),
      });
      if (!res.ok) throw new Error(`report-pdf returned ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `hamilton-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(`[account/reports] PDF download failed for report ${reportId}:`, error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={download} disabled={busy} className={`text-[14px] ${UTILITY_LINK}`}>
        {busy ? "Preparing PDF…" : "Download PDF"}
      </button>
      {failed ? (
        <span role="alert" className="text-[12px] text-ink-muted">
          The PDF couldn&apos;t be made. Try again.
        </span>
      ) : null}
    </span>
  );
}
