export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import type { InstitutionSearchResult, InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import { getPublicCategorySummaries, getPublicStatsSummary } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { PRODUCT_NAME, REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { TrackLink } from "@/components/track-link";
import {
  UnstatedAudienceFootnote,
  UnstatedAudienceMark,
  medianHasUnstatedAudience,
} from "@/components/unstated-audience";
import { InstitutionSearchBar } from "./search-bar";
import { StateExplorer } from "./state-explorer";
import { CoverageBar } from "./coverage-bar";
import {
  DirectoryPagination,
  InstitutionMobileCards,
  InstitutionResultsTable,
  type FeeFocus,
} from "./institution-results";
import { DIRECTORY_PAGE_SIZE, DIRECTORY_SORT_WINDOW, paginate, sortVerifiedFirst } from "./directory-sort";
import {
  CHARTER_OPTIONS,
  DEMO_CTA,
  charterNoun,
  directoryHref,
  namedStates,
  normalizeCharter,
  normalizeStateCode,
  percentLabel,
  publishedShare,
  reportCta,
  totalSummary,
  type Charter,
} from "./directory-view";
import { getInstitutionStateDirectorySummariesCached, searchInstitutionsCached } from "@/lib/data-store/public-cached-reads";
import { getInstitutionHeadlineCoverage } from "@/lib/data-store/market-readiness";

export const metadata: Metadata = {
  title: "Find your bank or credit union",
  description: `Search U.S. banks and credit unions and see each one's published fees, from the ${PRODUCT_NAME}.`,
};

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

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());
const COUNT = new Intl.NumberFormat("en-US");

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

export default async function InstitutionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = params.q || "";
  const stateCode = normalizeStateCode(params.state);
  const charter = normalizeCharter(params.charter);
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  // Validated against the taxonomy: an unknown value degrades to the plain directory.
  const focusCategory = params.fee && TAXONOMY.has(params.fee) ? params.fee : "";

  const hasQuery = query.trim().length >= 2;
  const hasState = Boolean(stateCode);
  const shouldShowResults = hasQuery || hasState;
  const [stats, stateSummaries, results, categorySummaries, sampleLive] = await Promise.all([
    getPublicStatsSummary(),
    // A failed read hides the map rather than drawing every state empty.
    getInstitutionStateDirectorySummariesCached({ charter_type: charter || undefined }).catch((error: unknown) => {
      console.error("Directory state summaries failed:", error);
      return [] as InstitutionStateDirectorySummary[];
    }),
    // A failed search says so rather than showing "0 institutions".
    shouldShowResults
      ? loadResults({
          query: hasQuery ? query : undefined,
          state_code: stateCode || undefined,
          charter_type: charter || undefined,
          fee_category: focusCategory || undefined,
          page,
        }).catch((error: unknown): DirectoryResults | null => {
          console.error("Directory search failed:", error);
          return null;
        })
      : Promise.resolve<DirectoryResults | null>({ rows: [], total: 0 }),
    focusCategory ? getPublicCategorySummaries().catch(() => []) : Promise.resolve([]),
    sampleReportAvailable().catch(() => false),
  ]);

  // One read for the visible page only. On failure the rows fall back to "Fees published"
  // rather than showing a made-up count.
  const coverage =
    results && results.rows.length > 0
      ? await getInstitutionHeadlineCoverage(results.rows.map((row) => row.id)).catch((error: unknown) => {
          console.error("Directory headline coverage failed:", error);
          return null;
        })
      : null;

  const focusSummary = focusCategory ? categorySummaries.find((s) => s.fee_category === focusCategory) : undefined;
  const focus: FeeFocus | null = focusCategory
    ? { category: focusCategory, label: plainLabel(focusCategory), median: focusSummary?.median_amount ?? null }
    : null;
  const focusUnstated = medianHasUnstatedAudience(focusSummary);

  const states = namedStates(stateSummaries);
  const pickedSummary = hasState ? states.find((s) => s.state_code === stateCode) ?? null : null;
  const stateName = hasState ? STATE_NAMES[stateCode] : "";
  const totalPages = results ? Math.ceil(results.total / DIRECTORY_PAGE_SIZE) : 0;
  // One "with published fees" number on the page: the hero counts what the map counts (and
  // follows the type switch), falling back to the site total only when the state read failed.
  const heroCount = states.length > 0 ? totalSummary(states).verified_institution_count : stats.institutions;
  const heroCountLabel = states.length > 0 ? COUNT.format(heroCount) : stats.institutionsLabel;
  const keep = { q: query, state: stateCode, charter, fee: focusCategory };

  // The no-result state offers the source form, carrying the name that was searched for.
  const submitSourceHref = hasQuery
    ? `/submit-fees?${new URLSearchParams({ institutionName: query.trim() }).toString()}`
    : "/submit-fees";

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-page px-4 py-6 sm:px-6 sm:py-9">
        {focus && (
          <div className="fi-reveal mb-5 rounded-xl border border-brick/20 bg-surface-0 px-4 py-3 text-[14px] leading-relaxed text-ink-soft">
            Comparing <span className="font-semibold text-ink">{focus.label.toLowerCase()} fees</span>
            {focus.median !== null && (
              <>
                . National median{" "}
                <span className="font-semibold tabular-nums text-ink">{formatAmount(focus.median)}</span>
                <UnstatedAudienceMark show={focusUnstated} />
              </>
            )}
            .{" "}
            <Link href={`/fees/${focus.category}`} className="font-medium text-brick hover:underline">
              Full {focus.label.toLowerCase()} analysis
            </Link>
            <UnstatedAudienceFootnote show={focusUnstated} className="mt-1" />
          </div>
        )}

        {/* `relative z-20` keeps the search dropdown above the sections that follow; see .fi-reveal. */}
        <section className="fi-reveal relative z-20 border-b border-border pb-5">
          <h1
            className="text-[2rem] font-extrabold leading-[1.08] tracking-[-0.02em] text-ink sm:text-5xl"
            style={{ fontFamily: "var(--fi-font-sans)" }}
          >
            Find your bank or credit union
          </h1>
          {!hasState && heroCount > 0 && (
            <p className="mt-2 text-[15px] text-ink-muted">
              <span className="font-semibold tabular-nums text-ink">{heroCountLabel}</span> {charterNoun(charter)} with
              published fees.
            </p>
          )}
          <div className="mt-4 max-w-2xl">
            <InstitutionSearchBar
              autoFocus={!hasQuery && !hasState}
              initialQuery={query}
              ariaLabel="Search by institution name, city or state"
              placeholder="Name, city or state"
            />
          </div>
          <CharterSwitch current={charter} keep={keep} />
        </section>

        {hasState && (
          <section aria-label={`${stateName} coverage`} className="fi-reveal border-b border-border py-5">
            <div className="flex flex-wrap items-center justify-between gap-x-4">
              <p className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{stateName}</p>
              <div className="flex flex-wrap items-center gap-x-4">
                <Link
                  href={`/research/state/${stateCode}`}
                  className="inline-flex min-h-11 items-center text-[14px] font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                >
                  {stateName} fee report
                </Link>
                <Link
                  href={directoryHref({ ...keep, state: "" })}
                  prefetch={false}
                  className="inline-flex min-h-11 items-center text-[14px] font-semibold text-brick underline-offset-2 hover:underline"
                >
                  Change state
                </Link>
              </div>
            </div>
            {pickedSummary && pickedSummary.institution_count > 0 && (
              <div className="mt-1 max-w-xl">
                <p className="mb-2 text-[13px] text-ink-muted">
                  {percentLabel(publishedShare(pickedSummary))} of {COUNT.format(pickedSummary.institution_count)}{" "}
                  {charter ? charterNoun(charter) : "institutions"} have published fees
                </p>
                <CoverageBar summary={pickedSummary} />
              </div>
            )}
          </section>
        )}

        {/* Results sit straight under the search (or the picked state); the map follows a name search. */}
        {shouldShowResults && results === null && (
          <section aria-label="Results" className="py-6">
            <p role="status" className="text-[15px] text-ink-muted">
              Search is unavailable right now.
            </p>
          </section>
        )}
        {shouldShowResults && results !== null && (
          <section aria-labelledby="results-heading" className="fi-reveal fi-reveal-delay-1 py-6">
            <h2 id="results-heading" className="text-[15px] font-normal text-ink-muted">
              <span className="font-semibold tabular-nums text-ink">{COUNT.format(results.total)}</span>{" "}
              {results.total === 1 ? "institution" : "institutions"}
              {hasQuery && (
                <>
                  {" "}for <span className="font-semibold text-ink">{query}</span>
                </>
              )}
              {hasState && <> in {stateName}</>}
            </h2>
            {results.total > 0 ? (
              <>
                <p className="mb-4 mt-0.5 text-[13px] text-ink-muted">Published fees first.</p>
                <InstitutionMobileCards rows={results.rows} coverage={coverage} focus={focus} />
                <InstitutionResultsTable rows={results.rows} coverage={coverage} focus={focus} />
                <DirectoryPagination
                  page={page}
                  totalPages={totalPages}
                  buildHref={(p) => directoryHref({ ...keep, page: p })}
                />
              </>
            ) : (
              <Link
                href={submitSourceHref}
                className="mt-2 inline-flex min-h-11 items-center text-[14px] font-semibold text-brick underline-offset-2 hover:underline"
              >
                Can&apos;t find it? Send its fee schedule
              </Link>
            )}
          </section>
        )}

        {!hasState && states.length > 0 && (
          <StateExplorer summaries={states} query={hasQuery ? query : ""} charter={charter} fee={focusCategory} />
        )}

        <BankStaffCta sampleLive={sampleLive} />
      </div>
    </div>
  );
}

/** Banks, credit unions or both. Each is a link, so the choice is in the URL and the back button. */
function CharterSwitch({ current, keep }: { current: Charter; keep: { q: string; state: string; fee: string } }) {
  return (
    <nav aria-label="Institution type" className="mt-4">
      <ul className="inline-flex rounded-full bg-surface-0 p-1 ring-1 ring-border">
        {CHARTER_OPTIONS.map((option) => {
          const active = option.value === current;
          return (
            <li key={option.value || "all"}>
              <Link
                href={directoryHref({ ...keep, charter: option.value })}
                prefetch={false}
                aria-current={active ? "true" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold transition-colors ${
                  active ? "bg-ink text-on-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {option.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The one next step for bank and credit union staff, kept quieter than the directory itself. */
function BankStaffCta({ sampleLive }: { sampleLive: boolean }) {
  const cta = reportCta(sampleLive);
  return (
    <section aria-labelledby="staff-heading" className="mt-4 border-t border-border pt-6 print:hidden">
      <h2 id="staff-heading" className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
        Work at a bank or credit union?
      </h2>
      <p className="mt-1 max-w-xl text-[14px] text-ink-muted">
        The {REPORT_OFFER.name} puts your fees next to the institutions you compete with, {REPORT_PRICE_INLINE}.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <TrackLink
          event={cta.event}
          eventProps={{ placement: "institutions_directory" }}
          href={cta.href}
          className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
        >
          {cta.label}
        </TrackLink>
        <TrackLink
          event="contact_sales"
          eventProps={{ placement: "institutions_directory_demo" }}
          href={DEMO_CTA.href}
          className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          {DEMO_CTA.label}
        </TrackLink>
      </div>
    </section>
  );
}
