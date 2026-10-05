export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFinancialsByInstitution } from "@/lib/data-store";
import { getFinancialHistory, getPeerFinancialMedians } from "@/lib/data-store/financial";
import {
  getBranchFootprint,
  getComplaintTrend,
  getHoldingCompanyProfile,
  getRegulatorInfo,
} from "@/lib/data-store/registry-profile";
import { canAccessPremium } from "@/lib/access";
import { getInstitutionFeeScheduleEvidence } from "@/lib/data-store/institution";
import { getCurrentUser } from "@/lib/auth";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { getAlertSubscriptionForInstitution } from "@/lib/data-store/alerts";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { FeeAlertControl } from "./fee-alert-control";
import { InfoTip } from "@/components/public/info-tip";
import { SITE_NAME } from "@/lib/constants";
import { computeInstitutionRating, generateInterpretation } from "@/lib/institution-rating";
import type { FeePublicationStatus } from "@/lib/institution-quality";
import { buildPublicInstitutionProfileLinks } from "@/lib/institution-profile-links";
import { formatAbsoluteDate, getPublicNationalIndex } from "@/lib/public-stats";
import { getCharterLabel, getSegmentLabel, toTitleCase } from "./enum-labels";
import { FeeFocusScroll } from "./fee-focus-scroll";
import { FeeScheduleTable, type FeeBenchmarks } from "./fee-schedule-table";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { FinancialContext } from "./financial-context";
import { buildFinancialSeries, toPeerMedianPoints } from "./financial-history";
import { FinancialProfileSection } from "./financial-profile-section";
import { assetSizeToDollars, formatReportQuarter, selectFinancialsByQuarter } from "./financial-units";
import { InstitutionMetricRow, InstitutionOfferBand } from "./institution-metrics";
import { MIN_VERIFIED_FEES_FOR_NARRATIVE, MIN_VERIFIED_FEES_FOR_OFFER } from "./profile-copy";
import {
  buildProfileTitle,
  getPublicInstitutionForPage,
  getVisibleFeesForPage,
  isVerifiedFee,
  pickHeadlineFees,
  toDisplayFees,
  toPipelineDisplayFees,
} from "./profile-data";
import { ProfileHeader } from "./profile-header";
import { InstitutionJsonLd } from "./profile-jsonld";
import { ProfileSidebar } from "./profile-sidebar";
import { FeeProfileSummary, StatusNotice } from "./status-notice";
import { ThinProfilePanel } from "./thin-profile-panel";

interface PageProps {
  params: Promise<{ id: string }>;
  /** `fee`: the category a consumer guide sent the reader to compare; highlights that row. */
  searchParams?: Promise<{ fee?: string }>;
}

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());

const FINANCIAL_HISTORY_QUARTERS = 4;
/** Up to three call-report sources can carry the same quarter; fetch enough rows to dedupe. */
const FINANCIAL_SOURCES_PER_QUARTER = 3;

function fallbackTo<T>(label: string, fallback: T) {
  return (error: unknown): T => {
    console.error(`Institution page ${label} failed:`, error);
    return fallback;
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const instId = parseInt(id, 10);
  if (Number.isNaN(instId)) return { title: "Institution Not Found" };

  const inst = await getPublicInstitutionForPage(instId);
  if (!inst) return { title: "Institution Not Found" };

  const fees = Number(inst.fee_count ?? 0) > 0 ? await getVisibleFeesForPage(instId) : [];
  const verifiedFees = fees.filter(isVerifiedFee);
  const headline = pickHeadlineFees(verifiedFees);
  const city = toTitleCase(inst.city);
  const place = [city, inst.state_code].filter(Boolean).join(", ");
  const stateName = inst.state_code ? STATE_NAMES[inst.state_code] : null;

  return {
    // Thin profiles (no verified fees yet) stay reachable but out of the index.
    robots: verifiedFees.length === 0 ? { index: false, follow: true } : undefined,
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

  const [visibleFees, evidence, financials, user] = await Promise.all([
    catalogVisibleFeeCount > 0 ? getVisibleFeesForPage(instId) : Promise.resolve([]),
    shouldLoadPipelineEvidence
      ? getInstitutionFeeScheduleEvidence(instId).catch(fallbackTo("fee evidence", null))
      : Promise.resolve(null),
    getFinancialsByInstitution(instId, FINANCIAL_HISTORY_QUARTERS * FINANCIAL_SOURCES_PER_QUARTER).catch(
      fallbackTo("financial context", []),
    ),
    getCurrentUser().catch(() => null),
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
  const [financialHistory, peerMedians, footprint, complaints, holdingCompany] = isPro
    ? await Promise.all([
        getFinancialHistory(instId).catch(fallbackTo("financial history", [])),
        getPeerFinancialMedians(instId).catch(fallbackTo("peer medians", null)),
        getBranchFootprint(instId).catch(fallbackTo("branch footprint", null)),
        getComplaintTrend(instId).catch(fallbackTo("complaint trend", null)),
        getHoldingCompanyProfile(instId).catch(fallbackTo("holding company", null)),
      ])
    : [[], null, null, null, null];
  const regulator = await getRegulatorInfo(instId).catch(fallbackTo("regulator info", null));
  const financialSeries = buildFinancialSeries(financialHistory);
  const peerMedianPoints = toPeerMedianPoints(peerMedians);

  const verifiedFees = visibleFees.filter(isVerifiedFee);
  const catalogRows = toDisplayFees(visibleFees);
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
  const rating = verifiedFees.length > 0 ? computeInstitutionRating(verifiedFees, nationalIndex) : null;
  // Medians for the per-row comparison: the same verified-only index the rating uses, and
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
  const enoughForNarrative = verifiedFees.length >= MIN_VERIFIED_FEES_FOR_NARRATIVE;
  const showNarrative = rating !== null && enoughForNarrative;
  const thinProfile = verifiedFees.length < MIN_VERIFIED_FEES_FOR_OFFER;
  const headline = pickHeadlineFees(verifiedFees);
  const interpretation =
    showNarrative && rating
      ? generateInterpretation({
          rating,
          feeCount: verifiedFees.length,
          overdraftAmount: headline.overdraft,
          charterType: inst.charter_type,
        })
      : null;

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

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Institutions", href: "/institutions" },
          { name: inst.institution_name, href: `/institution/${instId}` },
        ]}
      />

      <div className="min-h-screen bg-[#FAF7F2] text-[#1A1815]">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
          <ProfileHeader
            name={inst.institution_name}
            status={status}
            segmentLabel={segmentLabel}
            locationLabel={locationLabel}
            charterLabel={charterLabel}
            districtName={districtName}
            websiteUrl={inst.website_url}
            feeScheduleUrl={inst.fee_schedule_url}
            collectedOn={collectedOn}
            financialsAsOf={financialsAsOf}
          />

          <StatusNotice
            status={status}
            needsSource={needsSource}
            correctSourceHref={links.correctSourceHref}
            claimHref={links.claimHref}
          />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <div className="min-w-0 space-y-6">
              {/* The answer first: what this institution charges. */}
              <section className="border border-[#E0D7C9] bg-white">
                <div className="border-b border-[#E0D7C9] px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-lg font-semibold text-[#1A1815]">Published fees</h2>
                    <InfoTip label="About published fees">
                      Published fees power benchmarks; fees under review do not.
                    </InfoTip>
                  </div>
                </div>

                {displayFees.length > 0 ? (
                  <>
                    {focusFeeCategory && <FeeFocusScroll category={focusFeeCategory} />}
                    <FeeScheduleTable
                      fees={displayFees}
                      disclosureUrl={inst.fee_schedule_url}
                      focusCategory={focusFeeCategory}
                      medians={nationalMedians}
                      benchmarks={feeBenchmarks}
                    />
                  </>
                ) : (
                  <div className="px-4 py-8 sm:px-5">
                    <div className="rounded-lg border border-[#E0D7C9] bg-[#FAF7F2] p-4">
                      <p className="text-sm font-semibold text-[#1A1815]">
                        {underReviewCount > 0
                          ? "Fees for this institution are under review."
                          : "No published schedule found."}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-[#6B6255]">
                        {underReviewCount > 0
                          ? "Fees will appear here once review is complete."
                          : "Fee comparisons are withheld until a published fee schedule has been reviewed."}
                      </p>
                    </div>
                  </div>
                )}
              </section>

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
                secondaryLink={thinProfile ? undefined : { href: links.reportOfferHref, label: "Benchmark it against peers, free" }}
              />

              {/* Public profiles state facts (fee vs. national median), never an adjective verdict — the
                  commissioned report carries the benchmark against a true peer set. */}
              {showNarrative && rating && interpretation && (
                <FeeProfileSummary
                  rating={rating}
                  interpretation={interpretation}
                  overdraftAmount={headline.overdraft}
                  factsOnly
                />
              )}

              <InstitutionMetricRow
                verifiedCount={verifiedCount}
                underReviewCount={underReviewCount}
                assetsDollars={assetsDollars}
              />

              {thinProfile ? (
                <ThinProfilePanel
                  status={status}
                  verifiedCount={verifiedFees.length}
                  correctSourceHref={links.correctSourceHref}
                  claimHref={links.claimHref}
                />
              ) : (
                <InstitutionOfferBand
                  institutionName={inst.institution_name}
                  reportOfferHref={links.reportOfferHref}
                  correctSourceHref={links.correctSourceHref}
                />
              )}

              <FinancialContext latest={latestFinancial} history={normalizedFinancials} />

              {(isPro
                ? financialSeries.length > 0 || Boolean(footprint || complaints || holdingCompany)
                : latestFinancial !== null) && (
                <FinancialProfileSection
                  isPro={isPro}
                  points={financialSeries}
                  peers={peerMedianPoints}
                  charterLabel={charterLabel}
                  footprint={footprint}
                  complaints={complaints}
                  holdingCompany={holdingCompany}
                />
              )}
            </div>

            <ProfileSidebar
              regulatorFacts={regulatorFacts}
              links={links}
              isAuthenticated={Boolean(user)}
              showAddSource={needsSource}
              showProCard={!thinProfile}
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
