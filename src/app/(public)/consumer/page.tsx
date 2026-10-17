export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { loadConsumerGuides } from "@/lib/guides/source";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { TAXONOMY_COUNT, getDisplayName } from "@/lib/fee-taxonomy";
import { formatFeeAmount } from "@/lib/format";
import { getPublicNationalIndex, getPublicSnapshot } from "@/lib/public-stats";
import { PRODUCT_NAME, SITE_URL } from "@/lib/constants";
import { PAGE_HEADER } from "@/components/public/page-header";
import { UnstatedAudienceFootnote, UnstatedAudienceMark, medianHasUnstatedAudience } from "@/components/unstated-audience";
import { InstitutionSearchBar } from "../institutions/search-bar";
import { SourceNote } from "../research/district/[id]/district-hub";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";

const TITLE = "Bank Fees for Consumers: Check and Compare";
const DESCRIPTION =
  "Check your own bank or credit union's published fees, read plain-language fee guides, and see national medians for every fee type.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/consumer` },
  openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/consumer`, siteName: "Fee Insight" },
};

/** The fee most consumers come to compare; the lead finding is read live for it. */
const LEAD_CATEGORY = "overdraft";
const ROWS_SHOWN = 5;

const money = (n: number) => formatFeeAmount(n) ?? `$${n.toFixed(2)}`;
/** "Overdraft (OD)" reads as "overdraft" in a sentence. */
const plain = (category: string) => getDisplayName(category).replace(/\s*\([^)]*\)/g, "");
/** Inside a sentence: lower case, except acronyms such as ATM or NSF. */
const inSentence = (category: string) =>
  plain(category)
    .split(" ")
    .map((word) => (/^[A-Z]{2,}$/.test(word.replace(/[^A-Za-z]/g, "")) ? word : word.toLowerCase()))
    .join(" ");

const BAND = "flex min-w-0 flex-col border-t border-border pt-5";
const BAND_H2 = "text-center text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-left sm:text-[22px]";
const BAND_LINE = "mt-2 text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left";
const MORE = "mt-auto inline-flex min-h-11 items-center pt-3 text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

export default async function ConsumerPage() {
  const [{ summary, categories }, nationalIndex, guides] = await Promise.all([
    getPublicSnapshot(),
    getPublicNationalIndex(),
    loadConsumerGuides().catch((error: unknown) => {
      console.error("Consumer page guides failed:", error);
      return [];
    }),
  ]);
  const summaryFor = new Map<string, FeeCategorySummary>(categories.map((c) => [c.fee_category, c]));

  const lead = summaryFor.get(LEAD_CATEGORY);
  const leadReady = lead && lead.median_amount != null && lead.p25_amount != null && lead.p75_amount != null ? lead : null;

  // The most widely published fee types with a median, the same figures as the fee index.
  const indexRows = nationalIndex
    .filter((entry) => entry.maturity_tier !== "insufficient" && entry.median_amount != null)
    .sort((a, b) => b.institution_count - a.institution_count);
  const guideRows = [...guides].sort((a, b) => Number(b.featured) - Number(a.featured)).slice(0, ROWS_SHOWN);
  const guideMedians = guideRows
    .map((guide) => ({ guide, median: summaryFor.get(guide.primaryCategory)?.median_amount ?? null }))
    .filter((g): g is { guide: (typeof guideRows)[number]; median: number } => g.median !== null);
  const topGuide = guideMedians.length > 1 ? guideMedians.reduce((a, b) => (b.median > a.median ? b : a)) : null;
  const widest = indexRows[0] ?? null;
  const asOf = summary.refreshedOn ? `, data as of ${summary.refreshedOn}` : "";
  const unstatedShown =
    medianHasUnstatedAudience(leadReady) ||
    indexRows.slice(0, ROWS_SHOWN).some((entry) => medianHasUnstatedAudience(summaryFor.get(entry.fee_category))) ||
    guideRows.some((guide) => medianHasUnstatedAudience(summaryFor.get(guide.primaryCategory)));

  return (
    <div className="min-h-screen bg-paper text-ink">
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "For consumers", href: "/consumer" }]} />
      <div className="mx-auto max-w-page px-4 py-7 sm:px-6 sm:py-10">
        <section className="relative z-20 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-end">
          <div className={`min-w-0 ${PAGE_HEADER}`}>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brick">For consumers</p>
            <h1 className="mt-2 text-[32px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[44px]">
              Your bank&apos;s fees, next to the national median
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left">
              Published fees from {summary.institutionsLabel} banks and credit unions, each linked to its own fee schedule.
            </p>
            <div className="mx-auto mt-5 max-w-xl text-left sm:mx-0">
              <InstitutionSearchBar resultPath="/check" ariaLabel="Your bank or credit union" placeholder="Your bank or credit union" />
            </div>
          </div>

          {leadReady && (
            <figure className="min-w-0 rounded-xl border border-border bg-surface-0 p-5 shadow-fi-1">
              <p className="text-[13px] font-medium text-ink-muted">{plain(LEAD_CATEGORY)} fee, U.S. median</p>
              <p className="mt-1 font-mono text-[40px] font-semibold leading-none tabular-nums text-ink">
                {money(leadReady.median_amount as number)}
                <UnstatedAudienceMark show={medianHasUnstatedAudience(leadReady)} />
              </p>
              <figcaption className="mt-3 text-[15px] leading-snug text-ink">
                Across {leadReady.institution_count.toLocaleString("en-US")} banks and credit unions that publish an{" "}
                {inSentence(LEAD_CATEGORY)} fee, the middle 50% fall between {money(leadReady.p25_amount as number)} and{" "}
                {money(leadReady.p75_amount as number)}.
              </figcaption>
              <p className="mt-3 text-[12px] text-ink-muted">
                Source: banks&apos; and credit unions&apos; published fee schedules, {PRODUCT_NAME}
                {asOf}.
              </p>
            </figure>
          )}
        </section>

        <div className="mt-10 grid gap-10 sm:mt-12 sm:grid-cols-2 sm:gap-8">
          <section aria-labelledby="guides-heading" className={BAND}>
            <h2 id="guides-heading" className={BAND_H2}>
              Fee guides
            </h2>
            {topGuide && (
              <p className={BAND_LINE}>
                Of the fees these guides cover, {inSentence(topGuide.guide.primaryCategory)} has the highest U.S. median,{" "}
                {money(topGuide.median)}.
              </p>
            )}
            {guideRows.length > 0 ? (
              <ul className="mt-3 divide-y divide-border">
                {guideRows.map((guide) => {
                  const median = summaryFor.get(guide.primaryCategory);
                  return (
                    <li key={guide.slug}>
                      <Link
                        href={`/guides/${guide.slug}`}
                        className="flex min-h-11 items-baseline justify-between gap-3 py-2.5 text-[15px] text-ink hover:text-brick"
                      >
                        <span className="min-w-0">{guide.title}</span>
                        {median?.median_amount != null && (
                          <span className="shrink-0 text-[13px] text-ink-muted">
                            U.S. median <span className="font-mono tabular-nums">{money(median.median_amount)}</span>
                            <UnstatedAudienceMark show={medianHasUnstatedAudience(median)} />
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={BAND_LINE}>The guides are not available right now.</p>
            )}
            {guideMedians.length > 0 && (
              <div className="mt-3">
                <SourceNote>
                  Medians from banks&apos; and credit unions&apos; published fee schedules, {PRODUCT_NAME}
                  {asOf}.
                </SourceNote>
              </div>
            )}
            <Link href="/guides" className={MORE}>
              {guides.length > 0 ? `All ${guides.length} guides` : "Fee guides"}
            </Link>
          </section>

          <section aria-labelledby="index-heading" className={BAND}>
            <h2 id="index-heading" className={BAND_H2}>
              U.S. medians by fee
            </h2>
            {widest && (
              <p className={BAND_LINE}>
                {plain(widest.fee_category)} is the most widely published fee: {widest.institution_count.toLocaleString("en-US")}{" "}
                banks and credit unions list one, with a U.S. median of {money(widest.median_amount as number)}.
              </p>
            )}
            {indexRows.length > 0 ? (
              <ul className="mt-3 divide-y divide-border">
                {indexRows.slice(0, ROWS_SHOWN).map((entry) => (
                  <li key={entry.fee_category}>
                    <Link
                      href={`/fees/${entry.fee_category}`}
                      className="flex min-h-11 items-baseline justify-between gap-3 py-2.5 text-[15px] text-ink hover:text-brick"
                    >
                      <span className="min-w-0">{plain(entry.fee_category)}</span>
                      <span className="shrink-0 font-mono text-[13px] tabular-nums text-ink-muted">
                        {money(entry.median_amount as number)}
                        <UnstatedAudienceMark show={medianHasUnstatedAudience(summaryFor.get(entry.fee_category))} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={BAND_LINE}>National medians are not available right now.</p>
            )}
            {indexRows.length > 0 && (
              <div className="mt-3">
                <SourceNote>
                  {PRODUCT_NAME}, one value per institution from its own published fee schedule{asOf}.
                </SourceNote>
              </div>
            )}
            <Link href="/fees" className={MORE}>
              {`All ${TAXONOMY_COUNT} fee categories in the ${PRODUCT_NAME}`}
            </Link>
          </section>
        </div>

        <div className="mt-10">
          <Link
            href="/methodology"
            className="inline-flex min-h-11 items-center text-[13px] font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
          >
            How the medians are counted
          </Link>
          <UnstatedAudienceFootnote show={unstatedShown} className="mt-3" />
        </div>
      </div>
    </div>
  );
}
