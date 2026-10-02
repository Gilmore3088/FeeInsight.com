"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CrewFeedItem, CrewMemberStatus, CrewState } from "@/lib/agents/crew";
import type { AdminAgent } from "@/lib/agents/types";

const POLL_MS = 15_000;

const STATE_STYLE: Record<CrewState, { label: string; dot: string; text: string }> = {
  working: { label: "Working", dot: "bg-emerald-500", text: "text-emerald-800 dark:text-emerald-300" },
  waiting: { label: "Waiting", dot: "bg-sky-500", text: "text-sky-800 dark:text-sky-300" },
  blocked: { label: "Blocked", dot: "bg-red-500", text: "text-red-800 dark:text-red-300" },
  idle: { label: "Idle", dot: "bg-gray-400", text: "text-gray-600 dark:text-gray-400" },
};

const TONE_STYLE: Record<CrewFeedItem["tone"], string> = {
  ok: "text-gray-800 dark:text-gray-200",
  warn: "text-amber-800 dark:text-amber-300",
  error: "text-red-800 dark:text-red-300",
};

function clock(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
        " " + date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function CrewLive({
  initialCrew,
  initialFeed,
}: {
  initialCrew: CrewMemberStatus[];
  initialFeed: CrewFeedItem[];
}) {
  const [crew, setCrew] = useState(initialCrew);
  const [feed, setFeed] = useState(initialFeed);
  const [filter, setFilter] = useState<AdminAgent | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/admin/crew${filter ? `?agent=${filter}` : ""}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { crew: CrewMemberStatus[]; feed: CrewFeedItem[] };
        if (!cancelled) {
          setCrew(body.crew);
          setFeed(body.feed);
        }
      } catch {
        // Keep the last good view; the next poll retries.
      }
    }
    if (filter) void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [filter]);

  const visibleFeed = filter ? feed.filter((item) => item.agent === filter) : feed;
  const nameOf = (agent: AdminAgent) => crew.find((member) => member.agent === agent)?.name ?? agent;

  return (
    <div className="space-y-8">
      <section aria-label="The crew">
        <p className="admin-section-title">The crew</p>
        <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {crew.map((member) => {
            const style = STATE_STYLE[member.state];
            const selected = filter === member.agent;
            return (
              <li key={member.agent}>
                <button
                  type="button"
                  onClick={() => setFilter(selected ? null : member.agent)}
                  aria-pressed={selected}
                  className={`h-full w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                    selected
                      ? "border-[var(--brand-primary)] bg-[var(--brand-primary)]/5"
                      : "border-black/[0.08] hover:border-black/20 dark:border-white/[0.1]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{member.name}</p>
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${style.text}`}>
                      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                      {style.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{member.role}</p>
                  <p className="mt-2 text-sm text-gray-800 dark:text-gray-200">
                    <span className="font-semibold">Now:</span> {member.now}
                  </p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    <span className="font-semibold">Last:</span> {member.last ?? "Nothing yet."}
                  </p>
                  <p className="mt-2 text-[11px] text-gray-500">
                    {member.doneToday} done today{member.lastAt ? ` · last ${clock(member.lastAt)}` : ""}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Activity log">
        <div className="flex items-baseline justify-between">
          <p className="admin-section-title">
            Activity log{filter ? ` · ${nameOf(filter)}` : ""}
          </p>
          <div className="flex items-center gap-3 text-xs">
            {filter && (
              <>
                <button type="button" className="font-semibold text-[var(--brand-primary)]" onClick={() => setFilter(null)}>
                  Show everyone
                </button>
                <Link href={crew.find((member) => member.agent === filter)?.href ?? "/admin"} className="text-gray-500 hover:text-gray-800">
                  Open {nameOf(filter)}&apos;s tools
                </Link>
              </>
            )}
          </div>
        </div>
        {visibleFeed.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No activity yet. When the crew works, every step shows up here.</p>
        ) : (
          <ol className="mt-2 divide-y divide-black/[0.06] border-y border-black/[0.06] dark:divide-white/[0.06] dark:border-white/[0.06]">
            {visibleFeed.map((item) => (
              <li key={item.id} className="grid grid-cols-[72px_88px_1fr] gap-2 py-2 text-sm sm:grid-cols-[96px_96px_1fr]">
                <span className="tabular-nums text-xs text-gray-500">{clock(item.at)}</span>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{nameOf(item.agent)}</span>
                <span className={TONE_STYLE[item.tone]}>{item.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
