export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { FDIC_TIER_LABELS } from "@/lib/fed-districts";
import { formatAmount, formatCompactDollars } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PAGE_HEADER } from "@/components/public/page-header";
import { SITE_URL } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { UpgradeGate } from "@/components/upgrade-gate";
import { getFeeRevenueResearchCached } from "@/lib/data-store/public-cached-reads";
import type { FeeRevenueResearchPreviewGroup } from "@/lib/data-store/fee-revenue-research";

export const metadata: Metadata = {
  robots: { index: false, follow: true },
  title: "Fee Schedules and Filed Income",
  description: "Published fee schedules alongside dated bank deposit service charges and credit-union fee income, with separate reporting populations.",
};

const money = (value: number | null) => value === null ? "Unavailable" : formatCompactDollars(value);
const fee = (value: number | null) => value === null ? "Unavailable" : formatAmount(value);
const intensity = (value: number | null) => value === null ? "Unavailable" : value.toFixed(2);
const label = (source: "fdic" | "ncua") => source === "fdic" ? "Bank deposit service charges" : "Credit-union fee income";
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const headingCell = "px-4 py-3 text-xs font-semibold text-ink-muted";
const numericCell = "px-4 py-3 text-right tabular-nums text-ink-soft";

function SourceCohort({ group }: { group: FeeRevenueResearchPreviewGroup }) {
  const name = label(group.source);
  const ranked = group.rankings;
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby={`${group.source}-heading`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-brick">{group.publisher}</p>
      <h2 id={`${group.source}-heading`} className="mt-2 text-xl font-bold text-ink">{name}</h2>
      <p className="mt-2 text-sm text-ink-soft">
        Financial quarter ended <time dateTime={group.report_date}>{dateLabel(group.report_date)}</time>. Standalone quarterly income; dollar amounts are shown in USD.
      </p>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">{group.definition}.</p>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
        Listed fees come from the current published catalog; the date above is the financial filing quarter, not a historical fee-price snapshot. This is the newest usable matched quarter for this source’s institutions with eligible published fees, rather than a count of every regulator filing.
        {group.stale_institution_count > 0 && <> {group.stale_institution_count.toLocaleString()} {group.stale_institution_count === 1 ? "institution with an older matched filing is" : "institutions with older matched filings are"} excluded from these summaries and rankings.</>}
      </p>

      <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ["Matched institutions", group.institution_count.toLocaleString()],
          ["Mean listed fee", fee(group.summary.mean_listed_fee_usd)],
          [`Mean quarterly ${group.source === "fdic" ? "deposit charges" : "fee income"}`, money(group.summary.mean_income_usd)],
        ].map(([title, value]) => (
          <div key={title} className="rounded-xl border border-border/80 bg-white/70 px-4 py-3">
            <dt className="text-sm text-ink-muted">{title}</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {group.institution_count < group.minimum_summary_count && (
        <p className="mt-3 text-sm text-ink-muted">Fewer than {group.minimum_summary_count} institutions report in this matched quarter. Aggregate means are unavailable; older quarters are not substituted.</p>
      )}

      <h3 className="mt-7 text-base font-bold text-ink">By reported asset size</h3>
      <p className="mt-2 text-sm text-ink-muted">Size uses each matched filing’s quarter-end assets. Means require at least {group.minimum_summary_count} institutions; the income-to-assets mean has its own reporting count.</p>
      <div role="region" aria-label={`${name} by reported assets, ${group.report_date}`} tabIndex={0} className="mt-3 overflow-x-auto rounded-xl border border-border/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brick">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <caption className="sr-only">{name} by asset size, {group.report_date}</caption>
          <thead className="border-b border-border/60 bg-paper/60">
            <tr>
              <th scope="col" className={headingCell}>Asset size</th>
              <th scope="col" className={`${headingCell} text-right`}>Institutions</th>
              <th scope="col" className={`${headingCell} text-right`}>Mean listed fee</th>
              <th scope="col" className={`${headingCell} text-right`}>Mean quarterly income</th>
              <th scope="col" className={`${headingCell} text-right`}>Income / assets (bps)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {group.by_tier.map((tier) => (
              <tr key={tier.asset_size_tier}>
                <th scope="row" className="px-4 py-3 font-medium text-ink">{FDIC_TIER_LABELS[tier.asset_size_tier] ?? "Assets unavailable"}</th>
                <td className={numericCell}>{tier.institution_count.toLocaleString()}</td>
                <td className={numericCell}>{fee(tier.mean_listed_fee_usd)}</td>
                <td className={numericCell}>{money(tier.mean_income_usd)}</td>
                <td className={numericCell}>{intensity(tier.mean_income_per_10k_assets)}<span className="mt-1 block text-xs text-ink-muted">{tier.ratio_reported_count} with assets</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-7 text-base font-bold text-ink">Institutions in this reporting cohort</h3>
      <p className="mt-2 text-sm text-ink-muted">
        {ranked.length > 0
          ? `Showing ${ranked.length} of ${group.ranking_preview.total} institutions with usable assets, ranked within this source and quarter by income per $10,000 of assets.`
          : `Fewer than ${group.minimum_summary_count} institutions have a usable asset denominator. The ranking is unavailable.`}
        {" "}This quarterly measure is not annualized and is not a share of revenue.
      </p>
      {ranked.length > 0 && (
        <div role="region" aria-label={`${name} institution ranking, ${group.report_date}`} tabIndex={0} className="mt-3 overflow-x-auto rounded-xl border border-border/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brick">
          <table className="w-full min-w-[45rem] text-left text-sm">
            <caption className="sr-only">{name}: institutions ranked within {group.report_date}</caption>
            <thead className="border-b border-border/60 bg-paper/60">
              <tr>
                <th scope="col" className={headingCell}>Rank</th>
                <th scope="col" className={headingCell}>Institution</th>
                <th scope="col" className={`${headingCell} text-right`}>Mean listed fee</th>
                <th scope="col" className={`${headingCell} text-right`}>Quarterly income</th>
                <th scope="col" className={`${headingCell} text-right`}>Assets</th>
                <th scope="col" className={`${headingCell} text-right`}>Income / assets (bps)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {ranked.map((row) => (
                <tr key={row.institution_id}>
                  <td className="px-4 py-3 tabular-nums text-ink-muted">{row.rank}</td>
                  <th scope="row" className="px-4 py-3 font-medium text-ink">
                    <Link href={`/institution/${row.institution_id}`} className="hover:text-brick focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brick">{row.institution_name}</Link>
                    {row.state_code && <span className="ml-2 text-xs text-ink-muted">{row.state_code}</span>}
                  </th>
                  <td className={numericCell}>{fee(row.listed_fee_usd)}</td>
                  <td className={numericCell}>{money(row.income_usd)}</td>
                  <td className={numericCell}>{money(row.assets_usd)}</td>
                  <td className={numericCell}>{intensity(row.income_per_10k_assets)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default async function FeeRevenueAnalysisPage() {
  const user = await getCurrentUser();
  if (!canAccessPremium(user)) {
    return <div className="mx-auto max-w-3xl px-4 py-16"><UpgradeGate message="Fee-to-revenue analysis" locked="Published fee schedules alongside dated bank deposit charges and credit-union fee income, with separate reporting populations." /></div>;
  }
  const research = await getFeeRevenueResearchCached();
  return (
    <div className="mx-auto max-w-page px-6 py-14">
      <BreadcrumbJsonLd items={[{ name: "Home", href: "/" }, { name: "Research", href: "/research" }, { name: "Fee-Revenue Analysis", href: "/research/fee-revenue-analysis" }]} />
      <header className={PAGE_HEADER}>
        <p className="text-xs font-semibold uppercase tracking-wider text-brick">Original Research</p>
        <h1 className="mt-3 text-[1.75rem] font-extrabold leading-tight tracking-tight text-ink sm:text-[2.25rem]">Fee Schedules and Filed Income</h1>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-ink-muted">
          Current published fee schedules alongside filed quarterly income. Bank deposit service charges and broader credit-union fee income describe different measures; their means and rankings are kept separate.
        </p>
      </header>
      {research.groups.length === 0 && <p className="mt-8 text-base text-ink-muted">No usable matched filing cohort is available. Missing financial data is not shown as zero.</p>}
      {research.groups.map((group) => <SourceCohort key={group.source} group={group} />)}
      {(["fdic", "ncua"] as const).filter((source) => !research.groups.some((group) => group.source === source)).map((source) => (
        <p key={source} className="mt-6 text-sm text-ink-muted">{label(source)}: no usable matched filing cohort is available.</p>
      ))}
      {(research.excluded_invalid_rows > 0 || research.conflicting_institution_count > 0) && (
        <p className="mt-5 text-sm text-ink-muted">Records without consistent source, identity, quarter or usable financial values are excluded. Conflicting institution records are not counted.</p>
      )}
      <section className="mt-10 rounded-xl border border-border bg-paper/50 px-5 py-4" aria-labelledby="methodology-heading">
        <h2 id="methodology-heading" className="text-base font-semibold text-ink">Methodology</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Each source uses one matched reporting quarter. Only institutions with at least three distinct approved, sourced published fee categories eligible under the consumer statistics rules and computable quarterly financials are included. Mean listed fee first uses one representative amount per category: the highest overdraft amount, and the median for other categories; it then averages those category values within each institution. Consumer, shared-audience, and audience-unspecified rows can qualify; business-only rows do not. Category mixes differ, so this is not a like-for-like fee-price benchmark.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          FDIC bank deposit charges are quarterly. NCUA broad member-service and membership fee income is reported year-to-date; later standalone quarters subtract that institution’s prior-quarter year-to-date amount. A missing prior filing is not filled or guessed. The two income measures are not combined. Financial income and assets are converted from stored thousands into USD once; listed fee amounts are already USD.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Income / assets is quarterly income per $10,000 of quarter-end assets, expressed in basis points. Missing or zero assets supply no ratio. Counts describe this matched sample, rather than all institutions or all filings. These dated cross-sections do not establish peer growth, merger-adjusted trends, or whether fee pricing caused income.
        </p>
      </section>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "ScholarlyArticle", headline: "Fee Schedules and Filed Income", description: metadata.description, url: `${SITE_URL}/research/fee-revenue-analysis` }).replace(/</g, "\\u003c") }} />
    </div>
  );
}
