import { getCurrentUser } from "@/lib/auth";
import { getSql } from "@/lib/data-store/connection";
import { canReadReportJob } from "@/lib/report-access";
import type { ReportJob } from "@/lib/report-engine/types";
import { readResearchManifest, researchReadyToRead } from "@/lib/research-database/manifest";
import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";

export const dynamic = "force-dynamic";

async function handleGET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const db = getSql();
  const [job] = await db<ReportJob[]>`SELECT * FROM report_jobs WHERE id::text = ${id}`;
  if (!job || !canReadReportJob(user, job)) return new Response("Not found", { status: 404 });
  const manifest = readResearchManifest(job.data_manifest);
  if (job.status !== "complete" || !manifest || !researchReadyToRead(job.data_manifest)) return new Response("Report not ready", { status: 409 });
  const snapshot = { ...manifest.research_snapshot, audit: undefined };
  return Response.json(snapshot, { headers: { "Content-Disposition": 'attachment; filename="fee-insight-market-research.json"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export const GET = withApiRoutePolicy("api.research.export", "GET", handleGET);
