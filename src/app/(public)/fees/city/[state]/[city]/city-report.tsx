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
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { getCityMarketCached, getStateFeeIndexesCached } from "@/lib/data-store/public-cached-reads";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { softRead } from "@/lib/soft-read";
import type { CityArea, CityMarket } from "@/lib/data-store";
import { cityCanonicalPath, titleCase } from "./city-lookup";
import { CompareRows, type CompareRow } from "./market-exhibits";
import { evidenceHeadline, FeeEvidence } from "./fee-evidence";
import { BranchMapLive } from "./branch-map";
import { ComparisonBars, feeBars } from "./comparison-bars";
import { LeadLink } from "./lead-link";
import { MarketTable } from "./market-table";
import { coverage, depositLeaders, depositsLabel, leadFinding, localFees, lowerLabel, money, pctLabel, trend } from "./market-view";

interface PageProps {
  params: Promise<{ state: string; city: string }>;
}


const H2 = "text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]";
const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

/** The market, null when the city has none, or "failed" when the read failed. */
async function loadMarket(state: string, city: string, area: CityArea): Promise<CityMarket | null | "failed"> {
  return getCityMarketCached(city, state, area).catch(() => "failed" as const);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { state, city } = await params;
  const stateCode = state.toUpperCase();
  const stateName = STATE_NAMES[stateCode];
  const cityName = titleCase(city);
  if (!stateName) notFound();
  const read = await loadMarket(stateCode, cityName, "city");
  const market = read === "failed" ? null : read;
  const cov = market ? coverage(market) : null;
  // A city with no fee published by enough institutions for a local median is a thin page:
  // rendered, not indexed. A failed read keeps the page indexable, since the page is cached.
  const indexable = read === "failed" || (market ? localFees(market, [], []).some((f) => f.median != null) : false);

  return {
    robots: { index: indexable, follow: true },
    alternates: { canonical: await cityCanonicalPath(state, city) },
    title: `${cityName}, ${stateCode} Bank Fees: Overdraft, ATM and More Compared`,
    description: cov
      ? `${cov.with_fees} of ${cov.institutions} banks and credit unions with branches in ${cityName}, ${stateCode} publish fees in the Bank Fee Index. See each fee with its source, set beside ${stateName} and the U.S.`
      : `Banks and credit unions with branches in ${cityName}, ${stateCode}: each published fee with its source, set beside ${stateName} and the U.S.`,
  };
}

/**
 * The city page, for the city itself (page.tsx) or its metro (metro/page.tsx, which the proxy
 * serves for ?area=metro; see viewer-variant.ts). The table's fee and order come from the
 * address in the browser (market-table.tsx), so both routes are cached.
 */
export async function CityReport({ state, city, area }: { state: string; city: string; area: CityArea }) {
  const stateCode = state.toUpperCase();
  const stateName = STATE_NAMES[stateCode];
  const cityName = titleCase(city);
  if (!stateName) notFound();

  // A failed market read throws to the error boundary rather than answering 404: a cached
  // 404 would hide the city for an hour. A failed state read hides the state comparison and
  // keeps the page for a minute, not an hour.
  const [market, stateRead, nationalIndex] = await Promise.all([
    getCityMarketCached(cityName, stateCode, area),
    softRead(getStateFeeIndexesCached(stateCode), null),
    getPublicNationalIndex(),
  ]);
  if (!market) notFound();
  if (stateRead.failed) await shortenPageLife();
  const stateIndexes = stateRead.value;

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
      } the ${stateName} median.`
    : null;
  // The name on the comparison bars and table: the city, or the metro.
  const barName = isMetro ? `${placeName} metro` : cityName;
  // Without a lead finding the header says why, rather than forcing one: too few institutions for
  // a local median, or every local median sits close to the state's.
  const comparable = fees.filter((f) => f.median != null && f.state_median != null);
  const mostPublishing = Math.max(0, ...fees.map((f) => f.n));
  const noLeadNote = hasLead
    ? null
    : comparable.length === 0
      ? `${cov.with_fees} ${cov.with_fees === 1 ? "institution" : "institutions"} with a branch here ${cov.with_fees === 1 ? "publishes" : "publish"} fees, not yet enough for a local median on any one fee. A median needs at least ${MIN_INSTITUTIONS_FOR_MEDIAN}; the most for any fee here is ${mostPublishing}.`
      : `Where a fee has enough institutions for a local median, the ${barName} median is within 10% of the ${stateName} median on all ${comparable.length} ${comparable.length === 1 ? "fee" : "fees"}.`;
  // A market where no fee reaches a local median leads with the institutions' own published
  // amounts for its most-published fee rather than an empty comparison.
  const sparse = !fees.some((f) => f.median != null) && fees.some((f) => f.n > 0);
  const evidenceFee = sparse ? fees.reduce((best, f) => (f.n > best.n ? f : best)) : null;
  const leaders = depositLeaders(market);
  const cityHref = `/fees/city/${stateCode.toLowerCase()}/${encodeURIComponent(cityName.toLowerCase())}`;
  const leadHref = lead ? `${cityHref}?${isMetro ? "area=metro&" : ""}fee=${lead.key}&sort=low#compare` : "";
  const branchesById = Object.fromEntries(market.institutions.map((i) => [i.id, i.branches]));

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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: `${cityName}, ${stateCode} Bank Fees Compared`,
            description: `Published fees of the ${cov.with_fees} banks and credit unions with branches in ${cityName}, ${stateName} that the Bank Fee Index holds, each with its source, set beside ${stateName} and the U.S.`,
            url: `${SITE_URL}${cityHref}`,
            spatialCoverage: { "@type": "Place", name: `${cityName}, ${stateName}` },
            creator: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
            isPartOf: { "@type": "Dataset", name: "Bank Fee Index" },
            variableMeasured: fees.filter((f) => f.median != null).map((f) => `${f.label} median`),
          }).replace(/</g, "\\u003c"),
        }}
      />

      {/* 1. The place, its boundary and what this page covers. */}
      <section className="border-b border-border bg-paper">
        <div
          className={`mx-auto max-w-page px-4 pb-10 pt-6 sm:px-6 sm:pb-12 sm:pt-10 ${
            "lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-16"
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
                  className={`inline-flex min-h-11 items-center rounded-full px-4 ${!isMetro ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink"}`}
                >
                  City of {cityName}
                </Link>
                <Link
                  href={`${cityHref}?area=metro`}
                  aria-current={isMetro ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full px-4 ${isMetro ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink"}`}
                >
                  Metro area
                </Link>
              </div>
            )}
            <p className={`mt-4 ${PAGE_LEDE}`}>
              <strong className="font-semibold text-ink">{cov.institutions}</strong> banks and credit unions have branches in {isMetro ? `the ${placeName} metro area` : cityName}.
              The Bank Fee Index holds published fees for <strong className="font-semibold text-ink">{cov.with_fees}</strong> of them.
            </p>
            <p className="mx-auto mt-2 text-[12px] text-ink-muted sm:mx-0 sm:text-left">The count includes institutions based elsewhere that have a branch here.</p>
          </div>
          {evidenceFee && (
            <div className="mt-10 border-t border-border pt-8 text-left lg:mt-2 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0">
              <h2 className="text-[22px] font-semibold leading-snug tracking-[-0.015em] text-ink sm:text-[28px]">{evidenceHeadline(evidenceFee)}</h2>
              <div className="mt-5">
                <FeeEvidence fee={evidenceFee} institutions={market.institutions} stateName={stateName} showNote />
              </div>
            </div>
          )}
          {noLeadNote && !evidenceFee && (
            <div className="mt-10 border-t border-border pt-8 text-left lg:mt-2 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Compared with {stateName}</p>
              <p className="mt-2 max-w-xl text-[17px] leading-snug text-ink sm:text-[19px]">{noLeadNote}</p>
              <p className="mt-2 text-[13px] text-ink-muted">
                {barName} counts institutions with a branch here, wherever headquartered. {stateName} counts institutions headquartered in the state.
              </p>
            </div>
          )}
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
            institutions={market.institutions}
            fees={fees}
            placeName={barName}
            stateName={stateName}
            medianNoteShown={sparse}
            leadKey={evidenceFee?.key ?? null}
          />
        </div>
      </section>

      {/* 3. Where they are: the branch map. */}
      {market.points.length >= 2 && (
        <section aria-labelledby="map-heading" className="mx-auto max-w-page px-4 pt-12 sm:px-6 sm:pt-16">
          <h2 id="map-heading" className={H2}>
            Where they have branches
          </h2>
          <div className="mt-5">
            <BranchMapLive points={market.points} unplaced={market.unplaced} label={placeName} branchesById={branchesById} />
          </div>
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
                    <Link href={`/institution/${l.id}`} className="line-clamp-2 leading-tight text-ink hover:text-brick">
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
              Hamilton, the Fee Insight workspace, sets an institution&apos;s own fees beside every institution in this market, with the source for
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
              <TrackLink event="contact_sales" eventProps={{ placement: "city_staff_band_demo" }} href={DEMO_REQUEST_NAV.href} className={`inline-flex min-h-11 items-center text-[14px] ${LINK}`}>
                {DEMO_REQUEST_NAV.label}
              </TrackLink>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface-0 p-5">
            <p className="text-[16px] font-semibold text-ink">Choosing an account?</p>
            <p className="mt-1 text-[14px] text-ink-muted">Open any institution above to see all of its published fees and where each one came from.</p>
            <Link href="/institutions" className={`mt-3 inline-flex min-h-11 items-center text-[14px] ${LINK}`}>
              Search institutions
            </Link>
          </div>
        </div>
      </section>

      <nav aria-label="More fee pages" className="mx-auto flex max-w-page flex-wrap gap-x-6 px-4 pb-16 pt-8 text-[14px] sm:px-6 [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center">
        <Link href={`/fees/city/${stateCode.toLowerCase()}`} className={LINK}>
          More {stateName} cities
        </Link>
        <Link href={`/research/state/${stateCode}`} className={LINK}>
          {stateName} fee report
        </Link>
        <Link href="/methodology" className={LINK}>
          Methodology
        </Link>
      </nav>
    </>
  );
}
