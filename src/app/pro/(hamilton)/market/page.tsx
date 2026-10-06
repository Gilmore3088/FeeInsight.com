export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import {
  getNationalIndexCached,
  getPublicStats,
  getDataFreshness,
} from "@/lib/data-store";
import {
  getBeigeBookHeadlines,
  getBeigeBookEditions,
  getRecentSpeeches,
} from "@/lib/data-store/fed";
import { getPublishedArticles } from "@/lib/data-store/articles";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { formatAmount } from "@/lib/format";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = {
  title: "Market Intelligence",
};

const SPOTLIGHT_CATS = ["overdraft", "nsf", "monthly_maintenance", "atm_non_network", "wire_domestic_outgoing", "card_foreign_txn"];

export default async function ProMarketPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?from=/pro/market");
  if (!canAccessPremium(user)) redirect("/subscribe?from=/pro/market");

  const allEntries = await getNationalIndexCached();
  const stats = await getPublicStats();
  const freshness = await getDataFreshness();

  const lastUpdated = freshness.last_crawl_at
    ? new Date(freshness.last_crawl_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "---";

  const spotlightEntries = SPOTLIGHT_CATS
    .map((cat) => allEntries.find((e) => e.fee_category === cat))
    .filter(Boolean);

  // Rich content sources
  let beigeBookHeadlines = new Map<number, { text: string; release_date: string }>();
  let beigeEditions: { release_code: string; release_date: string }[] = [];
  let speeches: { id: number; title: string; speaker: string | null; published_at: string; source_url: string; fed_district: number | null }[] = [];
  let articles: { slug: string; title: string; subtitle: string | null; category: string; published_at: string | null; author: string }[] = [];

  try {
    beigeBookHeadlines = await getBeigeBookHeadlines();
  } catch { /* tables may not exist */ }

  try {
    beigeEditions = await getBeigeBookEditions(4);
  } catch { /* tables may not exist */ }

  try {
    speeches = await getRecentSpeeches(8);
  } catch { /* tables may not exist */ }

  try {
    articles = await getPublishedArticles(6);
  } catch { /* tables may not exist */ }

  const latestBeigeDate = beigeEditions[0]?.release_date
    ? new Date(beigeEditions[0].release_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  return (
    <div>
    <div className="mx-auto max-w-7xl px-6 py-14">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className="h-px w-8 bg-terra/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-terra/60">
          Market Intelligence
        </span>
      </div>

      <h1
        className="text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-warm-900"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        News, Research & Insights
      </h1>
      <p className="mt-2 text-[14px] text-warm-600">
        Curated intelligence from the Federal Reserve, published research, and live fee benchmarks.
        <span className="ml-2 text-warm-500">Updated {lastUpdated}</span>
      </p>

      {/* Fee ticker strip */}
      <div className="mt-6 flex items-center gap-4 overflow-x-auto scrollbar-none rounded-xl border border-warm-200/80 bg-white/70 backdrop-blur-sm px-5 py-3">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.15em] text-terra">
          National Medians
        </span>
        <span className="shrink-0 h-3 w-px bg-warm-300" />
        {spotlightEntries.map((entry) => (
          <Link
            key={entry!.fee_category}
            href={`/pro/simulate?category=${entry!.fee_category}`}
            className="shrink-0 flex items-center gap-2 text-[11px] hover:text-terra transition-colors no-underline"
          >
            <span className="text-warm-600">{getDisplayName(entry!.fee_category)}</span>
            <span className="font-semibold text-warm-900 [font-variant-numeric:tabular-nums]">{formatAmount(entry!.median_amount)}</span>
            <span className="text-warm-500 [font-variant-numeric:tabular-nums]" title={`${entry!.maturity_tier} evidence`}>
              n={entry!.institution_count}
            </span>
          </Link>
        ))}
      </div>

      {/* Main grid: 2 columns */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column (2/3): Beige Book + Research */}
        <div className="lg:col-span-2 space-y-6">

          {/* Beige Book Latest */}
          {beigeBookHeadlines.size > 0 && (
            <div className="rounded-xl border border-warm-200/80 bg-white/70 backdrop-blur-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-warm-200/60 bg-warm-100/60 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-warm-500">
                    Federal Reserve Beige Book
                  </span>
                  {latestBeigeDate && (
                    <span className="ml-2 text-[11px] text-warm-500">{latestBeigeDate}</span>
                  )}
                </div>
              </div>
              <div className="divide-y divide-warm-200/40">
                {Array.from(beigeBookHeadlines.entries())
                  .sort(([a], [b]) => a - b)
                  .map(([districtId, headline]) => (
                    <Link
                      key={districtId}
                      href={`/research/district/${districtId}`}
                      className="flex items-start gap-3 px-5 py-3 hover:bg-warm-100/60 transition-colors no-underline"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warm-200/40 text-[10px] font-bold text-warm-600 mt-0.5">
                        {districtId}
                      </span>
                      <div className="min-w-0">
                        <span className="text-[12px] font-medium text-warm-900">
                          {DISTRICT_NAMES[districtId]}
                        </span>
                        <p className="text-[12px] text-warm-600 mt-0.5 line-clamp-1">
                          {headline.text}
                        </p>
                      </div>
                    </Link>
                  ))}
              </div>
            </div>
          )}

          {/* Published Research */}
          {articles.length > 0 && (
            <div className="rounded-xl border border-warm-200/80 bg-white/70 backdrop-blur-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-warm-200/60 bg-warm-100/60">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-warm-500">
                  Published Research
                </span>
              </div>
              <div className="divide-y divide-warm-200/40">
                {articles.map((article) => (
                  <Link
                    key={article.slug}
                    href={`/research/articles/${article.slug}`}
                    className="block px-5 py-3.5 hover:bg-warm-100/60 transition-colors no-underline"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <span
                          className="text-[14px] font-medium text-warm-900 hover:text-terra transition-colors"
                          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                        >
                          {article.title}
                        </span>
                        {article.subtitle && (
                          <p className="text-[12px] text-warm-600 mt-0.5 line-clamp-1">
                            {article.subtitle}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 rounded-full bg-warm-200/40 px-2 py-0.5 text-[9px] font-bold uppercase text-warm-600">
                        {article.category}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-warm-500">
                      <span>{article.author}</span>
                      {article.published_at && (
                        <>
                          <span className="text-warm-300">&middot;</span>
                          <span>{timeAgo(article.published_at)}</span>
                        </>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Fed Speeches & Testimony */}
          {speeches.length > 0 && (
            <div className="rounded-xl border border-warm-200/80 bg-white/70 backdrop-blur-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-warm-200/60 bg-warm-100/60">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-warm-500">
                  Fed Speeches & Testimony
                </span>
              </div>
              <div className="divide-y divide-warm-200/40">
                {speeches.map((speech) => (
                  <a
                    key={speech.id}
                    href={speech.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start justify-between gap-4 px-5 py-3 hover:bg-warm-100/60 transition-colors no-underline"
                  >
                    <div className="min-w-0">
                      <span className="text-[13px] font-medium text-warm-900 line-clamp-2">
                        {speech.title}
                      </span>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-warm-500">
                        {speech.speaker && <span>{speech.speaker}</span>}
                        {speech.fed_district && (
                          <>
                            <span className="text-warm-300">&middot;</span>
                            <span>District {speech.fed_district}</span>
                          </>
                        )}
                        <span className="text-warm-300">&middot;</span>
                        <span>{timeAgo(speech.published_at)}</span>
                      </div>
                    </div>
                    <svg className="h-3.5 w-3.5 shrink-0 text-warm-500 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column (1/3): Quick stats + navigation */}
        <div className="space-y-6">
          {/* Dataset overview */}
          <div className="rounded-xl border border-warm-200/80 bg-white/70 backdrop-blur-sm p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-warm-500 mb-4">
              Dataset
            </p>
            <div className="space-y-3">
              {[
                { label: "Institutions", value: stats.total_institutions.toLocaleString() },
                { label: "Observations", value: stats.total_observations.toLocaleString() },
                { label: "Categories", value: String(stats.total_categories) },
                { label: "Last Updated", value: lastUpdated },
              ].map((item) => (
                <div key={item.label} className="flex justify-between text-[13px]">
                  <span className="text-warm-600">{item.label}</span>
                  <span className="font-medium [font-variant-numeric:tabular-nums] text-warm-900">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Key benchmarks */}
          <div className="rounded-xl border border-warm-200/80 bg-white/70 backdrop-blur-sm p-5 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-terra/30 to-transparent" />
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-terra/60 mb-4">
              Key Benchmarks
            </p>
            <div className="space-y-3">
              {spotlightEntries.slice(0, 4).map((entry) => (
                <Link
                  key={entry!.fee_category}
                  href={`/pro/simulate?category=${entry!.fee_category}`}
                  className="block group no-underline"
                >
                  <span className="text-[11px] text-warm-500 group-hover:text-terra transition-colors">
                    {getDisplayName(entry!.fee_category)}
                  </span>
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="text-[18px] font-light [font-variant-numeric:tabular-nums] text-warm-900"
                      style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                    >
                      {formatAmount(entry!.median_amount)}
                    </span>
                    <span className="text-[10px] text-warm-500">
                      median · {entry!.institution_count} institutions · {entry!.maturity_tier}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Beige Book editions */}
          {beigeEditions.length > 0 && (
            <div className="rounded-xl border border-warm-200/80 bg-white/70 backdrop-blur-sm p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-warm-500 mb-3">
                Beige Book Editions
              </p>
              <div className="space-y-1.5">
                {beigeEditions.map((ed) => (
                  <div key={ed.release_code} className="flex items-center justify-between text-[12px]">
                    <span className="text-warm-700">{ed.release_code}</span>
                    <span className="text-warm-500 [font-variant-numeric:tabular-nums]">
                      {new Date(ed.release_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick links */}
          <div className="rounded-xl border border-warm-200/80 bg-white/70 backdrop-blur-sm p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-warm-500 mb-3">
              Explore
            </p>
            <div className="space-y-2">
              {[
                { label: "Peer Builder", href: "/pro/peers" },
                { label: "All Categories", href: "/pro/categories" },
                { label: "District Intelligence", href: "/pro/districts" },
                { label: "Institution Database", href: "/pro/data" },
                { label: "Hamilton Analyze", href: "/pro/analyze" },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-1.5 text-[13px] text-warm-600 hover:text-terra transition-colors"
                >
                  <span className="h-1 w-1 rounded-full bg-warm-300 shrink-0" />
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
