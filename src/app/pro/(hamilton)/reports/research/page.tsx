import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { redirect, notFound } from "next/navigation";
import { getSql } from "@/lib/data-store/connection";
import { canReadReportJob } from "@/lib/report-access";
import { readResearchManifest, researchReadyToRead } from "@/lib/research-database/manifest";
import { ResearchReport } from "@/components/research/research-report";
import type { ReportJob } from "@/lib/report-engine/types";
import { customizeResearchReport } from "./actions";
import { TrackView } from "@/components/track-view";
import { InstitutionPicker } from "@/components/hamilton/InstitutionPicker";
import { getInstitutionById } from "@/lib/data-store/core";

export const dynamic = "force-dynamic";
export const metadata = { title: "Market research" };

export default async function PaidResearchPage({ searchParams }: { searchParams: Promise<{ instId?: string; researchReport?: string; job?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const db = getSql();
  const [job] = params.job ? await db<ReportJob[]>`SELECT * FROM report_jobs WHERE id::text = ${params.job}` : [];
  if (params.job && (!job || !canReadReportJob(user, job))) notFound();
  const manifest = job ? readResearchManifest(job.data_manifest) : null;
  const selectedId = Number(params.instId ?? manifest?.research_snapshot.request.institutionId);
  const selected = Number.isSafeInteger(selectedId) && selectedId > 0 ? await getInstitutionById(selectedId) : null;
  return <div className="mx-auto max-w-6xl space-y-6 p-6"><h1 className="text-3xl font-semibold">Research your institution’s market</h1>
    <p>Compare economic conditions, financial peers and verified fees across your institution’s branch counties.</p>
    {canAccessPremium(user) && <form action={customizeResearchReport} className="flex flex-wrap items-end gap-4">
      <input type="hidden" name="researchReport" value={params.researchReport ?? ""} />
      <InstitutionPicker inputId="research-institution" name="institutionId" label="Find your institution" help="Start typing a name, then choose a match." initialId={selected?.id ?? null} initialName={selected?.institution_name ?? null} required />
      <button className="rounded bg-blue-700 px-4 py-2 text-white">Prepare my market report</button>
    </form>}
    {job && <section aria-label="Preparation status"><p>Status: {job.status}.</p>{job.error && <p role="alert">{job.error}</p>}{!manifest && <p>Reload this page after the queued research run completes.</p>}</section>}
    {manifest && researchReadyToRead(job?.data_manifest) && <>
      <TrackView event="research_analysis_complete" eventProps={{ job: job!.id }} onceKey={`research-analysis:${job!.id}`} />
      <div className="flex flex-wrap gap-4"><a className="underline" href={`/api/pro/research/${job!.id}/pdf`}>Download PDF</a><a className="underline" href={`/api/pro/research/${job!.id}/export`}>Export research data</a><Link className="underline" href={`/pro/simulate?instId=${manifest.research_snapshot.request.institutionId}`}>Explore a fee scenario</Link></div>
      <ResearchReport snapshot={manifest.research_snapshot} />
    </>}
  </div>;
}
