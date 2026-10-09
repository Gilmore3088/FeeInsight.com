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
import { ThisMonthOverview } from "@/components/hamilton/benchmark/ThisMonthOverview";
import { FeeScorecard } from "@/components/hamilton/benchmark/FeeScorecard";
import { LocalCompetitors } from "@/components/hamilton/benchmark/LocalCompetitors";
import { buildAttentionItems, buildBriefingOverview } from "@/lib/hamilton/briefing-observations";
import { provenanceToTrail, STANDARD_METHOD } from "@/lib/hamilton/audit-trail";
import { COMPETITOR_MOVE_WINDOW_DAYS, getWorkspaceBriefing, type EnginePeerOptions } from "@/lib/hamilton/workspace/research";
import { getCategoryChargeBases } from "@/lib/data-store/fee-index";
import { mixedBasisCategories } from "@/lib/hamilton/report-evidence";
import { getActivePeerSet } from "@/lib/hamilton/active-peer-set";
import { POSITION_EXTREME_PCT, REVENUE_SHIFT_PCT } from "@/lib/hamilton/workspace/observations";
import type { Briefing } from "@/lib/hamilton/workspace/types";
import { AuditPanel, Callout, LinkButton, MemoHeader, MemoPage } from "@/components/hamilton/memo/memo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "This month" };

/**
 * The engine's Briefing, cached for an hour per institution and peer group (keyed on both, so a
 * bank's own group from Settings never serves another reader), with the categories whose peers
 * charge them on mixed bases.
 */
const getCachedBriefing = unstable_cache(
  async (institutionId: number, peerSet: EnginePeerOptions["peerSet"]) => {
    const [briefing, bases] = await Promise.all([
      getWorkspaceBriefing(institutionId, new Date(), { peerSet }),
      getCategoryChargeBases().catch(() => []),
    ]);
    return { briefing, mixedBasis: [...mixedBasisCategories(bases)] };
  },
  ["hamilton-this-month-briefing-v3"],
  { revalidate: 3600 },
);

async function loadBriefing(
  user: User | null,
  selectedInstitutionId: string | null,
): Promise<{ briefing: Briefing | null; mixedBasis: string[]; unavailable: boolean }> {
  const institutionId = parseInstitutionId(selectedInstitutionId);
  if (!institutionId) return { briefing: null, mixedBasis: [], unavailable: false };
  try {
    const active = user ? await getActivePeerSet({ userId: user.id, institutionId }).catch(() => null) : null;
    const peerSet = active ? { filters: active.filters, label: active.label } : null;
    return { ...(await getCachedBriefing(institutionId, peerSet)), unavailable: false };
  } catch {
    return { briefing: null, mixedBasis: [], unavailable: true };
  }
}

const BRIEFING_METHOD = [
  ...STANDARD_METHOD,
  `What stands out: your fees in the top or bottom ${POSITION_EXTREME_PCT}% of their peer group (overdraft first when it is one), institutions in your state that changed a fee you charge in the last ${COMPETITOR_MOVE_WINDOW_DAYS} days, and any move of ${REVENUE_SHIFT_PCT}% or more in your service charge income, most unusual first, at most three.`,
  "A fee whose peers charge it on more than one basis (per item and monthly, say) has no single median to stand out from, so it is not listed.",
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
  const { briefing, mixedBasis, unavailable } = await loadBriefing(user, selectedInstitutionId);
  const mixed = new Set(mixedBasis);
  const items = buildAttentionItems(briefing, { mixedBasis: mixed });
  const overview = briefing ? buildBriefingOverview(briefing, briefing.stateCode ?? null, mixed) : null;
  const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const trail = briefing
    ? provenanceToTrail(briefing.provenance, { method: BRIEFING_METHOD })
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

      {briefing && overview ? (
        <ThisMonthOverview
          institutionName={briefing.institutionName}
          peerLabel={briefing.peerLabel}
          overview={overview}
          windowDays={COMPETITOR_MOVE_WINDOW_DAYS}
          overdraftIncome={briefing.overdraftIncome ?? null}
          overdraftFee={briefing.positions.find((p) => p.feeCategory === "overdraft")?.current ?? null}
        />
      ) : null}

      {briefing && trail && items.length > 0 ? (
        <WorthYourAttention observations={items} institutionId={selectedInstitutionId} trail={trail} />
      ) : unavailable ? (
        <p role="status" className="text-sm text-terra-text">
          Your briefing couldn&apos;t load just now.{" "}
          <Link href={hrefWithInstitutionContext("/pro/hamilton", selectedInstitutionId)} className="underline">
            Try again
          </Link>
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

      {briefing?.localMarket ? <LocalCompetitors market={briefing.localMarket} notCompared={mixedBasis} /> : null}

      {/* Every fee against its own peer group, in the engine's order. */}
      {briefing && briefing.positions.length > 0 ? (
        <FeeScorecard rows={briefing.positions} institutionId={selectedInstitutionId} notCompared={mixedBasis} />
      ) : null}

      <Suspense fallback={<ChangesSkeleton />}>
        <ChangesForInstitution user={user} selectedInstitutionId={selectedInstitutionId} />
      </Suspense>
    </MemoPage>
  );
}
