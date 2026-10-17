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
import { PeerRankTeaser, peerGroupLabel } from "./peer-rank-teaser";
import { getInstitutionPeerRankCached, getInstitutionPeerSetsCached, getPeerIndexCached } from "@/lib/data-store/public-cached-reads";
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
import Link from "next/link";
import { MIN_VERIFIED_FEES_FOR_OFFER } from "./profile-copy";
import {
  buildLocationParts,
  buildProfileTitle,
  getPublicInstitutionForPage,
  getRateFeesForPage,
  getVisibleFeesForPage,
  isVerifiedFee,
  pickHeadlineValues,
  toDisplayFees,
  toPipelineDisplayFees,
  toRateDisplayFees,
} from "./profile-data";
import { ProfileHeader } from "./profile-header";
import { InstitutionJsonLd } from "./profile-jsonld";
import { ProfileFootnote } from "./profile-footnote";
import { HamiltonBand, type HamiltonInsight } from "./hamilton-band";
import { HeadlineTable, type HeadlineRow, type MarketBand } from "./market-position";
import { buildFindings } from "./findings";
import { FindingsSection } from "./findings-section";
import { StatusNotice } from "./status-notice";
import { ThinProfilePanel } from "./thin-profile-panel";

interface PageProps {
  params: Promise<{ id: string }>;
  /**
   * `fee`: the category a consumer guide sent the reader to compare; highlights that row.
   * `peers`: the peer set the "Against peers" section compares with (state, district, size,
   * regulator, metro, nearest) beyond the report rule's group; absent, the first that clears the floor.
   */
  searchParams?: Promise<{ fee?: string; peers?: string }>;
}

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());

const FINANCIAL_HISTORY_QUARTERS = 4;
/** Headline fees drawn in full on the page, and the few the Hamilton picture repeats. */
const HEADLINE_ROWS_SHOWN = 6;
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
  // The title quotes the same values as the headline cards (the index's own rule), so a tab or
  // search result never shows a different amount from the page.
  const valueOf = (category: string) =>
    pickHeadlineValues(verifiedFees, [category])[0]?.amount ?? null;
  const headline = { overdraft: valueOf("overdraft"), nsf: valueOf("nsf"), monthly: valueOf("monthly_maintenance") };
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
  const query = (await searchParams) ?? {};
  const requestedFee = query.fee ?? "";
  const requestedPeers = typeof query.peers === "string" ? query.peers : null;
  const focusFeeCategory = TAXONOMY.has(requestedFee) ? requestedFee : null;

  const inst = await getPublicInstitutionForPage(instId);
  if (!inst) notFound();

  const catalogVisibleFeeCount = Number(inst.fee_count ?? 0);
  const status: FeePublicationStatus = inst.fee_publication_status ?? "unavailable";
  const shouldLoadPipelineEvidence =
    catalogVisibleFeeCount === 0 &&
    Boolean(inst.fee_schedule_url || inst.latest_source_status || (inst.latest_extracted_fee_count ?? 0) > 0);

  const [visibleFees, rateFees, evidence, financials, user, peerRank, peerSets] = await Promise.all([
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
    getInstitutionPeerSetsCached(instId, requestedPeers).catch(fallbackTo("peer sets", null)),
  ]);
  const peerSetHref = (key: string) => {
    const params = new URLSearchParams({ ...(focusFeeCategory ? { fee: focusFeeCategory } : {}), peers: key });
    return `/institution/${instId}?${params.toString()}#peers`;
  };

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
  // Home-state medians for its own charter (Texas banks, Florida credit unions), under the same
  // "enough institutions" rule, so the label names exactly the market the numbers come from.
  const kind = inst.charter_type === "credit_union" ? "credit union" : "bank";
  const stateIndex =
    verifiedFees.length > 0 && inst.state_code
      ? await getPeerIndexCached({ state_code: inst.state_code, charter_type: inst.charter_type }).catch(
          fallbackTo("state index", []),
        )
      : [];
  const stateMedians: StateMedians | undefined =
    stateIndex.length > 0 && inst.state_code && STATE_NAMES[inst.state_code]
      ? {
          place: `${STATE_NAMES[inst.state_code]} ${kind}`,
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
  const headlineRows: HeadlineRow[] = pickHeadlineValues(verifiedFees, HEADLINE_FEE_KEYS)
    .map((value) => ({
      category: value.category,
      label: getDisplayName(value.category),
      amount: value.amount,
      spread: value.count > 1 && value.low !== value.high ? { count: value.count, low: value.low, high: value.high } : null,
      sourceUrl: value.sourceUrl ?? inst.fee_schedule_url ?? null,
      state: marketBand(stateByCategory.get(value.category)),
      nation: marketBand(nationalByCategory.get(value.category)),
    }))
    .filter((row) => row.state !== null || row.nation !== null)
    .slice(0, HEADLINE_ROWS_SHOWN);
  const stateHasBands = headlineRows.some((row) => row.state !== null);
  const marketLabel = stateHasBands && stateName ? `${stateName} ${kind === "bank" ? "banks" : "credit unions"}` : "the U.S. market";
  const positionCounts = countPositions(displayFees, feeBenchmarks);
  const showHamiltonBand = !isPro && !thinProfile && headlineRows.length > 0;
  const stateGroup = stateHasBands && stateName ? marketLabel : null;
  const findings = thinProfile
    ? []
    : buildFindings({
        rows: headlineRows,
        stateGroup,
        stateCode: inst.state_code,
        peerRank,
        peerGroup: peerRank ? peerGroupLabel(peerRank) : null,
        positionCounts,
      });
  // The one Hamilton finding shown free: its fee-income share against the peer median from the
  // same quarter's call reports (a Pro visitor already has the full financial profile).
  const freePeerMedians =
    showHamiltonBand && latestFinancial ? await getPeerFinancialMedians(instId).catch(fallbackTo("peer medians", null)) : null;
  const hamiltonInsight: HamiltonInsight | null =
    showHamiltonBand && normalizedFinancials.length > 0
      ? {
          quarters: normalizedFinancials,
          ownSharePct: latestFinancial?.feeIncomeRatioPct ?? null,
          peerSharePct: freePeerMedians?.fee_income_ratio != null ? freePeerMedians.fee_income_ratio * 100 : null,
          peerCount: freePeerMedians?.fee_income_peer_count ?? null,
          sizeRange: segmentLabel?.split(", ")[1] ?? null,
          kind,
        }
      : null;

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
            assetsLabel={assetsDollars ? formatCompactDollars(assetsDollars) : null}
            regulatorFacts={regulatorFacts}
          />

          <StatusNotice
            status={status}
            needsSource={needsSource}
            correctSourceHref={links.correctSourceHref}
            claimHref={links.claimHref}
          />

          <div className="space-y-8 sm:space-y-10">
            <FindingsSection findings={findings} asOf={null} kind={kind} />

            <HeadlineTable
              rows={headlineRows}
              stateCode={stateHasBands ? inst.state_code : null}
              stateLabel={stateHasBands ? marketLabel : null}
            />

            {!thinProfile && peerSets && <PeerRankTeaser sets={peerSets} hrefFor={peerSetHref} />}

            {thinProfile && (
              <ThinProfilePanel
                status={status}
                verifiedCount={verifiedFees.length}
                correctSourceHref={links.correctSourceHref}
                claimHref={links.claimHref}
              />
            )}

            {displayFees.length > 0 ? (
              <details
                open={Boolean(focusFeeCategory) || headlineRows.length === 0}
                className="group overflow-hidden rounded-xl border border-border bg-surface-0 shadow-fi-1"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 sm:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="text-[15px] font-semibold text-ink">
                    All {displayFees.length} fees on its schedule, with sources
                  </span>
                  <span aria-hidden="true" className="text-ink-muted transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <div className="border-t border-border">
                  {focusFeeCategory && <FeeFocusScroll category={focusFeeCategory} />}
                  <FeeScheduleTable
                    fees={displayFees}
                    disclosureUrl={inst.fee_schedule_url}
                    focusCategory={focusFeeCategory}
                    medians={nationalMedians}
                    stateMedians={stateMedians}
                    benchmarks={feeBenchmarks}
                  />
                </div>
              </details>
            ) : (
              <p className="rounded-xl border border-border bg-surface-0 px-4 py-8 text-sm text-ink-muted sm:px-5">
                {underReviewCount > 0
                  ? "Fees are under review. They appear here once review is done."
                  : "No published fee schedule yet. Comparisons start once a schedule is reviewed."}
              </p>
            )}

            {showHamiltonBand && (
              <HamiltonBand
                institutionName={inst.institution_name}
                insight={hamiltonInsight}
                plansHref={links.plansHref}
                reportOfferHref={links.reportOfferHref}
              />
            )}

            {isPro && !thinProfile && (
              <Link href={links.analyzeHref} className="fi-btn fi-btn-primary">
                Open {inst.institution_name} in Hamilton
              </Link>
            )}

            {isPro && (financialSeries.length > 0 || Boolean(footprint || complaints || holdingCompany || regulatoryWatch)) && (
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
              correctSourceHref={links.correctSourceHref}
              financialsAsOf={financialsAsOf}
              financialsSource={latestFinancial?.source === "ncua" ? "NCUA" : "FDIC"}
            />
          </div>
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
