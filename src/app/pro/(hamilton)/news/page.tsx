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
import { MemoHeader, MemoPage } from "@/components/hamilton/memo/memo";

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
    <nav aria-label="Wire view" className="inline-flex overflow-hidden rounded-md border border-warm-300 bg-warm-50 text-sm">
      {([
        ["federal", "Federal agencies", "/pro/news"],
        ["states", "States", activeState ? `/pro/news?view=states&state=${activeState}` : "/pro/news?view=states"],
      ] as const).map(([key, label, href]) => (
        <Link
          key={key}
          href={href}
          aria-current={view === key ? "page" : undefined}
          className={`flex min-h-11 items-center px-4 font-medium no-underline ${
            view === key ? "bg-warm-900 text-warm-ink-50" : "text-warm-700 hover:bg-warm-150 hover:text-warm-900"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );

  // A still dot, not a pulse: the wire is read once a day, so nothing here is live.
  const updatedDaily = (
    <span className="inline-flex items-center gap-2 rounded-full border border-warm-300 bg-warm-50 px-3 py-1 text-xs font-medium text-warm-700">
      <span aria-hidden className="h-2 w-2 rounded-full bg-terra" />
      Updated daily
    </span>
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
      <MemoPage>
        <MemoHeader
          kicker="Regulatory Wire · States"
          title="Regulatory Wire"
          dek="State regulators' news, state fee bills and the press coverage of them."
          actions={updatedDaily}
        />
        <div>
          {viewSwitch}
          <StateWire news={news} states={states} activeState={activeState} />
        </div>
      </MemoPage>
    );
  }

  const articles = await getArticles({ source, topic, since, limit: 100 });
  const totalCount = await getArticleCount({ source, topic, since });
  const topicCounts = await getTopicCounts(since);
  const sourceCounts = await getSourceCounts(since);

  return (
    <MemoPage>
      <MemoHeader
        kicker="Regulatory Wire · Federal agencies"
        title="Regulatory Wire"
        dek="Releases from the Federal Reserve, FDIC, OCC and CFPB, read once a day."
        actions={updatedDaily}
      />
      <div>
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
    </MemoPage>
  );
}
