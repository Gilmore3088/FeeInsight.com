export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { linkPreview } from "@/lib/link-preview";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBeigeBookHeadline, getLatestBeigeBook } from "@/lib/data-store";
import type { StateFeeIndexes } from "@/lib/data-store";
import { formatCount, getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { getStatesForDistrict } from "@/lib/us-map-paths";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAllCategories, canAccessFullDistrict, canAccessPremium } from "@/lib/access";
import { STATE_NAMES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { TrackLink } from "@/components/track-link";
import { Button, SearchInput } from "@/brand/components";
import { DEMO_REQUEST_NAV, PRIMARY_CTA_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { getDistrictFeeIndexesCached } from "@/lib/data-store/public-cached-reads";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { buildCharterPairs, buildComparisons, computeStateFindings } from "@/lib/research-report/state-findings";
import { buildHistogram } from "@/components/public/distribution-chart";
import { LockedRows } from "../../../fees/[category]/exhibits";
import { StateVideo } from "../../state/[code]/state-exhibits";
import {
  BoardChart,
  BoardHeading,
  BoardLegend,
  BoardRows,
  CharterRows,
  FindingButtons,
  StateBoard,
} from "../../state/[code]/state-board";
import { boardFees, charterFees, charterHeadline, leadFindings, splitForAccess } from "../../state/[code]/state-view";
import { DistrictHero, DistrictStates } from "./district-exhibits";

interface PageProps {
  params: Promise<{ id: string }>;
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

const H2 = "text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]";

/** The Beige Book's first sentence for free readers; Pro reads the whole summary. */
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const districtId = Number(id);
  const name = DISTRICT_NAMES[districtId];
  if (!name || String(districtId) !== id) notFound();

  const title = `${name} Fed District ${districtId} Fee Analysis`;
  const description = `Bank and credit union fees in the ${name} Fed district (District ${districtId}) against national benchmarks, with economic context from the Beige Book.`;
  return {
    title,
    description,
    ...linkPreview({ title, description, path: `/research/district/${districtId}` }),
    alternates: { canonical: `/research/district/${districtId}` },
    keywords: [
      `Federal Reserve District ${districtId}`,
      `${name} bank fees`,
      `Fed district fee analysis`,
      `banking fees ${name}`,
    ],
  };
}

export default async function DistrictReportPage({ params }: PageProps) {
  const { id } = await params;
  const districtId = Number(id);
  if (!Number.isInteger(districtId) || districtId < 1 || districtId > 12 || String(districtId) !== id) notFound();

  const districtName = DISTRICT_NAMES[districtId];
  if (!districtName) notFound();

  const user = await getCurrentUser();
  const isPro = canAccessPremium(user);
  const showAllCategories = canAccessAllCategories(user);
  const showFullDistrict = canAccessFullDistrict(user);

  // Every read is served from the public cache between publishes.
  const [indexes, nationalIndex, beigeHeadline, beigeSections, summary] = await Promise.all([
    getDistrictFeeIndexesCached(districtId).catch(() => EMPTY_INDEXES),
    getPublicNationalIndex(),
    getBeigeBookHeadline(districtId, 400),
    showFullDistrict ? getLatestBeigeBook(districtId) : Promise.resolve([]),
    getPublicStatsSummary(),
  ]);
  const asOf = summary.refreshedOn;
  const place = `${districtName} district`;
  const states = getStatesForDistrict(districtId).filter((code) => STATE_NAMES[code]).sort();

  // The board, the chart, the findings and the banks/credit unions split all read the
  // district's one index, so every figure on the page counts the same institutions.
  const comparisons = buildComparisons(indexes.all, nationalIndex);
  const fees = boardFees(comparisons, indexes.bank, indexes.credit_union, indexes.institution_values);
  const { shown, locked } = splitForAccess(fees, showAllCategories);
  const charted = shown.filter((f) => f.values.length > 0);
  const paired = charterFees(shown);
  const visibleComparisons = comparisons.filter((c) => shown.some((f) => f.key === c.fee_category));
  const findings = leadFindings(
    computeStateFindings(place, visibleComparisons, buildCharterPairs(indexes.bank, indexes.credit_union, shown.map((f) => f.key))),
    charted,
  );

  const againstUs = shown.filter((f) => f.us);
  const aboveUs = againstUs.filter((f) => f.us && f.median > f.us.median * 1.01).length;
  const cuLowerOn = paired.filter((f) => f.cu.median! < f.bank.median!).length;
  const figures = [
    { value: formatCount(indexes.verified_institutions), label: "Institutions with verified fees" },
    { value: formatCount(indexes.verified_fees), label: "Verified fees" },
    ...(againstUs.length > 0 ? [{ value: `${aboveUs} of ${againstUs.length}`, label: "Fees above the U.S. median" }] : []),
    ...(paired.length > 0 ? [{ value: `${cuLowerOn} of ${paired.length}`, label: "Fees lower at credit unions" }] : []),
  ];
  const beigeSummary = beigeSections.find((s) => s.section_name === "Summary of Economic Activity")?.content_text ?? null;
  const posterBars = charted[0] ? buildHistogram(charted[0].values.map(([v]) => v), 12).map((b) => b.count) : [];
  const freeReportHref = `/reports?report=district&district=${districtId}&src=district-${districtId}#request`;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: `District ${districtId}`, href: `/research/district/${districtId}` },
        ]}
      />

      {/* 1. The district's states on the map, with four live figures. */}
      <DistrictHero district={districtId} name={districtName} figures={figures} freshnessLabel={summary.freshnessLabel} />

      {/* 2. The video, in its own section under the hero. */}
      <StateVideo stateName={`the ${place}`} bars={posterBars} />

      <div className="mx-auto max-w-page space-y-10 px-4 py-8 sm:space-y-12 sm:px-6 sm:py-12">
        {charted.length > 0 ? (
          // 3-5 share one selection: a fee picked in a finding or a list redraws the chart.
          <StateBoard fees={charted} stateName={place}>
            {findings.length > 0 && (
              <section aria-labelledby="findings-heading" className="space-y-3">
                <h2 id="findings-heading" className={H2}>
                  What stands out
                </h2>
                <FindingButtons findings={findings} />
              </section>
            )}

            {/* 4. The board: the picked fee's spread, then every fee against the U.S. */}
            <section id="benchmarks" aria-labelledby="board-heading" className="scroll-mt-20 space-y-3">
              <BoardHeading id="board-heading" />
              <BoardChart />
              <BoardLegend fees={charted} />
              <div className="rounded-2xl border border-border bg-surface-0 px-4 py-2 shadow-fi-1 sm:px-6">
                <BoardRows fees={charted} ariaLabel={`${place} median for each fee`} />
                {locked.length > 0 && (
                  <div className="border-t border-border pt-1">
                    <LockedRows rows={locked.slice(0, LOCKED_SHOWN).map((f) => ({ key: f.key, label: f.name, institutions: f.institutions }))} />
                    {locked.length > LOCKED_SHOWN && (
                      <p className="border-t border-border py-2 text-[12px] text-ink-muted">
                        Plus {locked.length - LOCKED_SHOWN} more {place} fees.{" "}
                        <a href="#search-heading" className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
                          What Hamilton adds
                        </a>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* 5. Banks against credit unions. */}
            {paired.length > 0 && (
              <section aria-labelledby="charter-heading" className="space-y-3">
                <div>
                  <h2 id="charter-heading" className={H2}>
                    {charterHeadline(paired)}
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted" aria-hidden="true">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-ink" /> Banks
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-brick" /> Credit unions
                    </span>
                    <span>Median in the {place}.</span>
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
            Not enough {place} institutions have verified fees yet for a district median.
          </p>
        )}

        {/* 6. The free district report. */}
        <section aria-labelledby="free-report-heading" className="flex flex-col gap-4 rounded-2xl bg-paper px-4 py-5 ring-1 ring-border sm:flex-row sm:items-center sm:justify-between sm:px-6 print:hidden">
          <div>
            <h2 id="free-report-heading" className={H2}>
              Get the free {place} report
            </h2>
            <p className="mt-1 text-[14px] text-ink-muted">The headline fees for District {districtId} against the U.S., sent to you.</p>
          </div>
          <TrackLink
            event="request_report_click"
            eventProps={{ placement: "district_free_report", district: districtId }}
            href={freeReportHref}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
          >
            Get the free report
          </TrackLink>
        </section>

        {/* 7. The Beige Book: its first line free, the whole summary in Pro. */}
        {beigeHeadline && (
          <section aria-labelledby="beige-heading" className="space-y-3">
            <h2 id="beige-heading" className={H2}>
              What the Fed sees in the {place}
            </h2>
            <figure className="rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6">
              <blockquote className="text-[16px] leading-relaxed text-ink">
                {showFullDistrict && beigeSummary ? beigeSummary : firstSentence(beigeHeadline.text)}
              </blockquote>
              <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
                <span>Federal Reserve Beige Book, {beigeHeadline.release_date}</span>
                {!showFullDistrict && (
                  <TrackLink
                    event="upgrade_click"
                    eventProps={{ placement: "district_beige_book", district: districtId }}
                    href={PRO_PLANS_NAV.href}
                    className="font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                  >
                    The full summary is in Hamilton
                  </TrackLink>
                )}
              </figcaption>
            </figure>
          </section>
        )}

        {/* 8. Each state's own report. */}
        {states.length > 0 && (
          <section aria-labelledby="states-heading" className="space-y-3">
            <h2 id="states-heading" className={H2}>
              Main states in the district
            </h2>
            <DistrictStates district={districtId} states={states} />
          </section>
        )}

        {/* The reader's own institution, and Hamilton once. */}
        <section aria-labelledby="search-heading" className="rounded-2xl bg-paper px-4 py-5 ring-1 ring-border sm:px-6 print:hidden">
          <h2 id="search-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
            Where does your institution sit?
          </h2>
          <form action="/institutions" method="get" role="search" className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <SearchInput name="q" label="Your bank or credit union" required autoComplete="off" className="w-full min-w-0 sm:flex-1" />
            <Button type="submit" variant="primary" className="min-h-11 justify-center whitespace-nowrap">
              {PRIMARY_CTA_NAV.label}
            </Button>
          </form>
          {!isPro && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-[14px] text-ink-muted">
                Hamilton, the Fee Insight Pro workspace, sets every fee you charge against institutions your size and in your
                district.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
                <TrackLink
                  event="upgrade_click"
                  eventProps={{ placement: "district_report_end", district: districtId }}
                  href={PRO_PLANS_NAV.href}
                  className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-on-ink hover:opacity-90"
                >
                  {PRO_PLANS_NAV.label}
                </TrackLink>
                <TrackLink
                  event="contact_sales"
                  eventProps={{ placement: "district_report_end_demo", district: districtId }}
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
          From {formatCount(indexes.verified_institutions)} {place} banks and credit unions&apos; own published fee schedules, one
          value per institution; a median needs at least {MIN_INSTITUTIONS_FOR_MEDIAN} institutions. Data as of {asOf}.{" "}
          <Link href="/methodology" className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink print:hidden">
            How we build it
          </Link>
        </p>
      </div>

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
            headline: `${districtName} Fed District ${districtId} Bank & Credit Union Fees`,
            description: `Fee benchmarks for banks and credit unions in the ${place}, compared with national medians.`,
            url: `${SITE_URL}/research/district/${districtId}`,
            dateModified: asOf && !Number.isNaN(Date.parse(asOf)) ? new Date(asOf).toISOString() : undefined,
            publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
