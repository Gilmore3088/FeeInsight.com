/**
 * /reports/sample-competitive-fee-position/csv — the sample report's numbers as a
 * spreadsheet, the same file a buyer downloads from their own report.
 */
import { buildReportCsv } from "@/lib/custom-report/analysis";
import { loadSampleReport } from "@/lib/custom-report/sample-report";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await loadSampleReport().catch(() => null);
  if (!report) return new Response("The sample report is being rebuilt.", { status: 404 });
  return new Response(buildReportCsv(report.data, report.analysis), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sample-fee-position-report.csv"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
