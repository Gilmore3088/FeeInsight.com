/**
 * /market-report/[token]/csv — the report's numbers as a spreadsheet: one row per fee line
 * for the institution (with the local median, middle half and rank), then every competitor
 * figure behind them with the line of its schedule that states it. Same signed link and the
 * same readiness bar as the page; nothing is shown for a market that does not pass it.
 */
import { analyzeMarket, buildReportCsv } from "@/lib/custom-report/analysis";
import { verifyReportToken } from "@/lib/custom-report/link";
import { getCustomReportMarketDataCached } from "@/lib/data-store/public-cached-reads";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verified = verifyReportToken(token);
  if (!verified) return new Response("Not found", { status: 404 });
  const data = await getCustomReportMarketDataCached(verified.institutionId);
  if (!data || !data.market) return new Response("Not found", { status: 404 });
  const analysis = analyzeMarket(data);
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
