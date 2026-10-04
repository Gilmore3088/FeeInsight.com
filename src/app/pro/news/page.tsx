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
import { NewsFeed } from "./news-feed";
import { ProReferenceWorkflowBanner } from "@/components/pro/reference-workflow-banner";

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

  const articles = await getArticles({ source, topic, since, limit: 100 });
  const totalCount = await getArticleCount({ source, topic, since });
  const topicCounts = await getTopicCounts(since);
  const sourceCounts = await getSourceCounts(since);

  return (
    <main id="main-content">
    <div className="mx-auto max-w-7xl px-6 py-10">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <span className="h-px w-8 bg-[#C44B2E]/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
          Live Feed
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
        Real-time regulatory updates from the Federal Reserve, FDIC, OCC, and CFPB.
      </p>

      <ProReferenceWorkflowBanner userId={user.id} surface="news" />

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
      />
    </div>
    </main>
  );
}
