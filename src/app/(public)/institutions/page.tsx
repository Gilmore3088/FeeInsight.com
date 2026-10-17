export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import type { InstitutionSearchResult } from "@/lib/data-store/search";
import { getPublicCategorySummaries, getPublicStatsSummary } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { PRODUCT_NAME } from "@/lib/constants";
import { linkPreview } from "@/lib/link-preview";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PAGE_H1, PAGE_HEADER, PAGE_LEDE } from "@/components/public/page-header";
import { getInstitutionStateDirectorySummariesCached, searchInstitutionsCached } from "@/lib/data-store/public-cached-reads";
import { HEADLINE_FEE_KEYS, getInstitutionHeadlineCoverage } from "@/lib/data-store/market-readiness";
import { SourceNote } from "../research/district/[id]/district-hub";
import { InstitutionSearchBar } from "./search-bar";
import { StateDirectoryMap } from "./state-directory-map";
import { StatePicker } from "./directory-filters";
import { StateList } from "./state-list";
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
  coverageFinding,
  directoryHref,
  nationalCoverage,
  normalizeCharter,
  normalizeStateCode,
  percentLabel,
  reportCta,
  stateCoverage,
  stateFinding,
  stateRows,
  type Charter,
} from "./directory-view";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    state?: string;
    charter?: string;
    page?: string;
    /** A fee category to compare, arriving from a consumer guide ("check your own bank"). */
    fee?: string;
  }>;
}

const DESCRIPTION =
  "Look up any U.S. bank or credit union by name or state and see the fees it publishes, from overdraft to wire fees, each from its own schedule.";

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
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
  if (firstPass.total <= DIRECTORY_SORT_WINDOW) {
    return {
      rows: paginate(sortVerifiedFirst(firstPass.rows), params.page, DIRECTORY_PAGE_SIZE),
      total: firstPass.total,
      published: firstPass.rows.filter(hasVerifiedFees).length,
    };
  }
  const paged = await searchInstitutionsCached({ ...params, pageSize: DIRECTORY_PAGE_SIZE });
  return { rows: sortVerifiedFirst(paged.rows), total: paged.total, published: null };
}

const COUNT = new Intl.NumberFormat("en-US");
const H2 = "text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]";
const FINDING = "mt-2 text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left";
const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";
const STATE_ROWS_SHOWN = 5;

export default async function InstitutionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = (params.q || "").trim();
  const stateCode = normalizeStateCode(params.state);
  const charter: Charter = normalizeCharter(params.charter);
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  // Validated against the taxonomy: an unknown value degrades to the plain directory.
  const focusCategory = params.fee && TAXONOMY.has(params.fee) ? params.fee : "";

  const hasQuery = query.length >= 2;
  const hasState = Boolean(stateCode);
  const shouldShowResults = hasQuery || hasState;
  const [stats, summaries, results, categorySummaries, sampleLive] = await Promise.all([
    getPublicStatsSummary(),
    getInstitutionStateDirectorySummariesCached({ charter_type: charter || undefined }).catch((error: unknown) => {
      console.error("Directory state summaries failed:", error);
      return [];
    }),
    shouldShowResults
      ? loadResults({
          query: hasQuery ? query : undefined,
          state_code: stateCode || undefined,
          charter_type: charter || undefined,
          fee_category: focusCategory || undefined,
          page,
        })
      : Promise.resolve<DirectoryResults>({ rows: [], total: 0, published: null }),
    focusCategory ? getPublicCategorySummaries() : Promise.resolve([]),
    sampleReportAvailable().catch(() => false),
  ]);

  // One read for the visible page only. On failure the rows fall back to "Fees published"
  // rather than showing a made-up count.
  const coverage =
    results.rows.length > 0
      ? await getInstitutionHeadlineCoverage(results.rows.map((row) => row.id)).catch((error: unknown) => {
          console.error("Directory headline coverage failed:", error);
          return null;
        })
      : null;

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
  const headline = hasState ? (picked ? coverageFinding(picked, charter, stateName) : null) : national ? coverageFinding(national, charter) : null;

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

  return (
    <div className="min-h-screen bg-paper text-ink">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Institutions", href: "/institutions" },
          ...(stateCode ? [{ name: stateName, href: `/institutions?state=${stateCode}` }] : []),
        ]}
      />
      <div className="mx-auto max-w-page px-4 pb-14 pt-7 sm:px-6 sm:pb-20 sm:pt-10">
        {/* `relative z-20` keeps the search suggestions above the sections that follow; see .fi-reveal. */}
        <section aria-labelledby="directory-heading" className="fi-reveal relative z-20">
          <div className={PAGE_HEADER}>
            <h1 id="directory-heading" className={PAGE_H1}>
              {hasState ? `${stateName} ${charterNoun(charter)}` : "Bank and credit union fees by institution"}
            </h1>
            {headline && <p className={`mt-3 ${PAGE_LEDE}`}>{headline}</p>}
            {focus && !shouldShowResults && (
              <p className={`mt-2 ${PAGE_LEDE}`}>
                Results show each institution&apos;s published {focus.label.toLowerCase()} fee beside the national median
                {focus.median !== null && ` of ${formatAmount(focus.median)}`}.
              </p>
            )}
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_220px] lg:items-center">
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
        </section>

        {shouldShowResults && (
          <section aria-labelledby="results-heading" className="fi-reveal fi-reveal-delay-1 mt-10 sm:mt-12">
            <h2 id="results-heading" className={`${H2} text-center sm:text-left`}>
              {resultsTitle}
            </h2>
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
                <InstitutionMobileCards rows={results.rows} coverage={coverage} focus={focus} />
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

        {!hasState && rows.length > 0 && (
          <section aria-labelledby="states-heading" className="fi-reveal fi-reveal-delay-2 mt-10 border-t border-border pt-8 sm:mt-12 sm:pt-10">
            <h2 id="states-heading" className={`${H2} text-center sm:text-left`}>
              Coverage by state
            </h2>
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
          </section>
        )}

        {/* One next step for bank and credit union teams, leading to the sample report and then Pro. */}
        <section aria-labelledby="teams-heading" className="mt-12 rounded-2xl border border-border bg-surface-0 p-5 sm:mt-16 sm:flex sm:items-center sm:justify-between sm:gap-8 sm:p-7">
          <div className="min-w-0 text-center sm:text-left">
            <h2 id="teams-heading" className="text-[18px] font-semibold text-ink sm:text-[20px]">
              For bank and credit union teams
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-soft sm:mx-0 sm:max-w-2xl sm:text-left">
              The Competitive Fee Position Report sets one institution&apos;s fees beside its market, with the source for each figure.
            </p>
          </div>
          <div className="mt-4 flex shrink-0 flex-col items-center gap-2 sm:mt-0 sm:items-end">
            <TrackLink
              event={cta.event}
              eventProps={{ placement: "institutions_teams_band" }}
              href={cta.href}
              className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
            >
              {cta.label}
            </TrackLink>
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "institutions_teams_band" }}
              href={PRO_PLANS_NAV.href}
              className={`inline-flex min-h-11 items-center text-[14px] ${LINK}`}
            >
              {PRO_PLANS_NAV.label}
            </TrackLink>
          </div>
        </section>

      </div>
    </div>
  );
}
