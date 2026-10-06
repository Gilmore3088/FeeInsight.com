import { Suspense } from "react";
import { unstable_cache, unstable_noStore } from "next/cache";
import Link from "next/link";
import type { Metadata } from "next";
import { fetchHomeBriefingSignals, type HomeBriefingSignals } from "@/lib/hamilton/home-data";
import { getCurrentUser, type User } from "@/lib/auth";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { fetchInstitutionPositioning, type InstitutionPositioning } from "@/lib/hamilton/institution-position";
import { parseInstitutionId } from "@/lib/hamilton/institution-context";
import { RecentChanges } from "@/components/hamilton/benchmark/RecentChanges";
import { WorthYourAttention } from "@/components/hamilton/benchmark/WorthYourAttention";
import { briefingAuditTrail, buildBriefingObservations } from "@/lib/hamilton/briefing-observations";
import { Callout, LinkButton, MemoHeader, MemoPage } from "@/components/hamilton/memo/memo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Briefing" };

/** Per-institution positioning; the cache key carries the institution id (unstable_cache keys on arguments). */
const getCachedInstitutionPositioning = unstable_cache(
  fetchInstitutionPositioning,
  ["hamilton-home-briefing-institution"],
  { revalidate: 3600 },
);

async function loadInstitutionPositioning(
  selectedInstitutionId: string | null,
): Promise<{ positioning: InstitutionPositioning | null; unavailable: boolean }> {
  const institutionId = parseInstitutionId(selectedInstitutionId);
  if (!institutionId) return { positioning: null, unavailable: false };
  try {
    return { positioning: await getCachedInstitutionPositioning(institutionId), unavailable: false };
  } catch {
    return { positioning: null, unavailable: true };
  }
}

function ChangesSkeleton() {
  return <div className="skeleton rounded-lg" style={{ minHeight: "3rem" }} />;
}

/** Signals and alerts are fresh on every load (never cached). */
async function ChangesForInstitution({
  user,
  selectedInstitutionId,
}: {
  user: User | null;
  selectedInstitutionId: string | null;
}) {
  unstable_noStore();
  let signals: HomeBriefingSignals = { whatChanged: [], priorityAlerts: [], monitorFeed: [] };
  if (user) {
    try {
      signals = await fetchHomeBriefingSignals(user.id, {
        institutionIds: selectedInstitutionId ? [selectedInstitutionId] : [],
      });
    } catch {
      // DB unavailable: the list shows its empty state.
    }
  }
  return (
    <RecentChanges
      alerts={signals.priorityAlerts}
      signals={signals.whatChanged}
      selectedInstitutionId={selectedInstitutionId}
    />
  );
}

async function resolveSelectedInstitutionId(
  user: User | null,
  params: { instId?: string; intent?: string },
): Promise<string | null> {
  if (params.instId) return params.instId;
  if (!user) return null;
  try {
    const { institution } = await resolveHamiltonInstitutionContext({
      userId: user.id,
      instId: null,
      intent: params.intent,
    });
    return institution?.id.toString() ?? null;
  } catch {
    return null;
  }
}

/**
 * Briefing: one memo. The fees worth a look this month (overdraft first), what changed, and how
 * it was built. Deterministic: no model call on this page.
 */
export default async function HamiltonHomePage({
  searchParams,
}: {
  searchParams: Promise<{ instId?: string; intent?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser().catch(() => null);
  const selectedInstitutionId = await resolveSelectedInstitutionId(user, params);
  const { positioning, unavailable } = await loadInstitutionPositioning(selectedInstitutionId);
  const observations = buildBriefingObservations(positioning);
  const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <MemoPage>
      <MemoHeader
        kicker={`Briefing · ${month}`}
        title={positioning ? positioning.institutionName : "Your briefing"}
        dek={
          positioning
            ? `Your published fees against ${positioning.benchmarkLabel}. Observations, not instructions: open any one to research it or model a price.`
            : "Choose your bank and Hamilton reads its published fees against its market every month."
        }
      />

      {positioning && observations.length > 0 ? (
        <WorthYourAttention
          observations={observations}
          institutionId={selectedInstitutionId}
          trail={briefingAuditTrail(positioning)}
        />
      ) : unavailable ? (
        <p role="status" className="text-sm text-terra-text">
          Your briefing couldn&apos;t load just now. <Link href="/pro/hamilton" className="underline">Try again</Link>
        </p>
      ) : positioning ? (
        <Callout>
          We don&apos;t have enough of {positioning.institutionName}&apos;s published fees to compare yet. Research still shows
          the market for any fee.
        </Callout>
      ) : (
        <div>
          <LinkButton href={hrefWithInstitutionContext("/pro/settings", selectedInstitutionId)} primary>
            Choose your bank
          </LinkButton>
        </div>
      )}

      <Suspense fallback={<ChangesSkeleton />}>
        <ChangesForInstitution user={user} selectedInstitutionId={selectedInstitutionId} />
      </Suspense>
    </MemoPage>
  );
}
