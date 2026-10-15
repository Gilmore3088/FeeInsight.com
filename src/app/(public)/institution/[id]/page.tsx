export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFinancialsByInstitution } from "@/lib/data-store";
import { getFinancialHistory, getPeerFinancialMedians, getPeerPercentiles } from "@/lib/data-store/financial";
import {
  getBranchFootprint,
  getEnforcementRecord,
  getComplaintTrend,
  getHoldingCompanyProfile,
  getRegulatorInfo,
} from "@/lib/data-store/registry-profile";
import { getRegulatoryWatch } from "@/lib/data-store/regulatory-watch";
import { canAccessPremium } from "@/lib/access";
import { getInstitutionFeeScheduleEvidence } from "@/lib/data-store/institution";
import { getCurrentUser } from "@/lib/auth";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { getAlertSubscriptionForInstitution } from "@/lib/data-store/alerts";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { FeeAlertControl } from "./fee-alert-control";
import { PeerRankTeaser } from "./peer-rank-teaser";
import { getInstitutionPeerRankCached, getPeerIndexCached } from "@/lib/data-store/public-cached-reads";
import { SITE_NAME } from "@/lib/constants";
import type { FeePublicationStatus } from "@/lib/institution-quality";
import { buildPublicInstitutionProfileLinks } from "@/lib/institution-profile-links";
import { formatAbsoluteDate, getPublicNationalIndex } from "@/lib/public-stats";
import { formatCompactDollars } from "@/lib/format";
import { getCharterLabel, getSegmentLabel, toTitleCase } from "./enum-labels";
import { FeeFocusScroll } from "./fee-focus-scroll";
import { FeeScheduleTable, countPositions, type FeeBenchmarks, type StateMedians } from "./fee-schedule-table";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import {
  buildFinancialSeries,
  computeGrowth,
  findOutliers,
  toPeerMedianPoints,
  toPeerRankRows,
} from "./financial-history";
import { FinancialProfileSection } from "./financial-profile-section";
import { assetSizeToDollars, formatReportQuarter, selectFinancialsByQuarter } from "./financial-units";
import { InstitutionOfferBand } from "./institution-metrics";
import { MIN_VERIFIED_FEES_FOR_OFFER } from "./profile-copy";
import {
  buildLocationParts,
  buildProfileTitle,
  getPublicInstitutionForPage,
  getRateFeesForPage,
  getVisibleFeesForPage,
  isVerifiedFee,
  pickHeadlineFees,
  pickHeadlineRows,
  toDisplayFees,
  toPipelineDisplayFees,
  toRateDisplayFees,
} from "./profile-data";
import { ProfileHeader } from "./profile-header";
import { InstitutionJsonLd } from "./profile-jsonld";
import { ProfileFootnote } from "./profile-footnote";
import { HamiltonBand } from "./hamilton-band";
import { MarketPosition, PositionSummary, type HeadlineRow, type MarketBand } from "./market-position";
import { StatusNotice } from "./status-notice";
import { ThinProfilePanel } from "./thin-profile-panel";

interface PageProps {
  params: Promise<{ id: string }>;
  /** `fee`: the category a consumer guide sent the reader to compare; highlights that row. */
  searchParams?: Promise<{ fee?: string }>;
}

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());

const FINANCIAL_HISTORY_QUARTERS = 4;
/** Headline fees drawn in full on the page, and the few the Hamilton picture repeats. */
const HEADLINE_ROWS_SHOWN = 6;
const HAMILTON_ROWS_SHOWN = 3;
/** fdic and ncua can both carry the same quarter; fetch enough rows to dedupe. */
const FINANCIAL_SOURCES_PER_QUARTER = 2;

function fallbackTo<T>(label: string, fallback: T) {
  return (error: unknown): T => {
    console.error(`Institution page ${label} failed:`, error);
    return fallback;
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const instId = parseInt(id, 10);
  // notFound() here, before the page streams, so a missing institution answers 404, not 200.
  if (Number.isNaN(instId)) notFound();

  const inst = await getPublicInstitutionForPage(instId);
  if (!inst) notFound();

  const fees = Number(inst.fee_count ?? 0) > 0 ? await getVisibleFeesForPage(instId) : [];
  const verifiedFees = fees.filter(isVerifiedFee);
  const headline = pickHeadlineFees(verifiedFees);
  const city = toTitleCase(inst.city);
  const place = [city, inst.state_code].filter(Boolean).join(", ");
  const stateName = inst.state_code ? STATE_NAMES[inst.state_code] : null;

  return {
    // Thin profiles (fewer verified fees than the page's own thin threshold) stay reachable
    // but out of the index.
    robots: verifiedFees.length < MIN_VERIFIED_FEES_FOR_OFFER ? { index: false, follow: true } : undefined,
    title: buildProfileTitle(inst.institution_name, headline),
    description: `Published fees for ${inst.institution_name}${place ? ` (${place})` : ""}, from its own fee schedule, with national benchmarks from ${SITE_NAME}.`,
    keywords: [
      inst.institution_name,
      `${inst.institution_name} fees`,
      `${inst.institution_name} overdraft fee`,
      stateName ? `${stateName} ${getCharterLabel(inst.charter_type).toLowerCase()} fees` : "",
    ].filter(Boolean),
  };
}

export default async function InstitutionProfilePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const instId = parseInt(id, 10);
  if (Number.isNaN(instId)) notFound();
  const requestedFee = (await searchParams)?.fee ?? "";
  const focusFeeCategory = TAXONOMY.has(requestedFee) ? requestedFee : null;

  const inst = await getPublicInstitutionForPage(instId);
  if (!inst) notFound();

  const catalogVisibleFeeCount = Number(inst.fee_count ?? 0);
  const status: FeePublicationStatus = inst.fee_publication_status ?? "unavailable";
  const shouldLoadPipelineEvidence =
    catalogVisibleFeeCount === 0 &&
    Boolean(inst.fee_schedule_url || inst.latest_source_status || (inst.latest_extracted_fee_count ?? 0) > 0);

  const [visibleFees, rateFees, evidence, financials, user, peerRank] = await Promise.all([
    catalogVisibleFeeCount > 0 ? getVisibleFeesForPage(instId) : Promise.resolve([]),
    getRateFeesForPage(instId),
    shouldLoadPipelineEvidence
      ? getInstitutionFeeScheduleEvidence(instId).catch(fallbackTo("fee evidence", null))
      : Promise.resolve(null),
    getFinancialsByInstitution(instId, FINANCIAL_HISTORY_QUARTERS * FINANCIAL_SOURCES_PER_QUARTER).catch(
      fallbackTo("financial context", []),
    ),
    getCurrentUser().catch(() => null),
    getInstitutionPeerRankCached(instId).catch(fallbackTo("peer rank", null)),
  ]);

  const alertSubscription = user
    ? await getAlertSubscriptionForInstitution(user.id, instId).catch(fallbackTo("alert subscription", null))
    : null;
  const alertCategoryLabels = Object.fromEntries(
    [focusFeeCategory, ...(alertSubscription?.fee_categories ?? [])]
      .filter((category): category is string => Boolean(category))
      .map((category) => [category, getDisplayName(category).replace(/\s*\([^)]*\)/g, "")]),
  );
  // Financial history is Pro-only; free users never receive it in the RSC payload.
  const isPro = canAccessPremium(user);
  const [financialHistory, peerMedians, peerPercentiles, footprint, complaints, holdingCompany, enforcement, regulatoryWatch] = isPro
    ? await Promise.all([
        getFinancialHistory(instId).catch(fallbackTo("financial history", [])),
        getPeerFinancialMedians(instId).catch(fallbackTo("peer medians", null)),
        getPeerPercentiles(instId).catch(fallbackTo("peer percentiles", null)),
        getBranchFootprint(instId).catch(fallbackTo("branch footprint", null)),
        getComplaintTrend(instId).catch(fallbackTo("complaint trend", null)),
        getHoldingCompanyProfile(instId).catch(fallbackTo("holding company", null)),
        getEnforcementRecord(instId).catch(fallbackTo("enforcement actions", null)),
        getRegulatoryWatch(instId).catch(fallbackTo("regulatory watch", null)),
      ])
    : [[], null, null, null, null, null, null, null];
  const regulator = await getRegulatorInfo(instId).catch(fallbackTo("regulator info", null));
  const financialSeries = buildFinancialSeries(financialHistory);
  const peerMedianPoints = toPeerMedianPoints(peerMedians);
  const financialGrowth = computeGrowth(financialSeries);
  const insights = {
    growth: financialGrowth,
    ranks: toPeerRankRows(peerPercentiles),
    flags: findOutliers(financialSeries, financialGrowth, peerPercentiles),
    peerCount: peerPercentiles?.peer_count ?? null,
    peerQuarter: formatReportQuarter(peerPercentiles?.report_date),
  };

  const verifiedFees = visibleFees.filter(isVerifiedFee);
  const catalogRows = [...toDisplayFees(visibleFees), ...toRateDisplayFees(rateFees)];
  const displayFees = catalogRows.length > 0 ? catalogRows : toPipelineDisplayFees(evidence);
  const pipelineCounts = evidence?.pipeline_counts ?? null;
  const pipelineUnderReview = pipelineCounts
    ? Math.max(0, (pipelineCounts.raw_without_verified_count ?? 0) + (pipelineCounts.verified_without_published_count ?? 0))
    : 0;
  const verifiedCount = inst.published_fee_count ?? verifiedFees.length;
  const underReviewCount = Math.max(
    inst.provisional_fee_count ?? 0,
    visibleFees.length - verifiedFees.length,
    pipelineUnderReview,
  );

  const nationalIndex =
    verifiedFees.length > 0 ? await getPublicNationalIndex().catch(fallbackTo("national index", [])) : [];
  // Medians for the per-row comparison: the verified-only national index, and
  // only where enough institutions publish the fee for a median to mean something.
  const nationalMedians = new Map<string, number | null>(
    nationalIndex
      .filter((entry) => entry.maturity_tier !== "insufficient")
      .map((entry) => [entry.fee_category, entry.median_amount]),
  );
  const feeBenchmarks: FeeBenchmarks = {};
  for (const entry of nationalIndex) {
    if (entry.maturity_tier === "insufficient") continue;
    if (entry.p25_amount == null || entry.median_amount == null || entry.p75_amount == null) continue;
    feeBenchmarks[entry.fee_category] = {
      p25: entry.p25_amount,
      median: entry.median_amount,
      p75: entry.p75_amount,
    };
  }
  // Home-state medians for the second comparison line, under the same "enough institutions" rule.
  const stateIndex =
    verifiedFees.length > 0 && inst.state_code
      ? await getPeerIndexCached({ state_code: inst.state_code }).catch(fallbackTo("state index", []))
      : [];
  const stateMedians: StateMedians | undefined =
    stateIndex.length > 0 && inst.state_code && STATE_NAMES[inst.state_code]
      ? {
          place: STATE_NAMES[inst.state_code],
          medians: new Map(
            stateIndex
              .filter((entry) => entry.maturity_tier !== "insufficient")
              .map((entry) => [entry.fee_category, entry.median_amount]),
          ),
        }
      : undefined;
  const thinProfile = verifiedFees.length < MIN_VERIFIED_FEES_FOR_OFFER;

  // One row per quarter, one source; the KPI strip and Financial Context share the same figure.
  const normalizedFinancials = selectFinancialsByQuarter(financials).slice(0, FINANCIAL_HISTORY_QUARTERS);
  const latestFinancial = normalizedFinancials[0] ?? null;
  const financialsAsOf = latestFinancial ? formatReportQuarter(latestFinancial.reportDate) : null;
  const assetsDollars = latestFinancial?.totalAssets ?? assetSizeToDollars(inst.asset_size);

  const stateName = inst.state_code ? STATE_NAMES[inst.state_code] : null;
  const city = toTitleCase(inst.city);
  const locationLabel = [city, stateName].filter(Boolean).join(", ") || null;
  const charterLabel = getCharterLabel(inst.charter_type);
  const districtName = inst.fed_district ? DISTRICT_NAMES[inst.fed_district] ?? null : null;
  const segmentLabel = getSegmentLabel(inst.asset_size_tier, inst.charter_type);
  const collectedOn = formatAbsoluteDate(inst.latest_source_collected_at ?? null);
  const links = buildPublicInstitutionProfileLinks({
    institutionId: instId,
    institutionName: inst.institution_name,
    isAuthenticated: Boolean(user),
  });
  const needsSource = status === "unavailable" || status === "under_review";

  const regulatorFacts: Array<{ label: string; value: string }> = [];
  if (regulator?.primary_regulator) regulatorFacts.push({ label: "Primary regulator", value: regulator.primary_regulator });
  if (regulator?.charter_agency === "State" && regulator.state_agency_name) {
    regulatorFacts.push({ label: "Chartered by", value: regulator.state_agency_name });
  }
  if (regulator?.holding_company_name) {
    regulatorFacts.push({ label: "Holding company", value: toTitleCase(regulator.holding_company_name) ?? regulator.holding_company_name });
  }
  if (regulator?.regulatory_status === "inactive") {
    regulatorFacts.push({ label: "Status", value: regulator.closed_date ? `Closed or merged ${regulator.closed_date}` : "Closed or merged" });
  }

  const marketBand = (entry: IndexEntry | undefined): MarketBand | null =>
    entry &&
    entry.maturity_tier !== "insufficient" &&
    entry.min_amount != null &&
    entry.p25_amount != null &&
    entry.median_amount != null &&
    entry.p75_amount != null &&
    entry.max_amount != null
      ? {
          min: entry.min_amount,
          p25: entry.p25_amount,
          median: entry.median_amount,
          p75: entry.p75_amount,
          max: entry.max_amount,
          institutions: entry.institution_count,
        }
      : null;
  const nationalByCategory = new Map(nationalIndex.map((entry) => [entry.fee_category, entry]));
  const stateByCategory = new Map(stateIndex.map((entry) => [entry.fee_category, entry]));
  const headlineRows: HeadlineRow[] = pickHeadlineRows(verifiedFees, HEADLINE_FEE_KEYS)
    .map((fee) => ({
      category: fee.fee_category as string,
      label: getDisplayName(fee.fee_category as string).replace(/\s*\([^)]*\)/g, ""),
      amount: fee.amount as number,
      sourceUrl: fee.source_url ?? inst.fee_schedule_url ?? null,
      state: marketBand(stateByCategory.get(fee.fee_category as string)),
      nation: marketBand(nationalByCategory.get(fee.fee_category as string)),
    }))
    .filter((row) => row.state !== null || row.nation !== null)
    .slice(0, HEADLINE_ROWS_SHOWN);
  const stateHasBands = headlineRows.some((row) => row.state !== null);
  const kind = inst.charter_type === "credit_union" ? "credit union" : "bank";
  const marketLabel = stateHasBands && stateName ? `${stateName} ${kind === "bank" ? "banks" : "credit unions"}` : "the U.S. market";
  const positionCounts = countPositions(displayFees, feeBenchmarks);
  const showHamiltonBand = !isPro && !thinProfile && headlineRows.length > 0;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Institutions", href: "/institutions" },
          { name: inst.institution_name, href: `/institution/${instId}` },
        ]}
      />

      <div className="min-h-screen bg-paper text-ink">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
          <ProfileHeader
            name={inst.institution_name}
            status={status}
            segmentLabel={segmentLabel}
            locationLabel={locationLabel}
            location={buildLocationParts({ city, stateCode: inst.state_code, stateName, hasApprovedFees: verifiedFees.length > 0 })}
            districtHref={inst.fed_district ? `/research/district/${inst.fed_district}` : null}
            charterLabel={charterLabel}
            districtName={districtName}
            websiteUrl={inst.website_url}
            feeScheduleUrl={inst.fee_schedule_url}
            collectedOn={collectedOn}
            publishedCount={verifiedCount}
            assetsLabel={assetsDollars ? `${formatCompactDollars(assetsDollars)} assets` : null}
          />

          <StatusNotice
            status={status}
            needsSource={needsSource}
            correctSourceHref={links.correctSourceHref}
            claimHref={links.claimHref}
          />

          <div className="space-y-10 sm:space-y-14">
            <MarketPosition rows={headlineRows} stateLabel={stateHasBands ? stateName : null} kind={kind} />

            {!thinProfile && (positionCounts.below + positionCounts.within + positionCounts.above > 0 || peerRank) && (
              <div className="grid gap-3 lg:grid-cols-2">
                <PositionSummary counts={positionCounts} />
                {peerRank && <PeerRankTeaser rank={peerRank} />}
              </div>
            )}

            {thinProfile && (
              <ThinProfilePanel
                status={status}
                verifiedCount={verifiedFees.length}
                correctSourceHref={links.correctSourceHref}
                claimHref={links.claimHref}
              />
            )}

            <section aria-labelledby="all-fees-heading" className="space-y-4">
              <h2 id="all-fees-heading" className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">
                {displayFees.length > 0 ? `Every fee on its schedule` : "Fees"}
              </h2>
              <div className="overflow-hidden rounded-xl border border-border bg-surface-0 shadow-fi-1">
                {displayFees.length > 0 ? (
                  <>
                    {focusFeeCategory && <FeeFocusScroll category={focusFeeCategory} />}
                    <FeeScheduleTable
                      fees={displayFees}
                      disclosureUrl={inst.fee_schedule_url}
                      focusCategory={focusFeeCategory}
                      medians={nationalMedians}
                      stateMedians={stateMedians}
                      benchmarks={feeBenchmarks}
                    />
                  </>
                ) : (
                  <p className="px-4 py-8 text-sm text-ink-muted sm:px-5">
                    {underReviewCount > 0
                      ? "Fees for this institution are under review and will appear here once review is complete."
                      : "No published fee schedule found yet."}
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>

        {showHamiltonBand && (
          <HamiltonBand
            institutionName={inst.institution_name}
            rows={headlineRows.slice(0, HAMILTON_ROWS_SHOWN)}
            marketLabel={marketLabel}
            stateLabel={stateHasBands ? stateName : null}
            plansHref={links.plansHref}
            reportOfferHref={links.reportOfferHref}
          />
        )}

        <div className="mx-auto max-w-6xl space-y-10 px-4 py-10 sm:space-y-14 sm:px-6 sm:py-14">
          {isPro && !thinProfile && (
            <InstitutionOfferBand
              institutionName={inst.institution_name}
              reportOfferHref={links.reportOfferHref}
              plansHref={links.plansHref}
              correctSourceHref={links.correctSourceHref}
              isPro
            />
          )}

          {(isPro
            ? financialSeries.length > 0 || Boolean(footprint || complaints || holdingCompany || regulatoryWatch)
            : latestFinancial !== null) && (
            <FinancialProfileSection
              isPro={isPro}
              points={financialSeries}
              peers={peerMedianPoints}
              insights={insights}
              charterLabel={charterLabel}
              footprint={footprint}
              complaints={complaints}
              holdingCompany={holdingCompany}
              enforcement={enforcement}
              regulatoryWatch={regulatoryWatch}
              exportHref={`/api/v1/institutions?id=${instId}&view=benchmark&format=csv`}
              institutionName={inst.institution_name}
              plansHref={links.plansHref}
              freeQuarters={normalizedFinancials}
            />
          )}

          <FeeAlertControl
            institutionId={instId}
            institutionName={inst.institution_name}
            focusCategory={focusFeeCategory}
            categoryLabels={alertCategoryLabels}
            mode={thinProfile ? "verify" : "alerts"}
            initial={{
              signedIn: Boolean(user),
              saved: alertSubscription !== null,
              feeCategories: alertSubscription?.fee_categories ?? null,
            }}
          />

          <ProfileFootnote
            regulatorFacts={regulatorFacts}
            correctSourceHref={links.correctSourceHref}
            financialsAsOf={financialsAsOf}
          />
        </div>
      </div>

      <InstitutionJsonLd
        institutionId={instId}
        institutionName={inst.institution_name}
        city={city}
        stateCode={inst.state_code}
      />
    </>
  );
}
