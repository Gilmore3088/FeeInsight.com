export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { linkPreview } from "@/lib/link-preview";
import { notFound } from "next/navigation";
import Link from "next/link";
import { STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAllCategories, canAccessPremium } from "@/lib/access";
import { formatCount, getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { LeadCapture } from "@/components/public/lead-capture";
import { TrackLink } from "@/components/track-link";
import { Button, SearchInput } from "@/brand/components";
import { DEMO_REQUEST_NAV, PRIMARY_CTA_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { REPORT_OFFER, SITE_NAME, SITE_URL } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { getStateFeeIndexesCached, getStateStatsCached } from "@/lib/data-store/public-cached-reads";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import type { StateFeeIndexes } from "@/lib/data-store";
import { buildCharterPairs, buildComparisons, computeStateFindings } from "@/lib/research-report/state-findings";
import { DotLegend, LockedRows, VideoSlot, money } from "../../../fees/[category]/exhibits";
import { StateHero } from "./state-exhibits";
import { BoardChart, BoardRows, CharterRows, FindingButtons, StateBoard } from "./state-board";
import { boardFees, charterFees, charterHeadline, leadFindings, splitForAccess } from "./state-view";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** Locked fees named for free visitors before the rest are counted. */
const LOCKED_SHOWN = 5;

const EMPTY_INDEXES: StateFeeIndexes = {
  all: [],
  bank: [],
  credit_union: [],
  verified_institutions: 0,
  verified_bank_institutions: 0,
  verified_cu_institutions: 0,
  verified_fees: 0,
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const stateCode = code.toUpperCase();
  const name = STATE_NAMES[stateCode];
  if (!name) return { title: "State Not Found" };
  // Thin states (fewer institutions with published fees than the median floor) stay out of
  // search; the sitemap leaves them out too. A failed read keeps the page indexable.
  const stats = await getStateStatsCached(stateCode).catch(() => null);
  const thin = stats !== null && stats.with_fees < MIN_INSTITUTIONS_FOR_MEDIAN;

  const title = `${name} Bank Fees - State Fee Report`;
  const description = `What ${name} banks and credit unions charge for overdraft, NSF, maintenance, ATM and wire fees, compared with national medians. Every figure from verified, published fee schedules.`;
  return {
    title,
    // One URL per state: /research/state/tx and /research/state/TX both render this page.
    alternates: { canonical: `/research/state/${stateCode}` },
    ...(thin ? { robots: { index: false, follow: true } } : {}),
    description,
    ...linkPreview({ title, description, path: `/research/state/${stateCode}` }),
    keywords: [
      `${name} bank fees`,
      `${name} overdraft fees`,
      `${name} credit union fees`,
      `bank fees by state`,
      `${name} ATM fees`,
    ],
  };
}

export default async function StateReportPage({ params }: PageProps) {
  const { code } = await params;
  const stateCode = code.toUpperCase();
  const stateName = STATE_NAMES[stateCode];
  if (!stateName) notFound();

  const user = await getCurrentUser();
  const isPro = canAccessPremium(user);
  const showAllCategories = canAccessAllCategories(user);

  // Every read is served from the public cache between publishes.
  const district = STATE_TO_DISTRICT[stateCode];
  const [summary, stats, indexes, nationalIndex, sampleLive] = await Promise.all([
    getPublicStatsSummary(),
    getStateStatsCached(stateCode),
    getStateFeeIndexesCached(stateCode).catch(() => EMPTY_INDEXES),
    getPublicNationalIndex(),
    sampleReportAvailable().catch(() => false),
  ]);
  const asOf = summary.refreshedOn;

  // The board, the chart, the findings and the banks/credit unions split all read the state's
  // one index, so every figure on the page counts the same institutions.
  const comparisons = buildComparisons(indexes.all, nationalIndex);
  const fees = boardFees(comparisons, indexes.bank, indexes.credit_union, indexes.institution_values);
  const { shown, locked } = splitForAccess(fees, showAllCategories);
  // A board entry cached before the values existed has nothing to draw until it refreshes.
  const charted = shown.filter((f) => f.values.length > 0);
  const paired = charterFees(shown);
  const visibleComparisons = comparisons.filter((c) => shown.some((f) => f.key === c.fee_category));
  const findings = leadFindings(
    computeStateFindings(
      stateName,
      visibleComparisons,
      buildCharterPairs(indexes.bank, indexes.credit_union, shown.map((f) => f.key)),
    ),
    charted,
  );

  const overdraft = fees.find((f) => f.key === "overdraft");
  const coverage = stats.institution_count > 0 ? Math.round((indexes.verified_institutions / stats.institution_count) * 100) : 0;
  const figures = [
    { value: formatCount(indexes.verified_institutions), label: "Institutions with verified fees" },
    overdraft
      ? { value: money(overdraft.median), label: overdraft.us ? `Overdraft median (U.S. ${money(overdraft.us.median)})` : "Overdraft median" }
      : { value: String(comparisons.length), label: "Fees with a state median" },
    { value: formatCount(indexes.verified_fees), label: "Verified fees" },
    { value: `${coverage}%`, label: `Of ${formatCount(stats.institution_count)} institutions covered` },
  ];
  const positions = (["below", "within", "above"] as const).filter((p) => shown.some((f) => f.position === p));

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: stateName, href: `/research/state/${stateCode}` },
        ]}
      />

      {/* 1. The state on the map, with four live figures. */}
      <StateHero stateCode={stateCode} stateName={stateName} district={district} figures={figures} freshnessLabel={summary.freshnessLabel} />

      <div className="mx-auto max-w-page space-y-10 px-4 py-8 sm:space-y-12 sm:px-6 sm:py-12">
        <VideoSlot title={`${stateName}'s fees settling into the U.S. range`} />

        {charted.length > 0 ? (
          // 2-4 share one selection: a fee picked in a finding or a list redraws the chart.
          <StateBoard fees={charted} stateName={stateName}>
            {/* 2. Key findings, each one line with its number. */}
            {findings.length > 0 && (
              <section aria-labelledby="findings-heading" className="space-y-3">
                <h2 id="findings-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]">
                  What stands out
                </h2>
                <FindingButtons findings={findings} />
              </section>
            )}

            {/* 3. The board: the picked fee's spread, then every fee against the U.S. */}
            <section id="benchmarks" aria-labelledby="board-heading" className="scroll-mt-20 space-y-3">
              <h2 id="board-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]">
                {stateName} against the U.S.
              </h2>
              <BoardChart />
              <DotLegend positions={[...positions]} />
              <div className="rounded-2xl border border-border bg-surface-0 px-4 py-2 shadow-fi-1 sm:px-6">
                <BoardRows fees={charted} ariaLabel={`${stateName} median for each fee`} />
                {locked.length > 0 && (
                  <div className="border-t border-border pt-1">
                    <LockedRows
                      rows={locked.slice(0, LOCKED_SHOWN).map((f) => ({ key: f.key, label: f.name, institutions: f.institutions }))}
                    />
                    {locked.length > LOCKED_SHOWN && (
                      <p className="border-t border-border py-2 text-[12px] text-ink-muted">
                        Plus {locked.length - LOCKED_SHOWN} more {stateName} fees.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* 4. Banks against credit unions. */}
            {paired.length > 0 && (
              <section aria-labelledby="charter-heading" className="space-y-3">
                <div>
                  <h2 id="charter-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]">
                    {charterHeadline(paired)}
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted" aria-hidden="true">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-ink" /> Banks
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-brick" /> Credit unions
                    </span>
                    <span>Median in {stateName}.</span>
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-surface-0 px-4 py-2 shadow-fi-1 sm:px-6">
                  <CharterRows fees={paired} />
                </div>
              </section>
            )}
          </StateBoard>
        ) : (
          <p className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-[14px] text-ink-muted">
            Not enough {stateName} institutions have verified fees yet for a state median.
          </p>
        )}

        {/* 5. The free state report. */}
        <LeadCapture
          placement="state_benchmark"
          className="print:hidden"
          stateCode={stateCode}
          eyebrow="Free report"
          headline={`Get the free ${stateName} fee report`}
          body={`The ${stateName} medians against the U.S., sent to you and updated as schedules are verified.`}
          buttonLabel="Send it to me"
          secondaryLink={
            sampleLive
              ? { href: "/reports/sample-competitive-fee-position", label: `See the sample ${REPORT_OFFER.name}` }
              : { href: `/for-institutions?report=institution&src=state-${stateCode.toLowerCase()}#report`, label: REPORT_OFFER.institutionCtaLabel }
          }
        />

        {/* The reader's own institution, and Hamilton once. */}
        <section aria-labelledby="search-heading" className="rounded-2xl bg-paper px-4 py-5 ring-1 ring-border sm:px-6 print:hidden">
          <h2 id="search-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
            Where does your institution sit?
          </h2>
          <form action="/institutions" method="get" role="search" className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="state" value={stateCode} />
            <SearchInput name="q" label="Your bank or credit union" required autoComplete="off" className="w-full min-w-0 sm:flex-1" />
            <Button type="submit" variant="primary" className="min-h-11 justify-center whitespace-nowrap">
              {PRIMARY_CTA_NAV.label}
            </Button>
          </form>
          {!isPro && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-[14px] text-ink-muted">
                Hamilton, the Fee Insight Pro workspace, sets every fee you charge against institutions your size and in{" "}
                {stateName}.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
                <TrackLink
                  event="upgrade_click"
                  eventProps={{ placement: "state_report_end", state: stateCode }}
                  href={PRO_PLANS_NAV.href}
                  className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-on-ink hover:opacity-90"
                >
                  {PRO_PLANS_NAV.label}
                </TrackLink>
                <TrackLink
                  event="contact_sales"
                  eventProps={{ placement: "state_report_end_demo", state: stateCode }}
                  href={DEMO_REQUEST_NAV.href}
                  className="text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                >
                  {DEMO_REQUEST_NAV.label}
                </TrackLink>
              </div>
            </div>
          )}
        </section>

        <p className="text-[12px] text-ink-muted">
          From {formatCount(indexes.verified_institutions)} {stateName} banks and credit unions&apos; own published fee schedules, one
          value per institution; a median needs at least {MIN_INSTITUTIONS_FOR_MEDIAN} institutions. Data as of {asOf}.{" "}
          <Link href="/methodology" className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink print:hidden">
            How we build it
          </Link>
        </p>
      </div>

      {/* Print / Save as PDF: drop site chrome and interactive controls, keep exhibits whole. */}
      <style>{`@media print {
        header, footer, nextjs-portal { display: none !important; }
        body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        section { break-inside: avoid-page; }
        a { text-decoration: none !important; }
      }`}</style>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: `${stateName} Bank & Credit Union Fees`,
            description: `Fee benchmarks for banks and credit unions in ${stateName}, compared with national medians.`,
            url: `${SITE_URL}/research/state/${stateCode}`,
            dateModified: asOf && !Number.isNaN(Date.parse(asOf)) ? new Date(asOf).toISOString() : undefined,
            publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
