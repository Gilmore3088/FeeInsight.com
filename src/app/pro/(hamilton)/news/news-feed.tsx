import Link from "next/link";
import type { RegArticle } from "@/lib/data-store/news";
import { wireHref, type PageWindow, type WireParams } from "@/lib/regulatory/wire";
import { FEE_TYPE_LABELS, feeTypesOf } from "@/lib/regulatory/wire-fee-types";
import { researchKey, type RelatedItem, type ResearchNote } from "@/lib/regulatory/wire-research";
import { ResearchPanel } from "./research-panel";
import { FeeChips, LABEL, SANS, WireDate, WirePager, WireSummary } from "./wire-controls";

/**
 * The Regulatory Wire's Federal view: the agencies' own releases, one page at a time, with
 * the source and topic filters beside them. Server-rendered; every filter is a link.
 */

interface NewsFeedProps {
  params: WireParams;
  articles: Pick<RegArticle, "guid" | "source" | "title" | "link" | "topic" | "published_at" | "created_at">[];
  win: PageWindow;
  /** "in the last 12 months", for the count line. */
  phrase: string;
  topicCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  topicLabels: Record<string, string>;
  sourceLabels: Record<string, string>;
  now: Date;
  /** Operators (admins and analysts) can pull the feeds by hand. */
  canRefreshFeeds?: boolean;
  /** Research notes keyed by researchKey("article", guid). */
  notes?: Map<string, ResearchNote>;
  /** Related releases and rules, keyed by guid. */
  related?: Map<string, RelatedItem[]>;
  /** Preview only: notes were written by hand and are labelled EXAMPLE. */
  exampleNotes?: boolean;
  /** Preview only: guids whose panel renders open. */
  openPanels?: string[];
}

const SOURCE_COLORS: Record<string, string> = {
  FED: "bg-sky-900 text-sky-100",
  FDIC: "bg-emerald-900 text-emerald-100",
  OCC: "bg-amber-900 text-amber-100",
  CFPB: "bg-violet-900 text-violet-100",
};

const TOPIC_DOTS: Record<string, string> = {
  overdraft: "bg-red-500",
  consumer_lending: "bg-amber-500",
  mergers_acquisitions: "bg-cyan-600",
  rulemaking_compliance: "bg-violet-500",
  fees_pricing: "bg-emerald-600",
  general: "bg-warm-400",
};

function FilterLink({
  href,
  active,
  label,
  count,
  dot,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
  dot?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] no-underline transition-colors ${
        active ? "bg-warm-900 font-medium text-white" : "text-warm-700 hover:bg-warm-100"
      }`}
    >
      <span className="flex items-center gap-2">
        {dot ? <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-sm ${dot}`} /> : null}
        {label}
      </span>
      <span className="text-[10px] opacity-70 [font-variant-numeric:tabular-nums]">{count.toLocaleString()}</span>
    </Link>
  );
}

export function NewsFeed({
  params,
  articles,
  win,
  phrase,
  topicCounts,
  sourceCounts,
  topicLabels,
  sourceLabels,
  now,
  canRefreshFeeds = false,
  notes,
  related,
  exampleNotes = false,
  openPanels = [],
}: NewsFeedProps) {
  const filtered = Boolean(params.source || params.topic || params.q || params.fee);
  const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="mt-2 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_240px]">
      <div className="min-w-0">
        <WireSummary params={params} win={win} noun="federal releases" phrase={phrase} />
        <FeeChips params={params} />
        <div className="mt-3">
          {articles.length === 0 ? (
            <div className="rounded-xl border border-warm-200 bg-white/70 px-6 py-10 text-center">
              <p className="text-[14px] text-warm-900">No federal releases here.</p>
              <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-warm-600">
                {filtered
                  ? "Nothing matches these filters. Try a longer time range, another search, or all sources and topics."
                  : canRefreshFeeds
                    ? "Nothing is stored for this window. Click Refresh to fetch the latest releases."
                    : "Nothing is stored for this window. The agencies' releases are read once a day."}
              </p>
            </div>
          ) : (
            <ol className="divide-y divide-warm-200/60 overflow-hidden rounded-xl border border-warm-200 bg-white/70">
              {articles.map((article) => {
                const fees = feeTypesOf(article.title);
                return (
                <li key={article.guid}>
                  <a
                    href={article.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block px-4 pb-3 pt-3.5 no-underline transition-colors hover:bg-warm-100/80"
                  >
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
                      <span
                        className={`rounded px-1.5 py-0.5 font-bold uppercase tracking-wider ${
                          SOURCE_COLORS[article.source] ?? "bg-warm-800 text-white"
                        }`}
                      >
                        {article.source}
                      </span>
                      {sourceLabels[article.source] && sourceLabels[article.source] !== article.source ? (
                        <span className="font-semibold uppercase tracking-wider text-warm-600">
                          {sourceLabels[article.source]}
                        </span>
                      ) : null}
                    </p>
                    <h3 className="mt-1.5 text-[16px] font-medium leading-snug text-warm-900 transition-colors group-hover:text-[#A93D25] sm:text-[17px]">
                      {article.title}
                    </h3>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-warm-600">
                      <WireDate value={article.published_at || article.created_at} now={now} />
                      <span aria-hidden="true">·</span>
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${TOPIC_DOTS[article.topic] ?? "bg-warm-400"}`} />
                        {topicLabels[article.topic] ?? article.topic}
                      </span>
                      {fees.length > 0 ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-[#A93D25]">{fees.map((f) => FEE_TYPE_LABELS[f]).join(", ")}</span>
                        </>
                      ) : null}
                    </p>
                  </a>
                  <div className="px-4">
                    <ResearchPanel
                      note={notes?.get(researchKey("article", article.guid)) ?? null}
                      related={related?.get(article.guid) ?? []}
                      example={exampleNotes}
                      open={openPanels.includes(article.guid)}
                      now={now}
                    />
                  </div>
                </li>
                );
              })}
            </ol>
          )}
        </div>
        <WirePager params={params} win={win} />
      </div>

      <aside className="space-y-5">
        <div className="rounded-xl border border-warm-200 bg-white/70 px-4 py-3.5">
          <h2 className={`${LABEL} mb-2.5`} style={SANS}>
            Sources
          </h2>
          <div className="space-y-1">
            <FilterLink
              href={wireHref(params, { source: undefined, page: 1 })}
              active={!params.source}
              label="All sources"
              count={sum(sourceCounts)}
            />
            {Object.entries(sourceLabels).map(([key, label]) => (
              <FilterLink
                key={key}
                href={wireHref(params, { source: params.source === key ? undefined : key, page: 1 })}
                active={params.source === key}
                label={label}
                count={sourceCounts[key] ?? 0}
                dot={SOURCE_COLORS[key]?.split(" ")[0]}
              />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-warm-200 bg-white/70 px-4 py-3.5">
          <h2 className={`${LABEL} mb-2.5`} style={SANS}>
            Topics
          </h2>
          <div className="space-y-1">
            <FilterLink
              href={wireHref(params, { topic: undefined, page: 1 })}
              active={!params.topic}
              label="All topics"
              count={sum(topicCounts)}
            />
            {Object.entries(topicLabels).map(([key, label]) => {
              const count = topicCounts[key] ?? 0;
              if (count === 0 && key !== params.topic) return null;
              return (
                <FilterLink
                  key={key}
                  href={wireHref(params, { topic: params.topic === key ? undefined : key, page: 1 })}
                  active={params.topic === key}
                  label={label}
                  count={count}
                  dot={TOPIC_DOTS[key]}
                />
              );
            })}
          </div>
          <p className="mt-2.5 text-[10px] leading-relaxed text-warm-600">
            Counts are for this time range{params.q ? " and search" : ""}.
          </p>
        </div>

        <div className="rounded-xl border border-warm-200 bg-warm-100/50 px-4 py-3.5">
          <h2 className={`${LABEL} mb-2`} style={SANS}>
            About
          </h2>
          <p className="text-[11px] leading-relaxed text-warm-600">
            The official press releases of the Federal Reserve, FDIC, OCC and CFPB, from their
            RSS feeds. Topics and fee types come from keywords in the headline. Dates are each
            release&apos;s publication day (UTC). A Research panel holds an AI summary of the
            release&apos;s own text where one has been written, labelled as such; related items
            are linked by docket, rule or institution name.{" "}
            {canRefreshFeeds ? "Click Refresh to pull the latest updates." : "New releases are read once a day."}
          </p>
        </div>
      </aside>
    </div>
  );
}
