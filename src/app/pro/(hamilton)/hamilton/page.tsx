export const dynamic = "force-dynamic";
import { Suspense } from "react";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { InstitutionBriefing } from "@/components/hamilton/intelligence/InstitutionBriefing";
import { IntelligenceWorkspace, MarketContext } from "@/components/hamilton/intelligence/IntelligenceWorkspace";
export const metadata: Metadata = { title: "Overview" };

/**
 * Overview opens on the research institution's briefing (#2042): what stands out about its fees,
 * what changed and what to check, each with a next step. The market behind it follows as the
 * supporting layer. With no institution, or with a market chosen, it is the market overview.
 */
export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ research?: string; lens?: string; instId?: string; size?: string }> }) {
  const params = await searchParams;
  const institution = params.research === undefined ? await overviewInstitution(params.instId) : null;
  if (!institution) return <IntelligenceWorkspace overview params={params} />;
  // One column for the briefing and the market behind it, the briefing's own width.
  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
    <InstitutionBriefing searchParams={Promise.resolve({ instId: String(institution.id) })} />
    <Suspense fallback={<div className="skeleton rounded-lg" style={{ minHeight: "12rem" }} />}>
      <MarketContext stateCode={institution.stateCode} />
    </Suspense>
  </div>;
}

/** The institution in the URL, else the reader's saved research institution; null for none or on error. */
async function overviewInstitution(instId: string | undefined) {
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    const { institution } = await resolveHamiltonInstitutionContext({ userId: user.id, instId: instId ?? null, persistUrlSelection: false });
    return institution;
  } catch {
    return null;
  }
}
