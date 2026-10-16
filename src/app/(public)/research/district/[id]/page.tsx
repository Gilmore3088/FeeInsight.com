export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { linkPreview } from "@/lib/link-preview";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBeigeBookHeadline, getLatestBeigeBook } from "@/lib/data-store";
import type { StateFeeIndexes } from "@/lib/data-store";
import { formatCount, getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { getStatesForDistrict } from "@/lib/us-map-paths";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAllCategories, canAccessFullDistrict, canAccessPremium } from "@/lib/access";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { TrackLink } from "@/components/track-link";
import { Button, SearchInput } from "@/brand/components";
import { DEMO_REQUEST_NAV, PRIMARY_CTA_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { getDistrictFeeIndexesCached, getDistrictHubCached } from "@/lib/data-store/public-cached-reads";
import { MIN_COMPLAINT_PEERS } from "@/lib/data-store/district-hub";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { buildCharterPairs, buildComparisons, computeStateFindings } from "@/lib/research-report/state-findings";
import { buildHistogram } from "@/components/public/distribution-chart";
import { LockedRows } from "../../../fees/[category]/exhibits";
import { StateVideo } from "../../state/[code]/state-exhibits";
import {
  BoardChart,
  BoardHeading,
  BoardLegend,
  BoardRows,
  CharterRows,
  FindingButtons,
  StateBoard,
} from "../../state/[code]/state-board";
import { boardFees, charterFees, charterHeadline, leadFindings, splitForAccess } from "../../state/[code]/state-view";
import { DistrictHero, PickMap } from "./district-exhibits";
import { HubStates, type HubTableRow } from "./district-hub-states";
import {
  ComplaintChart,
  CpiChart,
  HubSection,
  LeadersTable,
  PriceMoves,
  RankBars,
  RevenueChart,
  StatePanel,
  TierChart,
  Tiles,
  compact,
  count,
  money,
  pct,
  signedPct,
} from "./district-hub";
import {
  complaintView,
  cpiBankServices,
  feeChangeSummary,
  hubFeeKeys,
  hubFeeName,
  monthYear,
  quarterLabel,
  revenueTrend,
  stateHubRows,
  tierMix,
} from "./district-hub-view";

interface PageProps {
  params: Promise<{ id: string }>;
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

const H2 = "text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]";

/** The Beige Book's first sentence for free readers; Pro reads the whole summary. */
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const districtId = Number(id);
  const name = DISTRICT_NAMES[districtId];
  if (!name || String(districtId) !== id) notFound();

  const title = `${name} Fed District ${districtId} Fee Analysis`;
  const description = `Bank and credit union fees in the ${name} Fed district (District ${districtId}) against national benchmarks, with economic context from the Beige Book.`;
  return {
    title,
    description,
    ...linkPreview({ title, description, path: `/research/district/${districtId}` }),
    alternates: { canonical: `/research/district/${districtId}` },
    keywords: [
      `Federal Reserve District ${districtId}`,
      `${name} bank fees`,
      `Fed district fee analysis`,
      `banking fees ${name}`,
    ],
  };
}

export default async function DistrictReportPage({ params }: PageProps) {
  const { id } = await params;
  const districtId = Number(id);
  if (!Number.isInteger(districtId) || districtId < 1 || districtId > 12 || String(districtId) !== id) notFound();

  const districtName = DISTRICT_NAMES[districtId];
  if (!districtName) notFound();

  const user = await getCurrentUser();
  const isPro = canAccessPremium(user);
  const showAllCategories = canAccessAllCategories(user);
  const showFullDistrict = canAccessFullDistrict(user);

  // Every read is served from the public cache between publishes.
  const [indexes, nationalIndex, beigeHeadline, beigeSections, summary, hub] = await Promise.all([
    getDistrictFeeIndexesCached(districtId).catch(() => EMPTY_INDEXES),
    getPublicNationalIndex(),
    getBeigeBookHeadline(districtId, 400),
    showFullDistrict ? getLatestBeigeBook(districtId) : Promise.resolve([]),
    getPublicStatsSummary(),
    getDistrictHubCached(districtId).catch(() => null),
  ]);
  const asOf = summary.refreshedOn;
  const place = `${districtName} district`;
  const states = getStatesForDistrict(districtId).filter((code) => STATE_NAMES[code]).sort();

  // The board, the chart, the findings and the banks/credit unions split all read the
  // district's one index, so every figure on the page counts the same institutions.
  const comparisons = buildComparisons(indexes.all, nationalIndex);
  const fees = boardFees(comparisons, indexes.bank, indexes.credit_union, indexes.institution_values);
  const { shown, locked } = splitForAccess(fees, showAllCategories);
  const charted = shown.filter((f) => f.values.length > 0);
  const paired = charterFees(shown);
  const visibleComparisons = comparisons.filter((c) => shown.some((f) => f.key === c.fee_category));
  // "In St. Louis district," reads as "In the St. Louis district," (the benchmark report words it the same way).
  const findings = leadFindings(
    computeStateFindings(place, visibleComparisons, buildCharterPairs(indexes.bank, indexes.credit_union, shown.map((f) => f.key))).map(
      (f) => ({ ...f, detail: f.detail.replace(`In ${place},`, `In the ${place},`) }),
    ),
    charted,
  );

  const againstUs = shown.filter((f) => f.us);
  const aboveUs = againstUs.filter((f) => f.us && f.median > f.us.median * 1.01).length;
  const cuLowerOn = paired.filter((f) => f.cu.median! < f.bank.median!).length;
  // The hub: every state of the district, its institutions, income, branches, complaints and economy.
  const rows = hub ? stateHubRows(hub, states) : [];
  const feeKeys = hubFeeKeys(showAllCategories);
  const districtMedians = Object.fromEntries(
    feeKeys.map((k) => {
      const e = indexes.all.find((x) => x.fee_category === k);
      return [k, e && e.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN ? e.median_amount : null];
    }),
  );
  const revenue = hub ? revenueTrend(hub) : [];
  const latestRevenue = revenue[revenue.length - 1] ?? null;
  const institutionsTracked = hub ? hub.institutions.reduce((sum, g) => sum + g.institutions, 0) : 0;
  const tiers = hub ? tierMix(hub) : [];
  const complaints = hub ? complaintView(hub, districtId, states) : null;
  const moves = hub ? feeChangeSummary(hub, showAllCategories) : null;
  const cpi = hub ? cpiBankServices(hub) : null;
  const usUnemployment = hub?.series.UNRATE ?? null;
  const unemploymentRows = rows.filter((r) => r.unemployment);
  const incomeRows = rows.filter((r) => r.medianIncome != null);
  const incomeYear = hub?.demographics.find((d) => d.median_household_income != null)?.year ?? null;
  const branches = hub?.branches ?? null;
  const branchTotals = branches
    ? {
        bank: branches.by_state.reduce((sum, b) => sum + b.branches, 0),
        cu: branches.cu_by_state.reduce((sum, b) => sum + b.branches, 0),
      }
    : null;

  const figures = [
    ...(institutionsTracked > 0 ? [{ value: formatCount(institutionsTracked), label: "Banks and credit unions" }] : []),
    { value: formatCount(indexes.verified_institutions), label: "Institutions with verified fees" },
    { value: formatCount(indexes.verified_fees), label: "Verified fees" },
    ...(againstUs.length > 0 ? [{ value: `${aboveUs} of ${againstUs.length}`, label: "Fees above the U.S. median" }] : []),
    ...(paired.length > 0 ? [{ value: `${cuLowerOn} of ${paired.length}`, label: "Fees lower at credit unions" }] : []),
    ...(latestRevenue ? [{ value: compact(latestRevenue.total), label: `Service charges, ${quarterLabel(latestRevenue.quarter)}` }] : []),
  ];

  // The state picker: one panel per state, drawn here; the table carries the same figures.
  const tableColumns = [
    { key: "institutions", label: "Institutions" },
    { key: "coverage", label: "Verified" },
    ...feeKeys.slice(0, 3).map((k) => ({ key: k, label: hubFeeName(k) })),
    { key: "charges", label: "Service charges" },
    { key: "unemployment", label: "Jobless" },
  ];
  const tableRows: HubTableRow[] = rows.map((r) => ({
    code: r.code,
    name: r.name,
    cells: {
      institutions: { v: r.institutions, t: count(r.institutions) },
      coverage: { v: r.coveragePct, t: pct(r.coveragePct, 0) },
      ...Object.fromEntries(
        feeKeys.slice(0, 3).map((k) => {
          const m = r.fees[k]?.median ?? null;
          return [k, { v: m, t: money(m) }];
        }),
      ),
      charges: { v: r.serviceCharges, t: compact(r.serviceCharges) },
      unemployment: { v: r.unemployment?.rate ?? null, t: pct(r.unemployment?.rate) },
    },
  }));
  const panels = Object.fromEntries(
    rows.map((r) => [r.code, <StatePanel key={r.code} row={r} feeKeys={feeKeys} districtMedians={districtMedians} districtName={`${districtName} district`} />]),
  );
  const firstState = [...rows].sort((a, b) => b.institutions - a.institutions)[0]?.code ?? null;
  const beigeSummary = beigeSections.find((s) => s.section_name === "Summary of Economic Activity")?.content_text ?? null;
  const posterBars = charted[0] ? buildHistogram(charted[0].values.map(([v]) => v), 12).map((b) => b.count) : [];
  const freeReportHref = `/reports?report=district&district=${districtId}&src=district-${districtId}#request`;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: `District ${districtId}`, href: `/research/district/${districtId}` },
        ]}
      />

      {/* 1. The district's states on the map, with up to six live figures. */}
      <DistrictHero district={districtId} name={districtName} figures={figures} freshnessLabel={summary.freshnessLabel} reportHref={freeReportHref} />

      {/* 2. The video, in its own section under the hero. */}
      <StateVideo stateName={`the ${place}`} bars={posterBars} />

      <div className="mx-auto max-w-page space-y-10 px-4 py-8 sm:space-y-12 sm:px-6 sm:py-12">
        {charted.length > 0 ? (
          // 3-5 share one selection: a fee picked in a finding or a list redraws the chart.
          <StateBoard fees={charted} stateName={place}>
            {findings.length > 0 && (
              <section aria-labelledby="findings-heading" className="space-y-3">
                <h2 id="findings-heading" className={H2}>
                  What stands out
                </h2>
                <FindingButtons findings={findings} />
              </section>
            )}

            {/* 4. The board: the picked fee's spread, then every fee against the U.S. */}
            <section id="benchmarks" aria-labelledby="board-heading" className="scroll-mt-20 space-y-3">
              <BoardHeading id="board-heading" />
              <BoardChart />
              <BoardLegend fees={charted} />
              <div className="rounded-2xl border border-border bg-surface-0 px-4 py-2 shadow-fi-1 sm:px-6">
                <BoardRows fees={charted} ariaLabel={`${place} median for each fee`} />
                {locked.length > 0 && (
                  <div className="border-t border-border pt-1">
                    <LockedRows rows={locked.slice(0, LOCKED_SHOWN).map((f) => ({ key: f.key, label: f.name, institutions: f.institutions }))} />
                    {locked.length > LOCKED_SHOWN && (
                      <p className="border-t border-border py-2 text-[12px] text-ink-muted">
                        Plus {locked.length - LOCKED_SHOWN} more {place} fees.{" "}
                        <TrackLink
                          event="upgrade_click"
                          eventProps={{ placement: "district_locked_rows", district: districtId }}
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
            </section>

            {/* 5. Banks against credit unions. */}
            {paired.length > 0 && (
              <section aria-labelledby="charter-heading" className="space-y-3">
                <div>
                  <h2 id="charter-heading" className={H2}>
                    {charterHeadline(paired)}
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted" aria-hidden="true">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-ink" /> Banks
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-brick" /> Credit unions
                    </span>
                    <span>Median in the {place}.</span>
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-surface-0 px-4 py-2 shadow-fi-1 sm:px-6">
                  <CharterRows fees={paired} />
                </div>
              </section>
            )}
          </StateBoard>
        ) : (
          <p className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-[14px] text-ink-muted">
            Not enough {place} institutions have verified fees yet for a district median.
          </p>
        )}

        {/* 6. State by state: pick a state on the map, the chips or the table. */}
        {rows.length > 0 && firstState && (
          <HubSection
            id="states"
            title="State by state"
            line={`Each state against the ${districtName} district median.`}
            source={
              <>
                Fee medians from verified published fee schedules, one value per institution; a median needs{" "}
                {MIN_INSTITUTIONS_FOR_MEDIAN} institutions. Service charges from FDIC and NCUA call reports, branches from the FDIC
                Summary of Deposits and NCUA, unemployment from BLS, income from the Census ACS.
              </>
            }
          >
            <HubStates
              states={rows.map((r) => ({ code: r.code, name: r.name }))}
              map={<PickMap district={districtId} />}
              panels={panels}
              columns={tableColumns}
              rows={tableRows}
              initial={firstState}
            />
          </HubSection>
        )}

        {/* 7. The free district report. */}
        <section aria-labelledby="free-report-heading" className="flex flex-col gap-4 rounded-2xl bg-paper px-4 py-5 ring-1 ring-border sm:flex-row sm:items-center sm:justify-between sm:px-6 print:hidden">
          <div>
            <h2 id="free-report-heading" className={H2}>
              Get the free {place} report
            </h2>
            <p className="mt-1 text-[14px] text-ink-muted">District {districtId}&apos;s headline fees against the U.S., in one PDF to share with your team.</p>
          </div>
          <TrackLink
            event="request_report_click"
            eventProps={{ placement: "district_free_report", district: districtId }}
            href={freeReportHref}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
          >
            Get the free report
          </TrackLink>
        </section>

        {/* 8. Fee income: deposit service charges from the call reports. */}
        {latestRevenue && (
          <HubSection
            id="income"
            title="Deposit service charges"
            line={`${compact(latestRevenue.total)} in ${quarterLabel(latestRevenue.quarter)}, from ${count(latestRevenue.institutions)} reporting banks and credit unions.`}
            source="FDIC and NCUA call reports. Credit union year-to-date income is split into quarters; a quarter shows once most institutions have filed."
          >
            <RevenueChart quarters={revenue} />
            {rows.filter((r) => r.serviceCharges != null).length > 1 && (
              <RankBars
                rows={rows
                  .filter((r) => r.serviceCharges != null)
                  .sort((x, y) => y.serviceCharges! - x.serviceCharges!)
                  .map((r) => ({ key: r.code, label: r.name, value: r.serviceCharges! }))}
                format={(n) => compact(n)}
              />
            )}
          </HubSection>
        )}

        {/* 9. Market structure: who is here, by size, and who holds the deposits. */}
        {(tiers.length > 0 || branches) && (
          <HubSection
            id="market"
            title="Who serves the district"
            line={institutionsTracked > 0 ? `${count(institutionsTracked)} banks and credit unions, by asset size.` : undefined}
            source={
              <>
                Institutions tracked by {SITE_NAME}, sized by total assets.
                {branches && ` Branches and deposits from the FDIC Summary of Deposits, ${branches.sod_year}; credit union branches from NCUA.`}
              </>
            }
          >
            {tiers.length > 0 && <TierChart tiers={tiers} />}
            {branches && branchTotals && (
              <Tiles
                tone="card"
                items={[
                  { value: count(branchTotals.bank), label: "Bank branches" },
                  ...(branchTotals.cu > 0 ? [{ value: count(branchTotals.cu), label: "Credit union branches" }] : []),
                  { value: compact(branches.total_deposits), label: "Bank deposits" },
                ]}
              />
            )}
            {branches && branches.leaders.length > 0 && (
              <>
                <h3 className="pt-2 text-[15px] font-semibold text-ink">Largest banks by deposits</h3>
                <LeadersTable branches={branches} />
              </>
            )}
          </HubSection>
        )}

        {/* 10. CFPB fee complaints, only from institutions matched to their CFPB record. */}
        {complaints && (
          <HubSection
            id="complaints"
            title={`Fee complaints to the CFPB, ${complaints.year}`}
            line="Per $1 billion of deposits."
            source={`CFPB Consumer Complaint Database, fee-related issues. Only institutions matched to their CFPB company record count, and a rate needs ${MIN_COMPLAINT_PEERS} of them.`}
          >
            <ComplaintChart view={complaints} minPeers={MIN_COMPLAINT_PEERS} />
          </HubSection>
        )}

        {/* 11. The economy: jobs, income and the price of bank services. */}
        {(unemploymentRows.length > 0 || incomeRows.length > 0 || cpi) && (
          <HubSection
            id="economy"
            title="Jobs, income and prices"
            source={
              <>
                BLS state unemployment and CPI for bank services via FRED
                {incomeYear ? `; Census ACS ${incomeYear} median household income` : ""}.
              </>
            }
          >
            <Tiles
              tone="card"
              items={[
                ...(usUnemployment ? [{ value: pct(usUnemployment.latest.value), label: `U.S. unemployment, ${monthYear(usUnemployment.latest.date)}` }] : []),
                ...(cpi ? [{ value: signedPct(cpi.latestPct), label: `Bank services prices, 12 months to ${monthYear(cpi.date)}` }] : []),
              ]}
            />
            {unemploymentRows.length > 0 && (
              <>
                <h3 className="pt-2 text-[15px] font-semibold text-ink">Unemployment rate</h3>
                <RankBars
                  rows={[...unemploymentRows]
                    .sort((x, y) => y.unemployment!.rate - x.unemployment!.rate)
                    .map((r) => ({ key: r.code, label: r.name, value: r.unemployment!.rate }))}
                  format={(n) => pct(n)}
                  tick={usUnemployment?.latest.value ?? null}
                  tickLabel="U.S."
                />
              </>
            )}
            {incomeRows.length > 0 && (
              <>
                <h3 className="pt-2 text-[15px] font-semibold text-ink">Median household income</h3>
                <RankBars
                  rows={[...incomeRows].sort((x, y) => y.medianIncome! - x.medianIncome!).map((r) => ({ key: r.code, label: r.name, value: r.medianIncome! }))}
                  format={(n) => compact(n)}
                />
              </>
            )}
            {cpi && cpi.history.length > 1 && (
              <>
                <h3 className="pt-2 text-[15px] font-semibold text-ink">Bank services prices, change over 12 months</h3>
                <CpiChart history={cpi.history} label="CPI for checking accounts and other bank services, 12-month change" />
              </>
            )}
          </HubSection>
        )}

        {/* 12. The Beige Book: its first line free, the whole summary in Pro. */}
        {beigeHeadline && (
          <section aria-labelledby="beige-heading" className="space-y-3">
            <h2 id="beige-heading" className={H2}>
              What the Fed sees in the {place}
            </h2>
            <figure className="rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6">
              <blockquote className="text-[16px] leading-relaxed text-ink">
                {showFullDistrict && beigeSummary ? beigeSummary : firstSentence(beigeHeadline.text)}
              </blockquote>
              <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
                <a
                  href="https://www.federalreserve.gov/monetarypolicy/beige-book-default.htm"
                  className="underline decoration-border underline-offset-4 hover:text-ink"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Federal Reserve Beige Book, {beigeHeadline.release_date}
                </a>
                {!showFullDistrict && (
                  <TrackLink
                    event="upgrade_click"
                    eventProps={{ placement: "district_beige_book", district: districtId }}
                    href={PRO_PLANS_NAV.href}
                    className="font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                  >
                    Read it beside your fees in Hamilton
                  </TrackLink>
                )}
              </figcaption>
            </figure>
          </section>
        )}

        {/* 13. Fee changes seen in the last twelve months. */}
        {moves && hub && (
          <HubSection
            id="changes"
            title="Fee changes in the last 12 months"
            source={`Changes between two copies of the same institution's fee schedule, seen since ${monthYear(hub.fee_changes_since)}.`}
          >
            <PriceMoves summary={moves} showAll={showAllCategories} />
          </HubSection>
        )}

        {/* The reader's own institution, and Hamilton once. */}
        <section aria-labelledby="search-heading" className="rounded-2xl bg-paper px-4 py-5 ring-1 ring-border sm:px-6 print:hidden">
          <h2 id="search-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
            Where does your institution sit?
          </h2>
          <form action="/institutions" method="get" role="search" className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <SearchInput name="q" label="Your bank or credit union" required autoComplete="off" className="w-full min-w-0 sm:flex-1" />
            <Button type="submit" variant="primary" className="min-h-11 justify-center whitespace-nowrap">
              {PRIMARY_CTA_NAV.label}
            </Button>
          </form>
          {!isPro && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-[14px] text-ink-muted">
                Hamilton, the Fee Insight Pro workspace, sets every fee you charge against institutions your size and in your
                district.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
                <TrackLink
                  event="upgrade_click"
                  eventProps={{ placement: "district_report_end", district: districtId }}
                  href={PRO_PLANS_NAV.href}
                  className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-on-ink hover:opacity-90"
                >
                  {PRO_PLANS_NAV.label}
                </TrackLink>
                <TrackLink
                  event="contact_sales"
                  eventProps={{ placement: "district_report_end_demo", district: districtId }}
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
          From {formatCount(indexes.verified_institutions)} {place} banks and credit unions&apos; own published fee schedules, one
          value per institution; a median needs at least {MIN_INSTITUTIONS_FOR_MEDIAN} institutions. Data as of {asOf}.{" "}
          <Link href="/methodology" className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink print:hidden">
            How we build it
          </Link>
        </p>
      </div>

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
            headline: `${districtName} Fed District ${districtId} Bank & Credit Union Fees`,
            description: `Fee benchmarks for banks and credit unions in the ${place}, compared with national medians.`,
            url: `${SITE_URL}/research/district/${districtId}`,
            dateModified: asOf && !Number.isNaN(Date.parse(asOf)) ? new Date(asOf).toISOString() : undefined,
            publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
