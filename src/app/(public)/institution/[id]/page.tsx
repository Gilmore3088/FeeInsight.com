export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
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
import { PAGE_CRUMBS, PAGE_H1, PAGE_HEADER } from "@/components/public/page-header";
import { getAlertSubscriptionForInstitution } from "@/lib/data-store/alerts";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { FeeAlertControl } from "./fee-alert-control";
import { PeerRankTeaser } from "./peer-rank-teaser";
import { getComparableMarketIndexCached, getInstitutionPeerSetsCached } from "@/lib/data-store/public-cached-reads";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { buildPublicInstitutionProfileLinks } from "@/lib/institution-profile-links";
import { formatAbsoluteDate } from "@/lib/public-stats";
import { formatCompactDollars } from "@/lib/format";
import { getCharterLabel, getSegmentLabel, toTitleCase } from "./enum-labels";
import { FeeFocusScroll } from "./fee-focus-scroll";
import {
  FeeScheduleTable,
  countPositions,
  groupFeesByFamily,
  splitFeesByAudience,
  type DisplayFee,
  type FeeBenchmarks,
} from "./fee-schedule-table";
import { ShowAll } from "./show-all";
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
import { MIN_VERIFIED_FEES_FOR_OFFER } from "./profile-copy";
import {
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
import { InstitutionJsonLd } from "./profile-jsonld";
import { ProfileFootnote } from "./profile-footnote";
import { HamiltonBand, type HamiltonInsight } from "./hamilton-band";
import { CompareTable } from "./compare-table";
import {
  compareCounts,
  compareFinding,
  compareRows,
  heroFinding,
  leadRow,
  orderRows,
  positionFinding,
  scheduleState,
} from "./profile-view";
import { ComparisonBars, type ComparisonBar } from "../../fees/city/[state]/[city]/comparison-bars";

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
/** fdic and ncua can both carry the same quarter; fetch enough rows to dedupe. */
const FINANCIAL_SOURCES_PER_QUARTER = 2;

const H2 = "text-center text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-left sm:text-[28px]";
const FINDING = "mx-auto mt-2 max-w-3xl text-center text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left";
const SOURCE = "mt-3 text-center text-[12px] leading-relaxed text-ink-muted sm:mx-0 sm:max-w-none sm:text-left";
const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

function fallbackTo<T>(label: string, fallback: T) {
  return (error: unknown): T => {
    console.error(`Institution page ${label} failed:`, error);
    return fallback;
  };
}

const count = (n: number) => n.toLocaleString("en-US");

/** Schedule rows shown before "Show all". */
const SCHEDULE_ROWS = 5;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const instId = parseInt(id, 10);
  // notFound() here, before the page streams, so a missing institution answers 404, not 200.
  if (Number.isNaN(instId)) notFound();

  const inst = await getPublicInstitutionForPage(instId);
  if (!inst) notFound();

  const fees = Number(inst.fee_count ?? 0) > 0 ? await getVisibleFeesForPage(instId) : [];
  const verifiedFees = fees.filter(isVerifiedFee);
  // The title quotes the same values as the comparison table (the index's own rule), so a tab or
  // search result never shows a different amount from the page.
  // A fee with several prices has no single price to put in a title (the shared rule), except
  // overdraft, whose compared value is its standard fee, a real price on its schedule.
  const valueOf = (category: string) => {
    const v = pickHeadlineValues(verifiedFees, [category])[0];
    if (!v) return null;
    return v.low === v.high ? v.amount : category === "overdraft" ? v.high : null;
  };
  const headline = { overdraft: valueOf("overdraft"), nsf: valueOf("nsf"), monthly: valueOf("monthly_maintenance") };
  const city = toTitleCase(inst.city);
  const place = [city, inst.state_code].filter(Boolean).join(", ");
  const stateName = inst.state_code ? STATE_NAMES[inst.state_code] : null;
  const kind = inst.charter_type === "bank" ? "bank" : "credit union";

  return {
    // Thin profiles (fewer verified fees than the page's own thin threshold), including those
    // with financial data but no fees (decision D20), stay reachable but out of the index.
    robots: verifiedFees.length < MIN_VERIFIED_FEES_FOR_OFFER ? { index: false, follow: true } : undefined,
    // The ?peers= and ?fee= views are the same page; only the bare address indexes.
    alternates: { canonical: `/institution/${instId}` },
    title: buildProfileTitle(inst.institution_name, headline),
    description: `${inst.institution_name}${place ? `, a ${kind} based in ${place}` : ""}: ${
      verifiedFees.length > 0 ? `${verifiedFees.length} published fees` : "published fees"
    } from its own fee schedule, each beside the ${stateName ? `${stateName}, ` : ""}Fed district and U.S. medians from ${SITE_NAME}.`,
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
  const shouldLoadPipelineEvidence =
    catalogVisibleFeeCount === 0 &&
    Boolean(inst.fee_schedule_url || inst.latest_source_status || (inst.latest_extracted_fee_count ?? 0) > 0);

  const [visibleFees, rateFees, evidence, financials, user, peerSets] = await Promise.all([
    catalogVisibleFeeCount > 0 ? getVisibleFeesForPage(instId) : Promise.resolve([]),
    getRateFeesForPage(instId),
    shouldLoadPipelineEvidence
      ? getInstitutionFeeScheduleEvidence(instId).catch(fallbackTo("fee evidence", null))
      : Promise.resolve(null),
    getFinancialsByInstitution(instId, FINANCIAL_HISTORY_QUARTERS * FINANCIAL_SOURCES_PER_QUARTER).catch(
      fallbackTo("financial context", []),
    ),
    getCurrentUser().catch(() => null),
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
  const underReviewCount = Math.max(
    inst.provisional_fee_count ?? 0,
    visibleFees.length - verifiedFees.length,
    pipelineUnderReview,
  );

  // Three medians, each built under exactly the eligibility rules this page applies to the
  // institution's own fees (market-eligibility.ts): the state's (banks and credit unions
  // headquartered in it), the institution's Fed district's, and the U.S. A business-only fee, or a
  // CD/IRA, card inactivity or safe deposit service fee filed under another category, is left out
  // of both sides alike.
  const stateCode = inst.state_code && STATE_NAMES[inst.state_code] ? inst.state_code : null;
  const district = inst.fed_district && DISTRICT_NAMES[inst.fed_district] ? inst.fed_district : null;
  const hasFees = verifiedFees.length > 0;
  const [nationalIndex, stateIndex, districtIndex] = hasFees
    ? await Promise.all([
        getComparableMarketIndexCached({ kind: "us" }).catch(fallbackTo("national index", [] as IndexEntry[])),
        stateCode
          ? getComparableMarketIndexCached({ kind: "state", code: stateCode }).catch(fallbackTo("state index", [] as IndexEntry[]))
          : Promise.resolve([] as IndexEntry[]),
        district
          ? getComparableMarketIndexCached({ kind: "district", district }).catch(fallbackTo("district index", [] as IndexEntry[]))
          : Promise.resolve([] as IndexEntry[]),
      ])
    : [[] as IndexEntry[], [] as IndexEntry[], [] as IndexEntry[]];

  const usable = (entry: IndexEntry) => entry.median_amount != null && entry.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN;
  const feeBenchmarks: FeeBenchmarks = {};
  for (const entry of nationalIndex) {
    if (!usable(entry) || entry.p25_amount == null || entry.p75_amount == null) continue;
    feeBenchmarks[entry.fee_category] = { p25: entry.p25_amount, median: entry.median_amount as number, p75: entry.p75_amount };
  }
  const stateName = stateCode ? STATE_NAMES[stateCode] : null;

  const sparse = verifiedFees.length < MIN_VERIFIED_FEES_FOR_OFFER;
  const schedule = scheduleState({ publishedFees: verifiedFees.length, hasSchedule: Boolean(inst.fee_schedule_url) });
  const categories = [...new Set(verifiedFees.map((fee) => fee.fee_category).filter((c): c is string => Boolean(c)))];
  const rawRows = compareRows(
    pickHeadlineValues(verifiedFees, categories),
    { state: stateIndex, district: districtIndex, us: nationalIndex },
    schedule,
    inst.fee_schedule_url ?? null,
  );
  const lead = sparse ? null : leadRow(rawRows, HEADLINE_FEE_KEYS);
  // The hero's lead fee is the table's first row, so the reader finds it where the page started.
  const rows = orderRows(rawRows, HEADLINE_FEE_KEYS, lead?.key ?? null);
  const published = rows.filter((row) => row.amount != null);
  const counts = compareCounts(rows);
  // Counted as the fee list shows them: one row per name and amount, personal apart from
  // business-only, so the hero's count is the count a reader sees in the list.
  const rowCount = (fees: DisplayFee[]) => groupFeesByFamily(fees).reduce((n, group) => n + group.rows.length, 0);
  const publishedDisplay = displayFees.filter((fee) => fee.status === "verified");
  const audience = splitFeesByAudience(publishedDisplay);
  const personalRows = rowCount(audience ? audience.personal : publishedDisplay);
  const businessOnlyRows = audience ? rowCount(audience.business.filter((fee) => fee.feeAudience === "business")) : 0;
  const publishedRows = rowCount(publishedDisplay);
  const reviewRows = rowCount(displayFees) - publishedRows;
  const scheduleRowCount = rowCount(displayFees);
  const positionLine = positionFinding(countPositions(displayFees, feeBenchmarks));
  const finding = heroFinding({
    rows,
    name: inst.institution_name,
    headline: HEADLINE_FEE_KEYS,
    stateName,
    sparse,
    publishedCount: personalRows,
    businessCount: businessOnlyRows,
    schedule,
    underReview: underReviewCount,
  });

  // One row per quarter, one source; the Hamilton band and the footnote share the same figure.
  const normalizedFinancials = selectFinancialsByQuarter(financials).slice(0, FINANCIAL_HISTORY_QUARTERS);
  const latestFinancial = normalizedFinancials[0] ?? null;
  const financialsAsOf = latestFinancial ? formatReportQuarter(latestFinancial.reportDate) : null;
  const assetsDollars = latestFinancial?.totalAssets ?? assetSizeToDollars(inst.asset_size);

  const city = toTitleCase(inst.city);
  const charterLabel = getCharterLabel(inst.charter_type);
  const kind = inst.charter_type === "bank" ? "bank" : "credit union";
  const districtName = district ? DISTRICT_NAMES[district] : null;
  const segmentLabel = getSegmentLabel(inst.asset_size_tier, inst.charter_type);
  const collectedOn = formatAbsoluteDate(inst.latest_source_collected_at ?? null);
  const links = buildPublicInstitutionProfileLinks({
    institutionId: instId,
    institutionName: inst.institution_name,
    isAuthenticated: Boolean(user),
  });

  const facts: Array<{ label: string; value: React.ReactNode }> = [{ label: "Charter", value: charterLabel }];
  if (city || stateName) {
    facts.push({
      label: "Headquarters",
      value: (
        <>
          {city}
          {city && stateName ? ", " : ""}
          {stateName && stateCode && (
            <Link href={`/research/state/${stateCode}`} className={LINK}>
              {stateName}
            </Link>
          )}
        </>
      ),
    });
  }
  if (districtName && district) {
    facts.push({
      label: "Fed district",
      value: (
        <Link href={`/research/district/${district}`} className={LINK}>
          {districtName}
        </Link>
      ),
    });
  }
  if (assetsDollars) facts.push({ label: "Total assets", value: formatCompactDollars(assetsDollars) });
  else if (segmentLabel) facts.push({ label: "Size", value: segmentLabel });
  if (regulator?.primary_regulator) facts.push({ label: "Regulator", value: regulator.primary_regulator });
  if (regulator?.holding_company_name) {
    facts.push({ label: "Holding company", value: toTitleCase(regulator.holding_company_name) ?? regulator.holding_company_name });
  }
  if (regulator?.regulatory_status === "inactive") {
    facts.push({ label: "Status", value: regulator.closed_date ? `Closed or merged ${regulator.closed_date}` : "Closed or merged" });
  }

  // The hero's exhibit: the lead fee beside the medians it is read against.
  // The bar's name carries the place; the line under it says whose median it is (one wording site-wide).
  const publishSample = (n: number) => `Median of ${count(n)} banks and credit unions that publish this fee`;
  const tooFew = `Too few for a median (${MIN_INSTITUTIONS_FOR_MEDIAN} needed)`;
  const leadBars: ComparisonBar[] | null =
    lead && lead.amount != null
      ? [
          {
            name: inst.institution_name,
            // Several prices: the bar is the compared value, labeled in the shared rule's words.
            sample: lead.comparedAt ?? "Its published fee",
            value: lead.amount,
          },
          ...(stateName
            ? [
                {
                  name: stateName,
                  sample: lead.state
                    ? publishSample(lead.state.institutions)
                    : "Banks and credit unions that publish this fee",
                  value: lead.state?.median ?? null,
                  missing: tooFew,
                },
              ]
            : []),
          ...(districtName
            ? [
                {
                  name: `${districtName} district`,
                  sample: lead.district
                    ? publishSample(lead.district.institutions)
                    : "Banks and credit unions that publish this fee",
                  value: lead.district?.median ?? null,
                  missing: tooFew,
                },
              ]
            : []),
          {
            name: "U.S.",
            sample: lead.us ? publishSample(lead.us.institutions) : "Banks and credit unions that publish this fee",
            value: lead.us?.median ?? null,
          },
        ]
      : null;
  // Phones show three bars (it, its state, the U.S.); the district bar waits for wider screens.
  const phoneBars = leadBars?.filter((bar) => !bar.name.endsWith(" district")) ?? null;
  const shortFacts = [charterLabel, [city, stateCode].filter(Boolean).join(", "), assetsDollars ? `${formatCompactDollars(assetsDollars)} in assets` : segmentLabel]
    .filter((part): part is string => Boolean(part))
    .join(" \u00b7 ");

  const showHamiltonBand = !isPro && !sparse && published.length > 0;
  // The one Hamilton finding shown free: its fee-income share against the peer median from the
  // same quarter's call reports (a Pro visitor already has the full financial profile).
  const [freePeerMedians, sampleLive] = await Promise.all([
    showHamiltonBand && latestFinancial
      ? getPeerFinancialMedians(instId).catch(fallbackTo("peer medians", null))
      : Promise.resolve(null),
    showHamiltonBand || (sparse && !isPro) ? sampleReportAvailable().catch(() => false) : Promise.resolve(false),
  ]);
  const sampleHref = sampleLive ? "/reports/sample-competitive-fee-position" : null;
  const hamiltonInsight: HamiltonInsight | null =
    showHamiltonBand && normalizedFinancials.length > 0
      ? {
          quarters: normalizedFinancials,
          ownSharePct: latestFinancial?.feeIncomeRatioPct ?? null,
          peerSharePct: freePeerMedians?.fee_income_ratio != null ? freePeerMedians.fee_income_ratio * 100 : null,
          peerCount: freePeerMedians?.fee_income_peer_count ?? null,
          filerCount: freePeerMedians?.peer_count ?? null,
          sizeRange: segmentLabel?.split(", ")[1] ?? null,
          kind,
        }
      : null;

  const scheduleLink = inst.fee_schedule_url ? (
    <a href={inst.fee_schedule_url} target="_blank" rel="noopener noreferrer" className={LINK}>
      its fee schedule
    </a>
  ) : (
    "its fee schedule"
  );
  const places = [stateName, districtName ? `the ${districtName} district` : null, "the U.S."].filter((p): p is string => Boolean(p));
  const medianPlaces = places.length > 1 ? `${places.slice(0, -1).join(", ")} and ${places[places.length - 1]}` : places.join("");
  const scheduleAll = Boolean(focusFeeCategory) || sparse;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Institutions", href: "/institutions" },
          { name: inst.institution_name, href: `/institution/${instId}` },
        ]}
      />

      <div className="bg-paper text-ink">
        {/* 1. Who it is, and the one finding the page leads with. */}
        <section className="border-b border-border">
          <div
            className={`mx-auto max-w-page px-4 pb-10 pt-6 sm:px-6 sm:pb-12 sm:pt-10 ${
              leadBars ? "lg:grid lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-start lg:gap-16" : ""
            }`}
          >
            <div className={PAGE_HEADER}>
              <nav aria-label="Breadcrumb" className={PAGE_CRUMBS}>
                <Link href="/institutions" className="inline-flex min-h-11 items-center hover:text-ink">
                  Institutions
                </Link>
                {stateName && stateCode && (
                  <>
                    <span aria-hidden="true">/</span>
                    <Link href={`/research/state/${stateCode}`} className="inline-flex min-h-11 items-center hover:text-ink">
                      {stateName}
                    </Link>
                  </>
                )}
              </nav>
              <h1 className={`mt-2 break-words ${PAGE_H1}`}>{inst.institution_name}</h1>
              {shortFacts && <p className="mt-3 text-center text-[14px] text-ink-soft sm:hidden">{shortFacts}</p>}
              <dl className="mt-5 hidden grid-cols-2 gap-x-6 gap-y-3 text-left sm:grid sm:grid-cols-3 xl:flex xl:flex-wrap xl:gap-x-10">
                {facts.map((fact) => (
                  <div key={fact.label} className="min-w-0">
                    <dt className="text-[12px] text-ink-muted">{fact.label}</dt>
                    <dd className="mt-0.5 break-words text-[14px] font-medium leading-5 text-ink">{fact.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mx-auto mt-6 max-w-2xl text-[19px] font-semibold leading-snug tracking-[-0.01em] text-ink sm:mx-0 sm:text-left sm:text-[22px]">
                {finding}
              </p>
              <p className={SOURCE}>
                {published.length > 0 ? (
                  <>
                    Source: {scheduleLink}
                    {collectedOn ? `, read ${collectedOn}` : ""}.
                  </>
                ) : (
                  <>
                    Know where its fee schedule is?{" "}
                    <Link href={links.correctSourceHref} className={LINK}>
                      Send the link
                    </Link>
                  </>
                )}
              </p>
            </div>
            {leadBars && lead && (
              <figure className="mt-10 border-t border-border pt-8 text-left lg:mt-2 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0">
                <figcaption className="text-[14px] font-semibold text-ink">{lead.label}</figcaption>
                <div className="mt-4 sm:hidden">
                  <ComparisonBars bars={phoneBars ?? leadBars} />
                </div>
                <div className="mt-4 hidden sm:block">
                  <ComparisonBars bars={leadBars} />
                </div>
              </figure>
            )}
          </div>
        </section>

        <div className="mx-auto max-w-page space-y-14 px-4 pb-16 pt-12 sm:space-y-16 sm:px-6 sm:pt-16">
          {/* 2. Every published fee beside the state, district and U.S. medians. */}
          {published.length > 0 && (
            <section aria-labelledby="compare-heading" className="scroll-mt-20">
              <h2 id="compare-heading" className={H2}>
                Fees against the market
              </h2>
              {!sparse && counts && <p className={FINDING}>{compareFinding(counts, stateName)}</p>}
              <div className="mt-5">
                <CompareTable rows={rows} stateName={stateName} stateCode={stateCode} districtName={districtName} />
              </div>
              <p className={SOURCE}>
                Source: each amount links to the fee schedule it was read from. Medians for {medianPlaces}: {PRODUCT_NAME} published
                fees, shown where at least {MIN_INSTITUTIONS_FOR_MEDIAN} institutions publish the fee.
              </p>
              <details className="group/how mt-1">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-[13px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true" className="transition-transform group-open/how:rotate-90">
                    &rsaquo;
                  </span>
                  How the comparison is made
                </summary>
                <dl className="mt-2 grid max-w-3xl gap-x-4 gap-y-1 text-[12px] leading-snug text-ink-muted sm:grid-cols-[auto_minmax(0,1fr)]">
                  <dt className="font-medium text-ink-soft">Compared at</dt>
                  <dd>
                    The value this page compares: its one price, or the middle of its prices when it lists several (the highest,
                    its standard fee, for overdraft).
                  </dd>
                  <dt className="font-medium text-ink-soft">Same rules</dt>
                  <dd>
                    Its fees and every median use the same rules. Business-only fees are left out. So are CD, IRA, card
                    inactivity, box drilling and key fees filed under a fee they don&rsquo;t match.
                  </dd>
                  {stateName && (
                    <>
                      <dt className="font-medium text-ink-soft">{stateName}</dt>
                      <dd>
                        Banks and credit unions headquartered in {stateName} that publish the fee.
                      </dd>
                    </>
                  )}
                  {districtName && (
                    <>
                      <dt className="font-medium text-ink-soft">{districtName} district</dt>
                      <dd>
                        Banks and credit unions headquartered in the {districtName} Fed district that publish the fee.
                      </dd>
                    </>
                  )}
                  <dt className="font-medium text-ink-soft">U.S.</dt>
                  <dd>Banks and credit unions across the {PRODUCT_NAME} that publish the fee.</dd>
                  <dt className="font-medium text-ink-soft">About the same</dt>
                  <dd>Within 1% of the median.</dd>
                  <dt className="font-medium text-ink-soft">Account</dt>
                  <dd>Fees not tied to a named account apply across its personal accounts.</dd>
                </dl>
              </details>
            </section>
          )}

          {/* Overdraft and maintenance against a peer group the visitor picks. */}
          {!sparse && peerSets && <PeerRankTeaser sets={peerSets} hrefFor={peerSetHref} />}

          {/* The fee position beside its call-report context: the band a visitor sees right after the comparison. */}
          {showHamiltonBand && (
            <HamiltonBand
              institutionName={inst.institution_name}
              insight={hamiltonInsight}
              plansHref={links.plansHref}
              reportOfferHref={links.reportOfferHref}
              sampleReportHref={sampleHref}
            />
          )}

          {/* 3. The whole schedule, grouped by type. */}
          {displayFees.length > 0 && (
            <section aria-labelledby="schedule-heading">
              <h2 id="schedule-heading" className={H2}>
                {published.length > 0 ? "Every published fee" : "Fees under review"}
              </h2>
              <p className={FINDING}>
                {published.length > 0
                  ? (positionLine ??
                    `${count(publishedRows)} published ${publishedRows === 1 ? "fee" : "fees"}${reviewRows > 0 ? ` and ${count(reviewRows)} under review` : ""} from its schedule, grouped by type.`)
                  : "They stay out of every comparison until review is done."}
              </p>
              <div className="mt-5">
                <ShowAll total={scheduleRowCount} shown={SCHEDULE_ROWS} initialAll={scheduleAll}>
                  <div className="overflow-hidden rounded-2xl border border-border bg-surface-0">
                    {focusFeeCategory && <FeeFocusScroll category={focusFeeCategory} />}
                    <FeeScheduleTable
                      fees={displayFees}
                      disclosureUrl={inst.fee_schedule_url}
                      focusCategory={focusFeeCategory}
                      benchmarks={feeBenchmarks}
                      limit={scheduleAll ? Number.POSITIVE_INFINITY : SCHEDULE_ROWS}
                    />
                  </div>
                </ShowAll>
              </div>
              <p className={SOURCE}>
                Source: each amount links to {scheduleLink}
                {collectedOn ? `, read ${collectedOn}` : ""}. Position: the U.S. middle 50% of {PRODUCT_NAME} published fees.
              </p>
            </section>
          )}

          {isPro && !sparse && (
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
            mode={sparse ? "verify" : "alerts"}
            initial={{
              signedIn: Boolean(user),
              saved: alertSubscription !== null,
              feeCategories: alertSubscription?.fee_categories ?? null,
            }}
          />

          {sparse && !isPro && sampleHref && (
            <p className="-mt-8 text-center text-[14px] text-ink-soft sm:-mt-10 sm:text-left">
              <Link href={sampleHref} className={`inline-flex min-h-11 items-center ${LINK}`}>
                See what a free sample Competitive Fee Position Report shows
              </Link>
            </p>
          )}

          <ProfileFootnote
            correctSourceHref={links.correctSourceHref}
            claimHref={links.claimHref}
            websiteUrl={inst.website_url}
            financialsAsOf={financialsAsOf}
            financialsSource={latestFinancial?.source === "ncua" ? "NCUA" : "FDIC"}
          />
        </div>
      </div>

      <InstitutionJsonLd
        institutionId={instId}
        institutionName={inst.institution_name}
        city={city}
        stateCode={inst.state_code}
        dateModified={inst.latest_source_collected_at ?? null}
      />
    </>
  );
}
