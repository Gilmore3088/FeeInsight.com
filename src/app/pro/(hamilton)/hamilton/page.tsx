import { Suspense } from "react";
import { unstable_cache, unstable_noStore } from "next/cache";
import Link from "next/link";
import type { Metadata } from "next";
import {
  fetchCacheableHomeBriefing,
  fetchHomeBriefingData,
  fetchHomeBriefingSignals,
  HomeBriefingUnavailableError,
  type HomeBriefingData,
  type HomeBriefingSignals,
} from "@/lib/hamilton/home-data";
import { getCurrentUser, type User } from "@/lib/auth";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import {
  fetchInstitutionPositioning,
  type InstitutionPositioning,
} from "@/lib/hamilton/institution-position";
import { parseInstitutionId } from "@/lib/hamilton/institution-context";
import { getHamiltonWritingStatus, type HamiltonWritingStatus } from "@/lib/hamilton/writing-status";
import { PositionOverview } from "@/components/hamilton/benchmark/PositionOverview";
import { NationalSnapshot } from "@/components/hamilton/benchmark/NationalSnapshot";
import { RecentChanges } from "@/components/hamilton/benchmark/RecentChanges";
import { HamiltonBriefing } from "@/components/hamilton/benchmark/HamiltonBriefing";
import {
  fetchDistrictContext,
  fetchRegulatoryContext,
  fetchStateContext,
} from "@/lib/hamilton/expert-context";

export const dynamic = "force-dynamic";

const EMPTY_BRIEFING: HomeBriefingData = {
  thesis: null,
  confidence: "low",
  positioning: [],
  spotlightCount: 0,
  totalInstitutions: 0,
};

const getCachedHomeBriefing = unstable_cache(
  fetchCacheableHomeBriefing,
  ["hamilton-home-briefing"],
  { revalidate: 86400 },
);

/** The fee data without the AI thesis; throws on an empty index so an outage is never cached. */
const getCachedNationalBriefing = unstable_cache(
  async () => {
    const data = await fetchHomeBriefingData({ includeThesis: false });
    if (data.positioning.length === 0) throw new HomeBriefingUnavailableError("fee index unavailable");
    return data;
  },
  ["hamilton-home-national"],
  { revalidate: 3600 },
);

/** A cheap policy read, so a switched-off Hamilton isn't re-attempted (and logged) on every view. */
const getCachedWritingStatus = unstable_cache(
  getHamiltonWritingStatus,
  ["hamilton-writing-status"],
  { revalidate: 300 },
);

async function loadBriefing(writing: HamiltonWritingStatus): Promise<HomeBriefingData> {
  if (writing.available) {
    try {
      return await getCachedHomeBriefing();
    } catch {
      // Thesis or index failed; fall through to the fee data alone.
    }
  }
  return getCachedNationalBriefing().catch(() => EMPTY_BRIEFING);
}

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

/** State, district and regulatory context: slow-moving, so cached for hours (one cheap query each). */
const getCachedStateContext = unstable_cache(fetchStateContext, ["hamilton-expert-state"], { revalidate: 21600 });
const getCachedDistrictContext = unstable_cache(fetchDistrictContext, ["hamilton-expert-district"], { revalidate: 21600 });
const getCachedRegulatoryContext = unstable_cache(fetchRegulatoryContext, ["hamilton-expert-regulation"], { revalidate: 3600 });

export const metadata: Metadata = { title: "Benchmark" };

interface HamiltonHomePageProps {
  searchParams: Promise<{
    instId?: string;
    intent?: string;
  }>;
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

export default async function HamiltonHomePage({ searchParams }: HamiltonHomePageProps) {
  const params = await searchParams;
  const user = await getCurrentUser().catch(() => null);
  const isAdmin = user?.role === "admin" || user?.role === "analyst";
  const writing = await getCachedWritingStatus().catch(
    (): HamiltonWritingStatus => ({ available: true, blockingPolicies: [] }),
  );
  const [data, selectedInstitutionId] = await Promise.all([
    loadBriefing(writing),
    resolveSelectedInstitutionId(user, params),
  ]);
  const { positioning, unavailable: positioningUnavailable } =
    await loadInstitutionPositioning(selectedInstitutionId);

  const [state, district, regulation] = await Promise.all([
    positioning?.stateCode ? getCachedStateContext(positioning.stateCode).catch(() => null) : null,
    positioning?.fedDistrict ? getCachedDistrictContext(positioning.fedDistrict).catch(() => null) : null,
    getCachedRegulatoryContext(3).catch(() => []),
  ]);

  const topCategory = positioning?.topGap?.feeCategory ?? null;
  const simulateHref = hrefWithInstitutionContext(
    topCategory ? `/pro/simulate?category=${encodeURIComponent(topCategory)}` : "/pro/simulate",
    selectedInstitutionId,
  );
  const reportsHref = hrefWithInstitutionContext("/pro/reports?intent=executive-briefing", selectedInstitutionId);
  const analyzeHref = hrefWithInstitutionContext("/pro/analyze", selectedInstitutionId);
  const settingsHref = hrefWithInstitutionContext("/pro/settings", selectedInstitutionId);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--hamilton-on-surface)" }}>
            Benchmark
          </h1>
          <p className="mt-0.5 text-balance text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
            {positioning
              ? `${positioning.institutionName} compared with ${positioning.benchmarkLabel}`
              : "How fees compare with peers and the nation"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={reportsHref}
            className="rounded-lg border px-3.5 py-2 text-sm font-medium no-underline"
            style={{
              borderColor: "var(--hamilton-outline-variant)",
              backgroundColor: "var(--hamilton-surface-container-lowest)",
              color: "var(--hamilton-on-surface)",
            }}
          >
            Build a report
          </Link>
          <Link
            href={simulateHref}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-white no-underline"
            style={{ background: "var(--hamilton-gradient-cta)" }}
          >
            {positioning?.topGap ? `Simulate ${positioning.topGap.displayName}` : "Simulate a change"}
          </Link>
        </div>
      </header>

      {!positioning && !positioningUnavailable && (
        <section
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5"
          style={{ borderColor: "var(--hamilton-outline-variant)", backgroundColor: "var(--hamilton-surface-container-lowest)" }}
        >
          <div>
            <h2 className="text-balance text-base font-semibold" style={{ color: "var(--hamilton-on-surface)" }}>
              See where your fees sit against your peers
            </h2>
            <p className="mt-0.5 text-pretty text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
              Choose your institution and every published fee is drawn against its peer group.
            </p>
          </div>
          <Link
            href={settingsHref}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-white no-underline"
            style={{ background: "var(--hamilton-gradient-cta)" }}
          >
            Choose institution
          </Link>
        </section>
      )}

      <HamiltonBriefing
        thesis={data.thesis}
        blockingPolicies={writing.blockingPolicies}
        isAdmin={isAdmin}
        analyzeHref={analyzeHref}
        positioning={positioning}
        state={state}
        district={district}
        regulation={regulation}
      />

      <Suspense fallback={<ChangesSkeleton />}>
        <ChangesForInstitution user={user} selectedInstitutionId={selectedInstitutionId} />
      </Suspense>

      {positioning ? (
        <PositionOverview positioning={positioning} state={state} showHeadline={false} />
      ) : positioningUnavailable ? (
        <p role="status" className="text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
          Your institution&apos;s position couldn&apos;t load just now.{" "}
          <Link href="/pro/hamilton" className="underline">Try again</Link>
        </p>
      ) : null}

      <NationalSnapshot
        entries={data.positioning}
        totalInstitutions={data.totalInstitutions}
        selectedInstitutionId={selectedInstitutionId}
      />
    </div>
  );
}
