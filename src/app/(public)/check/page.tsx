export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getAlertSubscriptionForInstitution } from "@/lib/data-store/alerts";
import { ArrowLeftRight, ExternalLink, FileText, Search } from "lucide-react";
import {
  getBranchCityForZipCached,
  getCityMarketCached,
  getStateFeeIndexesCached,
  searchInstitutionsCached,
} from "@/lib/data-store/public-cached-reads";
import type { InstitutionSearchResult } from "@/lib/data-store/search";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { UNAVAILABLE_LABEL, formatAbsoluteDate, getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { SITE_URL } from "@/lib/constants";
import { homeSerif } from "@/app/landing-serif";
import { SAMPLE_REPORT_HREF, SERIF } from "@/app/landing-shared";
import "@/app/landing-motion.css";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PAGE_HERO_WRAP, PageHero } from "@/components/public/page-hero";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { CheckExample, loadCheckExample } from "../consumer/check-example";
import { PAGE_HEADER } from "@/components/public/page-header";
import { InstitutionSearchBar } from "../institutions/search-bar";
import { FeeAlertControl } from "../institution/[id]/fee-alert-control";
import { getCharterLabel, toTitleCase } from "../institution/[id]/enum-labels";
import { MIN_VERIFIED_FEES_FOR_OFFER } from "../institution/[id]/profile-copy";
import { getPublicInstitutionForPage, getVisibleFeesForPage, isVerifiedFee } from "../institution/[id]/profile-data";
import { loadConsumerGuides } from "@/lib/guides/source";
import { SourceNote } from "../research/district/[id]/district-hub";
import { cityPath, dottedCityName, titleCase } from "../fees/city/[state]/[city]/city-lookup";
import {
  ALTERNATIVE_FEES,
  avoidGuideHref,
  buildAlternatives,
  buildCheckRows,
  checkCounts,
  leadChip,
  leadRow,
  localFeeWords,
  parseCheckId,
  parseLocation,
  stateGroupLabel,
} from "./check-data";
import { CheckTable } from "./check-table";
import { LocalOptions, type LocalStatus } from "./alternatives";
import { CheckAnswerFocus } from "./answer-focus";
import { AvoidChips, HamiltonEmployeeBand, ResultStat } from "./check-result";

const TITLE = "Check a Bank's Fees Against the Market";
const DESCRIPTION =
  "Name a bank or credit union to see its published fees beside the U.S. and state medians, each linked to its own fee schedule.";

interface PageProps {
  searchParams: Promise<{ id?: string; q?: string; near?: string }>;
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
  { id: 21, name: "M&T Bank" },
  { id: 4956, name: "Navy Federal Credit Union" },
  { id: 6741, name: "SchoolsFirst FCU" },
] as const;

/** The lead demo institution, shown as the landing's live example. */
const EXAMPLE_ID = 323;
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

  const landing = id === null && query.length < 2;
  // The landing's right column: a real result for the lead demo institution, from the public cache.
  // When it cannot be read, the three steps take that column instead of leaving it empty.
  const [example, sampleAvailable] = landing
    ? await Promise.all([loadCheckExample(EXAMPLE_ID, []), sampleReportAvailable().catch(() => false)])
    : [null, false];

  return (
    <div className="min-h-screen overflow-x-clip bg-paper text-ink">
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "Fee check", href: "/check" }]} />
      {/* `relative z-20` keeps the search suggestions above the content below the band. */}
      <div className="relative z-20">
        <PageHero
          eyebrow="Fee check"
          title={<>How do your bank&apos;s fees compare?</>}
          lede={
            stats.institutionsLabel === UNAVAILABLE_LABEL
              ? "Banks and credit unions, each fee beside the state and U.S. medians."
              : `${stats.institutionsLabel} banks and credit unions, each fee beside the state and U.S. medians.`
          }
          aside={landing ? example ? <CheckExample example={example} layout="card" /> : <HowItWorks tone="band" /> : undefined}
        >
          <div className="max-w-xl">
            <InstitutionSearchBar
              initialQuery={query}
              resultPath="/check"
              ariaLabel="Your bank or credit union"
              placeholder="Your bank or credit union"
            />
          </div>
          {landing && <ExampleChips skip={example ? EXAMPLE_ID : null} />}
        </PageHero>
      </div>

      <div className={`${homeSerif.variable} ${PAGE_HERO_WRAP} pb-12 pt-8 sm:pb-16 sm:pt-10`}>
        {id !== null ? (
          <CheckAnswer id={id} near={params.near ?? ""} refreshedOn={stats.refreshedOn} />
        ) : query.length >= 2 ? (
          <CheckMatches query={query} />
        ) : (
          <CheckLanding showSteps={example !== null} sampleAvailable={sampleAvailable} />
        )}
      </div>
    </div>
  );
}

/** The demo cast as one-tap chips in the band; each stays on one line and the row wraps whole chips. */
function ExampleChips({ skip }: { skip: number | null }) {
  const shown = EXAMPLES.filter((example) => example.id !== skip);
  return (
    <div className="mt-4">
      <p className="text-[13px] font-semibold text-[#c9d6de]">{skip ? "Or try" : "Try"}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {shown.map((example) => (
          <li key={example.id}>
            <Link
              href={`/check?id=${example.id}`}
              className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-white/30 px-4 text-[14px] font-medium text-white hover:border-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {example.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STEPS = [
  { title: "Name your bank", line: "Search any bank or credit union in the directory.", Icon: Search },
  { title: "See where each fee sits", line: "Its main fees beside the state and U.S. medians.", Icon: ArrowLeftRight },
  { title: "Check the source", line: "Every price links to the institution's own fee schedule.", Icon: FileText },
] as const;

/** The three steps of a check; light on the band when they stand in for the example, ink below it. */
function HowItWorks({ tone }: { tone: "band" | "page" }) {
  const onBand = tone === "band";
  return (
    <ol className={`grid gap-3 ${onBand ? "" : "sm:grid-cols-3"}`}>
      {STEPS.map(({ title, line, Icon }, i) => (
        <li
          key={title}
          className={`flex min-w-0 items-start gap-3 rounded-xl p-4 ${onBand ? "bg-white/10" : "border border-border bg-surface-0"}`}
        >
          <span
            aria-hidden="true"
            className={`flex size-10 shrink-0 items-center justify-center rounded-full ${onBand ? "bg-white/15 text-white" : "bg-brick-tint text-brick"}`}
          >
            <Icon className="size-5" strokeWidth={1.75} />
          </span>
          <span className="min-w-0">
            <span className={`block text-[15px] font-semibold ${onBand ? "text-white" : "text-ink"}`}>
              <span className="sr-only">Step {i + 1}: </span>
              {title}
            </span>
            <span className={`block text-[14px] leading-snug ${onBand ? "text-[#e0e9ee]" : "text-ink-soft"}`}>{line}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Below the band before a search: how a check works, then the one step for bank and credit union teams. */
function CheckLanding({ showSteps, sampleAvailable }: { showSteps: boolean; sampleAvailable: boolean }) {
  return (
    <div className="space-y-10 sm:space-y-12">
      {showSteps && (
        <section aria-labelledby="how-heading">
          <h2 id="how-heading" className="text-[28px] font-medium leading-[1.08] tracking-[-0.02em] text-ink sm:text-[36px]" style={SERIF}>
            How a fee check works
          </h2>
          <div className="mt-4">
            <HowItWorks tone="page" />
          </div>
        </section>
      )}
      <section aria-label="For bank and credit union teams" className="space-y-2">
        <HamiltonEmployeeBand name="a bank or credit union" placement="check_landing_band" />
        {sampleAvailable && (
          <Link href={SAMPLE_REPORT_HREF} className={`inline-flex min-h-11 items-center text-[14px] ${LINK}`}>
            See a sample competitive fee report
          </Link>
        )}
      </section>
    </div>
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
      <div className="text-center sm:text-left">
        <p className="text-[15px] text-ink-soft sm:mx-0">No bank or credit union matches &ldquo;{query}&rdquo;.</p>
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
    <section aria-labelledby="matches-heading" className="max-w-3xl">
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

/** "TALLAHASSEE" or "st. louis" as "Tallahassee" and "St. Louis", hyphens kept. */
function displayCity(city: string): string {
  return city.toLowerCase().replace(/(^|[\s\-'.])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * The visitor's own city, from `?near=` (a ZIP or a city and state), and its market as the city
 * page reads it. The institution's headquarters is never assumed: nothing local is shown until
 * the visitor names a place.
 */
async function resolveLocal(near: string): Promise<LocalStatus> {
  const location = parseLocation(near);
  if (!location) return { kind: "none" };
  if (location.kind === "needs-state") return { kind: "needs-state", text: location.text };
  let city: string;
  let state: string;
  if (location.kind === "zip") {
    const found = await getBranchCityForZipCached(location.zip).catch(fallbackTo("ZIP lookup", null));
    if (!found) return { kind: "not-found", text: location.zip };
    city = displayCity(found.city);
    state = found.state;
  } else {
    city = displayCity(location.city);
    state = location.state;
  }
  const readMarket = (name: string) => getCityMarketCached(name, state, "city").catch(fallbackTo("city market", null));
  let market = await readMarket(city);
  const dotted = market ? null : dottedCityName(city);
  if (dotted) {
    market = await readMarket(dotted);
    if (market) city = dotted;
  }
  if (!market) {
    // A ZIP that names a branch city the city read cannot show has no fee data there yet.
    return location.kind === "zip" ? { kind: "no-fees", city: `${city}, ${state}` } : { kind: "not-found", text: `${city}, ${state}` };
  }
  return { kind: "found", market, city, state, viaZip: location.kind === "zip" ? location.zip : null };
}

async function CheckAnswer({ id, near, refreshedOn }: { id: number; near: string; refreshedOn: string | null }) {
  const inst = await getPublicInstitutionForPage(id).catch(fallbackTo("institution", null));
  if (!inst) {
    return (
      <p className="text-center text-[15px] text-ink-soft sm:mx-0 sm:text-left">
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
  const [nationalIndex, stateIndexes, guides, local, user] = await Promise.all([
    hasFees ? getPublicNationalIndex().catch(fallbackTo("national index", [])) : Promise.resolve([]),
    hasFees && stateCode ? getStateFeeIndexesCached(stateCode).catch(fallbackTo("state index", null)) : Promise.resolve(null),
    hasFees ? loadConsumerGuides().catch(fallbackTo("guides", [])) : Promise.resolve([]),
    hasFees ? resolveLocal(near) : Promise.resolve<LocalStatus>({ kind: "none" }),
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
  // Local options are offered only for a fee the city comparison covers.
  const comparesLocally = rows.some((row) => (ALTERNATIVE_FEES as string[]).includes(row.category));
  const alternatives = local.kind === "found" ? buildAlternatives(local.market, id, rows, verifiedFees) : [];

  const sparseLine = !hasFees
    ? `Fee Insight has not published fees for ${inst.institution_name} yet.`
    : rows.length === 0
      ? `${publishedCount.toLocaleString("en-US")} published ${publishedCount === 1 ? "fee" : "fees"}, none yet with a market median to compare against.`
      : thin
        ? `Only ${verifiedFees.length} of its fees are published so far; the comparison covers those.`
        : null;
  const counts = checkCounts(rows);
  const chip = leadChip(rows, stateLabel ? stateCode : null);

  // The next step is the consumer's: the account terms behind the lead fee.
  const lead = leadRow(rows) ?? rows[0] ?? null;
  const termsHref = lead?.sourceUrl ?? inst.fee_schedule_url ?? null;
  // One tap for a visitor who banks where it is headquartered; still the visitor's choice.
  const headquarters = stateCode && cityName ? `${cityName}, ${stateCode}` : null;

  return (
    <div className="space-y-10 sm:space-y-12">
      <CheckAnswerFocus targetId="answer-heading" />
      <section
        aria-labelledby="answer-heading"
        className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,820px)] lg:gap-12"
      >
        <div className={`min-w-0 space-y-6 ${PAGE_HEADER}`}>
          <div>
            <p className="text-[13px] text-ink-muted">{[getCharterLabel(inst.charter_type), place].filter(Boolean).join(" · ")}</p>
            <h2
              id="answer-heading"
              tabIndex={-1}
              className="mt-1 scroll-mt-24 break-words text-[34px] font-medium leading-[1.04] tracking-[-0.025em] text-ink focus:outline-none sm:text-[46px]"
              style={SERIF}
            >
              {inst.institution_name}
            </h2>
            {sparseLine && <p className="mt-3 text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left">{sparseLine}</p>}
          </div>
          {counts && <ResultStat counts={counts} chip={chip} stateName={stateLabel ? stateName : null} />}
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 sm:justify-start">
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
            <Link href={`/institution/${id}`} className={`inline-flex min-h-11 items-center text-[14px] ${LINK}`}>
              {publishedCount > 0 ? `All ${publishedCount.toLocaleString("en-US")} fees` : "Its profile"}
            </Link>
          </div>
          <HamiltonEmployeeBand name={inst.institution_name} placement="check_employee_band" />
        </div>

        {rows.length > 0 && (
          <div className="min-w-0 space-y-4">
            <h3 className="text-center text-[16px] font-semibold text-ink sm:text-left">
              Its main fees against {stateLabel ? `${stateName} and the U.S.` : "the U.S."}
            </h3>
            <CheckTable rows={rows} stateCode={stateLabel ? stateCode : null} stateLabel={stateLabel} guideHrefs={guideHrefs} />
            <AvoidChips rows={rows} guideHrefs={guideHrefs} />
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

      {hasFees && comparesLocally ? (
        <LocalOptions
          id={id}
          near={near}
          status={local}
          lists={alternatives}
          fees={localFeeWords(rows)}
          name={inst.institution_name}
          cityHref={local.kind === "found" ? cityPath(local.state, local.city) : null}
          headquarters={headquarters}
        />
      ) : hasFees && stateCode ? (
        <p className="border-t border-border pt-6 text-center text-[14px] text-ink-soft sm:text-left">
          No local comparison is available for {inst.institution_name}&apos;s fees yet.{" "}
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
    </div>
  );
}
