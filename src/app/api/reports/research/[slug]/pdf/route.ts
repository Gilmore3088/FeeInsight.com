import { getSql } from "@/lib/data-store/connection";
import { readResearchManifest, researchReadyToRead } from "@/lib/research-database/manifest";
import { renderResearchPdf } from "@/lib/research-database/pdf";
import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleGET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getSql();
  const [row] = await db`
    SELECT j.data_manifest FROM published_reports p JOIN report_jobs j ON j.id = p.job_id
     WHERE p.slug = ${slug} AND p.is_public = true AND j.status = 'complete' LIMIT 1`;
  const manifest = readResearchManifest(row?.data_manifest);
  if (!manifest || !researchReadyToRead(row?.data_manifest)) return new Response("Report not found", { status: 404 });
  const pdf = await renderResearchPdf(manifest.research_snapshot);
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="fee-insight-research.pdf"', "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
export const GET = withApiRoutePolicy("api.research.pdf", "GET", handleGET);
