export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { linkPreview } from "@/lib/link-preview";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getBeigeBookHeadline, getLatestBeigeBook } from "@/lib/data-store";
import { DISTRICT_NAMES, STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAllCategories, canAccessFullDistrict, canAccessPremium } from "@/lib/access";
import { formatCount, getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { LeadCapture } from "@/components/public/lead-capture";
import { TrackLink } from "@/components/track-link";
import { Button, SearchInput } from "@/brand/components";
import { DEMO_REQUEST_NAV, PRIMARY_CTA_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { REPORT_OFFER, SITE_NAME, SITE_URL } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { getPeerIndexCached, getStateFeeIndexesCached, getStateHubCached, getStateStatsCached } from "@/lib/data-store/public-cached-reads";
import { MIN_COMPLAINT_PEERS, MIN_LEADER_BRANCHES } from "@/lib/data-store/district-hub";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import type { StateFeeIndexes } from "@/lib/data-store";
import {
  STATE_FINDING_MIN_INSTITUTIONS,
  buildCharterPairs,
  buildComparisons,
  computeStateFindings,
  nationalBandTakeaway,
} from "@/lib/research-report/state-findings";
import { LockedRows } from "../../../fees/[category]/exhibits";
import { CharterField, type CharterFee } from "../../district/[id]/district-charter";
import {
  CpiChart,
  DepositStrip,
  HubSection,
  IncomeLine,
  KICKER,
  PriceMoves,
  RankBars,
  STORY_H2,
  SizeByRegulator,
  SourceNote,
  compact,
  count,
  incomeTrend,
  leadersShare,
  pct,
  signedPct,
} from "../../district/[id]/district-hub";
import {
  cpiBankServices,
  feeChangeSummary,
  monthYear,
  openingFinding,
  quarterLabel,
  revenueTrend,
  sizeGroups,
  stateComplaintView,
} from "../../district/[id]/district-hub-view";
import { StateHero } from "./state-exhibits";
import { BoardChart, BoardLegend, BoardRows, FindingButtons, StateBoard } from "./state-board";
import { boardFees, charterFees, leadFindings, positionIn, splitForAccess } from "./state-view";
import { TrendChart, lastMonths } from "./trend-chart";

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "2026-08-01" reads as "August 2026", for a headline. */
function longMonth(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The Beige Book's first sentence for free readers; Pro reads the whole summary. */
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}

interface PageProps {
  params: Promise<{ code: string }>;
}

/** Locked fees named for free visitors before the rest are counted. */
const LOCKED_SHOWN = 5;

const EMPTY_INDEXES: StateFeeIndexes = {
  all: [],
  bank: [],
  credit_union: [],
  verified_institutions: 0,
  verified_bank_institutions: 0,
  verified_cu_institutions: 0,
  verified_fees: 0,
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const stateCode = code.toUpperCase();
  const name = STATE_NAMES[stateCode];
  if (!name) return { title: "State Not Found" };
  // Thin states (fewer institutions with published fees than the median floor) stay out of
  // search; the sitemap leaves them out too. A failed read keeps the page indexable.
  const stats = await getStateStatsCached(stateCode).catch(() => null);
  const thin = stats !== null && stats.with_fees < MIN_INSTITUTIONS_FOR_MEDIAN;

  const title = `${name} Bank Fees - State Fee Report`;
  const description = `What ${name} banks and credit unions charge for overdraft, NSF, maintenance, ATM and wire fees, compared with national medians. Every figure from verified, published fee schedules.`;
  return {
    title,
    // One URL per state: /research/state/tx and /research/state/TX both render this page.
    alternates: { canonical: `/research/state/${stateCode}` },
    ...(thin ? { robots: { index: false, follow: true } } : {}),
    description,
    ...linkPreview({ title, description, path: `/research/state/${stateCode}` }),
    keywords: [
      `${name} bank fees`,
      `${name} overdraft fees`,
      `${name} credit union fees`,
      `bank fees by state`,
      `${name} ATM fees`,
    ],
  };
}

export default async function StateReportPage({ params }: PageProps) {
  const { code } = await params;
  const stateCode = code.toUpperCase();
  const stateName = STATE_NAMES[stateCode];
  if (!stateName) notFound();

  const user = await getCurrentUser();
  const isPro = canAccessPremium(user);
  const showAllCategories = canAccessAllCategories(user);
  const showFullDistrict = canAccessFullDistrict(user);

  // Every read is served from the public cache between publishes.
  const district = STATE_TO_DISTRICT[stateCode];
  const [summary, indexes, nationalIndex, districtIndex, sampleLive, hub, beigeHeadline, beigeSections] = await Promise.all([
    getPublicStatsSummary(),
    getStateFeeIndexesCached(stateCode).catch(() => EMPTY_INDEXES),
    getPublicNationalIndex(),
    // The district page's own read, so the two pages quote the same district medians.
    district ? getPeerIndexCached({ fed_districts: [district] }).catch(() => []) : Promise.resolve([]),
    sampleReportAvailable().catch(() => false),
    getStateHubCached(stateCode).catch(() => null),
    district ? getBeigeBookHeadline(district, 400) : Promise.resolve(null),
    district && showFullDistrict ? getLatestBeigeBook(district) : Promise.resolve([]),
  ]);
  const asOf = summary.refreshedOn;

  // The board, the chart, the findings and the banks/credit unions split all read the state's
  // one index, so every figure on the page counts the same institutions.
  const comparisons = buildComparisons(indexes.all, nationalIndex);
  const fees = boardFees(comparisons, indexes.bank, indexes.credit_union, indexes.institution_values, districtIndex);
  const { shown, locked } = splitForAccess(fees, showAllCategories);
  // A board entry cached before the values existed has nothing to draw until it refreshes.
  const charted = shown.filter((f) => f.values.length > 0);
  const paired = charterFees(shown);
  const visibleComparisons = comparisons.filter((c) => shown.some((f) => f.key === c.fee_category));
  const findings = leadFindings(
    computeStateFindings(
      stateName,
      visibleComparisons,
      buildCharterPairs(indexes.bank, indexes.credit_union, shown.map((f) => f.key)),
    ),
    charted,
  );
  const takeaway = nationalBandTakeaway(stateName, stateName, visibleComparisons);

  const againstUs = shown.filter((f) => f.us);
  const aboveUs = againstUs.filter((f) => f.us && f.median > f.us.median * 1.01).length;
  // The hero's band figure counts the same fees as the list and the heading below it.
  const insideBand = againstUs.filter((f) => positionIn(f.median, f.us!) === "within").length;
  const charter: CharterFee[] = paired.map((f) => ({
    key: f.key,
    name: f.name,
    bank: f.bank.median!,
    cu: f.cu.median!,
    banks: f.bank.institutions,
    creditUnions: f.cu.institutions,
  }));
  const cuLowerOn = charter.filter((f) => f.cu < f.bank).length;
  const bankLowerOn = charter.filter((f) => f.bank < f.cu).length;
  const charterTitle =
    cuLowerOn === 0 && bankLowerOn === 0
      ? `Banks and credit unions have the same median on all ${charter.length} fees`
      : cuLowerOn >= bankLowerOn
        ? `Credit unions have lower medians on ${cuLowerOn} of ${charter.length} fees`
        : `Banks have lower medians on ${bankLowerOn} of ${charter.length} fees`;
  // The district switch shows only when the district has a median for a fee the board draws.
  const districtName = district && charted.some((f) => f.district) ? `${DISTRICT_NAMES[district]} Fed district` : null;

  // The state's own hub: every institution in the state, its income, branches and economy.
  const institutionsTracked = hub ? hub.institutions.reduce((sum, g) => sum + g.institutions, 0) : 0;
  const revenue = hub ? revenueTrend(hub) : [];
  const bankTrend = incomeTrend(revenue, "banks");
  const cuTrend = incomeTrend(revenue, "creditUnions");
  const sizes = hub ? sizeGroups(hub, stateCode) : null;
  const sized = sizes ? [...sizes.banks, ...sizes.creditUnions].some((g) => g.institutions > 0) : false;
  const branches = hub?.branches ?? null;
  const bankBranches = branches?.by_state.find((b) => b.state_code === stateCode)?.branches ?? null;
  const cuBranches = branches?.cu_by_state.find((b) => b.state_code === stateCode)?.branches ?? null;
  const leaders = branches ? leadersShare(branches) : null;
  const complaints = hub ? stateComplaintView(hub, stateCode, district ?? null) : null;
  const complaintRows = complaints
    ? [
        ...(complaints.state.rate != null ? [{ key: "state", label: stateName, value: complaints.state.rate, note: count(complaints.state.matched) }] : []),
        ...(complaints.district?.rate != null && district ? [{ key: "district", label: `${DISTRICT_NAMES[district]} district`, value: complaints.district.rate }] : []),
        ...(complaints.us.rate != null ? [{ key: "us", label: "U.S.", value: complaints.us.rate }] : []),
      ]
    : [];
  const moves = hub ? feeChangeSummary(hub, showAllCategories) : null;
  const cpi = hub ? cpiBankServices(hub) : null;
  const usUnemployment = hub?.series.UNRATE ?? null;
  const stateUnemployment = hub?.series[`${stateCode}UR`] ?? null;
  // The U.S. rate for the state's own latest month, so the headline compares the same month.
  const usSameMonth = stateUnemployment ? (usUnemployment?.history.find((p) => p.date === stateUnemployment.latest.date) ?? null) : null;
  const income = hub?.demographics.find((d) => d.state_code === stateCode && d.median_household_income != null) ?? null;
  const beigeSummary = beigeSections.find((s) => s.section_name === "Summary of Economic Activity")?.content_text ?? null;
  const economyFigures = [
    ...(stateUnemployment ? [{ value: pct(stateUnemployment.latest.value), label: `${stateName} unemployment, ${monthYear(stateUnemployment.latest.date)}` }] : []),
    ...(usUnemployment ? [{ value: pct(usUnemployment.latest.value), label: `U.S. unemployment, ${monthYear(usUnemployment.latest.date)}` }] : []),
    ...(income ? [{ value: compact(income.median_household_income), label: `Median household income, ${income.year}` }] : []),
    ...(cpi ? [{ value: signedPct(cpi.latestPct), label: `U.S. bank services prices, 12 months to ${monthYear(cpi.date)}` }] : []),
  ];

  const facts = [
    ...(indexes.verified_institutions > 0
      ? [
          {
            value: formatCount(indexes.verified_institutions),
            label:
              institutionsTracked > 0
                ? `of ${formatCount(institutionsTracked)} banks and credit unions have verified fee schedules`
                : "banks and credit unions have verified fee schedules",
          },
        ]
      : []),
    ...(againstUs.length >= 3 ? [{ value: `${insideBand} of ${againstUs.length}`, label: "fee medians sit inside the U.S. middle half" }] : []),
  ];
  // The opening takeaway is the state's sharpest specific gap; the band count sits beside it as context.
  const statement = openingFinding(againstUs, STATE_FINDING_MIN_INSTITUTIONS) ?? takeaway;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: stateName, href: `/research/state/${stateCode}` },
        ]}
      />

      {/* Opening: the state among its neighbors, two facts, and the page's thesis. */}
      <StateHero
        stateCode={stateCode}
        stateName={stateName}
        district={district}
        facts={facts}
        statement={statement}
        freshnessLabel={summary.freshnessLabel}
      />

      <div className="mx-auto max-w-page space-y-20 px-4 py-12 sm:space-y-28 sm:px-6 sm:py-16">
        {/* Story 1: the state against the U.S. or its district, one fee at a time. */}
        {charted.length > 0 ? (
          <StateBoard fees={charted} stateName={stateName} districtName={districtName}>
            <section id="benchmarks" aria-labelledby="board-heading" className="scroll-mt-20 space-y-8">
              <div className="max-w-3xl">
                <p className={`${KICKER} mb-2`}>Against the U.S.</p>
                <h2 id="board-heading" className={STORY_H2}>
                  {againstUs.length > 0 ? `${aboveUs} of ${againstUs.length} ${stateName} medians sit above the U.S. median` : `Fee medians in ${stateName}`}
                </h2>
              </div>
              {findings.length > 0 && <FindingButtons findings={findings} />}
              <BoardChart />
              <div>
                <BoardLegend fees={charted} />
                <div className="mt-3">
                  <BoardRows fees={charted} ariaLabel={`${stateName} median for each fee`} limit={5} />
                </div>
                {locked.length > 0 && (
                  <div className="mt-4 border-t border-border pt-1">
                    <LockedRows rows={locked.slice(0, LOCKED_SHOWN).map((f) => ({ key: f.key, label: f.name, institutions: f.institutions }))} />
                    {locked.length > LOCKED_SHOWN && (
                      <p className="border-t border-border py-2 text-[12px] text-ink-muted">
                        Plus {locked.length - LOCKED_SHOWN} more {stateName} fees.{" "}
                        <TrackLink
                          event="upgrade_click"
                          eventProps={{ placement: "state_locked_rows", state: stateCode }}
                          href={PRO_PLANS_NAV.href}
                          className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                        >
                          See them in Hamilton
                        </TrackLink>
                      </p>
                    )}
                  </div>
                )}
              </div>
              <SourceNote label="Method">
                Findings rank only fees with at least {STATE_FINDING_MIN_INSTITUTIONS} {stateName} institutions. Fees with fewer appear in the
                list, unranked. The U.S. middle half runs from the 25th to the 75th percentile of U.S. institutions.
              </SourceNote>
            </section>
          </StateBoard>
        ) : (
          <p className="border-y border-dashed border-border px-5 py-8 text-center text-[14px] text-ink-muted">
            Not enough {stateName} institutions have verified fees yet for a state median.
          </p>
        )}

        {/* Story 2: banks against credit unions, as one field of fees. */}
        {charter.length > 0 && (
          <section id="charter" aria-labelledby="charter-heading" className="scroll-mt-20 space-y-8">
            <div className="max-w-3xl">
              <p className={`${KICKER} mb-2`}>Banks and credit unions</p>
              <h2 id="charter-heading" className={STORY_H2}>
                {charterTitle}
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">Each tile is one fee. Pick one to see both medians.</p>
            </div>
            <CharterField fees={charter} place={stateName} />
          </section>
        )}

        {/* The free state report, straight after the fee stories it summarizes. */}
        <div id="free-report" className="scroll-mt-20">
          <LeadCapture
            placement="state_benchmark"
            className="print:hidden"
            stateCode={stateCode}
            eyebrow="Free report"
            headline={`Get the free ${stateName} fee report`}
            body={`The ${stateName} medians against the U.S., sent to you and updated as schedules are verified.`}
            buttonLabel="Send it to me"
            secondaryLink={
              sampleLive
                ? { href: "/reports/sample-competitive-fee-position", label: `See the sample ${REPORT_OFFER.name}` }
                : { href: `/reports?report=institution&src=state-${stateCode.toLowerCase()}#request`, label: REPORT_OFFER.institutionCtaLabel }
            }
          />
        </div>

        {/* Story 3: fee income, banks and credit unions apart. */}
        {(bankTrend || cuTrend) && (
          <HubSection
            id="income"
            collapse="income trends"
            kicker="Fee income"
            title={
              bankTrend?.yoyPct != null
                ? `${stateName} bank service charges ${bankTrend.yoyPct >= 0 ? "rose" : "fell"} ${Math.abs(bankTrend.yoyPct).toFixed(1)}% in a year`
                : bankTrend
                  ? `${stateName} banks reported ${compact(bankTrend.latest.value)} in deposit service charges in ${quarterLabel(bankTrend.latest.quarter)}`
                  : `${stateName} credit union fee income`
            }
            line="Credit union fee income is a wider measure than bank service charges, so the two charts stay separate and are never added together."
            source="Banks: service charges on deposit accounts, FDIC call reports. Credit unions: all fee income, NCUA call reports. Credit union year-to-date income is split into quarters; a quarter shows once most institutions have filed."
          >
            <div className="grid gap-14 lg:grid-cols-2 lg:gap-16">
              <IncomeLine quarters={revenue} series="banks" title="Banks: service charges on deposit accounts" />
              <IncomeLine quarters={revenue} series="creditUnions" title="Credit unions: all fee income" />
            </div>
          </HubSection>
        )}

        {/* Story 4: who serves the state, by deposits and by size. */}
        {(sized || branches) && (
          <HubSection
            id="market"
            collapse="deposit share"
            kicker={`Who serves ${stateName}`}
            title={
              leaders
                ? `The ${NUMBER_WORDS[leaders.banks] ?? leaders.banks} largest banks hold ${Math.round(leaders.pct)}% of bank deposits in ${stateName}`
                : `${count(institutionsTracked)} banks and credit unions`
            }
            line={
              institutionsTracked > 0
                ? `${count(institutionsTracked)} banks and credit unions${
                    bankBranches != null ? `, with ${count(bankBranches)} bank branches${cuBranches ? ` and ${count(cuBranches)} credit union branches` : ""}` : ""
                  }.`
                : undefined
            }
            source={
              <>
                Institutions tracked by {SITE_NAME}. Total assets from FDIC and NCUA data, grouped the way each regulator reports them: the FDIC asset-size groups for banks and the NCUA groups for credit unions.
                {branches &&
                  ` Bank deposits from the FDIC Summary of Deposits, ${branches.sod_year}, for branches in ${stateName}; credit union branches from NCUA. Leading banks count banks with ${MIN_LEADER_BRANCHES} or more branches in the state.`}
              </>
            }
          >
            {branches && <DepositStrip branches={branches} />}
            {sizes && sized && (
              <div className="pt-4">
                <SizeByRegulator groups={sizes} />
              </div>
            )}
          </HubSection>
        )}

        {/* Story 5: the economy around the fees. */}
        {(economyFigures.length > 0 || beigeHeadline) && (
          <HubSection
            id="economy"
            collapse="economic context"
            kicker="Economic context"
            title={
              stateUnemployment && usSameMonth
                ? `${stateName} unemployment was ${pct(stateUnemployment.latest.value)} in ${longMonth(stateUnemployment.latest.date)}, against ${pct(usSameMonth.value)} for the U.S.`
                : cpi
                  ? `U.S. prices for bank services ${cpi.latestPct >= 0 ? "rose" : "fell"} ${Math.abs(cpi.latestPct).toFixed(1)}% in a year`
                  : `What the Fed sees around ${stateName}`
            }
            source={
              <>
                BLS unemployment and the CPI for checking accounts and other bank services via FRED
                {income ? `; Census ACS ${income.year} median household income` : ""}; Federal Reserve Beige Book
                {district ? `, ${DISTRICT_NAMES[district]} district` : ""}.
              </>
            }
          >
            <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-16">
              <div className="space-y-8">
                {economyFigures.length > 0 && (
                  <dl className="grid grid-cols-2 gap-6">
                    {economyFigures.map((f) => (
                      <div key={f.label} className="flex flex-col-reverse border-l-2 border-brick pl-4">
                        <dt className="mt-2 text-[13px] leading-snug text-ink-soft">{f.label}</dt>
                        <dd className="font-mono text-[28px] font-semibold leading-none tabular-nums text-ink sm:text-[34px]">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {beigeHeadline && district && (
                  <figure>
                    <blockquote className="font-serif text-[20px] leading-snug text-ink sm:text-[24px]">
                      &ldquo;{showFullDistrict && beigeSummary ? beigeSummary : firstSentence(beigeHeadline.text)}&rdquo;
                    </blockquote>
                    <figcaption className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
                      <a
                        href="https://www.federalreserve.gov/monetarypolicy/beige-book-default.htm"
                        className="underline decoration-border underline-offset-4 hover:text-ink"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Federal Reserve Beige Book, {DISTRICT_NAMES[district]} district, {beigeHeadline.release_date}
                      </a>
                      {!showFullDistrict && (
                        <TrackLink
                          event="upgrade_click"
                          eventProps={{ placement: "state_beige_book", state: stateCode }}
                          href={PRO_PLANS_NAV.href}
                          className="font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                        >
                          Read it beside your fees in Hamilton
                        </TrackLink>
                      )}
                    </figcaption>
                  </figure>
                )}
              </div>
              <div className="space-y-12">
                {stateUnemployment && stateUnemployment.history.length > 1 && (
                  <div>
                    <p className="mb-3 text-[14px] font-semibold text-ink">Unemployment rate</p>
                    <TrendChart
                      lines={[
                        { label: stateName, points: lastMonths(stateUnemployment.history), tone: "primary" },
                        ...(usUnemployment ? [{ label: "U.S.", points: lastMonths(usUnemployment.history), tone: "compare" as const }] : []),
                      ]}
                      format={(v) => `${v.toFixed(1)}%`}
                      label={`${stateName} and U.S. unemployment rate`}
                    />
                  </div>
                )}
                {cpi && cpi.history.length > 1 && (
                  <div>
                    <p className="mb-3 text-[14px] font-semibold text-ink">U.S. bank services prices, change over 12 months</p>
                    <CpiChart history={cpi.history} label="CPI for checking accounts and other bank services, 12-month change" />
                  </div>
                )}
              </div>
            </div>
          </HubSection>
        )}

        {/* Complaints and fee changes: kept for readers who want them, behind one disclosure. */}
        {(complaintRows.length > 0 || (moves && hub)) && (
          <details className="group/disc border-t border-border pt-6">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[16px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="transition-transform group-open/disc:rotate-90">
                &rsaquo;
              </span>
              More {stateName} data: fee complaints and fee changes
            </summary>
            <div className="mt-8 space-y-16">
              {complaints && complaintRows.length > 0 && (
                <HubSection
                  id="complaints"
                  title={`Fee complaints to the CFPB, ${complaints.year}`}
                  line="Per $1 billion of deposits."
                  source={`CFPB Consumer Complaint Database, fee-related issues. Only institutions matched to their CFPB company record count, and a rate needs ${MIN_COMPLAINT_PEERS} of them.`}
                >
                  <div className="space-y-2">
                    <RankBars rows={complaintRows} format={(n) => n.toFixed(1)} />
                    {complaints.state.rate == null && (
                      <p className="text-[12px] text-ink-muted">
                        {count(complaints.state.matched)} {stateName} institutions are matched to CFPB records, under the {MIN_COMPLAINT_PEERS} a rate needs.
                      </p>
                    )}
                  </div>
                </HubSection>
              )}
              {moves && hub && (
                <HubSection
                  id="changes"
                  title="Fee changes in the last 12 months"
                  source={`Changes between two copies of the same institution's fee schedule, seen since ${monthYear(hub.fee_changes_since)}.`}
                >
                  <PriceMoves summary={moves} showAll={showAllCategories} />
                </HubSection>
              )}
            </div>
          </details>
        )}

        {/* The reader's own institution, and Hamilton once. */}
        <section aria-labelledby="search-heading" className="rounded-2xl bg-paper px-4 py-5 ring-1 ring-border sm:px-6 print:hidden">
          <h2 id="search-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
            Where does your institution sit?
          </h2>
          <form action="/institutions" method="get" role="search" className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="state" value={stateCode} />
            <SearchInput name="q" label="Your bank or credit union" required autoComplete="off" className="w-full min-w-0 sm:flex-1" />
            <Button type="submit" variant="primary" className="min-h-11 justify-center whitespace-nowrap">
              {PRIMARY_CTA_NAV.label}
            </Button>
          </form>
          {!isPro && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-[14px] text-ink-muted">
                Hamilton, the Fee Insight Pro workspace, sets every fee you charge against institutions your size and in{" "}
                {stateName}.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
                <TrackLink
                  event="upgrade_click"
                  eventProps={{ placement: "state_report_end", state: stateCode }}
                  href={PRO_PLANS_NAV.href}
                  className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-on-ink hover:opacity-90"
                >
                  {PRO_PLANS_NAV.label}
                </TrackLink>
                <TrackLink
                  event="contact_sales"
                  eventProps={{ placement: "state_report_end_demo", state: stateCode }}
                  href={DEMO_REQUEST_NAV.href}
                  className="text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                >
                  {DEMO_REQUEST_NAV.label}
                </TrackLink>
              </div>
            </div>
          )}
        </section>

        <p className="text-[12px] text-ink-muted">
          From {formatCount(indexes.verified_institutions)} {stateName} banks and credit unions&apos; own published fee schedules, one
          value per institution; a median needs at least {MIN_INSTITUTIONS_FOR_MEDIAN} institutions. Data as of {asOf}.{" "}
          <Link href="/methodology" className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink print:hidden">
            How we build it
          </Link>
        </p>
      </div>

      {/* Print / Save as PDF: drop site chrome and interactive controls, keep exhibits whole. */}
      <style>{`@media print {
        header, footer, nextjs-portal { display: none !important; }
        body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        section { break-inside: avoid-page; }
        a { text-decoration: none !important; }
      }`}</style>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: `${stateName} Bank & Credit Union Fees`,
            description: `Fee benchmarks for banks and credit unions in ${stateName}, compared with national medians.`,
            url: `${SITE_URL}/research/state/${stateCode}`,
            dateModified: asOf && !Number.isNaN(Date.parse(asOf)) ? new Date(asOf).toISOString() : undefined,
            publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
