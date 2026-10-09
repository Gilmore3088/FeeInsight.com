import Link from "next/link";
import type { RegArticle } from "@/lib/data-store/news";
import type { RuleTracker } from "@/lib/regulatory/rule-tracker";
import { formatWireDate, wireHref, type PageWindow, type WireParams } from "@/lib/regulatory/wire";
import { FEE_TYPE_LABELS, feeTypesOf } from "@/lib/regulatory/wire-fee-types";
import type { FeeDataStrip } from "@/lib/regulatory/wire-fee-links";
import { researchKey, type RelatedItem, type ResearchNote } from "@/lib/regulatory/wire-research";
import { ResearchPanel } from "./research-panel";
import { RuleTrackerSection } from "./rule-tracker";
import { FeeChips, LABEL, SANS, WirePager, WireSummary } from "./wire-controls";

/**
 * The Regulatory Wire's Federal view, laid out as a research desk rather than a feed: the
 * numbers that need attention first, then the rulemaking tracker (comment deadlines and
 * effective dates from the Federal Register), then the agencies' releases grouped by day.
 * Server-rendered; every filter is a link.
 */

interface NewsFeedProps {
  params: WireParams;
  articles: Pick<RegArticle, "guid" | "source" | "title" | "link" | "topic" | "published_at" | "created_at">[];
  /** Federal Register rules sorted by what needs action; empty when none are stored. */
  tracker: RuleTracker;
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
  /** "In the fee data" strips (national figures), keyed by guid. */
  feeData?: Map<string, FeeDataStrip>;
  /** Preview only: fee figures labelled EXAMPLE. */
  exampleFees?: boolean;
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

/** Release topics that bear on fees; their rows carry a "Fee-related" mark. */
const FEE_TOPICS = new Set(["overdraft", "fees_pricing"]);

function Glance({ items }: { items: { label: string; value: number; note: string; strong?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-warm-200 bg-white/70 sm:grid-cols-4">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`px-4 py-3 ${i % 2 === 1 ? "border-l border-warm-200" : ""} ${i >= 2 ? "border-t border-warm-200 sm:border-t-0" : ""} ${i === 2 ? "sm:border-l" : ""}`}
        >
          <dt className={LABEL} style={SANS}>
            {item.label}
          </dt>
          <dd className={`mt-1 text-[24px] leading-none [font-variant-numeric:tabular-nums] ${item.strong ? "text-[#A93D25]" : "text-warm-900"}`}>
            {item.value.toLocaleString()}
          </dd>
          <dd className="mt-1 text-[11px] text-warm-600">{item.note}</dd>
        </div>
      ))}
    </dl>
  );
}

type ReleaseRow = NewsFeedProps["articles"][number];

/** Releases on one page, grouped under the day they were published (UTC). */
function byDay(articles: ReleaseRow[], now: Date): { day: string; iso: string; rows: ReleaseRow[] }[] {
  const groups: { day: string; iso: string; rows: ReleaseRow[] }[] = [];
  for (const article of articles) {
    const d = formatWireDate(article.published_at || article.created_at, now);
    const day = d ? `${d.absolute}${d.relative ? ` · ${d.relative}` : ""}` : "Date not given";
    const iso = d?.iso ?? "";
    const last = groups[groups.length - 1];
    if (last && last.iso === iso) last.rows.push(article);
    else groups.push({ day, iso, rows: [article] });
  }
  return groups;
}

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
  tracker,
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
  feeData,
  exampleFees = false,
}: NewsFeedProps) {
  const filtered = Boolean(params.source || params.topic || params.q || params.fee);
  const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="mt-2 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_240px] 2xl:gap-8">
      <div className="min-w-0">
        <Glance
          items={[
            { label: "Open for comment", value: tracker.open.length, note: "Proposed rules taking comments", strong: tracker.open.length > 0 },
            { label: "Taking effect", value: tracker.upcoming.length, note: "Final rules not yet in effect" },
            { label: "Fee-related rules", value: tracker.fee_related, note: "Overdraft, NSF, fees, Reg E, DD, CC" },
            { label: "Agency releases", value: win.total, note: phrase.replace(/^in /, "") },
          ]}
        />

        <RuleTrackerSection tracker={tracker} now={now} />

        <section aria-labelledby="releases-heading" className="mt-7">
          <h2 id="releases-heading" className={LABEL} style={SANS}>
            Agency releases
          </h2>
          <div className="mt-1">
            <WireSummary params={params} win={win} noun="federal releases" phrase={phrase} />
            <FeeChips params={params} />
          </div>
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
              <div className="space-y-4">
                {byDay(articles, now).map((group) => (
                  <div key={group.iso || group.day}>
                    <h3 className="text-[11px] font-semibold text-warm-700 [font-variant-numeric:tabular-nums]" style={SANS}>
                      {group.iso ? <time dateTime={group.iso}>{group.day}</time> : group.day}
                    </h3>
                    <ol className="mt-1.5 divide-y divide-warm-200/60 overflow-hidden rounded-xl border border-warm-200 bg-white/70">
                      {group.rows.map((article) => {
                        const fees = feeTypesOf(article.title);
                        return (
                        <li key={article.guid}>
                          <a
                            href={article.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-start gap-3 px-4 py-3 no-underline transition-colors hover:bg-warm-100/80"
                          >
                            <span
                              className={`mt-0.5 w-12 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-wider ${
                                SOURCE_COLORS[article.source] ?? "bg-warm-800 text-white"
                              }`}
                              style={SANS}
                            >
                              {article.source}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[14px] font-medium leading-snug text-warm-900 transition-colors group-hover:text-[#A93D25] sm:text-[15px]">
                                {article.title}
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-warm-600">
                                <span className="flex items-center gap-1.5">
                                  <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${TOPIC_DOTS[article.topic] ?? "bg-warm-400"}`} />
                                  {topicLabels[article.topic] ?? article.topic}
                                </span>
                                {sourceLabels[article.source] && sourceLabels[article.source] !== article.source ? (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{sourceLabels[article.source]}</span>
                                  </>
                                ) : null}
                                {fees.length > 0 ? (
                                  <span className="font-medium text-[#A93D25]">{fees.map((f) => FEE_TYPE_LABELS[f]).join(", ")}</span>
                                ) : FEE_TOPICS.has(article.topic) ? (
                                  <span className="rounded-full border border-[#A93D25]/40 px-1.5 font-medium text-[#A93D25]">Fee-related</span>
                                ) : null}
                              </span>
                            </span>
                          </a>
                          <div className="px-4">
                            <ResearchPanel
                              note={notes?.get(researchKey("article", article.guid)) ?? null}
                              related={related?.get(article.guid) ?? []}
                              example={exampleNotes}
                              open={openPanels.includes(article.guid)}
                              now={now}
                              feeData={feeData?.get(article.guid) ?? null}
                              exampleFees={exampleFees}
                            />
                          </div>
                        </li>
                        );
                      })}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
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

        <details className="group rounded-xl border border-warm-200 bg-warm-100/50 px-4 py-3">
          <summary className={`${LABEL} cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden`} style={SANS}>
            How the Wire is sourced <span className="group-open:hidden">▸</span>
            <span className="hidden group-open:inline">▾</span>
          </summary>
          <p className="mt-2 text-[11px] leading-relaxed text-warm-600">
            The rulemaking tracker reads proposed and final rules from the Federal Register, with
            their comment deadlines and effective dates. Agency releases are the official press
            releases of the Federal Reserve, FDIC, OCC and CFPB, from their RSS feeds; their
            topics and fee types come from keywords in the headline. Dates are each release&apos;s
            publication day (UTC). A Research panel holds an AI summary of the release&apos;s own
            text where one has been written, labelled as such; related items are linked by
            docket, rule or institution name.{" "}
            {canRefreshFeeds ? "Click Refresh to pull the latest updates." : "New releases are read once a day."}
          </p>
        </details>
      </aside>
    </div>
  );
}
