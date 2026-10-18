import { unstable_cache } from "next/cache";
import { listScoreboardSnapshots, scoreboardSchemaReady, type ScoreboardSnapshotRow } from "@/lib/data-store/answer-key";
import { sql } from "@/lib/data-store/connection";
import { getSpendSummary, type SpendLine } from "@/lib/data-store/console-spend";
import { formatAdminDateTime } from "@/lib/admin-time";
import { VitalsRow, type Vital } from "./today-panels";

/**
 * The Pipeline room's agent frame (admin redesign #1122, step 4): every agent page opens on the
 * same strip under its title. It shows the scorecard numbers the agent owns, its provider spend
 * against its own cap, its latest steps, and its guide. Each number is read from a table and dated;
 * one that could not be read says so. The agent's own piles and tools follow on its page.
 */

export type FrameAgent = "atlas" | "magellan" | "rosetta" | "knox" | "darwin";

const GUIDE_BASE = "https://github.com/Gilmore3088/FeeInsight.com/blob/main/";

export const AGENT_GUIDES: Record<FrameAgent, string> = {
  atlas: "src/lib/agents/atlas/AGENTS.md",
  magellan: "src/lib/agents/magellan/AGENTS.md",
  rosetta: "src/lib/agents/rosetta/AGENTS.md",
  knox: "src/lib/agents/knox/AGENTS.md",
  darwin: "src/lib/agents/darwin/AGENTS.md",
};

const pct = (value: number | null | undefined) => (value == null ? null : `${(value * 100).toFixed(1)}%`);
const count = (value: number) => value.toLocaleString("en-US");
const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The scorecard numbers an agent owns, from the newest snapshot. Targets are only the ones the scorecard states. */
export function agentScoreVitals(agent: FrameAgent, snapshot: ScoreboardSnapshotRow | null): Vital[] {
  const goal = snapshot?.goal ?? null;
  const asOf = snapshot ? ` · scorecard ${snapshot.snapshot_date}` : "";
  const missing = snapshot ? "Not in the newest scorecard." : "No scorecard snapshot yet.";
  const href = "/admin/scoreboard";
  switch (agent) {
    case "atlas": {
      const live = goal?.liveInstitutions;
      return [{
        label: "Institutions with live fees",
        value: live ? count(live.live) : null,
        note: live ? `${count(live.addedThisWeek)} added in 7 days${asOf}` : missing,
        href,
      }];
    }
    case "magellan": {
      const cells = goal?.coverageCells;
      return [{
        label: "Coverage groups",
        value: cells ? `${cells.readyCells} of ${cells.totalCells}` : null,
        note: cells ? `state × size groups at target; ${count(cells.institutionsShort)} more institutions close the gap${asOf}` : missing,
        href,
      }];
    }
    case "rosetta":
      return [{
        label: "Right document",
        value: pct(snapshot?.right_document_rate),
        note: snapshot?.right_document_rate != null
          ? `of ${count(snapshot.right_document_denominator ?? 0)} reads passed the fee-page check, 30 days${asOf}`
          : missing,
        href,
      }];
    case "knox": {
      const passes = goal?.knoxPasses;
      return [{
        label: "Fees found at $0",
        value: pct(passes?.zeroCostShare),
        note: passes?.zeroCostShare != null
          ? `of ${count(passes.free.rowsKept + passes.paid.rowsKept)} kept fees came from the free pass${asOf}`
          : missing,
        href,
      }];
    }
    case "darwin": {
      const wrong = goal?.wrongAfterPublish;
      return [
        {
          label: "Darwin backlog",
          value: snapshot?.darwin_backlog == null ? null : count(snapshot.darwin_backlog),
          note: snapshot?.darwin_backlog == null ? missing : `rows waiting for a verdict${asOf}`,
          href,
        },
        {
          label: "Wrong after publish",
          value: pct(wrong?.rate),
          note: wrong?.rate != null ? `target under 1%, ${count(wrong.wrong)} of ${count(wrong.published)}${asOf}` : missing,
          href,
        },
      ];
    }
  }
}

/** The agent's provider spend this month against its own cap. Null `lines` means the ledger could not be read. */
export function agentSpendVital(agent: FrameAgent, lines: SpendLine[] | null): Vital {
  const href = "/admin/controls";
  if (!lines) return { label: "Spend this month", value: null, note: "Could not read provider usage.", href };
  const line = lines.find((candidate) => candidate.key === agent);
  if (!line) return { label: "Spend this month", value: money(0), note: "No paid calls this month and no cap of its own", href };
  return {
    label: "Spend this month",
    value: money(line.monthUsd),
    note: line.monthlyCapUsd
      ? `of ${money(line.monthlyCapUsd)} monthly cap${line.enabled ? "" : "; paid calls switched off"}`
      : `no monthly cap of its own${line.enabled ? "" : "; paid calls switched off"}`,
    href,
    meter: { used: line.monthUsd, cap: line.monthlyCapUsd },
  };
}

export interface RecentStep {
  id: number;
  title: string;
  status: string;
  at: string | null;
  /** The step's summary, or its error when it failed. */
  line: string | null;
}

export function toRecentStep(row: Record<string, unknown>): RecentStep {
  const status = String(row.status ?? "");
  const at = row.completed_at ?? row.started_at ?? row.queued_at;
  const error = row.error_summary ? String(row.error_summary) : null;
  const summary = row.summary ? String(row.summary) : null;
  return {
    id: Number(row.id),
    title: String(row.title ?? row.step_key ?? ""),
    status,
    at: at ? new Date(at as string | Date).toISOString() : null,
    line: status === "failed" ? error ?? summary : summary ?? error,
  };
}

const RECENT_STEP_LIMIT = 6;

async function readRecentSteps(agent: FrameAgent): Promise<RecentStep[]> {
  const rows = await sql`
    SELECT id, step_key, title, status, summary, error_summary, queued_at, started_at, completed_at
      FROM agent_run_steps
     WHERE agent_name = ${agent}
       -- Registry steps under Magellan's name before #1865 are Hoovie's, not Magellan's.
       AND NOT (agent_name = 'magellan' AND step_key LIKE 'registry-%')
       AND updated_at > NOW() - INTERVAL '7 days'
     ORDER BY COALESCE(completed_at, started_at, queued_at) DESC
     LIMIT ${RECENT_STEP_LIMIT}
  `;
  return rows.map((row) => toRecentStep(row as Record<string, unknown>));
}

// The same cache entries as the Today page: one snapshot a day, spend fresh to the minute.
const getCachedLatestSnapshot = unstable_cache(
  async (): Promise<ScoreboardSnapshotRow | null> => {
    if (!(await scoreboardSchemaReady())) return null;
    return (await listScoreboardSnapshots(8)).at(-1) ?? null;
  },
  ["admin", "today-scorecard"],
  { revalidate: 600 },
);
const getCachedSpendSummary = unstable_cache(getSpendSummary, ["admin", "console-spend"], { revalidate: 60 });

const STATUS_TONE: Record<string, string> = {
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  blocked: "bg-amber-400",
  running: "bg-sky-500",
  queued: "bg-gray-300 dark:bg-white/20",
};

export async function AgentFrame({ agent }: { agent: FrameAgent }) {
  const [snapshot, spend, steps] = await Promise.all([
    getCachedLatestSnapshot().catch((error) => {
      console.error(`Agent frame (${agent}) scorecard read failed`, error);
      return null;
    }),
    getCachedSpendSummary().catch((error) => {
      console.error(`Agent frame (${agent}) spend read failed`, error);
      return null;
    }),
    readRecentSteps(agent).catch((error) => {
      console.error(`Agent frame (${agent}) recent steps read failed`, error);
      return null;
    }),
  ]);
  const vitals = [...agentScoreVitals(agent, snapshot), agentSpendVital(agent, spend?.agents ?? null)];

  return (
    <section aria-label="How this agent is doing" className="space-y-3">
      <VitalsRow vitals={vitals} />
      <div className="admin-card space-y-2 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Latest steps</h2>
          <a
            href={`${GUIDE_BASE}${AGENT_GUIDES[agent]}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-[var(--brand-primary)]"
          >
            Guide
          </a>
        </div>
        {steps == null ? (
          <p className="text-xs text-red-700 dark:text-red-300">The run ledger could not be read.</p>
        ) : steps.length === 0 ? (
          <p className="text-xs text-gray-500">No steps in the last 7 days.</p>
        ) : (
          <ul className="space-y-1.5">
            {steps.map((step) => (
              <li key={step.id} className="grid grid-cols-[8px_minmax(0,1fr)] items-baseline gap-x-2 text-xs">
                <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_TONE[step.status] ?? "bg-gray-300"}`} />
                <p className="min-w-0 text-gray-700 dark:text-gray-300">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{step.title}</span>{" "}
                  <span className="text-gray-500">
                    · {step.status}
                    {step.at ? ` · ${formatAdminDateTime(step.at)}` : ""}
                  </span>
                  {step.line ? <span className="block truncate text-gray-500">{step.line}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
