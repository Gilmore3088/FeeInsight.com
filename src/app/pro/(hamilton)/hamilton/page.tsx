import { Suspense } from "react";
import { unstable_cache, unstable_noStore } from "next/cache";
import Link from "next/link";
import type { Metadata } from "next";
import {
  fetchCacheableHomeBriefing,
  fetchHomeBriefingData,
  fetchHomeBriefingSignals,
  type HomeBriefingData,
} from "@/lib/hamilton/home-data";
import { getCurrentUser } from "@/lib/auth";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { HamiltonViewCard } from "@/components/hamilton/home/HamiltonViewCard";
import { PositioningEvidence } from "@/components/hamilton/home/PositioningEvidence";
import { WhatChangedCard } from "@/components/hamilton/home/WhatChangedCard";
import { PriorityAlertsCard } from "@/components/hamilton/home/PriorityAlertsCard";
import { MonitorFeedPreview } from "@/components/hamilton/home/MonitorFeedPreview";
import { RecommendedActionCard } from "@/components/hamilton/home/RecommendedActionCard";
import type { HomeBriefingSignals } from "@/lib/hamilton/home-data";

export const dynamic = "force-dynamic";

const getCachedHomeBriefing = unstable_cache(
  fetchCacheableHomeBriefing,
  ["hamilton-home-briefing"],
  { revalidate: 86400 },
);

/** The cached briefing, or (when it can't be built) the data view without the AI thesis, uncached. */
async function loadHomeBriefing(): Promise<{ data: HomeBriefingData; unavailable: boolean }> {
  try {
    return { data: await getCachedHomeBriefing(), unavailable: false };
  } catch {
    const data = await fetchHomeBriefingData({ includeThesis: false }).catch(() => ({
      thesis: null,
      confidence: "low" as const,
      positioning: [],
      spotlightCount: 0,
      totalInstitutions: 0,
      recommendedCategory: null,
    }));
    return { data, unavailable: true };
  }
}

export const metadata: Metadata = { title: "Executive Briefing" };

interface HamiltonHomePageProps {
  searchParams: Promise<{
    instId?: string;
    intent?: string;
  }>;
}

/**
 * Skeleton placeholder for fresh-data signal components while loading.
 * Uses .skeleton shimmer class from globals.css.
 */
function SignalsSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <div
        style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "2rem" }}
      >
        <div className="hamilton-card skeleton" style={{ minHeight: "12rem" }} />
        <div className="hamilton-card skeleton" style={{ minHeight: "12rem" }} />
      </div>
      <div className="hamilton-card skeleton" style={{ minHeight: "5rem" }} />
    </div>
  );
}

/**
 * BriefingSignals — fetches time-sensitive signal/alert data fresh on every load.
 * Per D-11: unstable_noStore() opts this async component out of ISR caching.
 */
async function BriefingSignals({
  selectedInstitutionId,
}: {
  selectedInstitutionId: string | null;
}) {
  unstable_noStore();

  let signals: HomeBriefingSignals = {
    whatChanged: [],
    priorityAlerts: [],
    monitorFeed: [],
  };

  try {
    const user = await getCurrentUser();
    if (user) {
      signals = await fetchHomeBriefingSignals(user.id, {
        institutionIds: selectedInstitutionId ? [selectedInstitutionId] : [],
      });
    }
  } catch {
    // Auth or DB unavailable — render empty states
  }

  return (
    <>
      {/* Second Row: WhatChanged (8 col) + PriorityAlerts (4 col) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: "2rem",
        }}
      >
        <WhatChangedCard
          signals={signals.whatChanged}
          selectedInstitutionId={selectedInstitutionId}
        />
        <PriorityAlertsCard alerts={signals.priorityAlerts} />
      </div>

      {/* Monitor Feed — full-width timeline */}
      <MonitorFeedPreview
        signals={signals.monitorFeed}
        selectedInstitutionId={selectedInstitutionId}
      />
    </>
  );
}

async function resolveSelectedInstitutionId(params: {
  instId?: string;
  intent?: string;
}): Promise<string | null> {
  if (params.instId) return params.instId;

  try {
    const user = await getCurrentUser();
    if (!user) return null;

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

export default async function HamiltonHomePage({
  searchParams,
}: HamiltonHomePageProps) {
  const params = await searchParams;
  const { data, unavailable: briefingUnavailable } = await loadHomeBriefing();
  const selectedInstitutionId = await resolveSelectedInstitutionId(params);
  const reportsHref = hrefWithInstitutionContext(
    "/pro/reports?intent=executive-briefing",
    selectedInstitutionId,
  );
  const monitorHref = hrefWithInstitutionContext("/pro/monitor", selectedInstitutionId);

  return (
    <div>
      {/* Page header — "Executive Briefing" + subtitle pills */}
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: "1rem",
          marginBottom: "3rem",
        }}
      >
        <div>
          <h1
            className="font-headline"
            style={{
              fontSize: "3rem",
              fontStyle: "italic",
              fontWeight: 400,
              letterSpacing: "-0.02em",
              color: "var(--hamilton-on-surface)",
              lineHeight: 1.1,
              marginBottom: "0.5rem",
            }}
          >
            Executive Briefing
          </h1>
          <span
            className="font-label"
            style={{
              fontSize: "0.625rem",
              fontWeight: 600,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--hamilton-on-surface-variant)",
            }}
          >
            {data.thesis ? "Analysis current" : "Analysis unavailable"}
          </span>
          {briefingUnavailable && (
            <p role="status" style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "var(--hamilton-on-surface-variant)" }}>
              Hamilton&apos;s written briefing is temporarily unavailable; the fee data below is current.{" "}
              <Link href="/pro/hamilton" style={{ textDecoration: "underline" }}>
                Try again
              </Link>
            </p>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", flexShrink: 1 }}>
          <Link
            href={reportsHref}
            className="no-underline"
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "var(--hamilton-surface-container-high)",
              color: "var(--hamilton-on-surface)",
              fontSize: "0.875rem",
              fontWeight: 500,
              borderRadius: "var(--hamilton-radius-lg)",
              border: "1px solid var(--hamilton-border)",
            }}
          >
            Generate Brief
          </Link>
          <Link
            href={monitorHref}
            className="burnished-cta editorial-shadow no-underline"
            style={{
              padding: "0.5rem 1rem",
              color: "var(--hamilton-on-primary)",
              fontSize: "0.875rem",
              fontWeight: 500,
              borderRadius: "var(--hamilton-radius-lg)",
            }}
          >
            Open Watchlist
          </Link>
        </div>
      </header>

      {/* Content grid */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        {/* Row 1: Hamilton's View — full width */}
        <HamiltonViewCard
          thesis={data.thesis}
          confidence={data.confidence}
          selectedInstitutionId={selectedInstitutionId}
        />

        {/* Row 2: Positioning Evidence — full width */}
        <PositioningEvidence
          entries={data.positioning}
          selectedInstitutionId={selectedInstitutionId}
        />

        {/* Row 3: Recommended Action — full width */}
        <RecommendedActionCard
          recommendedCategory={data.recommendedCategory}
          thesisExists={data.thesis !== null}
          selectedInstitutionId={selectedInstitutionId}
        />

        {/* Fresh signal rows via Suspense (WhatChanged + PriorityAlerts + MonitorFeed) */}
        <Suspense fallback={<SignalsSkeleton />}>
          <BriefingSignals selectedInstitutionId={selectedInstitutionId} />
        </Suspense>
      </div>
    </div>
  );
}
