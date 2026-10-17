export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getAlertSubscriptionForInstitution } from "@/lib/data-store/alerts";
import { getPeerIndexCached, searchInstitutionsCached } from "@/lib/data-store/public-cached-reads";
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
import { HeadlineTable } from "../institution/[id]/market-position";
import { buildFindings } from "../institution/[id]/findings";
import { getCharterLabel, toTitleCase } from "../institution/[id]/enum-labels";
import { MIN_VERIFIED_FEES_FOR_OFFER } from "../institution/[id]/profile-copy";
import { getPublicInstitutionForPage, getVisibleFeesForPage, isVerifiedFee } from "../institution/[id]/profile-data";
import { SourceNote } from "../research/district/[id]/district-hub";
import { buildCheckRows, parseCheckId, stateGroupLabel } from "./check-data";
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
  const [nationalIndex, stateIndex, user] = await Promise.all([
    verifiedFees.length > 0 ? getPublicNationalIndex().catch(fallbackTo("national index", [])) : Promise.resolve([]),
    verifiedFees.length > 0 && inst.state_code
      ? getPeerIndexCached({ state_code: inst.state_code, charter_type: inst.charter_type }).catch(fallbackTo("state index", []))
      : Promise.resolve([]),
    getCurrentUser().catch(() => null),
  ]);
  const alertSubscription = user
    ? await getAlertSubscriptionForInstitution(user.id, id).catch(fallbackTo("alert subscription", null))
    : null;

  const stateName = inst.state_code ? (STATE_NAMES[inst.state_code] ?? null) : null;
  const rows = buildCheckRows({
    verifiedFees,
    nationalIndex,
    stateIndex,
    fallbackSourceUrl: inst.fee_schedule_url ?? null,
  });
  const stateGroup = stateGroupLabel(rows, stateName, inst.charter_type);
  const thin = verifiedFees.length < MIN_VERIFIED_FEES_FOR_OFFER;
  // The profile's own lead finding, from the same rows, so the two pages say the same thing.
  const lead = thin
    ? null
    : (buildFindings({
        rows,
        stateGroup,
        stateCode: inst.state_code,
        peerRank: null,
        peerGroup: null,
        positionCounts: { below: 0, within: 0, above: 0 },
      })[0] ?? null);
  const publishedCount = inst.published_fee_count ?? verifiedFees.length;
  const place = [toTitleCase(inst.city), inst.state_code].filter(Boolean).join(", ");
  const collectedOn = formatAbsoluteDate(inst.latest_source_collected_at ?? null);

  const sparseLine =
    verifiedFees.length === 0
      ? `Fee Insight has not published fees for ${inst.institution_name} yet.`
      : rows.length === 0
        ? `${publishedCount.toLocaleString("en-US")} published ${publishedCount === 1 ? "fee" : "fees"}, none yet with a market median to compare against.`
        : thin
          ? `Only ${verifiedFees.length} of its fees are published so far; the comparison covers those.`
          : null;
  const comparedWith = stateGroup ?? "U.S. institutions";
  // Always one finding sentence: the profile's lead finding, else the sparse line, else what is compared.
  const findingLine =
    lead?.text ??
    sparseLine ??
    `Its ${rows.length} main ${rows.length === 1 ? "fee" : "fees"}, each against the median of ${comparedWith}.`;
  const tableCaption = `Its main fees against ${stateGroup ?? "the U.S."}`;

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
          <div className="mt-5 flex justify-center sm:justify-start">
            <Link href={`/institution/${id}`} className="fi-btn fi-btn-primary inline-flex min-h-11 max-w-full items-center justify-center px-5 text-center">
              {publishedCount > 0
                ? `See all ${publishedCount.toLocaleString("en-US")} fees at ${inst.institution_name}`
                : `Open ${inst.institution_name}'s profile`}
            </Link>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="min-w-0 space-y-3">
            <h3 className="text-center text-[16px] font-semibold text-ink sm:text-left">{tableCaption}</h3>
            {/* The shared table carries its own h2; the h3 above is this page's caption for it. */}
            <div className="[&_#headline-table-heading]:hidden">
              <HeadlineTable rows={rows} stateCode={stateGroup ? inst.state_code : null} stateLabel={stateGroup} />
            </div>
            <SourceNote>
              {inst.institution_name}&apos;s own published fee schedule{collectedOn ? `, collected ${collectedOn}` : ""}. Medians
              come from the published schedules of the institutions counted on each row; a median needs at least{" "}
              {MIN_INSTITUTIONS_FOR_MEDIAN}.{refreshedOn ? ` Medians as of ${refreshedOn}.` : ""}{" "}
              <Link href="/methodology" className={LINK}>
                Methodology
              </Link>
            </SourceNote>
          </div>
        )}
      </section>

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
        <Link href={REPORT_SHOWCASE.sampleHref} className={`inline-flex min-h-11 items-center ${LINK}`}>
          See a sample Competitive Fee Position report
        </Link>
      </p>
    </div>
  );
}
