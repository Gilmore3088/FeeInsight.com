export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth";
import { formatAdminDateTime } from "@/lib/admin-time";
import { getAgentQuality, scheduleProblems, type AgentQuality, type LatestStep } from "@/lib/data-store/agent-quality";
import { ScreenHeader, Unreadable } from "../../room-hub";

const num = (value: unknown): string => (Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US") : "unknown");

/** One step's newest run: unknown when the read failed, "not run yet" when it never finished. */
function LastRun({ step, name }: { step: LatestStep | null | undefined; name: string }) {
  if (step === undefined) return <p className="text-sm text-amber-800 dark:text-amber-300">Unknown: {name}&apos;s last run could not be read.</p>;
  if (step === null) return <p className="text-sm text-gray-500">{name} has not finished a run yet.</p>;
  return (
    <p className="text-sm text-gray-800 dark:text-gray-200">
      <span className="text-xs text-gray-500">{formatAdminDateTime(step.at)} · </span>
      {step.summary}
    </p>
  );
}

const STATUS_STYLE: Record<string, string> = {
  stuck: "text-red-700 dark:text-red-400",
  open: "text-sky-800 dark:text-sky-300",
  not_counted: "text-amber-800 dark:text-amber-300",
  closed: "text-emerald-800 dark:text-emerald-300",
};

function Regressions({ quality }: { quality: AgentQuality }) {
  const misses = Array.isArray(quality.deming?.detail.regression_cases)
    ? (quality.deming?.detail.regression_cases as Array<Record<string, unknown>>)
    : [];
  return (
    <section className="admin-card space-y-3 p-4" aria-label="Regressions">
      <p className="admin-section-title">Regressions (Deming)</p>
      <LastRun step={quality.deming} name="Deming" />
      <LastRun step={quality.freshAudit} name="Deming's fresh audit" />
      {quality.evalCases === null ? (
        <Unreadable what="The test-case store" />
      ) : (
        <p className="text-xs tabular-nums text-gray-600 dark:text-gray-400">
          {quality.evalCases.length === 0
            ? "No test cases yet."
            : quality.evalCases.map((row) => `${row.dataset} ${row.status}: ${num(row.count)}`).join(" · ")}
        </p>
      )}
      {misses.length > 0 ? (
        <ul className="space-y-0.5 text-sm" aria-label="Cases the rules no longer catch">
          {misses.slice(0, 20).map((miss) => (
            <li key={String(miss.caseId)} className="text-red-800 dark:text-red-300">
              Case {String(miss.caseId)} ({String(miss.severity)}, {String(miss.checkName ?? "unnamed check")}): {String(miss.verdict)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Replay({ quality }: { quality: AgentQuality }) {
  return (
    <section className="admin-card space-y-3 p-4" aria-label="Replay backlog">
      <p className="admin-section-title">Replay backlog (Bayes)</p>
      <LastRun step={quality.bayes} name="Bayes" />
      {quality.replayJobs === null ? (
        <Unreadable what="The replay ledger" />
      ) : quality.replayJobs.length === 0 ? (
        <p className="text-sm text-gray-500">No rule changes counted yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-gray-500">
              <tr>
                <th className="py-1 pr-3 font-semibold">Rule change</th>
                <th className="py-1 pr-3 font-semibold">Status</th>
                <th className="py-1 pr-3 text-right font-semibold">Affected</th>
                <th className="py-1 pr-3 text-right font-semibold">Done</th>
                <th className="py-1 pr-3 text-right font-semibold">Queued</th>
                <th className="py-1 text-right font-semibold">Left on purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
              {quality.replayJobs.map((job) => (
                <tr key={job.changeKey} title={job.note ?? undefined}>
                  <td className="py-1 pr-3 font-mono text-gray-800 dark:text-gray-200">{job.changeKey}</td>
                  <td className={`py-1 pr-3 font-semibold ${STATUS_STYLE[job.status] ?? ""}`}>{job.status.replace("_", " ")}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{num(job.affected)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{num(job.done)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{num(job.queued)}</td>
                  <td className="py-1 text-right tabular-nums">{num(job.excluded)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Schedules({ quality }: { quality: AgentQuality }) {
  const problems = quality.schedules ? scheduleProblems(quality.schedules.detail) : [];
  return (
    <section className="admin-card space-y-3 p-4" aria-label="Schedules">
      <p className="admin-section-title">Schedules (Atlas)</p>
      <LastRun step={quality.schedules} name="The schedule check" />
      {problems.length > 0 ? (
        <ul className="space-y-0.5 text-xs">
          {problems.map((row) => (
            <li key={`${row.path} ${row.schedule}`} className={row.state === "unknown" ? "text-amber-800 dark:text-amber-300" : "text-red-800 dark:text-red-300"}>
              <span className="font-mono">{row.path}</span> ({row.schedule}): {row.state}
              {row.lastDueAt ? `, due ${formatAdminDateTime(row.lastDueAt)}` : ""}
              {row.lastCallAt ? `, last call ${formatAdminDateTime(row.lastCallAt)}` : row.state === "unknown" ? "" : ", no call since"}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function RepeatedErrors({ quality }: { quality: AgentQuality }) {
  return (
    <section className="admin-card space-y-3 p-4" aria-label="Categories with repeated errors">
      <p className="admin-section-title">Categories with repeated errors, last 30 days</p>
      {quality.repeatedErrors === null ? (
        <Unreadable what="Confirmed takedowns" />
      ) : quality.repeatedErrors.length === 0 ? (
        <p className="text-sm text-gray-500">No confirmed takedowns in the last 30 days.</p>
      ) : (
        <ul className="space-y-0.5 text-xs tabular-nums">
          {quality.repeatedErrors.map((row) => (
            <li key={`${row.category} ${row.checkName}`} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">
                <span className="font-mono text-gray-800 dark:text-gray-200">{row.category}</span>
                <span className="text-gray-500"> · {row.checkName}</span>
              </span>
              <span className="shrink-0 font-semibold">{num(row.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Quality (PRD 12.3): regressions, the replay backlog, schedules and repeated errors, from the ledgers. */
export default async function AgentsQualityPage() {
  await requireAuth("view");
  const quality = await getAgentQuality();
  return (
    <section className="flex flex-col gap-4 pb-10">
      <ScreenHeader
        title="Quality"
        lede="What the quality tools found: mistakes the rules no longer catch, rule changes still reaching older records, scheduled jobs that missed their time, and the categories with the most confirmed takedowns. Read-only; a section that cannot be read says so instead of showing zero."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Regressions quality={quality} />
        <Schedules quality={quality} />
      </div>
      <Replay quality={quality} />
      <RepeatedErrors quality={quality} />
    </section>
  );
}
