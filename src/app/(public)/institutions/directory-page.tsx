import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { institutionNameRank, type InstitutionSearchResult } from "@/lib/data-store/search";
import { getPublicCategorySummaries, getPublicStatsSummary, UNAVAILABLE_PUBLIC_STATS } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import { linkPreview } from "@/lib/link-preview";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PageHero, PAGE_HERO_WRAP } from "@/components/public/page-hero";
import {
  getInstitutionHeadlineCoverageCached,
  getInstitutionStateDirectorySummariesCached,
  getLargestInstitutionsCached,
  searchInstitutionsCached,
} from "@/lib/data-store/public-cached-reads";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { createReadBudget } from "@/lib/read-deadline";
import { boundedSearchTerm } from "@/lib/api-hardening/query-caps";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { SourceNote } from "../research/district/[id]/district-hub";
import { InstitutionSearchBar } from "./search-bar";
import { StateDirectoryMap } from "./state-directory-map";
import { StatePicker } from "./directory-filters";
import { StateList } from "./state-list";
import { CoverageDisclosure } from "./coverage-disclosure";
import {
  DirectoryPagination,
  InstitutionMobileCards,
  InstitutionResultsTable,
  type FeeFocus,
  type HeadlineCoverage,
} from "./institution-results";
import { DIRECTORY_PAGE_SIZE, DIRECTORY_SORT_WINDOW, hasVerifiedFees, paginate, sortVerifiedFirst } from "./directory-sort";
import {
  CHARTER_OPTIONS,
  availabilityLine,
  bandsInUse,
  charterNoun,
  coverageFinding,
  directoryHref,
  nationalCoverage,
  normalizeCharter,
  normalizeFeesFilter,
  normalizeStateCode,
  percentLabel,
  stateCoverage,
  stateRows,
  stateSummaryLine,
  type Charter,
} from "./directory-view";
import { headlineFeeList } from "./headline-fee-names";

/**
 * The directory, shared by /institutions (cached, ISR: the plain directory every crawler and
 * visitor lands on, #1811) and /institutions/results, which the proxy rewrites any request
 * carrying a search, state, charter, page, fee or fees filter to, since those vary per request.
 */
export interface DirectoryParams {
  q?: string;
  state?: string;
  charter?: string;
  page?: string;
  /** A fee category to compare, arriving from a consumer guide ("check your own bank"). */
  fee?: string;
  /** "1": only institutions with fees in the index. */
  fees?: string;
}

/**
 * One deadline for the directory's database reads (#1919): with the connection pool
 * saturated the page sat on its loading skeleton for minutes. Past it, the error
 * boundary answers instead, and the per-row fee coverage drops out.
 */
const DIRECTORY_READ_BUDGET_MS = 15_000;

const DESCRIPTION = `Find your bank or credit union by name or state and see the fees it publishes, from overdraft to wire fees, each from its own schedule, in the ${PRODUCT_NAME}.`;

export function directoryMetadata(params: DirectoryParams): Metadata {
  const stateCode = normalizeStateCode(params.state);
  const stateName = stateCode ? STATE_NAMES[stateCode] : "";
  const title = stateName ? `${stateName} Banks and Credit Unions: Published Fees` : "Bank and Credit Union Fees by Institution";
  const description = stateName
    ? `${stateName} banks and credit unions in the ${PRODUCT_NAME}, by headquarters, with the fees each one publishes, from its own schedule.`
    : DESCRIPTION;
  const path = stateCode ? `/institutions?state=${stateCode}` : "/institutions";
  // Name searches, filters and later pages are views of the same list: keep them out of search.
  const isView = Boolean(params.q || params.charter || params.fee || params.fees || (params.page && params.page !== "1"));
  return {
    title,
    description,
    ...(isView ? { robots: { index: false, follow: true } } : { alternates: { canonical: path } }),
    ...linkPreview({ title, description, path }),
  };
}

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());

/** Display name without its abbreviation, for prose: "Overdraft", not "Overdraft (OD)". */
function plainLabel(category: string): string {
  return getDisplayName(category).replace(/\s*\([^)]*\)/g, "");
}

interface DirectoryResults {
  rows: InstitutionSearchResult[];
  /** Matches (with the fees filter on, matches with fees in the index); null when not counted. */
  total: number | null;
  /** Matches with published fees, when the whole match set was read in one window; else null. */
  published: number | null;
  /** Without a count: whether a next page has rows. Null when `total` answers that. */
  hasNext: boolean | null;
}

/**
 * Published-first ordering across the whole result set when it fits in one window; otherwise
 * the current page is sorted on its own.
 *
 * The fees filter is applied to the rows read. The database lists institutions with fees first,
 * so when the window holds any row without fees it already holds every row with fees, and the
 * filtered set is exact. Only when every row in the window has fees (more than 1,500 matches with
 * fees) are later pages read one at a time, without a count; `hasNext` then says whether the next
 * page holds any row with fees, so the page never offers a "next" that comes back empty.
 */
async function loadResults(params: {
  query?: string;
  state_code?: string;
  charter_type?: string;
  fee_category?: string;
  feesOnly: boolean;
  page: number;
}): Promise<DirectoryResults> {
  const { feesOnly, ...search } = params;
  const firstPass = await searchInstitutionsCached({ ...search, page: 1, pageSize: DIRECTORY_SORT_WINDOW });
  // A name search puts the institution it names first among equals ("US Bank": U.S. Bank, then First US Bank).
  const query = params.query;
  const nameRank = query ? (name: string) => institutionNameRank(name, query) : undefined;
  const withFees = firstPass.rows.filter(hasVerifiedFees);
  const windowComplete = firstPass.total <= DIRECTORY_SORT_WINDOW || (feesOnly && withFees.length < firstPass.rows.length);
  if (windowComplete) {
    const matches = feesOnly ? withFees : firstPass.rows;
    return {
      rows: paginate(sortVerifiedFirst(matches, nameRank), params.page, DIRECTORY_PAGE_SIZE),
      total: matches.length,
      published: matches.filter(hasVerifiedFees).length,
      hasNext: null,
    };
  }
  const paged = await searchInstitutionsCached({ ...search, pageSize: DIRECTORY_PAGE_SIZE });
  const rows = sortVerifiedFirst(paged.rows, nameRank);
  if (!feesOnly) return { rows, total: paged.total, published: null, hasNext: null };
  const pageRows = rows.filter(hasVerifiedFees);
  const lastRaw = params.page * DIRECTORY_PAGE_SIZE >= paged.total;
  const hasNext =
    pageRows.length === DIRECTORY_PAGE_SIZE && !lastRaw
      ? (await searchInstitutionsCached({ ...search, page: params.page + 1, pageSize: DIRECTORY_PAGE_SIZE })).rows.some(hasVerifiedFees)
      : false;
  return { rows: pageRows, total: null, published: null, hasNext };
}

/** Rows in the opening list, and how many of the largest are read to fill it with the fees filter on. */
const LARGEST_SHOWN = 25;
const LARGEST_READ_WITH_FEES = 100;

const COUNT = new Intl.NumberFormat("en-US");
const H2 = "text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]";
const NOTE = "mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-soft";
const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";
const PILL = "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] font-medium transition-colors";
const STATE_ROWS_SHOWN = 5;

export async function InstitutionsDirectory({ params }: { params: DirectoryParams }) {
  const query = (params.q || "").trim();
  const stateCode = normalizeStateCode(params.state);
  const charter: Charter = normalizeCharter(params.charter);
  const feesOnly = normalizeFeesFilter(params.fees);
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  // Validated against the taxonomy: an unknown value degrades to the plain directory.
  const focusCategory = params.fee && TAXONOMY.has(params.fee) ? params.fee : "";

  // A name with under two letters or digits ("--", "a.") is no search: the page stays the
  // plain directory instead of listing every institution.
  const hasQuery = boundedSearchTerm(query) !== null;
  const hasState = Boolean(stateCode);
  // A name or a state lists every match; otherwise the page opens on the largest institutions.
  const isSearch = hasQuery || hasState;
  const budget = createReadBudget(DIRECTORY_READ_BUDGET_MS, "Directory");
  const [stats, summaries, results, categorySummaries] = await Promise.all([
    // Optional: a slow count at build time must not fail the whole deploy (#1988).
    budget.optional(getPublicStatsSummary(), "public stats", UNAVAILABLE_PUBLIC_STATS),
    // The cached directory is also rendered at build time: a failed read draws the map without
    // its counts for a minute (shortenPageLife below) instead of failing the build or the page.
    budget.optional(getInstitutionStateDirectorySummariesCached({ charter_type: charter || undefined }), "state summaries", []),
    isSearch
      ? budget.required(
          loadResults({
            query: hasQuery ? query : undefined,
            state_code: stateCode || undefined,
            charter_type: charter || undefined,
            fee_category: focusCategory || undefined,
            feesOnly,
            page,
          }),
          "search results",
        )
      : // The opening list is one bounded, cached read: no page of it varies per request.
        budget
          .optional(
            getLargestInstitutionsCached({
              charter_type: charter || undefined,
              limit: feesOnly ? LARGEST_READ_WITH_FEES : LARGEST_SHOWN,
            }),
            "largest institutions",
            [],
          )
          .then<DirectoryResults>((rows) => {
            const shown = (feesOnly ? rows.filter(hasVerifiedFees) : rows).slice(0, LARGEST_SHOWN);
            return { rows: shown, total: shown.length, published: null, hasNext: null };
          }),
    focusCategory ? budget.optional(getPublicCategorySummaries(), "category summaries", []) : Promise.resolve([]),
  ]);

  // Each row's headline coverage, from the shared cached coverage entry (no per-request read).
  // On failure the rows fall back to "Fees in the index" rather than showing a made-up count.
  const coverage: HeadlineCoverage =
    results.rows.length > 0
      ? await budget.optional(getInstitutionHeadlineCoverageCached(results.rows.map((row) => row.id)), "headline coverage", null)
      : null;
  // A render with a failed optional read is cached for a minute, not an hour (#1572). An empty
  // opening list is treated the same: the largest institutions are never really none.
  if (budget.failed() || !stats.complete || (!isSearch && results.rows.length === 0)) await shortenPageLife();

  const focus: FeeFocus | null = focusCategory
    ? {
        category: focusCategory,
        label: plainLabel(focusCategory),
        median: categorySummaries.find((s) => s.fee_category === focusCategory)?.median_amount ?? null,
      }
    : null;

  const stateName = stateCode ? STATE_NAMES[stateCode] : "";
  const noun = charterNoun(charter);
  const national = nationalCoverage(stats, summaries, charter);
  const picked = stateCode ? stateCoverage(summaries.find((s) => s.state_code === stateCode)) : null;
  const heroCoverage = hasState ? picked : national;
  const available = availabilityLine(heroCoverage, charter, hasState ? stateName : undefined);

  const rows = stateRows(summaries);
  const bands = bandsInUse(summaries.filter((s) => STATE_NAMES[s.state_code]));

  const keep = { q: hasQuery ? query : "", charter, fee: focusCategory, fees: feesOnly };
  // Without a count (the fees filter over a very large match set), "next" shows only when the
  // next page has rows.
  const totalPages = results.total !== null ? Math.ceil(results.total / DIRECTORY_PAGE_SIZE) : results.hasNext ? page + 1 : page;
  const buildPageHref = (nextPage: number) => directoryHref({ ...keep, state: stateCode, page: nextPage });
  const stateHref = (code: string) => directoryHref({ ...keep, state: code });

  // The no-result state offers the source form, carrying the name that was searched for.
  const submitSourceHref = hasQuery
    ? `/submit-fees?${new URLSearchParams({ institutionName: query }).toString()}`
    : "/submit-fees";

  const withFees = feesOnly ? " with fees in the index" : "";
  const resultsTitle = !isSearch ? `Largest ${noun}` : hasQuery ? "Search results" : `${stateName} ${noun}`;
  const resultsNote = !isSearch
    ? `The ${results.rows.length === LARGEST_SHOWN ? `${LARGEST_SHOWN} ` : ""}largest ${noun} by total assets${withFees}. Search by name or choose a state to see every institution.`
    : [
        results.total === null
          ? `${noun.charAt(0).toUpperCase()}${noun.slice(1)}${withFees}${hasQuery ? ` matching “${query}”` : ""}${hasState ? ` in ${stateName}` : ""}.`
          : `${COUNT.format(results.total)} ${results.total === 1 ? "institution" : "institutions"}${withFees}${
              hasQuery ? ` ${results.total === 1 ? "matches" : "match"} “${query}”` : ""
            }${hasState ? ` in ${stateName}` : ""}.`,
        !feesOnly && results.total !== null && results.total > 1 && results.published !== 0 && results.published !== results.total
          ? "Institutions with fees in the index are listed first."
          : "",
        focus && focus.median !== null ? `The national median ${focus.label.toLowerCase()} fee is ${formatAmount(focus.median)}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
  const tableCaption = `${resultsTitle}. ${resultsNote}`;

  const filterCard = (
    // The search takes the whole first row; the three filters share the second on a wide screen.
    <div className="grid gap-3 rounded-2xl border border-border bg-surface-0 p-3 text-ink shadow-[0_18px_40px_-24px_rgba(16,45,67,0.45)] sm:p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <div className="md:col-span-3">
        <InstitutionSearchBar initialQuery={query} ariaLabel="Search by bank or credit union name" placeholder="Bank or credit union name" />
      </div>
      <nav aria-label="Institution type" className="flex justify-center">
        <ul className="inline-flex rounded-full border border-control-border bg-surface-0 p-1">
          {CHARTER_OPTIONS.map((option) => {
            const active = option.value === charter;
            return (
              <li key={option.label}>
                <Link
                  href={directoryHref({ ...keep, state: stateCode, charter: option.value })}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  className={`${PILL} ${active ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink"}`}
                >
                  {option.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <StatePicker query={keep.q} stateCode={stateCode} charter={charter} fee={focusCategory} fees={feesOnly} />
      <div className="flex justify-center">
        <Link
          href={directoryHref({ ...keep, state: stateCode, fees: !feesOnly })}
          prefetch={false}
          aria-current={feesOnly ? "page" : undefined}
          className={`${PILL} border ${feesOnly ? "border-ink bg-ink text-on-ink" : "border-control-border text-ink-soft hover:text-ink"}`}
        >
          {feesOnly && <Check aria-hidden="true" className="size-4" />}
          Fees available
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen overflow-x-clip bg-paper text-ink">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Institutions", href: "/institutions" },
          ...(stateCode ? [{ name: stateName, href: `/institutions?state=${stateCode}` }] : []),
        ]}
      />
      {/* `relative z-20` keeps the search suggestions above the sections that follow. */}
      <div className="fi-reveal relative z-20">
        <PageHero
          id="directory-heading"
          eyebrow="Institution directory"
          crumbs={
            hasState ? (
              <Link href={directoryHref({ ...keep, state: "" })} prefetch={false}>
                All states
              </Link>
            ) : undefined
          }
          title={hasState ? `${stateName} ${noun}` : "Find your bank or credit union"}
          lede={
            focus
              ? `Each result shows its ${focus.label.toLowerCase()} fee${
                  focus.median !== null ? ` beside the ${formatAmount(focus.median)} national median` : ""
                }.`
              : "Explore published fees and compare institutions."
          }
        >
          {filterCard}
          {available && <p className="mt-4 text-[15px] text-[#e0e9ee]">{available}</p>}
        </PageHero>
      </div>

      <div className={`${PAGE_HERO_WRAP} pb-14 sm:pb-20`}>
        <section aria-labelledby="results-heading" className="fi-reveal fi-reveal-delay-1 pt-6 sm:pt-8">
          <h2 id="results-heading" className={H2}>
            {resultsTitle}
          </h2>
          <p className={NOTE}>
            {resultsNote}
            {focus && (
              <>
                {" "}
                <Link href={`/fees/${focus.category}`} className={LINK}>
                  See the full {focus.label.toLowerCase()} analysis
                </Link>
                .
              </>
            )}
          </p>

          {results.rows.length > 0 ? (
            <div className="mt-5">
              <InstitutionMobileCards rows={results.rows} coverage={coverage} focus={focus} />
              <InstitutionResultsTable rows={results.rows} coverage={coverage} focus={focus} caption={tableCaption} />
              {isSearch && <DirectoryPagination page={page} totalPages={totalPages} buildHref={buildPageHref} />}
              <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-ink-muted">
                Coverage counts how many of the {HEADLINE_FEE_KEYS.length} headline fees are in the index for each
                institution. A fee that is not in the index has not been published there yet; it does not mean the
                institution charges $0.
              </p>
            </div>
          ) : isSearch ? (
            <div className="mt-5 rounded-xl border border-dashed border-border px-5 py-8 text-center">
              <p className="text-[15px] text-ink-soft">
                {hasQuery
                  ? `No ${noun}${withFees} match “${query}”${hasState ? ` in ${stateName}` : ""}.`
                  : `No ${noun}${withFees} found.`}
              </p>
              {hasState && hasQuery && (
                <p className="mt-2 text-[14px]">
                  <Link href={directoryHref({ ...keep, state: "" })} className={LINK}>
                    Search every state
                  </Link>
                </p>
              )}
              <p className="mt-3 text-[14px]">
                <Link href={submitSourceHref} className={`inline-flex min-h-11 items-center ${LINK}`}>
                  Send an institution&apos;s fee schedule
                </Link>
              </p>
              <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-ink-muted">
                A link to the published schedule is enough. Each fee is checked against the source before it is published.
              </p>
            </div>
          ) : (
            <p className="mt-5 rounded-xl border border-dashed border-border px-5 py-6 text-[15px] text-ink-soft">
              The list of largest institutions is unavailable right now. Search by name or choose a state above.
            </p>
          )}
        </section>

        {rows.length > 0 && (
          <section aria-labelledby="states-heading" className="fi-reveal fi-reveal-delay-2 mt-12 sm:mt-16">
            <CoverageDisclosure
              collapsed={isSearch}
              headingId="states-heading"
              title="Explore by headquarters state"
              summary={stateSummaryLine(rows)}
              heading={
                <h2 id="states-heading" className={H2}>
                  Explore by headquarters state
                </h2>
              }
            >
              <p className={NOTE}>
                Each institution is counted in the state where it is headquartered, not every state where it has branches.
              </p>
              <figure className="mt-6 min-w-0">
                <figcaption className="text-[13px] font-semibold text-ink">
                  Share of {noun} with fees in the index, by headquarters state
                </figcaption>
                <div className="mx-auto mt-3 hidden max-w-[860px] lg:block">
                  <StateDirectoryMap rows={rows} bands={bands} hrefFor={stateHref} />
                </div>
                <div className="mt-3 lg:mt-6">
                  <StateList
                    rows={rows.map((r) => ({
                      code: r.code,
                      name: r.name,
                      href: stateHref(r.code),
                      published: COUNT.format(r.published),
                      monitored: COUNT.format(r.monitored),
                      share: percentLabel(r.share),
                    }))}
                    shown={STATE_ROWS_SHOWN}
                  />
                </div>
              </figure>
            </CoverageDisclosure>
          </section>
        )}

        <section aria-labelledby="coverage-heading" className="fi-reveal mt-12 border-t border-border pt-8 sm:mt-16">
          <h2 id="coverage-heading" className={H2}>
            Coverage and methodology
          </h2>
          {heroCoverage && <p className={NOTE}>{coverageFinding(heroCoverage, charter, hasState ? stateName : undefined)}</p>}
          <details className="group mt-3">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-[15px] font-medium text-ink [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="text-ink-muted transition-transform group-open:rotate-90">
                &#8250;
              </span>
              How coverage is counted
            </summary>
            <div className="mt-2 max-w-3xl space-y-3 text-[14px] leading-relaxed text-ink-soft">
              <p>
                An institution has fees in the index when at least one fee from its own current schedule has passed
                review and is published in the {PRODUCT_NAME}. Institutions monitored are every bank and credit union
                in the index, from FDIC and NCUA records.
              </p>
              <p>
                Coverage on each result counts the {HEADLINE_FEE_KEYS.length} headline fees: {headlineFeeList()}. A
                fee missing from the index is not a $0 fee; the institution may charge it and we have not published it
                yet.
              </p>
              <SourceNote label="Source">
                Fees from each institution&apos;s own published schedule in the {PRODUCT_NAME}; institutions from FDIC
                and NCUA records, counted by headquarters state. {stats.freshnessLabel}.
              </SourceNote>
            </div>
          </details>
          <p className="mt-6 text-[14px] leading-relaxed text-ink-muted">
            Work at a bank or credit union? Open its profile to compare it with peers in Hamilton, the {SITE_NAME} Pro
            workspace.{" "}
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "institutions_footer_link" }}
              href={PRO_PLANS_NAV.href}
              className={LINK}
            >
              {PRO_PLANS_NAV.label}
            </TrackLink>
          </p>
        </section>
      </div>
    </div>
  );
}
