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
import { OVERSEAS_TERRITORIES, STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { TrackLink } from "@/components/track-link";
import { Button, SearchInput } from "@/brand/components";
import { DEMO_REQUEST_NAV, PRIMARY_CTA_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { getDistrictFeeIndexesCached, getDistrictHubCached } from "@/lib/data-store/public-cached-reads";
import { MIN_COMPLAINT_PEERS, MIN_LEADER_BRANCHES } from "@/lib/data-store/district-hub";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import {
  STATE_FINDING_MIN_INSTITUTIONS,
  buildCharterPairs,
  computeStateFindings,
} from "@/lib/research-report/state-findings";
import { LockedRows } from "../../../fees/[category]/exhibits";
import { BoardChart, BoardLegend, BoardRows, FindingButtons, StateBoard } from "../../state/[code]/state-board";
import { charterFees, leadFindings, positionIn } from "../../state/[code]/state-view";
import { CharterField, type CharterFee } from "./district-charter";
import { DistrictHero } from "./district-exhibits";
import { stateShape } from "./district-geo";
import { districtOpening } from "./district-opening";
import { HubStates, type HubFeeOption, type HubTableRow } from "./district-hub-states";
import {
  ComplaintChart,
  CpiChart,
  DepositStrip,
  HubSection,
  IncomeLine,
  KICKER,
  PriceMoves,
  STORY_H2,
  SizeByRegulator,
  SourceNote,
  StatePanel,
  compact,
  count,
  incomeTrend,
  leadersShare,
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
  sizeGroups,
} from "./district-hub-view";

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

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
  // The opening sentence comes from the same helper the research hub's districts exhibit uses.
  const { shown, locked, visibleComparisons, againstUs, statement } = districtOpening(indexes, nationalIndex, showAllCategories, place);
  const charted = shown.filter((f) => f.values.length > 0);
  const paired = charterFees(shown);
  // "In St. Louis district," reads as "In the St. Louis district," (the benchmark report words it the same way).
  const findings = leadFindings(
    computeStateFindings(place, visibleComparisons, buildCharterPairs(indexes.bank, indexes.credit_union, shown.map((f) => f.key))).map(
      (f) => ({ ...f, detail: f.detail.replace(`In ${place},`, `In the ${place},`) }),
    ),
    charted,
  );

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
  const bankTrend = incomeTrend(revenue, "banks");
  const cuTrend = incomeTrend(revenue, "creditUnions");
  const institutionsTracked = hub ? hub.institutions.reduce((sum, g) => sum + g.institutions, 0) : 0;
  const sizes = hub ? sizeGroups(hub) : null;
  const sized = sizes ? [...sizes.banks, ...sizes.creditUnions].some((g) => g.institutions > 0) : false;
  // Fed districts split some states (Dallas takes north Louisiana and south New Mexico); those
  // institutions count in the district totals but have no state row of their own.
  const outsideStates = Math.max(institutionsTracked - rows.reduce((sum, r) => sum + r.institutions, 0), 0);
  const complaints = hub ? complaintView(hub, districtId, states) : null;
  const moves = hub ? feeChangeSummary(hub, showAllCategories) : null;
  const cpi = hub ? cpiBankServices(hub) : null;
  const usUnemployment = hub?.series.UNRATE ?? null;
  const incomeYear = hub?.demographics.find((d) => d.median_household_income != null)?.year ?? null;
  const branches = hub?.branches ?? null;
  const branchTotals = branches
    ? {
        bank: branches.by_state.reduce((sum, b) => sum + b.branches, 0),
        cu: branches.cu_by_state.reduce((sum, b) => sum + b.branches, 0),
      }
    : null;
  const leaders = branches ? leadersShare(branches) : null;
  // Deposits are counted by whole state, so the deposit heading names the states, not the district.
  const depositArea =
    states.length === 1
      ? STATE_NAMES[states[0]]
      : states.some((code) => OVERSEAS_TERRITORIES.has(code))
        ? "the district's states and territories"
        : `the district's ${NUMBER_WORDS[states.length] ?? states.length} states`;

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
    ...(againstUs.length >= 3 ? [{ value: `${insideBand} of ${againstUs.length}`, label: "fee medians sit within the national middle range" }] : []),
  ];

  // The state cards: one fee at a time across every state, on one scale.
  const stateFees: HubFeeOption[] = feeKeys
    .map((k) => ({
      key: k,
      label: hubFeeName(k),
      district: districtMedians[k] ?? null,
      byState: Object.fromEntries(rows.map((r) => [r.code, r.fees[k]?.median ?? null])),
    }))
    .filter((f) => Object.values(f.byState).some((v) => v != null));
  const shapes = Object.fromEntries(
    rows.flatMap((r) => {
      const s = stateShape(r.code);
      return s ? [[r.code, { d: s.d, viewBox: `${s.box.x} ${s.box.y} ${s.box.w} ${s.box.h}` }]] : [];
    }),
  );
  const leadFee = stateFees[0] ?? null;
  const leadRange = leadFee
    ? rows
        .filter((r) => leadFee.byState[r.code] != null)
        .map((r) => ({ name: r.name, v: leadFee.byState[r.code]! }))
        .sort((x, y) => x.v - y.v)
    : [];
  const statesTitle =
    leadFee && leadRange.length >= 2
      ? leadRange[0].v === leadRange[leadRange.length - 1].v
        ? `Every state's ${leadFee.label.toLowerCase()} median is ${money(leadRange[0].v)}`
        : `${leadFee.label} medians run from ${money(leadRange[0].v)} in ${leadRange[0].name} to ${money(leadRange[leadRange.length - 1].v)} in ${leadRange[leadRange.length - 1].name}`
      : "State by state";

  // The full state table, behind its disclosure.
  const tableColumns = [
    { key: "institutions", label: "Institutions", phone: true },
    { key: "coverage", label: "Verified" },
    ...feeKeys.slice(0, 3).map((k, i) => ({ key: k, label: hubFeeName(k), phone: i === 0 })),
    { key: "charges", label: "Bank service charges" },
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
      charges: { v: r.bankServiceCharges, t: compact(r.bankServiceCharges) },
      unemployment: { v: r.unemployment?.rate ?? null, t: pct(r.unemployment?.rate) },
    },
  }));
  const panels = Object.fromEntries(
    rows.map((r) => [r.code, <StatePanel key={r.code} row={r} feeKeys={feeKeys} districtMedians={districtMedians} districtName={`${districtName} district`} />]),
  );
  const firstState = [...rows].sort((a, b) => b.institutions - a.institutions)[0]?.code ?? null;
  const economyRows = rows.filter((r) => r.unemployment || r.medianIncome != null);
  const beigeSummary = beigeSections.find((s) => s.section_name === "Summary of Economic Activity")?.content_text ?? null;
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

      {/* Opening: the district on its own map, two facts, and the page's thesis. */}
      <DistrictHero
        district={districtId}
        name={districtName}
        states={states}
        facts={facts}
        statement={statement}
        freshnessLabel={summary.freshnessLabel}
        reportHref={freeReportHref}
      />

      <div className="mx-auto max-w-page space-y-20 px-4 py-12 sm:space-y-28 sm:px-6 sm:py-16">
        {/* Story 1: the district against the U.S., one fee at a time. */}
        {charted.length > 0 ? (
          <StateBoard fees={charted} stateName={place}>
            <section id="benchmarks" aria-labelledby="board-heading" className="scroll-mt-20 space-y-8">
              <div className="max-w-3xl">
                <p className={`${KICKER} mb-2`}>Against the U.S.</p>
                <h2 id="board-heading" className={STORY_H2}>
                  {againstUs.length > 0
                    ? `${aboveUs} of ${againstUs.length} district medians sit above the U.S. median`
                    : `Fee medians in the ${place}`}
                </h2>
              </div>
              {findings.length > 0 && <FindingButtons findings={findings} />}
              <BoardChart />
              <div>
                <BoardLegend fees={charted} />
                <div className="mt-3">
                  <BoardRows fees={charted} ariaLabel={`${place} median for each fee`} limit={5} />
                </div>
                {locked.length > 0 && (
                  <div className="mt-4 border-t border-border pt-1">
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
              <SourceNote label="Method">
                Findings rank only fees with at least {STATE_FINDING_MIN_INSTITUTIONS} {place} institutions. Fees with fewer appear in the
                list, unranked. The national middle range runs from the 25th to the 75th percentile of U.S. institutions.
              </SourceNote>
            </section>
          </StateBoard>
        ) : (
          <p className="border-y border-dashed border-border px-5 py-8 text-center text-[14px] text-ink-muted">
            Not enough {place} institutions have verified fees yet for a district median.
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
            <CharterField fees={charter} place={`the ${place}`} />
          </section>
        )}

        {/* Story 3: state by state, one fee across every state on one scale. */}
        {rows.length > 0 && firstState && (
          <HubSection
            id="states"
            kicker="State by state"
            title={statesTitle}
            line="Each card shows the same fee on one scale; the short upright line marks the district median. Pick a state for its detail."
            source={
              <>
                Fee medians from verified published fee schedules, one value per institution; a median needs{" "}
                {MIN_INSTITUTIONS_FOR_MEDIAN} institutions. Fee income from FDIC and NCUA call reports, branches from the FDIC
                Summary of Deposits and NCUA, unemployment from BLS, income from the Census ACS. Fee medians, institution counts and
                fee income in each state count only institutions inside the {districtName} district; unemployment, income and
                branches cover the whole state.
                {outsideStates > 0 &&
                  ` ${count(outsideStates)} ${districtName} district institutions are in parts of other states and count only in the district totals.`}
              </>
            }
          >
            <HubStates
              states={rows.map((r) => ({ code: r.code, name: r.name }))}
              shapes={shapes}
              fees={stateFees}
              districtName={`${districtName} district`}
              panels={panels}
              columns={tableColumns}
              rows={tableRows}
              initial={firstState}
            />
          </HubSection>
        )}

        {/* The free district report. */}
        <section
          aria-labelledby="free-report-heading"
          className="flex flex-col items-center gap-5 border-y border-border py-10 text-center sm:flex-row sm:justify-between sm:text-left print:hidden"
        >
          <div>
            <h2 id="free-report-heading" className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[28px]">
              Get the {place} report
            </h2>
            <p className="mt-1 text-[15px] text-ink-soft">District {districtId}&apos;s headline fees against the U.S. in one free PDF, ready to share with your team.</p>
          </div>
          <TrackLink
            event="request_report_click"
            eventProps={{ placement: "district_free_report", district: districtId }}
            href={freeReportHref}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-ink px-6 text-[14px] font-semibold text-on-ink hover:opacity-90"
          >
            Get the free report
          </TrackLink>
        </section>

        {/* Story 4: fee income, banks and credit unions apart. */}
        {(bankTrend || cuTrend) && (
          <HubSection
            id="income"
            collapse="income trends"
            kicker="Fee income"
            title={
              bankTrend?.yoyPct != null
                ? `Bank service charges ${bankTrend.yoyPct >= 0 ? "rose" : "fell"} ${Math.abs(bankTrend.yoyPct).toFixed(1)}% in a year`
                : bankTrend
                  ? `Banks reported ${compact(bankTrend.latest.value)} in deposit service charges in ${quarterLabel(bankTrend.latest.quarter)}`
                  : "Credit union fee income"
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

        {/* Story 5: who serves the district, by deposits and by size. */}
        {(sized || branches) && (
          <HubSection
            id="market"
            collapse="deposit share"
            kicker="Who serves the district"
            title={
              leaders
                ? `The ${NUMBER_WORDS[leaders.banks] ?? leaders.banks} largest banks hold ${Math.round(leaders.pct)}% of bank deposits in ${depositArea}`
                : `${count(institutionsTracked)} banks and credit unions`
            }
            line={
              institutionsTracked > 0
                ? `${count(institutionsTracked)} banks and credit unions${
                    branchTotals ? `, with ${count(branchTotals.bank)} bank branches${branchTotals.cu > 0 ? ` and ${count(branchTotals.cu)} credit union branches` : ""}` : ""
                  }.`
                : undefined
            }
            source={
              <>
                Institutions tracked by {SITE_NAME}. Total assets from FDIC and NCUA data, grouped the way each regulator reports them: the FDIC asset-size groups for banks and the NCUA groups for credit unions.
                {branches &&
                  ` Bank deposits from the FDIC Summary of Deposits, ${branches.sod_year}, counted for each whole state, even where the district line splits one; credit union branches from NCUA. Leading banks count banks with ${MIN_LEADER_BRANCHES} or more branches here.`}
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

        {/* Story 6: the economy around the fees. */}
        {(cpi || beigeHeadline || economyRows.length > 0) && (
          <HubSection
            id="economy"
            collapse="economic context"
            kicker="Economic context"
            title={
              cpi
                ? `U.S. prices for bank services ${cpi.latestPct >= 0 ? "rose" : "fell"} ${Math.abs(cpi.latestPct).toFixed(1)}% in a year`
                : `What the Fed sees in the ${place}`
            }
            source={
              <>
                CPI for checking accounts and other bank services and BLS unemployment via FRED
                {incomeYear ? `; Census ACS ${incomeYear} median household income` : ""}; Federal Reserve Beige Book.
              </>
            }
          >
            <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-16">
              <div className="space-y-8">
                {(usUnemployment || cpi) && (
                  <dl className="grid grid-cols-2 gap-6">
                    {cpi && (
                      <div className="flex flex-col-reverse border-l-2 border-brick pl-4">
                        <dt className="mt-2 text-[13px] leading-snug text-ink-soft">Bank services prices, 12 months to {monthYear(cpi.date)}</dt>
                        <dd className="font-mono text-[34px] font-semibold leading-none tabular-nums text-ink">{signedPct(cpi.latestPct)}</dd>
                      </div>
                    )}
                    {usUnemployment && (
                      <div className="flex flex-col-reverse border-l-2 border-brick pl-4">
                        <dt className="mt-2 text-[13px] leading-snug text-ink-soft">U.S. unemployment, {monthYear(usUnemployment.latest.date)}</dt>
                        <dd className="font-mono text-[34px] font-semibold leading-none tabular-nums text-ink">{pct(usUnemployment.latest.value)}</dd>
                      </div>
                    )}
                  </dl>
                )}
                {beigeHeadline && (
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
                        Federal Reserve Beige Book, {districtName} district, {beigeHeadline.release_date}
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
                )}
              </div>
              {cpi && cpi.history.length > 1 && (
                <div>
                  <p className="mb-3 text-[14px] font-semibold text-ink">Bank services prices, change over 12 months</p>
                  <CpiChart history={cpi.history} label="CPI for checking accounts and other bank services, 12-month change" />
                </div>
              )}
            </div>
            {economyRows.length > 0 && (
              <details className="group/disc">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-[14px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true" className="transition-transform group-open/disc:rotate-90">
                    &rsaquo;
                  </span>
                  Unemployment and income by state
                </summary>
                <table className="mt-3 w-full max-w-xl text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                      <th scope="col" className="py-2 pr-3">State</th>
                      <th scope="col" className="px-3 py-2 text-right">Unemployment</th>
                      <th scope="col" className="py-2 pl-3 text-right">Median household income</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-200">
                    {economyRows.map((r) => (
                      <tr key={r.code}>
                        <th scope="row" className="py-2 pr-3 font-medium text-ink">{r.name}</th>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{pct(r.unemployment?.rate)}</td>
                        <td className="py-2 pl-3 text-right tabular-nums text-ink-soft">{compact(r.medianIncome)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </HubSection>
        )}

        {/* Complaints and fee changes: kept for readers who want them, behind one disclosure. */}
        {(complaints || (moves && hub)) && (
          <details className="group/disc border-t border-border pt-6">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[16px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="transition-transform group-open/disc:rotate-90">
                &rsaquo;
              </span>
              More district data: fee complaints and fee changes
            </summary>
            <div className="mt-8 space-y-16">
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
            <SearchInput name="q" label="Your bank or credit union" required autoComplete="off" className="w-full min-w-0 sm:flex-1" />
            <Button type="submit" variant="primary" className="min-h-11 justify-center whitespace-nowrap">
              {PRIMARY_CTA_NAV.label}
            </Button>
          </form>
          {!isPro && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-[14px] text-ink-muted">
                Hamilton, the Fee Insight workspace, sets every fee you charge against institutions your size and in your
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
