export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { formatAdminDateTime } from "@/lib/admin-time";
import { getAgentRun, getAgentRunEvents, getAgentRunSteps } from "@/lib/agents/run-store";
import { STORAGE_COMPACTION_RETRY_OF, STORAGE_ROLLOUT_SOURCE } from "@/lib/agents/hoovie/storage-rollout";
import { readArchiveRolloutProgress } from "@/lib/agents/hoovie/storage-rollout-progress";
import { sql } from "@/lib/data-store/connection";
import { advanceApprovedStorageRollout, retryStorageCompaction } from "./actions";

/**
 * A permanent run receipt, not the last-30-runs dashboard. The run ID is the
 * canonical identity; every step and event still comes from the run ledger.
 */
export default async function AtlasRunReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth("operate");
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isSafeInteger(runId) || runId < 1) notFound();

  const run = await getAgentRun(runId);
  if (!run) notFound();
  const [steps, events] = await Promise.all([
    getAgentRunSteps(runId),
    getAgentRunEvents(runId, 50),
  ]);
  let nextArchive: Awaited<ReturnType<typeof readArchiveRolloutProgress>> | undefined;
  let archiveError: string | undefined;
  if (run.params.source === STORAGE_ROLLOUT_SOURCE) {
    try { nextArchive = await readArchiveRolloutProgress(sql); }
    catch (error) { archiveError = error instanceof Error ? error.message.slice(0, 300) : "Archive progression could not be read"; }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <nav className="text-sm">
        <Link href="/admin/atlas/details" className="text-[var(--brand-primary)]">
          Back to Atlas
        </Link>
      </nav>
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
          Permanent execution receipt · Run #{run.id}
        </p>
        <h1 className="text-2xl font-semibold">{run.title}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Status: <strong>{run.status}</strong> · Agent: {run.agent} ·
          Created: {formatAdminDateTime(run.startedAt, { seconds: true })}
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {run.summary ?? "Waiting for a recorded execution result."}
        </p>
        {run.error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{run.error}</p>}
      </header>
      {archiveError && <p role="alert">Storage rollout held: {archiveError}</p>}
      {nextArchive && (
        <form action={advanceApprovedStorageRollout} className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <p className="text-sm">Next approved stage: {nextArchive.action} {nextArchive.source.toUpperCase()} {nextArchive.period}.</p>
          <button type="submit" className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white">Continue approved storage rollout</button>
          <p className="text-xs text-gray-500">One period and stage per run. Verified files, restore rehearsal, exact counts, and the pipeline pause remain enforced.</p>
        </form>
      )}
      {nextArchive === null && <p role="status">All four approved archive periods have completed export, restore rehearsal, pruning and consumer verification.</p>}
      {run.id === STORAGE_COMPACTION_RETRY_OF && (
        <form action={retryStorageCompaction.bind(null, run.id)} className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <p className="text-sm">The first approved conversion rolled back. Retry one batch of at most 5,000 rows per table, preserving the 2025 HMDA hold and existing archive controls.</p>
          <button type="submit" className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white">
            Retry approved storage canary
          </button>
          <p className="text-xs text-gray-500">Repeated requests reuse the same retry receipt. The pipeline pause still applies.</p>
        </form>
      )}
      <section className="space-y-3" aria-labelledby="steps-title">
        <h2 id="steps-title" className="text-lg font-semibold">Pipeline steps</h2>
        {steps.length === 0 && <p>No steps recorded.</p>}
        {steps.map((step) => (
          <div key={step.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <p className="text-sm font-semibold">
              {step.sequence}. {step.title} — {step.status}
            </p>
            {step.summary && <p className="mt-1 text-sm">{step.summary}</p>}
            {step.error && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">{step.error}</p>}
          </div>
        ))}
      </section>
      <section aria-labelledby="events-title" className="space-y-3">
        <h2 id="events-title" className="text-lg font-semibold">Audit events</h2>
        {events.length === 0 && <p>No events recorded.</p>}
        {events.map((event) => (
          <div key={event.id} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
            <p className="font-semibold">{event.eventType} · {event.status}</p>
            <p>{event.message}</p>
            <p className="text-xs text-gray-500">{formatAdminDateTime(event.createdAt, { seconds: true })}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
