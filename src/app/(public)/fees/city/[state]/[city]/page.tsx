export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicNationalIndex } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PAGE_CRUMBS, PAGE_H1, PAGE_HEADER, PAGE_LEDE } from "@/components/public/page-header";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { SITE_URL } from "@/lib/constants";
import { getCityMarketCached, getStateFeeIndexesCached } from "@/lib/data-store/public-cached-reads";
import type { CityArea, CityFeeKey, CityMarket } from "@/lib/data-store";
import { CITY_FEES } from "@/lib/data-store/city-market";
import { titleCase } from "./city-lookup";
import { CompareRows, type CompareRow } from "./market-exhibits";
import { BranchMapLive } from "./branch-map";
import { ComparisonBars, feeBars } from "./comparison-bars";
import { sortOf } from "./format";
import { LeadLink } from "./lead-link";
import { MarketTable } from "./market-table";
import { coverage, depositLeaders, depositsLabel, leadFinding, localFees, lowerLabel, money, pctLabel, trend } from "./market-view";

interface PageProps {
  params: Promise<{ state: string; city: string }>;
  searchParams?: Promise<{ area?: string; fee?: string; sort?: string }>;
}

/** Cities served by fewer institutions with published fees than this are thin pages: rendered, not indexed. */
const MIN_INDEXABLE_INSTITUTIONS = 3;

const H2 = "text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]";
const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

function areaOf(value: string | undefined): CityArea {
  return value === "metro" ? "metro" : "city";
}

async function loadMarket(state: string, city: string, area: CityArea): Promise<CityMarket | null> {
  return getCityMarketCached(city, state, area).catch(() => null);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { state, city } = await params;
  const stateCode = state.toUpperCase();
  const stateName = STATE_NAMES[stateCode];
  const cityName = titleCase(city);
  if (!stateName) notFound();
  const market = await loadMarket(stateCode, cityName, "city");
  const withFees = market ? coverage(market).with_fees : 0;

  return {
    robots: { index: withFees >= MIN_INDEXABLE_INSTITUTIONS, follow: true },
    // One address per city: "little-rock" and "little%20rock" render the same page.
    alternates: { canonical: `/fees/city/${state.toLowerCase()}/${encodeURIComponent(cityName.toLowerCase())}` },
    title: `Banking and Fees in ${cityName}, ${stateCode}`,
    description: `The banks and credit unions with branches in ${cityName}, ${stateName}, their published fees with sources, and how the market compares with ${stateName} and the U.S.`,
  };
}

export default async function CityFeePage({ params, searchParams }: PageProps) {
  const { state, city } = await params;
  const query = (await searchParams) ?? {};
  const stateCode = state.toUpperCase();
  const stateName = STATE_NAMES[stateCode];
  const cityName = titleCase(city);
  if (!stateName) notFound();

  const area = areaOf(query.area);
  const [market, stateIndexes, nationalIndex] = await Promise.all([
    loadMarket(stateCode, cityName, area),
    getStateFeeIndexesCached(stateCode).catch(() => null),
    getPublicNationalIndex(),
  ]);
  if (!market) notFound();

  const isMetro = market.area === "metro";
  const placeName = isMetro && market.metro ? market.metro.name.replace(/,\s*[A-Z-]+$/, "") : cityName;
  const cov = coverage(market);
  const fees = localFees(market, stateIndexes?.all ?? [], nationalIndex);
  const lead = leadFinding(fees);
  const hasLead = lead != null && lead.median != null && lead.state_median != null;
  const leadGap = hasLead ? lead!.median! - lead!.state_median! : 0;
  const leadHeadline = hasLead
    ? `${isMetro ? `The ${placeName} metro's` : `${cityName}'s`} ${lowerLabel(lead!.label)} fee median is ${money(Math.abs(leadGap))} ${
        leadGap > 0 ? "above" : "below"
      } the ${stateName} benchmark.`
    : null;
  const leaders = depositLeaders(market);
  const cityHref = `/fees/city/${stateCode.toLowerCase()}/${encodeURIComponent(cityName.toLowerCase())}`;
  const initialFee = CITY_FEES.some((f) => f.key === query.fee) ? (query.fee as CityFeeKey) : "overdraft";
  const initialSort = sortOf(query.sort);
  // The name on the comparison bars and table: the city, or the metro.
  const barName = isMetro ? `${placeName} metro` : cityName;
  const leadHref = lead ? `${cityHref}?${isMetro ? "area=metro&" : ""}fee=${lead.key}&sort=low#compare` : "";
  const branchesById = Object.fromEntries(market.institutions.map((i) => [i.id, i.branches]));
  const unplotted = cov.branches - market.points.length;

  const deposits5 = trend(market.deposit_years, 5, (y) => [y.area_deposits, y.state_deposits, y.us_deposits]);
  const branches10 = trend(market.deposit_years, 10, (y) => [y.area_branches, y.state_branches, y.us_branches]);
  const c = market.community;
  const popChange = (f: typeof c.area) => (f?.population && f.population_before ? (f.population - f.population_before) / f.population_before : null);
  const areaLabel = c.area?.name || placeName;
  // Census figures are county figures: the county holding most of the city's branches, or the metro's counties.
  const contextKicker = isMetro ? `Metro context: the ${placeName} metro's counties` : c.area?.name ? `County context: ${c.area.name}` : null;
  const economy: CompareRow[] = [];
  if (deposits5) {
    economy.push({
      label: "Bank deposits",
      note: `Change at branches here, ${deposits5.from} to ${deposits5.to}`,
      values: [
        { name: placeName, value: deposits5.area, text: pctLabel(deposits5.area) },
        { name: stateName, value: deposits5.state, text: pctLabel(deposits5.state) },
        { name: "U.S.", value: deposits5.us, text: pctLabel(deposits5.us) },
      ],
    });
  }
  if (branches10) {
    economy.push({
      label: "Bank branches",
      note: `Change in branch count, ${branches10.from} to ${branches10.to}`,
      values: [
        { name: placeName, value: branches10.area, text: pctLabel(branches10.area) },
        { name: stateName, value: branches10.state, text: pctLabel(branches10.state) },
        { name: "U.S.", value: branches10.us, text: pctLabel(branches10.us) },
      ],
    });
  }
  if (c.area && c.state) {
    economy.push({
      label: "Population",
      note: `Change between the ${c.area.year_before} and ${c.area.year} Census estimates`,
      values: [
        { name: areaLabel, value: popChange(c.area), text: pctLabel(popChange(c.area), 1) },
        { name: stateName, value: popChange(c.state), text: pctLabel(popChange(c.state), 1) },
        { name: "U.S.", value: popChange(c.us), text: pctLabel(popChange(c.us), 1) },
      ],
    });
    if (c.area.median_household_income && c.state.median_household_income) {
      economy.push({
        label: "Median household income",
        note: `Census estimate, ${c.area.year}`,
        values: [
          { name: areaLabel, value: c.area.median_household_income, text: `$${Math.round(c.area.median_household_income / 1000)}k` },
          { name: stateName, value: c.state.median_household_income, text: `$${Math.round(c.state.median_household_income / 1000)}k` },
        ],
      });
    }
  }

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: SITE_URL },
          { name: "Fees", href: `${SITE_URL}/fees` },
          { name: stateName, href: `${SITE_URL}/fees/city/${stateCode.toLowerCase()}` },
          { name: cityName, href: `${SITE_URL}${cityHref}` },
        ]}
      />

      {/* 1. The place, its boundary and what this page covers. */}
      <section className="border-b border-border bg-paper">
        <div
          className={`mx-auto max-w-page px-4 pb-10 pt-6 sm:px-6 sm:pb-12 sm:pt-10 ${
            hasLead ? "lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-16" : ""
          }`}
        >
          <div className={PAGE_HEADER}>
            <nav aria-label="Breadcrumb" className={PAGE_CRUMBS}>
              <Link href="/fees" className="hover:text-ink">Fees</Link>
              <span aria-hidden="true">/</span>
              <Link href={`/fees/city/${stateCode.toLowerCase()}`} className="hover:text-ink">{stateName}</Link>
              <span aria-hidden="true">/</span>
              <span className="text-ink-soft">{cityName}</span>
            </nav>
            <h1 className={`mt-4 ${PAGE_H1}`}>
              Banking and fees in {placeName}
            </h1>
            {market.metro && (
              <div className="mt-4 inline-flex rounded-full border border-border bg-surface-0 p-1 text-[13px] font-semibold" role="group" aria-label="Area">
                <Link
                  href={cityHref}
                  aria-current={!isMetro ? "page" : undefined}
                  className={`rounded-full px-4 py-1.5 ${!isMetro ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink"}`}
                >
                  City of {cityName}
                </Link>
                <Link
                  href={`${cityHref}?area=metro`}
                  aria-current={isMetro ? "page" : undefined}
                  className={`rounded-full px-4 py-1.5 ${isMetro ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink"}`}
                >
                  Metro area
                </Link>
              </div>
            )}
            <p className={`mt-4 ${PAGE_LEDE}`}>
              <strong className="font-semibold text-ink">{cov.institutions}</strong> banks and credit unions have branches in {isMetro ? `the ${placeName} metro area` : cityName}.
              The Bank Fee Index holds published fees for <strong className="font-semibold text-ink">{cov.with_fees}</strong> of them.
            </p>
            <p className="mx-auto mt-2 text-[12px] text-ink-muted sm:mx-0">The count includes institutions based elsewhere that have a branch here.</p>
          </div>
          {hasLead && lead && (
            <div className="mt-10 border-t border-border pt-8 text-left lg:mt-2 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-brick">Largest gap from {stateName}</p>
              <h2 className="mt-2 text-[22px] font-semibold leading-snug tracking-[-0.015em] text-ink sm:text-[28px]">
                {leadHeadline}
              </h2>
              <p className="mt-2 text-[13px] text-ink-muted">
                {barName} counts institutions with a branch here, wherever headquartered. {stateName} counts institutions headquartered in the state.
              </p>
              <div className="mt-6">
                <ComparisonBars bars={feeBars(lead, barName, stateName)} size="lg" />
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                <LeadLink fee={lead.key} sort="low" href={leadHref} target="compare">
                  See the {lead.n} institutions
                </LeadLink>
                <p className="max-w-md text-[12px] text-ink-muted">
                  Chosen as the fee whose {barName} median sits furthest from {stateName}&apos;s in percentage terms, among fees at least{" "}
                  {MIN_INSTITUTIONS_FOR_MEDIAN} local institutions publish.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 2. Compare: pick a fee, see the median against the state and the U.S., then the institutions behind it. */}
      <section id="compare" aria-labelledby="compare-heading" className="mx-auto max-w-page scroll-mt-20 px-4 pt-12 sm:px-6 sm:pt-16">
        <h2 id="compare-heading" className={H2}>
          Compare published fees
        </h2>
        <p className="mt-1 max-w-3xl text-[14px] text-ink-muted">
          Pick a fee to compare {barName} with {stateName} and the U.S. Each amount below links to the fee schedule it was read
          from, and an empty cell says why.
        </p>
        <div className="mt-5">
          <MarketTable
            key={`${initialFee}-${initialSort}`}
            institutions={market.institutions}
            fees={fees}
            placeName={barName}
            stateName={stateName}
            initialFee={initialFee}
            initialSort={initialSort}
          />
        </div>
      </section>

      {/* 3. Where they are: the branch map. */}
      {market.points.length >= 2 && (
        <section aria-labelledby="map-heading" className="mx-auto max-w-page px-4 pt-12 sm:px-6 sm:pt-16">
          <h2 id="map-heading" className={H2}>
            Where they have branches
          </h2>
          <p className="mt-1 max-w-3xl text-[14px] text-ink-muted">Select a branch to see its institution.</p>
          <div className="mt-5">
            <BranchMapLive points={market.points} label={placeName} branchesById={branchesById} />
          </div>
          {unplotted > 0 && (
            <p className="mt-2 text-[12px] text-ink-muted">
              The map shows {market.points.length} of {cov.branches} branch locations. {unplotted} {unplotted === 1 ? "has" : "have"} no
              map coordinates in the FDIC or NCUA branch records, so {unplotted === 1 ? "it is" : "they are"} counted but not plotted.
            </p>
          )}
        </section>
      )}

      {/* 4. Who holds the market: counts and deposit leaders. */}
      <section aria-labelledby="market-heading" className="mx-auto max-w-page px-4 pt-12 sm:px-6 sm:pt-16">
        <h2 id="market-heading" className={H2}>
          {placeName}&apos;s banking market
        </h2>
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <dl className="grid grid-cols-2 content-start gap-4">
            <div className="rounded-2xl border border-border bg-surface-0 p-4">
              <dt className="text-[12px] text-ink-muted">Banks with branches here</dt>
              <dd className="mt-1 font-mono text-[28px] tabular-nums text-ink">{cov.banks}</dd>
            </div>
            <div className="rounded-2xl border border-border bg-surface-0 p-4">
              <dt className="text-[12px] text-ink-muted">Credit unions with branches here</dt>
              <dd className="mt-1 font-mono text-[28px] tabular-nums text-ink">{cov.credit_unions}</dd>
            </div>
            <div className="rounded-2xl border border-border bg-surface-0 p-4">
              <dt className="text-[12px] text-ink-muted">Bank branch locations</dt>
              <dd className="mt-1 font-mono text-[28px] tabular-nums text-ink">{market.bank_branches}</dd>
            </div>
            <div className="rounded-2xl border border-border bg-surface-0 p-4">
              <dt className="text-[12px] text-ink-muted">Credit union branch locations</dt>
              <dd className="mt-1 font-mono text-[28px] tabular-nums text-ink">{market.cu_branches}</dd>
            </div>
          </dl>
          {leaders.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface-0 p-4">
              <p className="text-[14px] font-semibold text-ink">Largest banks by local bank deposits</p>
              <p className="text-[12px] text-ink-muted">
                Share of the {depositsLabel(market.deposit_years.at(-1)?.area_deposits ?? 0)} in bank deposits at branches here, FDIC
                Summary of Deposits {market.sod_year}. Credit unions report no deposits by branch.
              </p>
              <ol className="mt-3 space-y-2 text-[13px]">
                {leaders.map((l) => (
                  <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)_3rem] items-center gap-2">
                    <Link href={`/institution/${l.id}`} className="truncate text-ink hover:text-brick">
                      {l.name}
                    </Link>
                    <span className="h-2.5 rounded-full bg-paper" aria-hidden="true">
                      <span className="block h-full rounded-full bg-brick" style={{ width: `${Math.min(l.share / leaders[0].share, 1) * 100}%` }} />
                    </span>
                    <span className="text-right font-mono tabular-nums text-ink">{(l.share * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </section>

      {/* 5. Community context: county figures, labelled as the county, against the state and the U.S. */}
      {economy.length > 0 && (
        <section aria-labelledby="economy-heading" className="mx-auto max-w-page px-4 pt-12 sm:px-6 sm:pt-16">
          <details className="group rounded-2xl border border-border bg-surface-0 p-5" open>
            <summary className="cursor-pointer list-none">
              {contextKicker && <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-brick">{contextKicker}</p>}
              <h2 id="economy-heading" className={`${H2} mt-1 inline-block`}>
                Community context
              </h2>
              <span className="ml-2 text-[13px] text-ink-muted group-open:hidden">Show</span>
            </summary>
            <p className="mt-1 max-w-3xl text-[14px] text-ink-muted">
              {isMetro
                ? `Deposits and branches cover the ${placeName} metro. Population and income cover the metro's counties.`
                : c.area?.name
                  ? `Deposits and branches cover the City of ${cityName}. Population and income cover ${c.area.name}, the county with most of ${cityName}'s bank branches, not the city alone.`
                  : `Deposits and branches cover the City of ${cityName}.`}{" "}
              This is background. None of it sets or explains a fee.
            </p>
            <div className="mt-4">
              <CompareRows rows={economy} />
            </div>
            <p className="mt-3 text-[12px] text-ink-muted">
              Deposits and branches: FDIC Summary of Deposits, {market.sod_year} and earlier years. Population and income: Census
              American Community Survey 5-year estimates for {isMetro ? "the metro's counties" : areaLabel}.
            </p>
          </details>
        </section>
      )}

      {/* 6. Two next steps: banking teams first (the Pro subscription is the goal), then anyone choosing an account. */}
      <section className="mx-auto max-w-page px-4 pt-12 sm:px-6 sm:pt-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface-0 p-5">
            <p className="text-[16px] font-semibold text-ink">Work at a bank or credit union here?</p>
            <p className="mt-1 text-[14px] text-ink-muted">
              Hamilton, the Fee Insight Pro workspace, puts your own fees next to every institution in this market, with the source for
              each figure.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
              <TrackLink
                event="upgrade_click"
                eventProps={{ placement: "city_staff_band" }}
                href={PRO_PLANS_NAV.href}
                className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
              >
                {PRO_PLANS_NAV.label}
              </TrackLink>
              <TrackLink event="contact_sales" eventProps={{ placement: "city_staff_band_demo" }} href={DEMO_REQUEST_NAV.href} className={`text-[14px] ${LINK}`}>
                {DEMO_REQUEST_NAV.label}
              </TrackLink>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface-0 p-5">
            <p className="text-[16px] font-semibold text-ink">Choosing an account?</p>
            <p className="mt-1 text-[14px] text-ink-muted">Open any institution above to see all of its published fees and where each one came from.</p>
            <Link href="/institutions" className={`mt-3 inline-block text-[14px] ${LINK}`}>
              Search institutions
            </Link>
          </div>
        </div>
      </section>

      <nav aria-label="More fee pages" className="mx-auto flex max-w-page flex-wrap gap-x-6 gap-y-2 px-4 pb-16 pt-8 text-[14px] sm:px-6">
        <Link href={`/fees/city/${stateCode.toLowerCase()}`} className={LINK}>
          More {stateName} cities
        </Link>
        <Link href={`/research/state/${stateCode}`} className={LINK}>
          {stateName} fee report
        </Link>
        <Link href="/methodology" className={LINK}>
          How we build it
        </Link>
      </nav>
    </>
  );
}
