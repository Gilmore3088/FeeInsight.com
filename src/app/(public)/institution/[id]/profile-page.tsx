import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { notFound } from "next/navigation";
import { getFinancialsByInstitution } from "@/lib/data-store";
import { getPeerFinancialMedians } from "@/lib/data-store/financial";
import {
  getBranchFootprint,
  getEnforcementRecord,
  getComplaintTrend,
  getHoldingCompanyProfile,
  getRegulatorInfo,
} from "@/lib/data-store/registry-profile";
import { getInstitutionFeeScheduleEvidence } from "@/lib/data-store/institution";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { getComparableMarketIndexCached } from "@/lib/data-store/public-cached-reads";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { buildPublicInstitutionProfileLinks } from "@/lib/institution-profile-links";
import { formatAbsoluteDate } from "@/lib/public-stats";
import { formatCompactDollars } from "@/lib/format";
import { getCharterLabel, getSegmentLabel, toTitleCase } from "./enum-labels";
import { FeeFocusScroll } from "./fee-focus-scroll";
import {
  FeeScheduleTable,
  groupFeesByFamily,
  splitFeesByAudience,
  type DisplayFee,
  type FeeBenchmarks,
} from "./fee-schedule-table";
import { ShowAll } from "./show-all";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { RegistryCards } from "./registry-cards";
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
import { ProfileHero, type HeroFact } from "./profile-hero";
import { SERIF } from "./profile-serif";
import { profileSerif } from "./profile-serif-font";
import { createReadBudget } from "@/lib/read-deadline";
import { degradedMetadata, METADATA_READ_BUDGET_MS, PAGE_READ_BUDGET_MS } from "./profile-budget";
import "./profile.css";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { FeeAlertIsland, FreeOnly, HamiltonLink, ProFinancialProfile, ProOnly } from "./viewer-islands";
import { ProfileFootnote } from "./profile-footnote";
import { HamiltonBand, type HamiltonInsight } from "./hamilton-band";
import { CompareTable } from "./compare-table";
import { ConnectedPanel } from "./connected-panel";
import { buildConnectedPanel } from "./connected-panel-view";
import {
  compareCounts,
  compareRows,
  heroFinding,
  leadRow,
  orderRows,
  scheduleState,
} from "./profile-view";

/**
 * The institution profile, shared by /institution/[id] and its `?fee=` variant
 * (/institution/[id]/fee/[fee], which the proxy rewrites `?fee=` requests to).
 *
 * Both routes are cached (ISR, #1811): a crawler walking hundreds of profiles used to run
 * every read below per request and exhausted the database connections. So nothing here
 * reads the session or the query string; the page is the same for every visitor, and the
 * signed-in, Pro and alert parts are client islands (viewer-islands.tsx) that ask per
 * request after hydration. Pro data is read only there, so it never enters the cached HTML.
 */

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());

/** The `?fee=` focus, validated against the taxonomy: an unknown value is no focus. */
export function focusCategoryFrom(value: string | undefined): string | null {
  return value && TAXONOMY.has(value) ? value : null;
}

/** Plain labels for every taxonomy category, for the alert control's own wording. */
const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  [...TAXONOMY].map((category) => [category, getDisplayName(category).replace(/\s*\([^)]*\)/g, "")]),
);

const FINANCIAL_HISTORY_QUARTERS = 4;
/** fdic and ncua can both carry the same quarter; fetch enough rows to dedupe. */
const FINANCIAL_SOURCES_PER_QUARTER = 2;

const H2 = "text-[36px] font-medium leading-[1.04] tracking-[-0.02em] text-ink sm:text-[54px]";
const FINDING = "mt-3 max-w-3xl text-[16px] leading-relaxed text-ink-soft sm:text-[18px]";
const SOURCE = "mt-3 text-[12px] leading-relaxed text-ink-muted";
const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";


/** Schedule rows shown before "Show all". */
const SCHEDULE_ROWS = 5;

export async function institutionProfileMetadata(id: string): Promise<Metadata> {
  const instId = parseInt(id, 10);
  // notFound() here, before the page streams, so a missing institution answers 404, not 200.
  if (Number.isNaN(instId)) notFound();

  const budget = createReadBudget(METADATA_READ_BUDGET_MS, "Institution metadata");
  let inst: Awaited<ReturnType<typeof getPublicInstitutionForPage>>;
  try {
    inst = await budget.required(getPublicInstitutionForPage(instId), "institution");
  } catch (error) {
    // A slow or failed database must not hold the page: a metadata read that never answers
    // left the stream to be cut at 300 seconds, which the browser showed as "Application error".
    console.error("Institution metadata institution failed:", error);
    await shortenPageLife();
    return degradedMetadata(instId);
  }
  if (!inst) notFound();

  const fees = Number(inst.fee_count ?? 0) > 0 ? await budget.optional(getVisibleFeesForPage(instId), "fees", []) : [];
  if (budget.failed()) await shortenPageLife();
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

export async function InstitutionProfile({ id, focusFeeCategory }: { id: string; focusFeeCategory: string | null }) {
  const instId = parseInt(id, 10);
  if (Number.isNaN(instId)) notFound();

  const budget = createReadBudget(PAGE_READ_BUDGET_MS, "Institution page");
  const inst = await budget.required(getPublicInstitutionForPage(instId), "institution");
  if (!inst) notFound();

  const catalogVisibleFeeCount = Number(inst.fee_count ?? 0);
  const shouldLoadPipelineEvidence =
    catalogVisibleFeeCount === 0 &&
    Boolean(inst.fee_schedule_url || inst.latest_source_status || (inst.latest_extracted_fee_count ?? 0) > 0);

  const [visibleFees, rateFees, evidence, financials] = await Promise.all([
    catalogVisibleFeeCount > 0 ? budget.required(getVisibleFeesForPage(instId), "fees") : Promise.resolve([]),
    budget.required(getRateFeesForPage(instId), "rate fees"),
    shouldLoadPipelineEvidence
      ? budget.optional(getInstitutionFeeScheduleEvidence(instId), "fee evidence", null)
      : Promise.resolve(null),
    budget.optional(
      getFinancialsByInstitution(instId, FINANCIAL_HISTORY_QUARTERS * FINANCIAL_SOURCES_PER_QUARTER),
      "financial context",
      [],
    ),
  ]);

  // Financial history is Pro-only and read per request by ProFinancialProfile, never here: this
  // page is cached for every visitor. The branch footprint, complaints, enforcement and holding
  // company are public records every visitor sees.
  const [footprint, complaints, holdingCompany, enforcement, regulator] = await Promise.all([
    budget.optional(getBranchFootprint(instId), "branch footprint", null),
    budget.optional(getComplaintTrend(instId), "complaint trend", null),
    budget.optional(getHoldingCompanyProfile(instId), "holding company", null),
    budget.optional(getEnforcementRecord(instId), "enforcement actions", null),
    budget.optional(getRegulatorInfo(instId), "regulator info", null),
  ]);

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
        budget.optional(getComparableMarketIndexCached({ kind: "us" }), "national index", [] as IndexEntry[]),
        stateCode
          ? budget.optional(getComparableMarketIndexCached({ kind: "state", code: stateCode }), "state index", [] as IndexEntry[])
          : Promise.resolve([] as IndexEntry[]),
        district
          ? budget.optional(getComparableMarketIndexCached({ kind: "district", district }), "district index", [] as IndexEntry[])
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
  const scheduleRowCount = rowCount(displayFees);
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
  // The signed-out links; the Hamilton links that change for a signed-in reader are islands.
  const links = buildPublicInstitutionProfileLinks({
    institutionId: instId,
    institutionName: inst.institution_name,
    isAuthenticated: false,
  });

  // The hero's details, one labelled cell each: where it is, what it is, how big, who supervises it.
  const holdingName = regulator?.holding_company_name
    ? (toTitleCase(regulator.holding_company_name) ?? regulator.holding_company_name)
    : null;
  const heroFacts: HeroFact[] = [
    { label: "Headquarters", value: [city, stateName].filter(Boolean).join(", ") },
    { label: "Charter", value: charterLabel },
    { label: "Assets", value: assetsDollars ? formatCompactDollars(assetsDollars) : (segmentLabel ?? "") },
    { label: "Fed district", value: districtName ?? "", href: district ? `/research/district/${district}` : undefined },
    { label: "Regulator", value: regulator?.primary_regulator ?? "" },
    { label: "Holding company", value: holdingName ?? "", wide: true },
    {
      label: "Status",
      value:
        regulator?.regulatory_status === "inactive"
          ? regulator.closed_date
            ? `Closed or merged ${regulator.closed_date}`
            : "Closed or merged"
          : "",
      wide: true,
    },
  ].filter((fact) => fact.value);

  // Rendered for every visitor and hidden for a Pro reader by FreeOnly.
  const showHamiltonBand = !sparse && published.length > 0;
  // The one Hamilton finding shown free: its fee-income share against the peer median from the
  // same quarter's call reports (a Pro visitor already has the full financial profile).
  const [freePeerMedians, sampleLive] = await Promise.all([
    showHamiltonBand && latestFinancial
      ? budget.optional(getPeerFinancialMedians(instId), "peer medians", null)
      : Promise.resolve(null),
    showHamiltonBand || sparse
      ? budget.optional(sampleReportAvailable(), "sample report", false)
      : Promise.resolve(false),
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

  const connectedPanel = hamiltonInsight
    ? buildConnectedPanel({
        institutionId: instId,
        institutionName: inst.institution_name,
        insight: hamiltonInsight,
        rows,
        stateCode,
        stateName,
        city,
      })
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

  // A render with a failed read is cached for a minute, not an hour, so a database blip never
  // pins a profile with missing sections (#1572).
  if (budget.failed()) await shortenPageLife();

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Institutions", href: "/institutions" },
          { name: inst.institution_name, href: `/institution/${instId}` },
        ]}
      />

      <div className={`${profileSerif.variable} bg-paper text-ink`}>
        {/* 1. Who it is, and the count the page leads with (James's design file, Oct 17). */}
        <ProfileHero
          name={inst.institution_name}
          stateName={stateName}
          stateCode={stateCode}
          facts={heroFacts}
          counts={sparse ? null : counts}
          finding={finding}
          source={
            published.length > 0 ? (
              <>
                Source: {scheduleLink}
                {collectedOn ? `, read ${collectedOn}` : ""}.
              </>
            ) : (
              <>
                Know where its fee schedule is? <Link href={links.correctSourceHref}>Send the link</Link>
              </>
            )
          }
          primary={
            <HamiltonLink
              institutionId={instId}
              institutionName={inst.institution_name}
              className="fi-btn fi-btn-brick min-h-12 px-8 text-[15px]"
            />
          }
          schedulesHref={displayFees.length > 0 ? "#schedule-heading" : null}
        />

        <div className="mx-auto max-w-page space-y-14 px-4 pb-16 pt-12 sm:space-y-16 sm:px-6 sm:pt-16">
          {/* 2. Every published fee beside the state, district and U.S. medians. */}
          {published.length > 0 && (
            <section aria-labelledby="compare-heading" className="scroll-mt-20">
              <h2 id="compare-heading" className={H2} style={SERIF}>
                Fees against the market
              </h2>
              <p className={FINDING}>
                Comparison with {counts?.level === "state" && stateName ? stateName : "U.S."} medians for fees published by banks and
                credit unions.
              </p>
              <div className="mt-6">
                <CompareTable rows={rows} institutionName={inst.institution_name} stateName={stateName} districtName={districtName} />
              </div>
              <details className="group/how mt-3">
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-muted [&::-webkit-details-marker]:hidden">
                  <span>Published schedules</span>
                  <span aria-hidden="true">&middot;</span>
                  <span>Banks and credit unions</span>
                  {collectedOn && (
                    <>
                      <span aria-hidden="true">&middot;</span>
                      <span>Read {collectedOn}</span>
                    </>
                  )}
                  <span aria-hidden="true">&middot;</span>
                  <span className="inline-flex items-center gap-1.5 font-medium text-ink underline decoration-border underline-offset-4">
                    View sources
                    <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-open/how:rotate-90" />
                  </span>
                </summary>
                <p className={SOURCE}>
                  Each amount links to the fee schedule it was read from. Medians for {medianPlaces}: {PRODUCT_NAME} published fees,
                  shown where at least {MIN_INSTITUTIONS_FOR_MEDIAN} institutions publish the fee.
                </p>
                <dl className="mt-2 grid max-w-3xl gap-x-4 gap-y-1 text-[12px] leading-snug text-ink-muted sm:grid-cols-[auto_minmax(0,1fr)]">
                  <dt className="font-medium text-ink-soft">Compared at</dt>
                  <dd>
                    The value this page compares: its one price, or the middle of its prices when it lists several (the highest,
                    its standard fee, for overdraft).
                  </dd>
                  <dt className="font-medium text-ink-soft">Same rules</dt>
                  <dd>
                    Its fees and every median use the same rules. Business-only fees are left out. So are CD, IRA, card
                    inactivity, box drilling and key fees filed under a fee they don&rsquo;t match, and fees charged by a
                    different period than the median (a quarterly fee beside monthly ones).
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

          {/* Fee income beside fee prices, with Hamilton hand-offs that carry this comparison (James's brief, step 4).
              Without call-report figures to connect, the Hamilton band stands in, as before. */}
          {connectedPanel ? (
            <ConnectedPanel panel={connectedPanel} sampleReportHref={sampleHref} />
          ) : showHamiltonBand && (
            <FreeOnly>
              <HamiltonBand
                institutionName={inst.institution_name}
                insight={hamiltonInsight}
                plansHref={links.plansHref}
                reportOfferHref={links.reportOfferHref}
                sampleReportHref={sampleHref}
              />
            </FreeOnly>
          )}

          {/* 3. The whole schedule, grouped by type. */}
          {displayFees.length > 0 && (
            <section aria-labelledby="schedule-heading">
              <h2 id="schedule-heading" className={`${H2} scroll-mt-24`} style={SERIF}>
                {published.length > 0 ? "Published fee schedule" : "Fees under review"}
              </h2>
              <p className={FINDING}>
                {published.length > 0
                  ? `Amounts from ${inst.institution_name}\u2019s own schedules, with a source for each figure.`
                  : "They stay out of every comparison until review is done."}
              </p>
              <div className="mt-6">
                <ShowAll
                  total={scheduleRowCount}
                  shown={SCHEDULE_ROWS}
                  initialAll={scheduleAll}
                  aside={
                    <Link href={links.correctSourceHref} className={`inline-flex min-h-11 items-center gap-1.5 text-[14px] ${LINK}`}>
                      Correct a fee source
                      <ArrowUpRight aria-hidden="true" className="size-4" />
                    </Link>
                  }
                >
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
                {collectedOn ? `${collectedOn} data snapshot. ` : ""}Each amount links to {scheduleLink}. The U.S. comparison is the
                middle 50% of {PRODUCT_NAME} published fees, shown where at least {MIN_INSTITUTIONS_FOR_MEDIAN} institutions publish the
                fee.
              </p>
            </section>
          )}

          {!sparse && (
            <ProOnly>
              <HamiltonLink
                institutionId={instId}
                institutionName={inst.institution_name}
                className="fi-btn fi-btn-primary"
                label={`Open ${inst.institution_name} in Hamilton`}
              />
            </ProOnly>
          )}

          {/* 4. Where it operates and its public record: FDIC, NCUA, CFPB and SEC data, for every visitor. */}
          {(footprint || complaints || enforcement || holdingCompany) && (
            <section aria-labelledby="record-heading">
              <h2 id="record-heading" className={H2} style={SERIF}>
                Branches and public record
              </h2>
              <p className={FINDING}>Where {inst.institution_name} operates, and what regulators and customers have on file.</p>
              <div className="mt-6">
                <RegistryCards footprint={footprint} complaints={complaints} enforcement={enforcement} holdingCompany={holdingCompany} />
              </div>
            </section>
          )}

          <ProFinancialProfile institutionId={instId} institutionName={inst.institution_name} charterLabel={charterLabel} />

          <FeeAlertIsland
            institutionId={instId}
            institutionName={inst.institution_name}
            focusCategory={focusFeeCategory}
            categoryLabels={CATEGORY_LABELS}
            mode={sparse ? "verify" : "alerts"}
          />

          {sparse && sampleHref && (
            <FreeOnly>
            <p className="-mt-8 text-center text-[14px] text-ink-soft sm:-mt-10 sm:text-left">
              <Link href={sampleHref} className={`inline-flex min-h-11 items-center ${LINK}`}>
                See what a free sample Competitive Fee Position Report shows
              </Link>
            </p>
            </FreeOnly>
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
