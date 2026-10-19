import type { Metadata } from "next";
import Link from "next/link";
import type { InstitutionSearchResult } from "@/lib/data-store/search";
import { getPublicCategorySummaries, getPublicStatsSummary, UNAVAILABLE_LABEL, UNAVAILABLE_PUBLIC_STATS } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { PRODUCT_NAME } from "@/lib/constants";
import { InstitutionSearchBar } from "./search-bar";
import { StateDirectoryMap } from "./state-directory-map";
import { DirectoryFilters } from "./directory-filters";
import {
  DirectoryPagination,
  InstitutionMobileCards,
  InstitutionResultsTable,
  type FeeFocus,
} from "./institution-results";
import {
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_SORT_WINDOW,
  paginate,
  sortVerifiedFirst,
} from "./directory-sort";
import { getInstitutionStateDirectorySummariesCached, searchInstitutionsCached } from "@/lib/data-store/public-cached-reads";
import { getInstitutionHeadlineCoverage } from "@/lib/data-store/market-readiness";
import { PAGE_HEADER } from "@/components/public/page-header";
import { createReadBudget } from "@/lib/read-deadline";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";

/**
 * One deadline for the directory's database reads (#1919): with the connection pool
 * saturated the page sat on its loading skeleton for minutes. Past it, the error
 * boundary answers instead, and the per-row fee coverage drops out.
 */
const DIRECTORY_READ_BUDGET_MS = 15_000;

export const DIRECTORY_METADATA: Metadata = {
  title: `Find Your Bank — Search the ${PRODUCT_NAME}`,
  description:
    "Search banks and credit unions to compare fees against national benchmarks. Free institution lookup for all US financial institutions.",
};

/**
 * The directory, shared by /institutions (cached, ISR: the plain directory every crawler and
 * visitor lands on, #1811) and /institutions/results, which the proxy rewrites any request
 * carrying a search, state, charter, page or fee filter to, since those vary per request.
 */
export interface DirectoryParams {
  q?: string;
  state?: string;
  charter?: string;
  page?: string;
  /** A fee category to compare, arriving from a consumer guide ("check your own bank"). */
  fee?: string;
}

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());

/** Display name without its abbreviation, for prose: "Overdraft", not "Overdraft (OD)". */
function plainLabel(category: string): string {
  return getDisplayName(category).replace(/\s*\([^)]*\)/g, "");
}

interface DirectoryResults {
  rows: InstitutionSearchResult[];
  total: number;
}

/**
 * Published-first ordering across the whole result set when it fits in one
 * window; otherwise the current page is sorted on its own.
 */
async function loadResults(params: {
  query?: string;
  state_code?: string;
  charter_type?: string;
  fee_category?: string;
  page: number;
}): Promise<DirectoryResults> {
  const firstPass = await searchInstitutionsCached({
    ...params,
    page: 1,
    pageSize: DIRECTORY_SORT_WINDOW,
  });
  if (firstPass.total <= DIRECTORY_SORT_WINDOW) {
    return {
      rows: paginate(sortVerifiedFirst(firstPass.rows), params.page, DIRECTORY_PAGE_SIZE),
      total: firstPass.total,
    };
  }
  const paged = await searchInstitutionsCached({ ...params, pageSize: DIRECTORY_PAGE_SIZE });
  return { rows: sortVerifiedFirst(paged.rows), total: paged.total };
}

export async function InstitutionsDirectory({ params }: { params: DirectoryParams }) {
  const query = params.q || "";
  const stateCode = (params.state || "").toUpperCase();
  const charterType = params.charter || "";
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  // Validated against the taxonomy: an unknown value degrades to the plain directory.
  const focusCategory = params.fee && TAXONOMY.has(params.fee) ? params.fee : "";

  const hasQuery = query.trim().length >= 2;
  const hasState = Boolean(stateCode);
  const shouldShowResults = hasQuery || hasState;
  const budget = createReadBudget(DIRECTORY_READ_BUDGET_MS, "Directory");
  const [stats, stateSummaries, results, summaries] = await Promise.all([
    // Optional like the state summaries: a slow count at build time must not fail the whole
    // deploy (#1988). The stats bar shows the unavailable label and the page lives one minute.
    budget.optional(getPublicStatsSummary(), "public stats", UNAVAILABLE_PUBLIC_STATS),
    // The cached directory is also rendered at build time: a failed read draws the map without
    // its counts for a minute (shortenPageLife below) instead of failing the build or the page.
    budget.optional(getInstitutionStateDirectorySummariesCached({ charter_type: charterType || undefined }), "state summaries", []),
    shouldShowResults
      ? budget.required(loadResults({
          query: hasQuery ? query : undefined,
          state_code: stateCode || undefined,
          charter_type: charterType || undefined,
          fee_category: focusCategory || undefined,
          page,
        }), "search results")
      : Promise.resolve<DirectoryResults>({ rows: [], total: 0 }),
    focusCategory ? budget.optional(getPublicCategorySummaries(), "category summaries", []) : Promise.resolve([]),
  ]);

  // One read for the visible page only. On failure the rows fall back to "Fees published"
  // rather than showing a made-up count.
  const coverage =
    results.rows.length > 0
      ? await budget.optional(getInstitutionHeadlineCoverage(results.rows.map((row) => row.id)), "headline coverage", null)
      : null;

  const focus: FeeFocus | null = focusCategory
    ? {
        category: focusCategory,
        label: plainLabel(focusCategory),
        median: summaries.find((s) => s.fee_category === focusCategory)?.median_amount ?? null,
      }
    : null;

  const totalPages = Math.ceil(results.total / DIRECTORY_PAGE_SIZE);
  const selectedStateName = stateCode ? STATE_NAMES[stateCode] ?? stateCode : "";
  /** Pagination preserves every active filter, including the fee focus. */
  const buildPageHref = (nextPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (stateCode) search.set("state", stateCode);
    if (charterType) search.set("charter", charterType);
    if (focusCategory) search.set("fee", focusCategory);
    search.set("page", String(nextPage));
    return `/institutions?${search.toString()}`;
  };

  // The no-result state offers the source form, carrying the name that was searched for.
  const submitSourceHref = hasQuery
    ? `/submit-fees?${new URLSearchParams({ institutionName: query.trim() }).toString()}`
    : "/submit-fees";

  // A name search with no state picked: the results go straight under the search box.
  // Below the state map and filters they sat about three phone screens down.
  const resultsFirst = hasQuery && !hasState;
  // A render with a failed optional read is cached for a minute, not an hour (#1572).
  // An incomplete count (a read that answered but failed inside) is retried in a minute too.
  if (budget.failed() || !stats.complete) await shortenPageLife();
  const resultsSection = shouldShowResults && (
    <>
      {results.total > 0 && (
        <section className="fi-reveal fi-reveal-delay-2 pt-5">
          <div className="mb-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-muted">
              {selectedStateName ? `${selectedStateName} directory` : "Search results"}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              {results.total.toLocaleString("en-US")} institution{results.total !== 1 ? "s" : ""} found
              {query && (
                <span>
                  {" "}for <strong className="text-ink">{query}</strong>
                </span>
              )}
              . Institutions with published fees are listed first.
            </p>
          </div>

          <InstitutionMobileCards rows={results.rows} coverage={coverage} focus={focus} />
          <InstitutionResultsTable rows={results.rows} coverage={coverage} focus={focus} />
          <DirectoryPagination page={page} totalPages={totalPages} buildHref={buildPageHref} />
        </section>
      )}

      {results.total === 0 && (
        <div className="fi-reveal fi-reveal-delay-2 py-8 text-center">
          <p className="text-sm text-ink-muted">
            No institutions found. Try adjusting your search or filters.
          </p>
          <p className="mt-2 text-sm">
            <Link
              href={submitSourceHref}
              className="font-semibold text-brick underline-offset-2 hover:underline"
            >
              Can&apos;t find the institution? Send its fee schedule
            </Link>
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-muted">
            A link to the published schedule is enough. Reviewers check it against the source before
            any fee is published.
          </p>
        </div>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-page px-4 py-7 sm:px-6 sm:py-9">
        {focus && (
          <div className="fi-reveal mb-6 rounded-xl border border-brick/20 bg-white px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brick/80">
              Comparing {focus.label}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
              Search your institution below and its published {focus.label.toLowerCase()} appears
              alongside the national median
              {focus.median !== null && (
                <>
                  {" "}
                  of{" "}
                  <span className="font-semibold tabular-nums text-ink">
                    {formatAmount(focus.median)}
                  </span>
                </>
              )}
              .{" "}
              <Link href={`/fees/${focus.category}`} className="font-medium text-brick hover:underline">
                See the full {focus.label.toLowerCase()} analysis
              </Link>
            </p>
          </div>
        )}
        {/* `relative z-20` keeps the search dropdown above the sections that follow; see .fi-reveal. */}
        <section className="fi-reveal relative z-20 border-b border-border pb-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div className={`min-w-0 ${PAGE_HEADER}`}>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-muted">
                Institution Directory
              </p>
              <h1
                className="mx-auto mt-2 max-w-3xl text-4xl font-extrabold leading-[1.02] tracking-tight text-ink sm:mx-0 sm:text-5xl"
                style={{ fontFamily: "var(--fi-font-sans)" }}
              >
                Find your bank or credit union.
              </h1>
              {/* With a state picked, the intro and statistics give way so the list sits higher. */}
              {!hasState && (
                <>
                  <p className="mx-auto mt-3 max-w-[34rem] text-base leading-relaxed text-ink-soft sm:mx-0 sm:max-w-2xl">
                    Pick your state, then your bank or credit union, to see its published fees and
                    how they compare.
                  </p>
                  {stats.institutionsLabel !== UNAVAILABLE_LABEL && (
                    <p className="mt-1 text-sm text-ink-muted">
                      Published fees for {stats.institutionsLabel} institutions and growing.
                    </p>
                  )}
                </>
              )}
              {/* The search box and its suggestions stay left-aligned under the centered phone header. */}
              <div className="mx-auto mt-5 max-w-2xl text-left sm:mx-0">
                <InstitutionSearchBar
                  autoFocus={!hasQuery}
                  initialQuery={query}
                  ariaLabel="Search institution name, city, or state"
                  placeholder="Search institution name, city, or state..."
                />
              </div>
            </div>

            {!hasState && (
              <div className="grid grid-cols-3 divide-x divide-border border-y border-border bg-surface-0">
                <DirectoryStat label="Institutions with published fees" value={stats.institutionsLabel} />
                <DirectoryStat label="Published fees" value={stats.observationsLabel} />
                <DirectoryStat label="Institutions monitored" value={stats.monitoredLabel} />
              </div>
            )}
          </div>
        </section>

        {resultsFirst && resultsSection}

        <StateDirectoryMap
          summaries={stateSummaries}
          selectedStateCode={stateCode}
          query={hasQuery ? query : ""}
          charterType={charterType}
          feeCategory={focusCategory}
        />

        <DirectoryFilters
          query={query}
          stateCode={stateCode}
          charterType={charterType}
          feeCategory={focusCategory}
        />

        {!shouldShowResults && (
          <section className="fi-reveal fi-reveal-delay-2 py-6">
            <div className="border-y border-border py-4">
              <p className="text-sm font-semibold text-ink">
                Select a state to view institution profiles.
              </p>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
                Or search by name above to jump straight to an institution.
              </p>
            </div>
          </section>
        )}

        {!resultsFirst && resultsSection}
      </div>
    </div>
  );
}

function DirectoryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-3">
      <p className="text-[11px] font-bold uppercase leading-tight tracking-[0.1em] text-ink-muted">
        {label}
      </p>
      <p className="mt-1 truncate text-base font-semibold tabular-nums text-ink" title={value}>
        {value}
      </p>
    </div>
  );
}
