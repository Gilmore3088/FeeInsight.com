import { Suspense } from "react";
import { unstable_cache, unstable_noStore } from "next/cache";
import Link from "next/link";
import type { Metadata } from "next";
import { fetchHomeBriefingSignals, type HomeBriefingSignals } from "@/lib/hamilton/home-data";
import { getCurrentUser, type User } from "@/lib/auth";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { parseInstitutionId } from "@/lib/hamilton/institution-context";
import { RecentChanges } from "@/components/hamilton/benchmark/RecentChanges";
import { WorthYourAttention } from "@/components/hamilton/benchmark/WorthYourAttention";
import { FeeScorecard, type ScorecardRow } from "@/components/hamilton/benchmark/FeeScorecard";
import { buildAttentionItems, FLAGSHIP_FEE } from "@/lib/hamilton/briefing-observations";
import { provenanceToTrail, STANDARD_METHOD } from "@/lib/hamilton/audit-trail";
import { COMPETITOR_MOVE_WINDOW_DAYS, getFeeResearch, getWorkspaceBriefing } from "@/lib/hamilton/workspace/research";
import { POSITION_EXTREME_PCT, REVENUE_SHIFT_PCT } from "@/lib/hamilton/workspace/observations";
import type { Briefing, FeeResearch } from "@/lib/hamilton/workspace/types";
import { AuditPanel, Callout, LinkButton, MemoHeader, MemoPage } from "@/components/hamilton/memo/memo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "This month" };

/** The engine's Briefing and overdraft research, cached per institution for an hour (keyed on the id). */
const getCachedBriefing = unstable_cache(
  async (institutionId: number) => {
    const [briefing, overdraft] = await Promise.all([
      getWorkspaceBriefing(institutionId),
      getFeeResearch(institutionId, FLAGSHIP_FEE),
    ]);
    return { briefing, overdraft };
  },
  ["hamilton-this-month-briefing-v1"],
  { revalidate: 3600 },
);

async function loadBriefing(
  selectedInstitutionId: string | null,
): Promise<{ briefing: Briefing | null; overdraft: FeeResearch | null; unavailable: boolean }> {
  const institutionId = parseInstitutionId(selectedInstitutionId);
  if (!institutionId) return { briefing: null, overdraft: null, unavailable: false };
  try {
    return { ...(await getCachedBriefing(institutionId)), unavailable: false };
  } catch {
    return { briefing: null, overdraft: null, unavailable: true };
  }
}

const BRIEFING_METHOD = [
  ...STANDARD_METHOD,
  `Overdraft leads when you publish it. After it come your fees in the top or bottom ${POSITION_EXTREME_PCT}% of their peer group, institutions in your state that changed a fee you charge in the last ${COMPETITOR_MOVE_WINDOW_DAYS} days, and any move of ${REVENUE_SHIFT_PCT}% or more in your service charge income, most unusual first.`,
];

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
 * This month: one memo built by the Hamilton engine. What is worth a look (overdraft first), what
 * changed, and how it was built. Deterministic: no model call on this page.
 */
export default async function HamiltonHomePage({
  searchParams,
}: {
  searchParams: Promise<{ instId?: string; intent?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser().catch(() => null);
  const selectedInstitutionId = await resolveSelectedInstitutionId(user, params);
  const { briefing, overdraft, unavailable } = await loadBriefing(selectedInstitutionId);
  const items = buildAttentionItems(briefing, overdraft);
  const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const trail = briefing
    ? provenanceToTrail(briefing.provenance, {
        method: BRIEFING_METHOD,
        extraAssumptions:
          overdraft && items[0]?.id === `position:${FLAGSHIP_FEE}`
            ? [`Overdraft is compared with ${overdraft.peerLabel}, ${overdraft.band?.n ?? 0} institutions.`]
            : [],
      })
    : null;

  return (
    <MemoPage>
      <MemoHeader
        kicker={`This month · ${month}`}
        title={briefing ? briefing.institutionName : "Your briefing"}
        dek={
          briefing
            ? `${briefing.feesReviewed} published fees, read against ${briefing.peerLabel}.`
            : "Choose your bank and Hamilton reads its published fees against its market every month."
        }
      />

      {briefing && trail && items.length > 0 ? (
        <WorthYourAttention observations={items} institutionId={selectedInstitutionId} trail={trail} />
      ) : unavailable ? (
        <p role="status" className="text-sm text-terra-text">
          Your briefing couldn&apos;t load just now. <Link href="/pro/hamilton" className="underline">Try again</Link>
        </p>
      ) : briefing && trail && briefing.feesReviewed > 0 ? (
        <div className="flex flex-col gap-4">
          <Callout>
            Nothing stood out this month: no fee in its peer group&apos;s top or bottom {POSITION_EXTREME_PCT}%, no state
            competitor changes in {COMPETITOR_MOVE_WINDOW_DAYS} days, and fee income within {REVENUE_SHIFT_PCT}% of last year.
          </Callout>
          <AuditPanel trail={trail} />
        </div>
      ) : briefing ? (
        <Callout>
          We don&apos;t have enough of {briefing.institutionName}&apos;s published fees to compare yet. My fees still shows
          the market for any fee.
        </Callout>
      ) : (
        <div>
          <LinkButton href={hrefWithInstitutionContext("/pro/settings", selectedInstitutionId)} primary>
            Choose your bank
          </LinkButton>
        </div>
      )}

      {/* Every fee against its peers, once the engine returns the positions it already computes. */}
      {briefing && (briefing as Briefing & { positions?: ScorecardRow[] }).positions?.length ? (
        <FeeScorecard
          rows={(briefing as Briefing & { positions?: ScorecardRow[] }).positions ?? []}
          institutionId={selectedInstitutionId}
        />
      ) : null}

      <Suspense fallback={<ChangesSkeleton />}>
        <ChangesForInstitution user={user} selectedInstitutionId={selectedInstitutionId} />
      </Suspense>
    </MemoPage>
  );
}
