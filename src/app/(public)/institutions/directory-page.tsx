import type { Metadata } from "next";
import Link from "next/link";
import { institutionNameRank, type InstitutionSearchResult } from "@/lib/data-store/search";
import { getPublicCategorySummaries, getPublicStatsSummary, UNAVAILABLE_PUBLIC_STATS } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { PRODUCT_NAME } from "@/lib/constants";
import { linkPreview } from "@/lib/link-preview";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { ArrowLeft, Users } from "lucide-react";
import { SERIF } from "@/app/landing-shared";
import { homeSerif } from "@/app/landing-serif";
import { getInstitutionStateDirectorySummariesCached, searchInstitutionsCached } from "@/lib/data-store/public-cached-reads";
import { HEADLINE_FEE_KEYS, getInstitutionHeadlineCoverage } from "@/lib/data-store/market-readiness";
import { SourceNote } from "../research/district/[id]/district-hub";
import { InstitutionSearchBar } from "./search-bar";
import { StateDirectoryMap } from "./state-directory-map";
import { StatePicker } from "./directory-filters";
import { StateList } from "./state-list";
import { CoverageMeter } from "./coverage-meter";
import { CoverageDisclosure } from "./coverage-disclosure";
import "./directory.css";
import { createReadBudget } from "@/lib/read-deadline";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import {
  DirectoryPagination,
  InstitutionMobileCards,
  InstitutionResultsTable,
  type FeeFocus,
} from "./institution-results";
import { DIRECTORY_PAGE_SIZE, DIRECTORY_SORT_WINDOW, hasVerifiedFees, paginate, sortVerifiedFirst } from "./directory-sort";
import {
  CHARTER_OPTIONS,
  bandsInUse,
  charterNoun,
  directoryHref,
  nationalCoverage,
  normalizeCharter,
  normalizeStateCode,
  percentLabel,
  reportCta,
  stateCoverage,
  coverageFinding,
  stateFinding,
  stateSummaryLine,
  stateRows,
  type Charter,
} from "./directory-view";

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

/**
 * One deadline for the directory's database reads (#1919): with the connection pool
 * saturated the page sat on its loading skeleton for minutes. Past it, the error
 * boundary answers instead, and the per-row fee coverage drops out.
 */
const DIRECTORY_READ_BUDGET_MS = 15_000;

const DESCRIPTION =
  "Look up any U.S. bank or credit union by name or state and see the fees it publishes, from overdraft to wire fees, each from its own schedule.";

export function directoryMetadata(params: DirectoryParams): Metadata {
  const stateCode = normalizeStateCode(params.state);
  const stateName = stateCode ? STATE_NAMES[stateCode] : "";
  const title = stateName ? `${stateName} Banks and Credit Unions: Published Fees` : "Bank and Credit Union Fees by Institution";
  const description = stateName
    ? `Every ${stateName} bank and credit union the ${PRODUCT_NAME} monitors, with the fees each one publishes, from its own schedule.`
    : DESCRIPTION;
  const path = stateCode ? `/institutions?state=${stateCode}` : "/institutions";
  // Name searches, type filters and later pages are views of the same list: keep them out of search.
  const isView = Boolean(params.q || params.charter || params.fee || (params.page && params.page !== "1"));
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
  total: number;
  /** Matches with published fees, when the whole match set was read in one window; else null. */
  published: number | null;
}

/**
 * Published-first ordering across the whole result set when it fits in one window; otherwise
 * the current page is sorted on its own.
 */
async function loadResults(params: {
  query?: string;
  state_code?: string;
  charter_type?: string;
  fee_category?: string;
  page: number;
}): Promise<DirectoryResults> {
  const firstPass = await searchInstitutionsCached({ ...params, page: 1, pageSize: DIRECTORY_SORT_WINDOW });
  // A name search puts the institution it names first among equals ("US Bank": U.S. Bank, then First US Bank).
  const query = params.query;
  const nameRank = query ? (name: string) => institutionNameRank(name, query) : undefined;
  if (firstPass.total <= DIRECTORY_SORT_WINDOW) {
    return {
      rows: paginate(sortVerifiedFirst(firstPass.rows, nameRank), params.page, DIRECTORY_PAGE_SIZE),
      total: firstPass.total,
      published: firstPass.rows.filter(hasVerifiedFees).length,
    };
  }
  const paged = await searchInstitutionsCached({ ...params, pageSize: DIRECTORY_PAGE_SIZE });
  return { rows: sortVerifiedFirst(paged.rows, nameRank), total: paged.total, published: null };
}

const COUNT = new Intl.NumberFormat("en-US");
const H2 = "text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]";
const FINDING = "mt-2 text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left";
const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";
const STATE_ROWS_SHOWN = 5;

export async function InstitutionsDirectory({ params }: { params: DirectoryParams }) {
  const query = (params.q || "").trim();
  const stateCode = normalizeStateCode(params.state);
  const charter: Charter = normalizeCharter(params.charter);
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  // Validated against the taxonomy: an unknown value degrades to the plain directory.
  const focusCategory = params.fee && TAXONOMY.has(params.fee) ? params.fee : "";

  const hasQuery = query.length >= 2;
  const hasState = Boolean(stateCode);
  const shouldShowResults = hasQuery || hasState;
  const budget = createReadBudget(DIRECTORY_READ_BUDGET_MS, "Directory");
  const [stats, summaries, results, categorySummaries, sampleLive] = await Promise.all([
    // Optional: a slow count at build time must not fail the whole deploy (#1988).
    budget.optional(getPublicStatsSummary(), "public stats", UNAVAILABLE_PUBLIC_STATS),
    // The cached directory is also rendered at build time: a failed read draws the map without
    // its counts for a minute (shortenPageLife below) instead of failing the build or the page.
    budget.optional(getInstitutionStateDirectorySummariesCached({ charter_type: charter || undefined }), "state summaries", []),
    shouldShowResults
      ? budget.required(
          loadResults({
            query: hasQuery ? query : undefined,
            state_code: stateCode || undefined,
            charter_type: charter || undefined,
            fee_category: focusCategory || undefined,
            page,
          }),
          "search results",
        )
      : Promise.resolve<DirectoryResults>({ rows: [], total: 0, published: null }),
    focusCategory ? budget.optional(getPublicCategorySummaries(), "category summaries", []) : Promise.resolve([]),
    sampleReportAvailable().catch(() => false),
  ]);

  // One read for the visible page only. On failure the rows fall back to "Fees published"
  // rather than showing a made-up count.
  const coverage =
    results.rows.length > 0
      ? await budget.optional(getInstitutionHeadlineCoverage(results.rows.map((row) => row.id)), "headline coverage", null)
      : null;
  // A render with a failed optional read is cached for a minute, not an hour (#1572).
  if (budget.failed() || !stats.complete) await shortenPageLife();

  const focus: FeeFocus | null = focusCategory
    ? {
        category: focusCategory,
        label: plainLabel(focusCategory),
        median: categorySummaries.find((s) => s.fee_category === focusCategory)?.median_amount ?? null,
      }
    : null;

  const stateName = stateCode ? STATE_NAMES[stateCode] : "";
  const national = nationalCoverage(stats, summaries, charter);
  const picked = stateCode ? stateCoverage(summaries.find((s) => s.state_code === stateCode)) : null;
  const heroCoverage = hasState ? picked : national;

  const rows = stateRows(summaries);
  const bands = bandsInUse(summaries.filter((s) => STATE_NAMES[s.state_code]));
  const byState = stateFinding(rows);

  const keep = { q: hasQuery ? query : "", charter, fee: focusCategory };
  const totalPages = Math.ceil(results.total / DIRECTORY_PAGE_SIZE);
  const buildPageHref = (nextPage: number) => directoryHref({ ...keep, state: stateCode, page: nextPage });
  const stateHref = (code: string) => directoryHref({ ...keep, state: code });
  const cta = reportCta(sampleLive);

  // The no-result state offers the source form, carrying the name that was searched for.
  const submitSourceHref = hasQuery
    ? `/submit-fees?${new URLSearchParams({ institutionName: query }).toString()}`
    : "/submit-fees";

  const resultsTitle = hasQuery ? "Search results" : "Institutions";
  // A state-only view: the lede already gives the state's count and its published share.
  const stateOnly = hasState && !hasQuery;
  const matchLine = `${COUNT.format(results.total)} ${results.total === 1 ? "institution" : "institutions"}${
    hasQuery ? ` ${results.total === 1 ? "matches" : "match"} \u201c${query}\u201d` : ""
  }${hasQuery && hasState ? ` in ${stateName}` : ""}.`;
  const publishedLine =
    results.total === 0 || results.published === null
      ? results.total > 1
        ? "Institutions with published fees are listed first."
        : ""
      : results.total === 1
        ? results.published === 1
          ? "It has published fees."
          : "It has no published fees yet."
        : results.published === 0
          ? "None has published fees yet."
          : results.published === results.total
            ? "All have published fees."
            : `${COUNT.format(results.published)} ${results.published === 1 ? "has" : "have"} published fees and ${
                results.published === 1 ? "is" : "are"
              } listed first.`;
  const focusLine =
    focus && focus.median !== null ? `The national median ${focus.label.toLowerCase()} fee is ${formatAmount(focus.median)}.` : "";
  const resultsFinding = (stateOnly ? [focusLine] : [matchLine, publishedLine, focusLine]).filter(Boolean).join(" ");

  const resultsSource = (
    <SourceNote label="Source">
      Fees from each institution&apos;s own published schedule in the {PRODUCT_NAME}; institutions from FDIC and NCUA records,
      counted by headquarters state. {stats.freshnessLabel}.
    </SourceNote>
  );
  // The method sits under the first source line on the page, after the section it explains.
  const method = (
  <details className="group mt-4 text-center sm:text-left">
    <summary className="mx-auto inline-flex sm:mx-0 min-h-11 cursor-pointer list-none items-center gap-2 text-[14px] font-medium text-ink [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" className="text-ink-muted group-open:rotate-90 transition-transform">
        &#8250;
      </span>
      How coverage is counted
    </summary>
    <div className="mx-auto mt-2 max-w-3xl space-y-2 text-[13px] leading-relaxed text-ink-muted sm:mx-0">
      <p className="sm:mx-0 sm:text-left">
        An institution has published fees when at least one fee from its own current schedule has passed review and is live in
        the {PRODUCT_NAME}. Institutions monitored are every bank and credit union in the index, from FDIC and NCUA records.
      </p>
      <p className="sm:mx-0 sm:text-left">
        The coverage label on each result counts how many of the {HEADLINE_FEE_KEYS.length} headline fees are published for
        that institution: {HEADLINE_FEE_KEYS.map((key) => plainLabel(key).toLowerCase()).join(", ")}. Under review means fees
        were found and are still being checked; None yet means no fee from the institution is live.
      </p>
    </div>
  </details>
  );

  const coverageBody = (
    <>
      {byState && <p className={`${FINDING} text-center`}>{byState}</p>}
      <figure className="mt-6 min-w-0">
        <figcaption className="text-[13px] font-semibold text-ink">
          {charter
            ? `Share of ${charterNoun(charter)} with published fees, by state`
            : "Share of institutions with published fees, by state"}
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
      <div className="mt-6">
        <SourceNote label="Source">
          Institutions monitored in the {PRODUCT_NAME}, from FDIC and NCUA records and counted by headquarters state, against
          those with at least one fee published from their own schedule. {stats.freshnessLabel}.
        </SourceNote>
      </div>
      {!(shouldShowResults && results.total > 0) && method}
    </>
  );

  return (
    <div className={`${homeSerif.variable} min-h-screen overflow-x-clip bg-paper text-ink`}>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Institutions", href: "/institutions" },
          ...(stateCode ? [{ name: stateName, href: `/institutions?state=${stateCode}` }] : []),
        ]}
      />
      {/* The search hero: navy band with a curved edge, the coverage figure, and the search card hanging
          over the curve. `relative z-20` keeps the search suggestions above the sections that follow. */}
      <section aria-labelledby="directory-heading" className="fi-directory-hero relative isolate z-20 pt-8 sm:pt-10 lg:pt-14">
        <div className="mx-auto max-w-page px-4 sm:px-6">
          <div
            className={
              heroCoverage
                ? "lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-end lg:gap-14"
                : undefined
            }
          >
            <div className="fi-reveal min-w-0">
              {hasState && (
                <Link
                  href={directoryHref({ ...keep, state: "" })}
                  prefetch={false}
                  className="inline-flex min-h-11 items-center gap-1.5 text-[14px] text-[#d9e2e9] hover:text-white"
                >
                  <ArrowLeft aria-hidden="true" className="size-4" />
                  All states
                </Link>
              )}
              <h1
                id="directory-heading"
                className={`${hasState ? "mt-1" : ""} text-[38px] font-medium leading-[1.04] tracking-[-0.025em] text-white sm:text-[52px] lg:text-[64px]`}
                style={SERIF}
              >
                {hasState ? `${stateName} ${charterNoun(charter)}` : "Find any bank or credit union’s fees"}
              </h1>
              {focus && (
                <p className="mt-4 max-w-2xl text-[16px] leading-snug text-[#e0e9ee] sm:text-[18px]">
                  Each result shows its {focus.label.toLowerCase()} fee
                  {focus.median !== null && ` beside the ${formatAmount(focus.median)} national median`}.
                </p>
              )}
            </div>
            {heroCoverage && (
              <CoverageMeter
                coverage={heroCoverage}
                charter={charter}
                stateName={hasState ? stateName : undefined}
                // With results on a phone, the results come first; the coverage line folds below them.
                className={`fi-reveal fi-reveal-delay-1 mt-8 lg:mt-0 ${shouldShowResults ? "hidden sm:block" : ""}`}
              />
            )}
          </div>

          <div className="fi-reveal fi-reveal-delay-1 mt-8 grid gap-3 rounded-2xl border border-border bg-surface-0 p-3 shadow-[0_18px_40px_-24px_rgba(16,45,67,0.45)] sm:p-4 lg:mt-12 lg:grid-cols-[minmax(0,1fr)_auto_220px] lg:items-center">
            <InstitutionSearchBar
              initialQuery={query}
              ariaLabel="Search by bank or credit union name"
              placeholder="Bank or credit union name"
            />
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
                        className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-[14px] font-medium transition-colors ${
                          active ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink"
                        }`}
                      >
                        {option.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <StatePicker query={keep.q} stateCode={stateCode} charter={charter} fee={focusCategory} />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-page px-4 pb-14 sm:px-6 sm:pb-20">
        {shouldShowResults && (
          <section aria-labelledby="results-heading" className="fi-reveal fi-reveal-delay-2 mt-8 sm:mt-12">
            <h2 id="results-heading" className={`${H2} text-center sm:text-left`}>
              {resultsTitle}
            </h2>
            {/* On a phone the hero's coverage meter steps aside for the results; a state view keeps its figure here. */}
            {hasState && picked && (
              <p className={`${FINDING} text-center sm:hidden`}>{coverageFinding(picked, charter, stateName)}</p>
            )}
            {(resultsFinding || focus) && (
              <p className={`${FINDING} text-center`}>
                {resultsFinding}
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
            )}

            {results.total > 0 ? (
              <div className="mt-5">
                <InstitutionMobileCards rows={results.rows} focus={focus} />
                <InstitutionResultsTable rows={results.rows} coverage={coverage} focus={focus} />
                <DirectoryPagination page={page} totalPages={totalPages} buildHref={buildPageHref} />
                <div className="mt-6">{resultsSource}</div>
                {method}
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-dashed border-border px-5 py-8 text-center">
                <p className="text-[15px] text-ink-soft">
                  {hasQuery ? `No ${charterNoun(charter)} match “${query}”${hasState ? ` in ${stateName}` : ""}.` : `No ${charterNoun(charter)} found.`}
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
            )}
          </section>
        )}

        {rows.length > 0 && (
          <section
            aria-labelledby="states-heading"
            className={`fi-reveal fi-reveal-delay-2 ${
              shouldShowResults ? "mt-10 sm:mt-12" : "mt-12 sm:mt-16"
            }`}
          >
            <CoverageDisclosure
              collapsed={shouldShowResults}
              headingId="states-heading"
              title="Coverage by state"
              summary={stateSummaryLine(rows)}
              heading={
                <h2 id="states-heading" className={`${H2} text-center sm:text-left`}>
                  Coverage by state
                </h2>
              }
            >
              {coverageBody}
            </CoverageDisclosure>
          </section>
        )}

        {/* The page's one next step: Hamilton, with the sample report for teams not ready to subscribe. */}
        <section
          aria-labelledby="hamilton-heading"
          className="fi-reveal mt-14 border-t border-border pt-10 sm:mt-16 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-12"
        >
          <div className="min-w-0 text-center sm:text-left">
            <h2 id="hamilton-heading" className="text-[34px] font-medium leading-[1.05] tracking-[-0.02em] text-ink sm:text-[44px]" style={SERIF}>
              <span className="block text-brick">Hey Hamilton,</span>
              <span className="block">how do our fees compare with our peers?</span>
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left">Named peers in your market, each fee linked to its schedule.</p>
          </div>
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:gap-x-7 lg:mt-0">
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "institutions_hamilton_band" }}
              href={PRO_PLANS_NAV.href}
              className="fi-btn fi-btn-brick min-h-12 px-7 text-[15px]"
            >
              <Users aria-hidden="true" className="size-4" />
              Track your peers in Hamilton
            </TrackLink>
            <TrackLink
              event={cta.event}
              eventProps={{ placement: "institutions_hamilton_band" }}
              href={cta.href}
              className={`inline-flex min-h-11 items-center text-[15px] ${LINK}`}
            >
              {cta.label}
            </TrackLink>
          </div>
        </section>
      </div>
    </div>
  );
}
