export const dynamic = "force-dynamic";

import Link from "next/link";
import { unstable_cache } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { formatAdminDateTime } from "@/lib/admin-time";
import {
  STAGE_AGENT,
  STAGE_ORDER,
  getMethodScorecard,
  groupMethods,
  type MethodGroup,
  type MethodRow,
} from "@/lib/data-store/method-scorecard";
import { Unreadable } from "../../room-hub";

// A 7-day scan of the attempt log takes about a quarter second; ten minutes old is fresh enough.
const getCachedScorecard = unstable_cache(() => getMethodScorecard(7), ["admin", "method-scorecard"], { revalidate: 600 });

function methodName(strategy: string): string {
  const bare = strategy.replace(/^[a-z]+\./, "").replace(/^family\./, "").replace(/_/g, " ");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

function share(row: MethodRow): number {
  return row.attempts > 0 ? row.ok / row.attempts : 0;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function tone(value: number): string {
  if (value >= 0.7) return "bg-emerald-500";
  if (value >= 0.3) return "bg-amber-400";
  return "bg-red-500";
}

/** The Learning screen: for every agent, which methods worked this week and which didn't. */
export default async function LearningPage() {
  await requireAuth("view");
  let scorecard: Awaited<ReturnType<typeof getMethodScorecard>> | null = null;
  try {
    scorecard = await getCachedScorecard();
  } catch (error) {
    console.error("Learning scorecard failed", error);
  }
  const groups = scorecard ? groupMethods(scorecard.rows) : new Map<string, MethodGroup[]>();
  const stages = STAGE_ORDER.filter((stage) => groups.has(stage));

  return (
    <div className="space-y-8 pb-10">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-gray-500">Agents · Learning</p>
        <h1 className="admin-display-title mt-2">Which methods are working</h1>
        <p className="admin-lede mt-1">
          Every method each agent tried in the last 7 days, from the attempt log the agents read before choosing what to try next.
          A method that keeps failing on a bank is not tried there again until it changes version.
        </p>
        {scorecard ? <p className="mt-2 text-[11px] text-gray-500">Read {formatAdminDateTime(scorecard.readAt)}</p> : null}
      </header>

      {!scorecard ? <Unreadable what="The attempt log" /> : null}
      {scorecard && stages.length === 0 ? <p className="text-sm text-gray-500">No attempts were logged in the last 7 days.</p> : null}

      {stages.map((stage) => {
        const owner = STAGE_AGENT[stage] ?? { agent: "atlas", name: stage, job: "" };
        const methods = groups.get(stage)!;
        return (
          <section key={stage} aria-label={`${owner.name}: ${owner.job}`} className="admin-card px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {owner.name} <span className="font-normal text-gray-500">· {owner.job}</span>
              </p>
              <Link href={`/admin/${owner.agent === "atlas" ? "atlas/details" : owner.agent}`} prefetch={false} className="text-xs font-semibold text-[var(--brand-primary)]">
                Open {owner.name}
              </Link>
            </div>
            <ul className="mt-3 space-y-3">
              {methods.map((method) => {
                const current = method.current;
                const rate = share(current);
                return (
                  <li key={method.strategy} className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
                    <p className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                      {methodName(method.strategy)}{" "}
                      <span className="rounded bg-black/[0.05] px-1 font-mono text-[10px] font-medium text-gray-600 dark:bg-white/[0.08] dark:text-gray-300">
                        v{current.version}
                      </span>
                    </p>
                    <div className="min-w-0 self-center">
                      <div className="h-2 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
                        <div className={`h-full rounded-full ${tone(rate)}`} style={{ width: `${Math.max(rate * 100, current.ok > 0 ? 1.5 : 0)}%` }} />
                      </div>
                      {method.older.length > 0 ? (
                        <p className="mt-1 text-[11px] text-gray-500">
                          Earlier: {method.older.slice(0, 3).map((row) => `v${row.version} ${pct(share(row))} of ${row.attempts.toLocaleString("en-US")}`).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-xs tabular-nums text-gray-600 dark:text-gray-300 sm:text-right">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{pct(rate)}</span> worked ·{" "}
                      {current.ok.toLocaleString("en-US")} of {current.attempts.toLocaleString("en-US")}
                      {current.costUsd > 0 ? (
                        <span className="block text-[11px] text-gray-500">
                          ${current.costUsd.toFixed(2)} spent
                          {current.ok > 0 ? ` · $${(current.costUsd / current.ok).toFixed(2)} per success` : ""}
                        </span>
                      ) : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
