export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import {
  getArticles,
  getArticleCount,
  getTopicCounts,
  getSourceCounts,
  TOPIC_LABELS,
  SOURCE_LABELS,
} from "@/lib/data-store/news";
import Link from "next/link";
import { getStateNews, getStatesWithNews } from "@/lib/data-store/state-news";
import { STATE_NAMES } from "@/lib/us-states";
import { NewsFeed } from "./news-feed";
import { StateWire } from "./state-wire";

export const metadata: Metadata = {
  title: "Regulatory Wire",
};

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((item) => returnParams.append(key, item));
    } else if (value) {
      returnParams.set(key, value);
    }
  }
  const returnPath = returnParams.toString()
    ? `/pro/news?${returnParams.toString()}`
    : "/pro/news";

  const user = await getCurrentUser();
  if (!user) redirect(`/login?from=${encodeURIComponent(returnPath)}`);
  if (!canAccessPremium(user)) redirect(`/subscribe?from=${encodeURIComponent(returnPath)}`);

  const source = typeof params.source === "string" ? params.source : undefined;
  const topic = typeof params.topic === "string" ? params.topic : undefined;

  // Time range
  let since: string | undefined;
  const range = typeof params.range === "string" ? params.range : "all";
  const now = new Date();
  if (range === "today") {
    since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  } else if (range === "week") {
    since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  } else if (range === "month") {
    since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  // "all" = no since

  const view = params.view === "states" ? "states" : "federal";
  const stateParam = typeof params.state === "string" ? params.state.toUpperCase() : "";
  const activeState = STATE_NAMES[stateParam] ? stateParam : null;

  const viewSwitch = (
    <nav aria-label="Wire view" className="mt-4 inline-flex overflow-hidden rounded-lg border border-warm-200 bg-white/70 text-[12px]">
      {([
        ["federal", "Federal agencies", "/pro/news"],
        ["states", "States", activeState ? `/pro/news?view=states&state=${activeState}` : "/pro/news?view=states"],
      ] as const).map(([key, label, href]) => (
        <Link
          key={key}
          href={href}
          aria-current={view === key ? "page" : undefined}
          className={`px-3 py-1.5 font-medium no-underline transition-colors ${
            view === key ? "bg-warm-900 text-white" : "text-warm-600 hover:bg-warm-100 hover:text-warm-900"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );

  if (view === "states") {
    const [news, states] = await Promise.all([
      // Some state news pages list posts going back years; the wire shows the last twelve months.
      getStateNews({
        stateCode: activeState,
        since: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        limit: activeState ? 50 : 30,
      }),
      getStatesWithNews(),
    ]);
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <h1
          className="text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815]"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Regulatory Wire
        </h1>
        <p className="mt-1 text-[13px] text-[#6B6255]">
          State regulators&apos; news, state fee bills and the press coverage of them.
        </p>
        {viewSwitch}
        <StateWire news={news} states={states} activeState={activeState} />
      </div>
    );
  }

  const articles = await getArticles({ source, topic, since, limit: 100 });
  const totalCount = await getArticleCount({ source, topic, since });
  const topicCounts = await getTopicCounts(since);
  const sourceCounts = await getSourceCounts(since);

  return (
    <div>
    <div className="mx-auto max-w-7xl px-6 py-10">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <span className="h-px w-8 bg-[#C44B2E]/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
          Updated daily
        </span>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      </div>
      <h1
        className="text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Regulatory Wire
      </h1>
      <p className="mt-1 text-[13px] text-[#6B6255]">
        Regulatory releases from the Federal Reserve, FDIC, OCC and CFPB, read once a day.
      </p>
      {viewSwitch}

      <NewsFeed
        articles={articles}
        totalCount={totalCount}
        topicCounts={topicCounts}
        sourceCounts={sourceCounts}
        topicLabels={TOPIC_LABELS}
        sourceLabels={SOURCE_LABELS}
        activeSource={source}
        activeTopic={topic}
        activeRange={range}
        canRefreshFeeds={user?.role === "admin" || user?.role === "analyst"}
      />
    </div>
    </div>
  );
}
