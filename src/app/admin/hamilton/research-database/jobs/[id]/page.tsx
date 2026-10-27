import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getSql } from "@/lib/data-store/connection";
import { readResearchManifest } from "@/lib/research-database/manifest";
import { researchTitle } from "@/lib/research-database/assemble";
import { ResearchReport } from "@/components/research/research-report";
import { ReportActions } from "../../../reports/report-actions";
import type { ReportJob } from "@/lib/report-engine/types";

export const dynamic = "force-dynamic";

export default async function ResearchJobPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth("operate");
  const { id } = await params;
  const db = getSql();
  const [job] = await db<ReportJob[]>`SELECT * FROM report_jobs WHERE id = ${id}`;
  if (!job) notFound();
  const manifest = readResearchManifest(job.data_manifest);
  const [published] = await db`SELECT id FROM published_reports WHERE job_id = ${id}`;
  const title = manifest ? researchTitle(manifest.research_snapshot) : "Research preparation";
  return <div className="space-y-6 p-6"><Link href="/admin/hamilton/research-database" className="underline">Research database</Link>
    <h1 className="text-3xl font-semibold">{title}</h1><p>Status: {job.status}. Run: {job.agent_run_id ?? "Not started"}.</p>
    {job.error && <p role="alert">{job.error}</p>}
    <p>Review the figures, source periods and limitations before publishing. Publication records your reviewer identity and the approved snapshot hash.</p>
    <ReportActions job={{ ...job, data_manifest: null }} title={title} isPublished={!!published} />
    {manifest && <ResearchReport snapshot={manifest.research_snapshot} />}
  </div>;
}
