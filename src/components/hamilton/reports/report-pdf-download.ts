/**
 * Asks the existing PDF route (POST /api/pro/report-pdf) for a PDF and saves it in the browser. The
 * route renders only from records and reads on the server; the body names what to print.
 */
export async function downloadReportPdf(body: Record<string, unknown>, filename: string): Promise<void> {
  const res = await fetch("/api/pro/report-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("PDF generation failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
