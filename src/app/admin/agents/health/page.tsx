export const dynamic = "force-dynamic";

import Link from "next/link";
import { unstable_cache } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { formatAdminDateTime } from "@/lib/admin-time";
import { crewMember } from "@/lib/agents/crew";
import { NOTIFICATION_STEPS, getAgentHealth, type AgentHealth } from "@/lib/data-store/agent-health";
import { ScreenHeader, Unreadable } from "../../room-hub";

// One grouped scan of a week of steps (about 35ms on prod); a minute old is fresh enough.
const getCachedAgentHealth = unstable_cache(() => getAgentHealth(), ["admin", "agent-health"], { revalidate: 60 });

const TONE: Record<AgentHealth["tone"], { label: string; dot: string }> = {
  good: { label: "Healthy", dot: "bg-emerald-500" },
  watch: { label: "Some failures", dot: "bg-amber-400" },
  bad: { label: "Failing", dot: "bg-red-500" },
  quiet: { label: "Nothing run lately", dot: "bg-gray-400" },
};

/** "registry-cfpb" reads as "Load cfpb"; other step names lose their dashes. */
function stepName(stepKey: string): string {
  if (stepKey.startsWith("registry-")) return `Load ${stepKey.slice("registry-".length).replace(/-/g, " ")}`;
  const plain = stepKey.replace(/[-_.]/g, " ");
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

function weekday(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" });
}

function DayBars({ health }: { health: AgentHealth }) {
  const peak = Math.max(1, ...health.days.map((day) => day.done + day.failed));
  return (
    <div className="mt-3 grid grid-cols-7 gap-1.5" aria-label="Steps per day, last seven days">
      {health.days.map((day) => {
        const total = day.done + day.failed;
        return (
          <div key={day.day} className="flex flex-col items-center gap-1" title={`${day.day}: ${day.done} done, ${day.failed} failed`}>
            <div className="flex h-14 w-full flex-col justify-end overflow-hidden rounded-sm bg-black/[0.04] dark:bg-white/[0.05]">
              {day.failed > 0 ? <div className="w-full bg-red-500" style={{ height: `${Math.max((day.failed / peak) * 100, 4)}%` }} /> : null}
              {day.done > 0 ? <div className="w-full bg-emerald-500/80" style={{ height: `${(day.done / peak) * 100}%` }} /> : null}
            </div>
            <span className="text-[10px] tabular-nums text-gray-500">{total > 0 ? total.toLocaleString("en-US") : "0"}</span>
            <span className="text-[10px] text-gray-400">{weekday(day.day)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Agent health: what each agent finished and what failed, day by day, from the run log. */
export default async function AgentsHealthPage() {
  await requireAuth("view");
  const health = await getCachedAgentHealth().catch((error) => {
    console.error("Agent health failed", error);
    return null;
  });

  return (
    <section className="flex flex-col gap-4 pb-10">
      <ScreenHeader
        title="Agent health"
        lede="Every step each agent finished or failed in the last seven days, from the run log. Green is done, red is failed. An agent shows Failing when a step's newest run failed; a step that has worked again since shows grey. Search-engine notices (the IndexNow ping) are listed on their own and never count toward pipeline health."
      />
      {!health ? <Unreadable what="The agent run log" /> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(health ?? []).map((agent) => {
          const meta = crewMember(agent.agent);
          const tone = TONE[agent.tone];
          return (
            <Link key={agent.agent} href={meta?.href ?? "/admin/agents"} prefetch={false} className="admin-card block min-w-0 px-4 py-4 transition-colors hover:border-gray-300 dark:hover:border-white/20">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {meta?.name ?? agent.agent}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                  <span aria-hidden="true" className={`size-2 rounded-full ${tone.dot}`} />
                  {tone.label}
                </span>
              </div>
              <p className="mt-1 text-xs tabular-nums text-gray-500">
                {agent.done.toLocaleString("en-US")} done · {agent.failed.toLocaleString("en-US")} failed
                {agent.waiting > 0 ? ` · ${agent.waiting.toLocaleString("en-US")} waiting` : ""} · last finished{" "}
                {agent.lastDoneAt ? formatAdminDateTime(agent.lastDoneAt) : "not this week"}
              </p>
              <DayBars health={agent} />
              {agent.failing.length > 0 ? (
                <ul className="mt-3 space-y-0.5 border-t border-black/[0.05] pt-2 text-xs dark:border-white/[0.06]">
                  {agent.failing.slice(0, 5).map((step) => (
                    <li key={step.stepKey} className="flex justify-between gap-2">
                      <span className="min-w-0">
                        <span className={`block truncate ${step.stillFailing ? "font-semibold text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400"}`}>
                          {stepName(step.stepKey)}
                        </span>
                        <span className="block text-[11px] text-gray-500">
                          {step.stillFailing
                            ? `Still failing · last failed ${step.lastFailedAt ? formatAdminDateTime(step.lastFailedAt) : "recently"}`
                            : `Working again since ${step.lastDoneAt ? formatAdminDateTime(step.lastDoneAt) : "its last run"}`}
                        </span>
                      </span>
                      <span className={`shrink-0 tabular-nums ${step.stillFailing ? "font-semibold text-red-700 dark:text-red-400" : "text-gray-500"}`}>
                        {step.failed} of {step.failed + step.done}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {agent.notifications.length > 0 ? (
                <ul className="mt-3 space-y-1.5 border-t border-black/[0.05] pt-2 text-xs dark:border-white/[0.06]" aria-label="Search-engine notices, not pipeline health">
                  {agent.notifications.map((step) => (
                    <li key={step.stepKey}>
                      <span className="block font-semibold text-gray-700 dark:text-gray-300">
                        {NOTIFICATION_STEPS[step.stepKey]?.label ?? stepName(step.stepKey)} ·{" "}
                        {step.stillFailing
                          ? `last failed ${step.lastFailedAt ? formatAdminDateTime(step.lastFailedAt) : "recently"}`
                          : `working again since ${step.lastDoneAt ? formatAdminDateTime(step.lastDoneAt) : "its last run"}`}
                      </span>
                      {step.lastError ? <span className="block text-[11px] text-gray-600 dark:text-gray-400">{step.lastError}</span> : null}
                      <span className="block text-[11px] text-gray-500">{NOTIFICATION_STEPS[step.stepKey]?.recovery}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
