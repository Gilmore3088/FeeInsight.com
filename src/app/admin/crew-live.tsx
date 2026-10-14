"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { CrewFeedItem, CrewMemberStatus, CrewState } from "@/lib/agents/crew";
import type { AdminAgent } from "@/lib/agents/types";
import { formatAdminDateTime, formatAdminTime } from "@/lib/admin-time";

const POLL_MS = 15_000;

const STATE_STYLE: Record<CrewState, { label: string; dot: string; text: string }> = {
  working: { label: "Working", dot: "bg-emerald-500", text: "text-emerald-800 dark:text-emerald-300" },
  waiting: { label: "Waiting", dot: "bg-sky-500", text: "text-sky-800 dark:text-sky-300" },
  blocked: { label: "Blocked", dot: "bg-red-500", text: "text-red-800 dark:text-red-300" },
  idle: { label: "Idle", dot: "bg-gray-400", text: "text-gray-600 dark:text-gray-400" },
  unknown: { label: "Unknown", dot: "bg-amber-400", text: "text-amber-800 dark:text-amber-300" },
};

const TONE_STYLE: Record<CrewFeedItem["tone"], string> = {
  ok: "text-gray-800 dark:text-gray-200",
  warn: "text-amber-800 dark:text-amber-300",
  error: "text-red-800 dark:text-red-300",
};

function clock(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? formatAdminTime(iso) : formatAdminDateTime(iso);
}

export function CrewLive({
  initialCrew,
  initialFeed,
  children,
}: {
  initialCrew: CrewMemberStatus[];
  initialFeed: CrewFeedItem[];
  /** Shown between the crew cards and the activity log (the marketing team). */
  children?: ReactNode;
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
  // Growth is the ledger name the marketing team runs under; the team has its own cards (children).
  const pipelineCrew = crew.filter((member) => member.agent !== "growth");
  const nameOf = (agent: AdminAgent) => crew.find((member) => member.agent === agent)?.name ?? agent;

  return (
    <div className="space-y-8">
      <section aria-label="The crew">
        <p className="admin-section-title">The crew</p>
        <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pipelineCrew.map((member) => {
            const style = STATE_STYLE[member.state];
            return (
              <li key={member.agent}>
                <Link
                  href={member.href}
                  prefetch={false}
                  className="block h-full w-full rounded-lg border border-black/[0.08] px-4 py-3 text-left transition-colors hover:border-black/20 dark:border-white/[0.1] dark:hover:border-white/25"
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
                  <p className="mt-1 text-xs text-gray-500">
                    Last success: {member.lastSuccessAt ? clock(member.lastSuccessAt) : "none in 30 days"}
                    {member.lastAttemptAt && (!member.lastSuccessAt || member.lastAttemptAt > member.lastSuccessAt) ? ` · last try ${clock(member.lastAttemptAt)}` : ""}
                    {member.nextRunAt ? ` · next scheduled ${clock(member.nextRunAt)}` : ""}
                  </p>
                  <p className="mt-2 flex items-center justify-between gap-2 text-[11px] text-gray-500">
                    <span>{member.doneToday} done today{member.lastAt ? ` · last ${clock(member.lastAt)}` : ""}</span>
                    <span aria-hidden="true" className="text-sm font-semibold text-[var(--brand-primary)]">›</span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {children}

      <section aria-label="Activity log">
        <div className="flex items-baseline justify-between">
          <p className="admin-section-title">
            Activity log{filter ? ` · ${nameOf(filter)}` : ""}
          </p>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Show
            <select
              id="crew-log-filter"
              value={filter ?? ""}
              onChange={(event) => setFilter((event.target.value || null) as AdminAgent | null)}
              className="min-h-11 rounded-md border border-black/15 bg-white px-2 py-1 text-sm text-gray-800 sm:min-h-0 sm:text-xs dark:border-white/15 dark:bg-transparent dark:text-gray-200"
            >
              <option value="">Everyone</option>
              {crew.map((member) => (
                <option key={member.agent} value={member.agent}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
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
