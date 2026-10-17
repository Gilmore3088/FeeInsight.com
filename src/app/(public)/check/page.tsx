export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getAlertSubscriptionForInstitution } from "@/lib/data-store/alerts";
import { ExternalLink } from "lucide-react";
import { getCityMarketCached, getStateFeeIndexesCached, searchInstitutionsCached } from "@/lib/data-store/public-cached-reads";
import type { InstitutionSearchResult } from "@/lib/data-store/search";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { formatAbsoluteDate, getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { SITE_URL } from "@/lib/constants";
import { REPORT_SHOWCASE } from "@/lib/report-showcase";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PAGE_HEADER } from "@/components/public/page-header";
import { InstitutionSearchBar } from "../institutions/search-bar";
import { FeeAlertControl } from "../institution/[id]/fee-alert-control";
import { getCharterLabel, toTitleCase } from "../institution/[id]/enum-labels";
import { MIN_VERIFIED_FEES_FOR_OFFER } from "../institution/[id]/profile-copy";
import { getPublicInstitutionForPage, getVisibleFeesForPage, isVerifiedFee } from "../institution/[id]/profile-data";
import { loadConsumerGuides } from "@/lib/guides/source";
import { SourceNote } from "../research/district/[id]/district-hub";
import { cityPath, titleCase } from "../fees/city/[state]/[city]/city-lookup";
import {
  avoidGuideHref,
  buildAlternatives,
  buildCheckRows,
  checkFinding,
  leadRow,
  lowerLabel,
  parseCheckId,
  stateGroupLabel,
} from "./check-data";
import { CheckTable } from "./check-table";
import { Alternatives } from "./alternatives";
import { CheckAnswerFocus } from "./answer-focus";

const TITLE = "Check a Bank's Fees Against the Market";
const DESCRIPTION =
  "Name a bank or credit union to see its published fees beside the U.S. and state medians, each linked to its own fee schedule.";

interface PageProps {
  searchParams: Promise<{ id?: string; q?: string }>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  // One indexable page; an answer for one institution lives canonically on its profile.
  const hasInput = Boolean(params.id || params.q);
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: `${SITE_URL}/check` },
    robots: hasInput ? { index: false, follow: true } : undefined,
    openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/check`, siteName: "Fee Insight" },
  };
}

/** The demo cast: well-covered institutions a first-time visitor can open in one tap. */
const EXAMPLES = [
  { id: 323, name: "Capital City Bank" },
  { id: 5, name: "U.S. Bank" },
  { id: 4956, name: "Navy Federal Credit Union" },
  { id: 6741, name: "SchoolsFirst FCU" },
] as const;

const MATCHES_SHOWN = 5;
const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

function fallbackTo<T>(label: string, fallback: T) {
  return (error: unknown): T => {
    console.error(`Fee check ${label} failed:`, error);
    return fallback;
  };
}

export default async function CheckPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const id = parseCheckId(params.id);
  const query = (params.q ?? "").trim();
  const stats = await getPublicStatsSummary();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "Fee check", href: "/check" }]} />
      <div className="mx-auto max-w-page px-4 py-7 sm:px-6 sm:py-9">
        {/* `relative z-20` keeps the suggestions above the answer below. */}
        <section className="relative z-20 border-b border-border pb-6">
          <div className={`max-w-3xl ${PAGE_HEADER}`}>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brick">Fee check</p>
            <h1 className="mt-2 text-[32px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[44px]">
              How do your bank&apos;s fees compare?
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left">
              Published fees for {stats.institutionsLabel} banks and credit unions, each set beside the U.S. and state
              medians.
            </p>
            <div className="mx-auto mt-5 max-w-xl text-left sm:mx-0">
              <InstitutionSearchBar
                initialQuery={query}
                resultPath="/check"
                ariaLabel="Your bank or credit union"
                placeholder="Your bank or credit union"
              />
            </div>
          </div>
        </section>

        {id !== null ? <CheckAnswer id={id} refreshedOn={stats.refreshedOn} /> : query.length >= 2 ? <CheckMatches query={query} /> : <Examples />}
      </div>
    </div>
  );
}

function Examples() {
  return (
    <p className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[14px] text-ink-muted sm:justify-start">
      <span>Examples:</span>
      {EXAMPLES.map((example) => (
        <Link key={example.id} href={`/check?id=${example.id}`} className={`inline-flex min-h-11 items-center ${LINK}`}>
          {example.name}
        </Link>
      ))}
    </p>
  );
}

function feeCountLabel(row: InstitutionSearchResult): string {
  if (row.published_fee_count > 0) return `${row.published_fee_count.toLocaleString("en-US")} published fees`;
  return row.fee_publication_status === "under_review" ? "Fees in review" : "No published fees yet";
}

async function CheckMatches({ query }: { query: string }) {
  const results = await searchInstitutionsCached({ query, page: 1, pageSize: MATCHES_SHOWN }).catch(
    fallbackTo("search", { rows: [] as InstitutionSearchResult[], total: 0 }),
  );
  const directoryHref = `/institutions?${new URLSearchParams({ q: query }).toString()}`;
  // One match is that institution: answer it rather than listing it.
  if (results.total === 1 && results.rows.length === 1) redirect(`/check?id=${results.rows[0].id}`);
  if (results.rows.length === 0) {
    return (
      <div className="mt-6 text-center sm:text-left">
        <p className="text-[15px] text-ink-soft">No bank or credit union matches &ldquo;{query}&rdquo;.</p>
        <Link
          href={`/submit-fees?${new URLSearchParams({ institutionName: query }).toString()}`}
          className={`mt-1 inline-flex min-h-11 items-center text-[14px] ${LINK}`}
        >
          Send its fee schedule
        </Link>
      </div>
    );
  }
  return (
    <section aria-labelledby="matches-heading" className="mt-6 max-w-3xl">
      <h2 id="matches-heading" className="text-center text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-muted sm:text-left">
        {results.total.toLocaleString("en-US")} {results.total === 1 ? "match" : "matches"} for &ldquo;{query}&rdquo;
      </h2>
      <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface-0">
        {results.rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/check?id=${row.id}`}
              className="flex min-h-11 flex-col gap-0.5 px-4 py-3 hover:bg-paper sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
            >
              <span className="text-[15px] font-medium text-ink">{row.institution_name}</span>
              <span className="text-[13px] text-ink-muted">
                {[toTitleCase(row.city), row.state_code].filter(Boolean).join(", ")} · {feeCountLabel(row)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {results.total > results.rows.length && (
        <Link href={directoryHref} className={`mt-2 inline-flex min-h-11 items-center text-[14px] ${LINK}`}>
          Show all {results.total.toLocaleString("en-US")} in the directory
        </Link>
      )}
    </section>
  );
}

async function CheckAnswer({ id, refreshedOn }: { id: number; refreshedOn: string | null }) {
  const inst = await getPublicInstitutionForPage(id).catch(fallbackTo("institution", null));
  if (!inst) {
    return (
      <p className="mt-6 text-center text-[15px] text-ink-soft sm:text-left">
        That institution is not in the directory.
      </p>
    );
  }

  const fees = Number(inst.fee_count ?? 0) > 0 ? await getVisibleFeesForPage(id) : [];
  const verifiedFees = fees.filter(isVerifiedFee);
  const hasFees = verifiedFees.length > 0;
  const stateCode = inst.state_code && STATE_NAMES[inst.state_code] ? inst.state_code : null;
  const stateName = stateCode ? STATE_NAMES[stateCode] : null;
  const cityName = inst.city ? titleCase(inst.city) : null;
  // The state page's index (every bank and credit union headquartered in the state), the same
  // population the institution profile compares against, so the two pages quote one median.
  const [nationalIndex, stateIndexes, guides, market, user] = await Promise.all([
    hasFees ? getPublicNationalIndex().catch(fallbackTo("national index", [])) : Promise.resolve([]),
    hasFees && stateCode ? getStateFeeIndexesCached(stateCode).catch(fallbackTo("state index", null)) : Promise.resolve(null),
    hasFees ? loadConsumerGuides().catch(fallbackTo("guides", [])) : Promise.resolve([]),
    hasFees && stateCode && cityName
      ? getCityMarketCached(cityName, stateCode, "city").catch(fallbackTo("city market", null))
      : Promise.resolve(null),
    getCurrentUser().catch(() => null),
  ]);
  const alertSubscription = user
    ? await getAlertSubscriptionForInstitution(user.id, id).catch(fallbackTo("alert subscription", null))
    : null;

  const rows = buildCheckRows({
    verifiedFees,
    nationalIndex,
    stateIndex: stateIndexes?.all ?? [],
    fallbackSourceUrl: inst.fee_schedule_url ?? null,
  });
  const stateLabel = stateGroupLabel(rows, stateName);
  const thin = verifiedFees.length < MIN_VERIFIED_FEES_FOR_OFFER;
  const publishedCount = inst.published_fee_count ?? verifiedFees.length;
  const place = [cityName, inst.state_code].filter(Boolean).join(", ");
  const collectedOn = formatAbsoluteDate(inst.latest_source_collected_at ?? null);
  const guideHrefs = Object.fromEntries(rows.map((row) => [row.category, avoidGuideHref(row.category, guides)]));
  const alternatives = buildAlternatives(market, id, rows);

  const sparseLine = !hasFees
    ? `Fee Insight has not published fees for ${inst.institution_name} yet.`
    : rows.length === 0
      ? `${publishedCount.toLocaleString("en-US")} published ${publishedCount === 1 ? "fee" : "fees"}, none yet with a market median to compare against.`
      : thin
        ? `Only ${verifiedFees.length} of its fees are published so far; the comparison covers those.`
        : null;
  const findingLine =
    sparseLine ?? checkFinding(rows, inst.institution_name, stateName) ?? `Its main fees against the ${stateLabel ?? "U.S."} median.`;

  // The next step is the consumer's: the account terms behind the lead fee, then how to avoid it.
  const lead = leadRow(rows) ?? rows[0] ?? null;
  const termsHref = lead?.sourceUrl ?? inst.fee_schedule_url ?? null;
  const avoidHref = lead ? guideHrefs[lead.category] : null;
  const cityHref = stateCode && cityName ? cityPath(stateCode, cityName) : null;
  const stateHref = stateCode ? `/research/state/${stateCode}` : null;

  return (
    <div className="mt-8 space-y-8 sm:mt-10 sm:space-y-10">
      <CheckAnswerFocus targetId="answer-heading" />
      <section
        aria-labelledby="answer-heading"
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,860px)] lg:gap-10"
      >
        <div className={`min-w-0 ${PAGE_HEADER}`}>
          <p className="text-[13px] text-ink-muted">{[getCharterLabel(inst.charter_type), place].filter(Boolean).join(" · ")}</p>
          <h2
            id="answer-heading"
            tabIndex={-1}
            className="mt-1 scroll-mt-24 text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink focus:outline-none sm:text-[36px]"
          >
            {inst.institution_name}
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left">{findingLine}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:justify-start">
            {termsHref ? (
              <a
                href={termsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="fi-btn fi-btn-primary inline-flex min-h-11 max-w-full items-center justify-center gap-1.5 px-5 text-center"
              >
                See the account terms
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : null}
            {avoidHref && lead ? (
              <Link href={avoidHref} className={`inline-flex min-h-11 items-center text-[14px] ${LINK}`}>
                Ways to avoid the {lowerLabel(lead.label)} fee
              </Link>
            ) : null}
          </div>
          <Link href={`/institution/${id}`} className={`mt-1 inline-flex min-h-11 items-center text-[13px] ${LINK}`}>
            {publishedCount > 0
              ? `See all ${publishedCount.toLocaleString("en-US")} fees at ${inst.institution_name}`
              : `Open ${inst.institution_name}'s profile`}
          </Link>
        </div>

        {rows.length > 0 && (
          <div className="min-w-0 space-y-3">
            <h3 className="text-center text-[16px] font-semibold text-ink sm:text-left">
              Its main fees against {stateLabel ? `${stateName} and the U.S.` : "the U.S."}
            </h3>
            <CheckTable rows={rows} stateCode={stateLabel ? stateCode : null} stateLabel={stateLabel} guideHrefs={guideHrefs} />
            <SourceNote>
              {inst.institution_name}&apos;s own published fee schedule{collectedOn ? `, collected ${collectedOn}` : ""}.
              {stateLabel
                ? ` State medians count every bank and credit union headquartered in ${stateName} that publishes the fee, the group the ${stateName} page and this institution's profile use. U.S. medians count every U.S. bank and credit union that publishes it.`
                : " U.S. medians count every U.S. bank and credit union that publishes the fee."}{" "}
              A median needs at least {MIN_INSTITUTIONS_FOR_MEDIAN} institutions.{refreshedOn ? ` Medians as of ${refreshedOn}.` : ""}{" "}
              <Link href="/methodology" className={LINK}>
                Methodology
              </Link>
            </SourceNote>
          </div>
        )}
      </section>

      {alternatives.length > 0 && cityName && cityHref ? (
        <Alternatives
          lists={alternatives}
          name={inst.institution_name}
          city={cityName}
          cityHref={cityHref}
          stateHref={stateHref}
          stateName={stateName}
          source={`Published fee schedules of banks and credit unions with a branch in ${cityName} (FDIC Summary of Deposits and NCUA branch records), the same list as the ${cityName} fee page.`}
        />
      ) : hasFees && stateCode ? (
        <p className="border-t border-border pt-6 text-center text-[14px] text-ink-soft sm:text-left">
          No city comparison is available for {inst.institution_name} yet.{" "}
          <Link href={`/institutions?state=${stateCode}`} className={`inline-flex min-h-11 items-center ${LINK}`}>
            Other {stateName} banks and credit unions
          </Link>
        </p>
      ) : null}

      <FeeAlertControl
        institutionId={id}
        institutionName={inst.institution_name}
        focusCategory={null}
        categoryLabels={{}}
        mode={thin ? "verify" : "alerts"}
        initial={{
          signedIn: Boolean(user),
          saved: alertSubscription !== null,
          feeCategories: alertSubscription?.fee_categories ?? null,
        }}
      />

      <p className="text-center text-[13px] text-ink-muted sm:text-left">
        For bank and credit union teams:{" "}
        <Link href={REPORT_SHOWCASE.sampleHref} className={`inline-flex min-h-11 items-center ${LINK}`}>
          a sample Competitive Fee Position report
        </Link>
      </p>
    </div>
  );
}
