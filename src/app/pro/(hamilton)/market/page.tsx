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
import { Figure, MemoHeader, MemoPage, MemoSection, SERIF } from "@/components/hamilton/memo/memo";

export const metadata: Metadata = {
  title: "Market",
};

const SPOTLIGHT_CATS = ["overdraft", "nsf", "monthly_maintenance", "atm_non_network", "wire_domestic_outgoing", "card_foreign_txn"];

const EVIDENCE_LABEL: Record<string, string> = {
  strong: "Strong evidence",
  provisional: "Provisional",
  insufficient: "Too few to rely on",
};

const rowLink =
  "flex min-h-11 items-start gap-3 px-4 py-3 no-underline hover:bg-warm-150";

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
    : "Date not recorded";

  const spotlightEntries = SPOTLIGHT_CATS
    .map((cat) => allEntries.find((e) => e.fee_category === cat))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));

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
    <MemoPage>
      <MemoHeader
        kicker="Reference"
        title="Market"
        dek={
          <>
            National medians for the fees that matter most, the Federal Reserve&apos;s latest reading of each
            district and published research. Fee data last checked {lastUpdated}.
          </>
        }
      />

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-warm-200 pb-6 sm:grid-cols-4">
        <Figure label="Institutions" value={stats.total_institutions.toLocaleString()} />
        <Figure label="Fees on file" value={stats.total_observations.toLocaleString()} />
        <Figure label="Fee categories" value={String(stats.total_categories)} />
        <Figure label="Last updated" value={lastUpdated} />
      </div>

      {spotlightEntries.length > 0 && (
        <MemoSection title="National medians" note="The middle price across every institution that publishes the fee. Open one to see it in My fees.">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {spotlightEntries.map((entry) => (
              <li key={entry.fee_category}>
                <Link
                  href={`/pro/research?fee=${encodeURIComponent(entry.fee_category)}`}
                  className="group flex min-h-11 flex-col rounded-lg border border-warm-300 bg-warm-50 px-4 py-3 no-underline hover:border-warm-500"
                >
                  <span className="text-sm text-warm-700 group-hover:text-terra-text">{getDisplayName(entry.fee_category)}</span>
                  <span className="mt-0.5 text-2xl text-warm-900 [font-variant-numeric:tabular-nums]" style={SERIF}>
                    {formatAmount(entry.median_amount)}
                  </span>
                  <span className="mt-0.5 text-xs text-warm-600 [font-variant-numeric:tabular-nums]">
                    {entry.institution_count.toLocaleString()} institutions ·{" "}
                    {EVIDENCE_LABEL[entry.maturity_tier] ?? entry.maturity_tier}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </MemoSection>
      )}

      {beigeBookHeadlines.size > 0 && (
        <MemoSection
          title="Federal Reserve Beige Book"
          note={
            <>
              {latestBeigeDate ? `Released ${latestBeigeDate}. ` : ""}Each district opens its page on the public site.
            </>
          }
        >
          <ul className="divide-y divide-warm-200 overflow-hidden rounded-lg border border-warm-300 bg-warm-50">
            {Array.from(beigeBookHeadlines.entries())
              .sort(([a], [b]) => a - b)
              .map(([districtId, headline]) => (
                <li key={districtId}>
                  <Link href={`/research/district/${districtId}`} className={rowLink}>
                    <span className="mt-0.5 w-6 shrink-0 text-right text-xs font-semibold text-terra-text [font-variant-numeric:tabular-nums]">
                      {districtId}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-warm-900">{DISTRICT_NAMES[districtId]}</span>
                      <span className="mt-0.5 block line-clamp-2 text-sm text-warm-700">{headline.text}</span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
          {beigeEditions.length > 0 && (
            <p className="text-xs text-warm-600">
              Recent editions:{" "}
              {beigeEditions
                .map(
                  (ed) =>
                    `${ed.release_code} (${new Date(ed.release_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })})`,
                )
                .join(" · ")}
            </p>
          )}
        </MemoSection>
      )}

      {articles.length > 0 && (
        <MemoSection title="Published research" note="Articles open on the public site.">
          <ul className="divide-y divide-warm-200 overflow-hidden rounded-lg border border-warm-300 bg-warm-50">
            {articles.map((article) => (
              <li key={article.slug}>
                <Link href={`/research/articles/${article.slug}`} className="flex min-h-11 flex-col gap-1 px-4 py-3 no-underline hover:bg-warm-150">
                  <span className="flex w-full flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <span className="min-w-0 text-base text-warm-900" style={SERIF}>
                      {article.title}
                    </span>
                    <span className="shrink-0 rounded border border-warm-300 bg-warm-150 px-1.5 py-px text-xs text-warm-700">
                      {article.category}
                    </span>
                  </span>
                  {article.subtitle && <span className="line-clamp-2 text-sm text-warm-700">{article.subtitle}</span>}
                  <span className="text-xs text-warm-600">
                    {article.author}
                    {article.published_at ? ` · ${timeAgo(article.published_at)}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </MemoSection>
      )}

      {speeches.length > 0 && (
        <MemoSection title="Fed speeches and testimony" note="Each opens at its source in a new tab.">
          <ul className="divide-y divide-warm-200 overflow-hidden rounded-lg border border-warm-300 bg-warm-50">
            {speeches.map((speech) => (
              <li key={speech.id}>
                <a
                  href={speech.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${rowLink} justify-between`}
                >
                  <span className="min-w-0">
                    <span className="block line-clamp-2 text-sm font-medium text-warm-900">{speech.title}</span>
                    <span className="mt-0.5 block text-xs text-warm-600">
                      {[speech.speaker, speech.fed_district ? `District ${speech.fed_district}` : null, timeAgo(speech.published_at)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span aria-hidden className="mt-0.5 shrink-0 text-sm text-warm-600">↗</span>
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </MemoSection>
      )}

      <MemoSection title="Elsewhere in Hamilton">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { label: "Peer group", desc: "Choose who you're compared with", href: "/pro/settings" },
            { label: "Fee categories", desc: "Every fee type and its median", href: "/pro/categories" },
            { label: "Fed districts", desc: "Fees and coverage by district", href: "/pro/districts" },
            { label: "Institutions", desc: "Find any bank or credit union", href: "/pro/data" },
            { label: "Ask Hamilton", desc: "Questions about any fee or institution", href: "/pro/analyze" },
          ].map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="group block min-h-11 rounded-lg border border-warm-300 bg-warm-50 px-4 py-3 no-underline hover:border-warm-500"
              >
                <span className="block text-base text-warm-900 group-hover:text-terra-text" style={SERIF}>
                  {link.label}
                </span>
                <span className="mt-0.5 block text-sm text-warm-600">{link.desc}</span>
              </Link>
            </li>
          ))}
        </ul>
      </MemoSection>
    </MemoPage>
  );
}
