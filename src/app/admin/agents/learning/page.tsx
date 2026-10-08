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

/** Worked, found nothing to do, and failed, as shares of all attempts. */
function shares(row: MethodRow): { worked: number; nothing: number; failed: number } {
  if (row.attempts <= 0) return { worked: 0, nothing: 0, failed: 0 };
  const worked = row.ok / row.attempts;
  const nothing = row.nothing / row.attempts;
  return { worked, nothing, failed: Math.max(0, 1 - worked - nothing) };
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function OutcomeBar({ row }: { row: MethodRow }) {
  const { worked, nothing, failed } = shares(row);
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="presentation">
      <div className="h-full bg-emerald-500" style={{ width: `${worked * 100}%` }} />
      <div className="h-full bg-gray-300 dark:bg-white/25" style={{ width: `${nothing * 100}%` }} />
      <div className="h-full bg-red-500" style={{ width: `${failed * 100}%` }} />
    </div>
  );
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
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
          <span><span aria-hidden="true" className="mr-1 inline-block size-2 rounded-full bg-emerald-500" />Worked</span>
          <span><span aria-hidden="true" className="mr-1 inline-block size-2 rounded-full bg-gray-300 dark:bg-white/25" />Nothing there or already up to date (not a failure)</span>
          <span><span aria-hidden="true" className="mr-1 inline-block size-2 rounded-full bg-red-500" />Failed</span>
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
                const split = shares(current);
                return (
                  <li key={method.strategy} className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
                    <p className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                      {methodName(method.strategy)}{" "}
                      <span className="rounded bg-black/[0.05] px-1 font-mono text-[10px] font-medium text-gray-600 dark:bg-white/[0.08] dark:text-gray-300">
                        v{current.version}
                      </span>
                    </p>
                    <div className="min-w-0 self-center">
                      <OutcomeBar row={current} />
                      {method.older.length > 0 ? (
                        <p className="mt-1 text-[11px] text-gray-500">
                          Earlier: {method.older.slice(0, 3).map((row) => `v${row.version} ${pct(shares(row).worked)} worked of ${row.attempts.toLocaleString("en-US")}`).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-xs tabular-nums text-gray-600 dark:text-gray-300 sm:text-right">
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">{pct(split.worked)}</span> worked ·{" "}
                      {pct(split.nothing)} nothing there ·{" "}
                      <span className={split.failed >= 0.1 ? "font-semibold text-red-700 dark:text-red-400" : undefined}>{pct(split.failed)} failed</span>
                      <span className="block text-[11px] text-gray-500">of {current.attempts.toLocaleString("en-US")} tries</span>
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
