export const dynamic = "force-dynamic";
import { InstitutionBriefing } from "@/components/hamilton/intelligence/InstitutionBriefing";
import type { Metadata } from "next";
import { IntelligenceWorkspace } from "@/components/hamilton/intelligence/IntelligenceWorkspace";
export const metadata: Metadata = { title: "Research" };
export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ research?: string; lens?: string; instId?: string; view?: string }> }) {
  const params = await searchParams;
  if (params.view === "institution") return <InstitutionBriefing searchParams={Promise.resolve(params)} />;
  return <IntelligenceWorkspace params={params} />;
}
