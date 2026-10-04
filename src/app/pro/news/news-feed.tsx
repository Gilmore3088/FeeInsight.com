"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { refreshFeeds } from "./actions";

interface Article {
  guid: string;
  source: string;
  title: string;
  link: string;
  topic: string;
  published_at: string | null;
  created_at: string;
}

interface NewsFeedProps {
  articles: Article[];
  totalCount: number;
  topicCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  topicLabels: Record<string, string>;
  sourceLabels: Record<string, string>;
  activeSource?: string;
  activeTopic?: string;
  activeRange: string;
}

const SOURCE_COLORS: Record<string, string> = {
  FED: "bg-sky-900 text-sky-200",
  FDIC: "bg-emerald-900 text-emerald-200",
  OCC: "bg-amber-900 text-amber-200",
  CFPB: "bg-violet-900 text-violet-200",
};

const TOPIC_COLORS: Record<string, string> = {
  overdraft: "text-red-400",
  consumer_lending: "text-amber-400",
  mergers_acquisitions: "text-cyan-400",
  rulemaking_compliance: "text-violet-400",
  fees_pricing: "text-emerald-400",
  general: "text-warm-600",
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function NewsFeed({
  articles,
  totalCount,
  topicCounts,
  sourceCounts,
  topicLabels,
  sourceLabels,
  activeSource,
  activeTopic,
  activeRange,
}: NewsFeedProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [refreshResult, setRefreshResult] = useState<string | null>(null);

  function setFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/pro/news?${params.toString()}`);
  }

  function handleRefresh() {
    startRefresh(async () => {
      try {
        const result = await refreshFeeds();
        setRefreshResult(
          `${result.inserted} new articles${result.errors.length > 0 ? ` (${result.errors.length} feed errors)` : ""}`
        );
        router.refresh();
        setTimeout(() => setRefreshResult(null), 4000);
      } catch {
        setRefreshResult("Failed to refresh feeds");
        setTimeout(() => setRefreshResult(null), 4000);
      }
    });
  }

  return (
    <div className="mt-6">
      {/* Control bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Time range */}
        <div className="flex items-center rounded-lg border border-warm-200 bg-white/70 overflow-hidden text-[11px]">
          {(["today", "week", "month", "all"] as const).map((range) => (
            <button
              key={range}
              onClick={() => setFilter("range", range === "all" ? undefined : range)}
              className={`px-3 py-1.5 font-medium transition-colors ${
                activeRange === range
                  ? "bg-warm-900 text-white"
                  : "text-warm-600 hover:text-warm-900 hover:bg-warm-100"
              }`}
            >
              {range === "today" ? "24h" : range === "week" ? "7d" : range === "month" ? "30d" : "All"}
            </button>
          ))}
        </div>

        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-lg border border-warm-200 bg-white/70 px-3 py-1.5 text-[11px] font-medium text-warm-600 hover:text-warm-900 hover:bg-warm-100 transition-colors disabled:opacity-50"
        >
          <svg aria-hidden="true"
            className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {refreshing ? "Fetching..." : "Refresh"}
        </button>

        {refreshResult && (
          <span className="text-[11px] text-emerald-600 font-medium">{refreshResult}</span>
        )}

        {/* Count */}
        <span className="ml-auto text-[11px] tabular-nums text-warm-500">
          {totalCount.toLocaleString()} articles
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_240px]">
        {/* Article list */}
        <div className="min-w-0">
          {articles.length === 0 ? (
            <div className="rounded-xl border border-warm-200 bg-white/70 px-6 py-12 text-center">
              <p className="text-[14px] text-warm-600">No articles found.</p>
              <p className="mt-1 text-[12px] text-warm-500">
                Click Refresh to fetch the latest regulatory news.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-warm-200 bg-white/70 backdrop-blur-sm overflow-hidden divide-y divide-warm-200/50">
              {articles.map((article) => (
                <a
                  key={article.guid}
                  href={article.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-warm-100/80 no-underline"
                >
                  {/* Source badge */}
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                      SOURCE_COLORS[article.source] ?? "bg-gray-800 text-gray-200"
                    }`}
                  >
                    {article.source}
                  </span>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-snug text-warm-900 group-hover:text-terra transition-colors line-clamp-2">
                      {article.title}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[10px]">
                      <span className={`font-semibold uppercase tracking-wider ${TOPIC_COLORS[article.topic] ?? "text-warm-500"}`}>
                        {topicLabels[article.topic] ?? article.topic}
                      </span>
                      <span className="text-warm-300">&middot;</span>
                      <span className="text-warm-500 tabular-nums">
                        {timeAgo(article.published_at || article.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* External link icon */}
                  <svg aria-hidden="true"
                    className="mt-1 h-3.5 w-3.5 shrink-0 text-warm-300 group-hover:text-terra transition-colors"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar: filters */}
        <aside className="space-y-5">
          {/* Sources */}
          <div className="rounded-xl border border-warm-200 bg-white/70 backdrop-blur-sm px-4 py-3.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500 mb-2.5">
              Sources
            </p>
            <div className="space-y-1">
              <button
                onClick={() => setFilter("source", undefined)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${
                  !activeSource ? "bg-warm-900 text-white font-medium" : "text-warm-700 hover:bg-warm-100"
                }`}
              >
                <span>All Sources</span>
                <span className="tabular-nums text-[10px] opacity-60">
                  {Object.values(sourceCounts).reduce((a, b) => a + b, 0)}
                </span>
              </button>
              {Object.entries(sourceLabels).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter("source", activeSource === key ? undefined : key)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${
                    activeSource === key ? "bg-warm-900 text-white font-medium" : "text-warm-700 hover:bg-warm-100"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-sm ${SOURCE_COLORS[key]?.split(" ")[0] ?? "bg-gray-800"}`} />
                    {label}
                  </span>
                  <span className="tabular-nums text-[10px] opacity-60">
                    {sourceCounts[key] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Topics */}
          <div className="rounded-xl border border-warm-200 bg-white/70 backdrop-blur-sm px-4 py-3.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500 mb-2.5">
              Topics
            </p>
            <div className="space-y-1">
              <button
                onClick={() => setFilter("topic", undefined)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${
                  !activeTopic ? "bg-warm-900 text-white font-medium" : "text-warm-700 hover:bg-warm-100"
                }`}
              >
                <span>All Topics</span>
                <span className="tabular-nums text-[10px] opacity-60">
                  {Object.values(topicCounts).reduce((a, b) => a + b, 0)}
                </span>
              </button>
              {Object.entries(topicLabels).map(([key, label]) => {
                const count = topicCounts[key] ?? 0;
                if (count === 0 && key !== activeTopic) return null;
                return (
                  <button
                    key={key}
                    onClick={() => setFilter("topic", activeTopic === key ? undefined : key)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${
                      activeTopic === key ? "bg-warm-900 text-white font-medium" : "text-warm-700 hover:bg-warm-100"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`text-[10px] ${TOPIC_COLORS[key] ?? ""}`}>&bull;</span>
                      {label}
                    </span>
                    <span className="tabular-nums text-[10px] opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* About */}
          <div className="rounded-xl border border-warm-200 bg-warm-100/50 px-4 py-3.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500 mb-2">
              About
            </p>
            <p className="text-[11px] leading-relaxed text-warm-600">
              Aggregated from official RSS feeds of the Federal Reserve, FDIC,
              OCC, and CFPB. Articles are classified by topic using keyword
              analysis. Click Refresh to pull the latest updates.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
