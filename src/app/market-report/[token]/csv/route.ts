/**
 * /market-report/[token]/csv — the report's numbers as a spreadsheet: one row per fee line
 * for the institution (with the local median, middle half and rank), then every competitor
 * figure behind them with the line of its schedule that states it. Same signed link, the
 * same readiness bar and the same saved copy for a paid report as the page.
 */
import { buildReportCsv } from "@/lib/custom-report/analysis";
import { verifyReportToken } from "@/lib/custom-report/link";
import { isReportRevoked } from "@/lib/data-store/report-payments";
import { loadMarketReport } from "@/lib/custom-report/report-data";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verified = verifyReportToken(token);
  if (!verified) return new Response("Not found", { status: 404 });
  if (await isReportRevoked(verified.institutionId)) return new Response("Not found", { status: 404 });
  const report = await loadMarketReport(verified.institutionId);
  if (!report) return new Response("Not found", { status: 404 });
  const { data, analysis } = report;
  if (!analysis.readiness.ready) {
    return new Response("This market is being refreshed, so there is no comparison to download right now.", { status: 409 });
  }
  const slug = data.subject.institution_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new Response(buildReportCsv(data, analysis), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fee-position-${slug || "report"}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
