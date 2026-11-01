import { cache, Suspense } from "react";
import { unstable_cache, unstable_noStore } from "next/cache";
import Link from "next/link";
import { fetchHomeBriefingSignals, type HomeBriefingSignals } from "@/lib/hamilton/home-data";
import { getCurrentUser, type User } from "@/lib/auth";
import { hrefWithInstitutionContext, normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { parseInstitutionId } from "@/lib/hamilton/institution-context";
import { decodeLandingResearch } from "@/lib/hamilton/landing-research-handoff";
import { RecentChanges } from "@/components/hamilton/benchmark/RecentChanges";
import { WorthYourAttention } from "@/components/hamilton/benchmark/WorthYourAttention";
import { ThisMonthOverview } from "@/components/hamilton/benchmark/ThisMonthOverview";
import { FeeScorecard } from "@/components/hamilton/benchmark/FeeScorecard";
import { LocalCompetitors } from "@/components/hamilton/benchmark/LocalCompetitors";
import { QuarterlyChanges } from "@/components/hamilton/intelligence/QuarterlyChanges";
import { getQuarterlyChanges } from "@/lib/hamilton/briefing-snapshots";
import { buildAttentionItems, buildBriefingOverview } from "@/lib/hamilton/briefing-observations";
import { provenanceToTrail, STANDARD_METHOD } from "@/lib/hamilton/audit-trail";
import { COMPETITOR_MOVE_WINDOW_DAYS, getWorkspaceBriefing, type EnginePeerOptions } from "@/lib/hamilton/workspace/research";
import { getActivePeerSet } from "@/lib/hamilton/active-peer-set";
import { POSITION_EXTREME_PCT, REVENUE_SHIFT_PCT } from "@/lib/hamilton/workspace/observations";
import type { Briefing } from "@/lib/hamilton/workspace/types";
import { AuditPanel, Callout, LinkButton, MemoHeader, MemoPage } from "@/components/hamilton/memo/memo";

/**
 * The engine's Briefing, cached for an hour per institution and peer group (keyed on both, so a
 * bank's own group from Settings never serves another reader). Every median it reads compares one
 * charging basis per category (statistics rule 9, #1901), so no category is held back as mixed.
 */
const getCachedBriefing = unstable_cache(
  async (institutionId: number, peerSet: EnginePeerOptions["peerSet"]) => ({
    briefing: await getWorkspaceBriefing(institutionId, new Date(), { peerSet }),
  }),
  // v6: briefings carry stateFeeChanges (#1891).
  ["hamilton-this-month-briefing-v6"],
  { revalidate: 3600 },
);

async function loadBriefing(
  userId: number | null,
  selectedInstitutionId: string | null,
): Promise<{ briefing: Briefing | null; unavailable: boolean }> {
  const institutionId = parseInstitutionId(selectedInstitutionId);
  if (!institutionId) return { briefing: null, unavailable: false };
  try {
    const active = userId ? await getActivePeerSet({ userId, institutionId }).catch(() => null) : null;
    const peerSet = active ? { filters: active.filters, label: active.label } : null;
    const result = await getCachedBriefing(institutionId, peerSet);
    if (result.briefing && result.briefing.institutionId !== institutionId) {
      return { briefing: null, unavailable: true };
    }
    return { ...result, unavailable: false };
  } catch {
    return { briefing: null, unavailable: true };
  }
}

/**
 * One briefing read per request, shared by the command center and the briefing below it (#1891), so
 * a cold cache never builds the engine's briefing twice at once. Keyed on primitives, as React's
 * cache compares arguments by identity.
 */
export const loadBriefingOnce = cache(loadBriefing);

const BRIEFING_METHOD = [
  ...STANDARD_METHOD,
  `What stands out: the research institution's fees in the top or bottom ${POSITION_EXTREME_PCT}% of their peer group (overdraft first when it is one), institutions in its state that changed a matching fee in the last ${COMPETITOR_MOVE_WINDOW_DAYS} days, and any move of ${REVENUE_SHIFT_PCT}% or more in its service charge income, most unusual first, at most three.`,
  "Each fee is compared on one charging basis (monthly, yearly, daily or each time it is charged); a fee stated on a different basis, on either side, is left out of the comparison.",
];

function ChangesSkeleton() {
  return <div className="skeleton rounded-lg" style={{ minHeight: "3rem" }} />;
}

/** One read of the quarterly comparison per request, shared with the command center (#1891). */
export const getQuarterlyChangesOnce = cache(getQuarterlyChanges);

/** The briefing against last quarter's stored copy (#1083); nothing when none is stored. */
async function QuarterlyChangesFor({ institutionId, pagePeerLabel }: { institutionId: number; pagePeerLabel: string }) {
  unstable_noStore();
  return <QuarterlyChanges changes={await getQuarterlyChangesOnce(institutionId)} pagePeerLabel={pagePeerLabel} />;
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
  const canonicalInstitutionId = normalizeCanonicalInstitutionId(selectedInstitutionId);
  if (user && canonicalInstitutionId) {
    try {
      signals = await fetchHomeBriefingSignals(user.id, {
        institutionIds: [canonicalInstitutionId],
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

async function resolveResearchInstitution(
  user: User | null,
  params: { instId?: string; intent?: string; research?: string },
) {
  if (!user) return { institution: null, error: null };
  let instId = params.instId ?? null;
  if (params.research !== undefined) {
    try {
      const research = decodeLandingResearch(params.research);
      if (research?.scope.kind !== "local") {
        return { institution: null, error: "Choose an institution for a monthly briefing. Open the research link in Ask Hamilton for market research." };
      }
      instId = String(research.scope.institutionId);
    } catch {
      return { institution: null, error: "This research link is invalid. Choose an institution again." };
    }
  }
  try {
    return await resolveHamiltonInstitutionContext({
      userId: user.id,
      instId,
      intent: params.intent,
      persistUrlSelection: false,
    });
  } catch {
    return { institution: null, error: "The research institution could not be loaded. Please try again." };
  }
}

/**
 * This month: one memo built by the Hamilton engine. What is worth a look (overdraft first), what
 * changed, and how it was built. Deterministic: no model call on this page.
 */
export async function InstitutionBriefing({
  searchParams,
  headless = false,
}: {
  searchParams: Promise<{ instId?: string; intent?: string; research?: string }>;
  /** Under the command center (#1891), which already names the institution and its month at a glance. */
  headless?: boolean;
}) {
  const params = await searchParams;
  const user = await getCurrentUser().catch(() => null);
  const { institution, error: contextError } = await resolveResearchInstitution(user, params);
  const selectedInstitutionId = institution ? String(institution.id) : null;
  const { briefing, unavailable } = await loadBriefingOnce(user?.id ?? null, selectedInstitutionId);
  const items = buildAttentionItems(briefing);
  const overview = briefing ? buildBriefingOverview(briefing, briefing.stateCode ?? null) : null;
  const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const trail = briefing
    ? provenanceToTrail(briefing.provenance, { method: BRIEFING_METHOD })
    : null;

  return (
    <MemoPage>
      {headless ? null : <MemoHeader
        kicker={`This month · ${month}`}
        title={institution?.name ?? "Monthly briefing"}
        dek={
          briefing
            ? `Published fees in ${briefing.feesReviewed} ${briefing.feesReviewed === 1 ? "category" : "categories"}, read against ${briefing.peerLabel}.`
            : institution
              ? `Research institution: ${institution.name}.`
              : "Choose an institution and Hamilton reads its published fees against its market every month."
        }
      />}

      {briefing && overview && !headless ? (
        <ThisMonthOverview
          institutionName={briefing.institutionName}
          peerLabel={briefing.peerLabel}
          overview={overview}
          windowDays={COMPETITOR_MOVE_WINDOW_DAYS}
          overdraftIncome={briefing.overdraftIncome ?? null}
          tryPriceHref={hrefWithInstitutionContext("/pro/simulate?fee=overdraft", selectedInstitutionId)}
        />
      ) : null}

      {briefing && trail && items.length > 0 ? (
        <WorthYourAttention observations={items} institutionId={selectedInstitutionId} trail={trail} />
      ) : unavailable ? (
        <p role="status" className="text-sm text-terra-text">
          The monthly briefing for {institution?.name ?? "this institution"} couldn&apos;t load just now.{" "}
          <Link href={hrefWithInstitutionContext("/pro/intelligence?view=institution", selectedInstitutionId)} className="underline">
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
          We don&apos;t have enough of {briefing.institutionName}&apos;s published fees to compare yet. Ask Hamilton still shows
          the market for any fee.
        </Callout>
      ) : institution ? (
        <Callout>No monthly briefing is available for {institution.name} yet. Ask Hamilton can still research its published fees.</Callout>
      ) : (
        <div>
          {contextError ? <p role="status" className="mb-3 text-sm text-terra-text">{contextError}</p> : null}
          <LinkButton href={hrefWithInstitutionContext("/pro/settings", selectedInstitutionId)} primary>
            Choose a research institution
          </LinkButton>
        </div>
      )}

      {briefing ? (
        <Suspense fallback={<ChangesSkeleton />}>
          <QuarterlyChangesFor institutionId={briefing.institutionId} pagePeerLabel={briefing.peerLabel} />
        </Suspense>
      ) : null}

      {briefing?.localMarket ? <LocalCompetitors market={briefing.localMarket} /> : null}

      {/* Every fee against its own peer group, in the engine's order. */}
      {briefing && briefing.positions.length > 0 ? (
        <FeeScorecard rows={briefing.positions} institutionId={selectedInstitutionId} institutionName={briefing.institutionName} />
      ) : null}

      <Suspense fallback={<ChangesSkeleton />}>
        <ChangesForInstitution user={user} selectedInstitutionId={selectedInstitutionId} />
      </Suspense>
    </MemoPage>
  );
}
