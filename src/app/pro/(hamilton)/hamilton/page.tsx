export const dynamic = "force-dynamic";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { InstitutionBriefing } from "@/components/hamilton/intelligence/InstitutionBriefing";
import { IntelligenceWorkspace, MarketContext } from "@/components/hamilton/intelligence/IntelligenceWorkspace";
import { CommandCenter } from "@/components/hamilton/intelligence/CommandCenter";
import { Callout } from "@/components/hamilton/memo/memo";
export const metadata: Metadata = { title: "Command center" };

/**
 * The landing page. With an institution on file it opens on the command center (#1891): five
 * questions about that institution, each linked to the page behind it, then this month's briefing
 * (#2042) and the market behind it. With no institution it is the national market overview under a
 * way to choose one; with a market chosen (`research`) it is that market, a research destination.
 */
export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ research?: string; lens?: string; instId?: string; size?: string }> }) {
  const params = await searchParams;
  const institution = params.research === undefined ? await overviewInstitution(params.instId) : null;
  if (!institution) {
    if (params.research !== undefined) return <IntelligenceWorkspace overview params={params} />;
    return <div className="flex w-full flex-col gap-6">
      <div className="mx-auto w-full max-w-5xl">
        <Callout>
          Choose your bank or credit union and this page becomes its command center: filed performance, peers, market and what changed.{" "}
          <Link href="/pro/settings" className="font-medium text-terra-text underline">Choose your institution</Link>
        </Callout>
      </div>
      <IntelligenceWorkspace overview params={params} />
    </div>;
  }
  // One column for the command center, the briefing and the market behind it, the briefing's own width.
  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
    <CommandCenter institution={institution} />
    <InstitutionBriefing searchParams={Promise.resolve({ instId: String(institution.id) })} headless />
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
