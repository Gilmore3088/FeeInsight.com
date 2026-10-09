export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  Check,
  CheckCircle2,
  DatabaseZap,
  ExternalLink,
  FileSearch,
  MessageSquareMore,
  PauseCircle,
  X,
} from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { getAutomationControl } from "@/lib/automation-control";
import {
  DATA_TRUST_QUEUE_STATES,
  type DataTrustQueueState,
  type DataTrustSeverity,
} from "@/lib/data-trust";
import {
  getDataTrustQueueRows,
  getInstitutionClaimCounts,
  getSourceSubmissionCounts,
  listInstitutionClaims,
  listSourceSubmissions,
  type DataTrustQueueRow,
  type InstitutionClaimReviewStatus,
  type InstitutionClaimRow,
  type SourceSubmissionReviewStatus,
  type SourceSubmissionRow,
} from "@/lib/admin-queries";
import { formatAssets } from "@/lib/format";
import {
  acceptSourceSubmission,
  acceptInstitutionClaim,
  rejectSourceSubmission,
  rejectInstitutionClaim,
  requestInstitutionClaimInfo,
  requestSourceSubmissionInfo,
} from "./actions";

const QUEUE_LABELS: Record<DataTrustQueueState, string> = {
  source_needed: "Source needed",
  submitted_source_pending_review: "Submitted",
  source_accepted_awaiting_validation: "Accepted",
  source_failed: "Failed source",
  extracted_rows_pending_classification: "Extracted",
  verified_public_ready: "Public ready",
};

const SUBMISSION_TABS: Array<{ value: SourceSubmissionReviewStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "needs_info", label: "Needs info" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const CLAIM_TABS: Array<{ value: InstitutionClaimReviewStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "needs_info", label: "Needs info" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

function emptyQueueCounts(): Record<DataTrustQueueState, number> {
  return DATA_TRUST_QUEUE_STATES.reduce(
    (counts, item) => ({ ...counts, [item]: 0 }),
    {} as Record<DataTrustQueueState, number>,
  );
}

async function guardedLoad<T>({
  label,
  promise,
  fallback,
  warnings,
  timeoutMs = 9_000,
}: {
  label: string;
  promise: Promise<T>;
  fallback: T;
  warnings: string[];
  timeoutMs?: number;
}): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      warnings.push(label);
      console.error(`[admin-quality] ${label} timed out after ${timeoutMs}ms`);
      resolve(fallback);
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        warnings.push(label);
        console.error(`[admin-quality] ${label} failed:`, error);
        resolve(fallback);
      },
    );
  });
}

function number(value: number): string {
  return value.toLocaleString("en-US");
}

function severityClass(severity: DataTrustSeverity): string {
  switch (severity) {
    case "critical":
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/25 dark:text-red-300";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-300";
    case "work":
      return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/25 dark:text-blue-300";
    case "ok":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-300";
  }
}

function statusClass(status: string): string {
  if (status === "accepted") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-300";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/25 dark:text-red-300";
  if (status === "needs_info") return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/25 dark:text-blue-300";
  return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-300";
}

function ownerHref(row: DataTrustQueueRow): string {
  if (row.owner === "magellan") return "/admin/magellan";
  if (row.owner === "darwin") return "/admin/darwin";
  if (row.owner === "knox") return "/admin/knox";
  if (row.owner === "hamilton") return "/admin/hamilton";
  return "/admin";
}

function buildHref(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `/admin/quality?${qs}` : "/admin/quality";
}

function truncate(value: string | null, max = 52): string {
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

export default async function DataTrustWorkbench({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const stateParam = typeof params.state === "string" ? params.state : "all";
  const state = DATA_TRUST_QUEUE_STATES.includes(stateParam as DataTrustQueueState)
    ? (stateParam as DataTrustQueueState)
    : "all";
  const submissionParam = typeof params.submissions === "string" ? params.submissions : "pending";
  const submissionsStatus = SUBMISSION_TABS.some((tab) => tab.value === submissionParam)
    ? (submissionParam as SourceSubmissionReviewStatus)
    : "pending";
  const claimParam = typeof params.claims === "string" ? params.claims : "pending";
  const claimsStatus = CLAIM_TABS.some((tab) => tab.value === claimParam)
    ? (claimParam as InstitutionClaimReviewStatus)
    : "pending";
  const query = typeof params.q === "string" ? params.q : "";
  const page = Math.max(1, Number(params.page) || 1);
  const submissionPage = Math.max(1, Number(params.submissionPage) || 1);
  const claimPage = Math.max(1, Number(params.claimPage) || 1);
  const selectedId = typeof params.selected === "string" ? Number(params.selected) : null;

  const loadWarnings: string[] = [];
  const automation = await getAutomationControl().catch(() => null);
  const [queue, submissionCounts, submissions, claimCounts, claims] = await Promise.all([
    guardedLoad({
      label: "institution trust queue",
      warnings: loadWarnings,
      fallback: { rows: [], total: 0, counts: emptyQueueCounts() },
      promise: getDataTrustQueueRows({
        state,
        query,
        page,
        pageSize: 40,
        automationEnabled: automation?.enabled ?? false,
      }),
    }),
    guardedLoad({
      label: "source submission counts",
      warnings: loadWarnings,
      fallback: { pending: 0, accepted: 0, rejected: 0, needs_info: 0, total: 0 },
      promise: getSourceSubmissionCounts(),
    }),
    guardedLoad({
      label: "source submissions",
      warnings: loadWarnings,
      fallback: { rows: [], total: 0, page: submissionPage, pageSize: 12 },
      promise: listSourceSubmissions({
        status: submissionsStatus,
        page: submissionPage,
        pageSize: 12,
      }),
    }),
    guardedLoad({
      label: "institution claim counts",
      warnings: loadWarnings,
      fallback: { pending: 0, accepted: 0, rejected: 0, needs_info: 0, total: 0 },
      promise: getInstitutionClaimCounts(),
    }),
    guardedLoad({
      label: "institution claims",
      warnings: loadWarnings,
      fallback: { rows: [], total: 0, page: claimPage, pageSize: 12 },
      promise: listInstitutionClaims({
        status: claimsStatus,
        page: claimPage,
        pageSize: 12,
      }),
    }),
  ]);
  const selected =
    selectedId && Number.isInteger(selectedId)
      ? queue.rows.find((row) => row.id === selectedId) ?? queue.rows[0] ?? null
      : queue.rows[0] ?? null;
  const queueTotal = DATA_TRUST_QUEUE_STATES.reduce(
    (sum, item) => sum + queue.counts[item],
    0,
  );

  return (
    <div className="space-y-6 pb-10">
      <header className="border-b border-black/[0.06] pb-5 dark:border-white/[0.06]">
        <Breadcrumbs items={[{ label: "Atlas", href: "/admin" }, { label: "Data Trust" }]} />
        <div className="mt-3 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-end">
          <div>
            <p className="admin-eyebrow">Quality · Evidence pipeline</p>
            <h1 className="admin-display-title mt-1">Data trust workbench</h1>
            <p className="admin-lede mt-2 max-w-3xl">
              Review submitted sources, diagnose institution readiness, and route each profile to one next safe action.
            </p>
          </div>
          <div
            className={`border px-4 py-3 ${
              automation?.enabled
                ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/25"
                : "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/25"
            }`}
          >
            <div className="flex items-start gap-3">
              {automation?.enabled ? (
                <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
              ) : (
                <PauseCircle className="mt-0.5 size-4 text-red-600" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {automation === null ? "Automation status unknown" : automation.enabled ? "Automation enabled" : "Automation stopped"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                  {automation?.enabled
                    ? "Source acceptance still requires explicit operator launch before provider work starts."
                    : automation === null
                      ? "The safety control could not be read, so provider work is held until it can be."
                      : automation.reason ?? "Provider automation is held; accepted sources stay queued for manual or later validation."}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section aria-label="Data trust summary" className="grid gap-x-6 gap-y-4 border-y border-black/[0.06] py-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 dark:border-white/[0.06]">
        <SummaryMetric label="Profiles in queue" value={number(queueTotal)} />
        <SummaryMetric label="Pending sources" value={number(submissionCounts.pending)} tone={submissionCounts.pending > 0 ? "work" : "default"} />
        <SummaryMetric label="Pending claims" value={number(claimCounts.pending)} tone={claimCounts.pending > 0 ? "work" : "default"} />
        <SummaryMetric label="Accepted sources" value={number(submissionCounts.accepted)} />
        <SummaryMetric label="Source needed" value={number(queue.counts.source_needed)} tone="warning" />
        <SummaryMetric label="Failed source" value={number(queue.counts.source_failed)} tone={queue.counts.source_failed > 0 ? "critical" : "default"} />
        <SummaryMetric label="Public ready" value={number(queue.counts.verified_public_ready)} tone="ok" />
      </section>

      {loadWarnings.length > 0 && (
        <section className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200">
          Live data timed out for {loadWarnings.join(", ")}. The workbench is showing a safe fallback; refresh after the database pool clears.
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="admin-section-title">Institution trust queue</p>
              <p className="admin-meta mt-1">
                {number(queue.total)} institution{queue.total === 1 ? "" : "s"} match the current queue.
              </p>
            </div>
            <form method="GET" className="flex min-w-0 flex-col gap-2 sm:flex-row">
              {state !== "all" && <input type="hidden" name="state" value={state} />}
              <input
                type="text"
                name="q"
                defaultValue={query}
                placeholder="Search institutions"
                className="min-h-9 min-w-0 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-100 dark:focus:ring-white/[0.2]"
              />
              <button className="min-h-9 rounded-md bg-gray-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-gray-800 dark:bg-white/[0.12] dark:hover:bg-white/[0.18]">
                Search
              </button>
              {(query || state !== "all") && (
                <Link
                  href="/admin/quality"
                  prefetch={false}
                  className="inline-flex min-h-9 items-center justify-center rounded-md border border-gray-200 px-3 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.04]"
                >
                  Clear
                </Link>
              )}
            </form>
          </div>

          <nav aria-label="Trust queue filters" className="flex gap-1 overflow-x-auto border-b border-black/[0.06] dark:border-white/[0.06]">
            <QueueTab
              href={buildHref({ q: query, submissions: submissionsStatus })}
              active={state === "all"}
              label="All"
              count={queueTotal}
            />
            {DATA_TRUST_QUEUE_STATES.map((item) => (
              <QueueTab
                key={item}
                href={buildHref({ state: item, q: query, submissions: submissionsStatus })}
                active={state === item}
                label={QUEUE_LABELS[item]}
                count={queue.counts[item]}
              />
            ))}
          </nav>

          <div className="grid gap-3 lg:hidden">
            {queue.rows.length === 0 ? (
              <div className="border border-black/[0.06] bg-white px-4 py-8 text-center text-sm text-gray-500 dark:border-white/[0.06] dark:bg-white/[0.02]">
                No institutions match this trust queue.
              </div>
            ) : (
              queue.rows.map((row) => (
                <TrustQueueMobileCard
                  key={row.id}
                  row={row}
                  selected={selected?.id === row.id}
                  inspectHref={buildHref({
                    state: state === "all" ? undefined : state,
                    q: query,
                    submissions: submissionsStatus,
                    page,
                    selected: row.id,
                  })}
                />
              ))
            )}
          </div>

          <div className="hidden overflow-hidden border border-black/[0.06] bg-white lg:block dark:border-white/[0.06] dark:bg-white/[0.02]">
            <div className="overflow-x-auto">
              <table className="admin-table min-w-[980px] w-full text-xs">
                <thead>
                  <tr>
                    <th>Institution</th>
                    <th>State</th>
                    <th>Evidence</th>
                    <th>Source</th>
                    <th>Next action</th>
                    <th>Lane</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                        No institutions match this trust queue.
                      </td>
                    </tr>
                  ) : (
                    queue.rows.map((row) => (
                      <TrustQueueTableRow
                        key={row.id}
                        row={row}
                        selected={selected?.id === row.id}
                        inspectHref={buildHref({
                          state: state === "all" ? undefined : state,
                          q: query,
                          submissions: submissionsStatus,
                          page,
                          selected: row.id,
                        })}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {queue.total > 40 && (
            <div className="flex items-center justify-between gap-3 text-xs">
              <Link
                href={buildHref({
                  state: state === "all" ? undefined : state,
                  q: query,
                  submissions: submissionsStatus,
                  page: Math.max(1, page - 1),
                  selected: selected?.id,
                })}
                prefetch={false}
                className="rounded-md border border-gray-200 px-3 py-1.5 font-semibold text-gray-600 hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.04]"
              >
                Previous
              </Link>
              <span className="text-gray-500">
                Page {page} of {Math.max(1, Math.ceil(queue.total / 40))}
              </span>
              <Link
                href={buildHref({
                  state: state === "all" ? undefined : state,
                  q: query,
                  submissions: submissionsStatus,
                  page: page + 1,
                  selected: selected?.id,
                })}
                prefetch={false}
                className="rounded-md border border-gray-200 px-3 py-1.5 font-semibold text-gray-600 hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.04]"
              >
                Next
              </Link>
            </div>
          )}
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-[calc(var(--admin-nav-h)+20px)]">
          <EvidenceInspector row={selected} />
          <ProviderFailuresDeferred />
        </aside>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 border-t border-black/[0.06] pt-5 sm:flex-row sm:items-end sm:justify-between dark:border-white/[0.06]">
          <div>
            <p className="admin-section-title">Institution claim requests</p>
            <p className="admin-meta mt-1">
              Authenticated users can request institution authority review. Accepting a claim grants workspace authority; it still does not publish fee data.
            </p>
          </div>
          <p className="admin-meta">
            {number(claims.total)} claim{claims.total === 1 ? "" : "s"} in this filter
          </p>
        </div>

        <nav aria-label="Institution claim filters" className="flex gap-1 overflow-x-auto border-b border-black/[0.06] dark:border-white/[0.06]">
          {CLAIM_TABS.map((tab) => (
            <QueueTab
              key={tab.value}
              href={buildHref({
                state: state === "all" ? undefined : state,
                q: query,
                submissions: submissionsStatus,
                claims: tab.value,
              })}
              active={claimsStatus === tab.value}
              label={tab.label}
              count={
                tab.value === "all"
                  ? claimCounts.total
                  : claimCounts[tab.value]
              }
            />
          ))}
        </nav>

        <div className="grid gap-3">
          {claims.rows.length === 0 ? (
            <div className="border border-black/[0.06] bg-white px-4 py-10 text-center text-sm text-gray-500 dark:border-white/[0.06] dark:bg-white/[0.02]">
              No institution claims match this filter.
            </div>
          ) : (
            claims.rows.map((claim) => (
              <InstitutionClaimItem key={claim.id} claim={claim} />
            ))
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 border-t border-black/[0.06] pt-5 sm:flex-row sm:items-end sm:justify-between dark:border-white/[0.06]">
          <div>
            <p className="admin-section-title">Source submissions</p>
            <p className="admin-meta mt-1">
              Source intake decisions are audited and never start provider extraction by themselves.
            </p>
          </div>
          <p className="admin-meta">
            {number(submissions.total)} item{submissions.total === 1 ? "" : "s"} in this filter
          </p>
        </div>

        <nav aria-label="Source submission filters" className="flex gap-1 overflow-x-auto border-b border-black/[0.06] dark:border-white/[0.06]">
          {SUBMISSION_TABS.map((tab) => (
            <QueueTab
              key={tab.value}
              href={buildHref({
                state: state === "all" ? undefined : state,
                q: query,
                submissions: tab.value,
              })}
              active={submissionsStatus === tab.value}
              label={tab.label}
              count={
                tab.value === "all"
                  ? submissionCounts.total
                  : submissionCounts[tab.value]
              }
            />
          ))}
        </nav>

        <div className="grid gap-3">
          {submissions.rows.length === 0 ? (
            <div className="border border-black/[0.06] bg-white px-4 py-10 text-center text-sm text-gray-500 dark:border-white/[0.06] dark:bg-white/[0.02]">
              No source submissions match this filter.
            </div>
          ) : (
            submissions.rows.map((submission) => (
              <SourceSubmissionItem key={submission.id} submission={submission} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "critical" | "warning" | "work" | "ok";
}) {
  const valueClass =
    tone === "critical"
      ? "text-red-700 dark:text-red-300"
      : tone === "warning"
        ? "text-amber-700 dark:text-amber-300"
        : tone === "work"
          ? "text-blue-700 dark:text-blue-300"
          : tone === "ok"
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-gray-900 dark:text-gray-100";
  return (
    <div className="min-w-0">
      <p className="admin-meta text-[10px] uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

function QueueTab({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={`-mb-px inline-flex min-h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-xs font-semibold transition-colors ${
        active
          ? "border-gray-900 text-gray-900 dark:border-gray-100 dark:text-gray-100"
          : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
        active ? "bg-gray-900 text-white dark:bg-white/[0.14]" : "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400"
      }`}>
        {number(count)}
      </span>
    </Link>
  );
}

function TrustQueueTableRow({
  row,
  selected,
  inspectHref,
}: {
  row: DataTrustQueueRow;
  selected: boolean;
  inspectHref: string;
}) {
  return (
    <tr className={`align-top ${selected ? "bg-blue-50/60 dark:bg-blue-950/15" : ""}`}>
      <td>
        <div className="min-w-[260px]">
          <Link
            href={`/admin/institution/${row.id}`}
            prefetch={false}
            className="font-semibold text-gray-900 hover:text-blue-700 dark:text-gray-100 dark:hover:text-blue-300"
          >
            {row.institution_name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
            <span>{[row.city, row.state_code].filter(Boolean).join(", ") || "-"}</span>
            <span className="uppercase">{row.charter_type ?? "-"}</span>
            <span>{formatAssets(row.asset_size)}</span>
          </div>
        </div>
      </td>
      <td>
        <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${severityClass(row.severity)}`}>
          {row.label}
        </span>
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          {row.publicLabel}
        </p>
      </td>
      <td>
        <div className="grid min-w-[180px] grid-cols-3 gap-2 tabular-nums">
          <MiniCount label="Ver." value={row.verified_fee_count} tone="ok" />
          <MiniCount label="Prov." value={row.provisional_fee_count} tone="warning" />
          <MiniCount label="Raw" value={row.raw_without_verified_count} />
        </div>
      </td>
      <td>
        <div className="min-w-[220px] space-y-1 text-[11px] text-gray-500 dark:text-gray-400">
          {row.fee_schedule_url ? (
            <a
              href={row.fee_schedule_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-[220px] items-center gap-1 truncate font-medium text-blue-600 hover:underline dark:text-blue-400"
              title={row.fee_schedule_url}
            >
              {truncate(row.fee_schedule_url, 34)}
              <ExternalLink className="size-3 shrink-0" />
            </a>
          ) : (
            <span>No fee URL</span>
          )}
          <p>Latest: {row.latest_source_status ?? "none"}</p>
          {row.pending_submission_count > 0 && (
            <p className="font-semibold text-amber-700 dark:text-amber-300">
              {number(row.pending_submission_count)} source pending
            </p>
          )}
          {row.validation_queue_count > 0 && (
            <p className="font-semibold text-blue-700 dark:text-blue-300">
              Validation: {row.latest_validation_queue_status?.replaceAll("_", " ") ?? "queued"}
            </p>
          )}
        </div>
      </td>
      <td>
        <p className="min-w-[240px] text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
          {row.nextAction}
        </p>
      </td>
      <td>
        <div className="flex min-w-[150px] flex-wrap gap-2">
          <Link
            href={inspectHref}
            prefetch={false}
            aria-current={selected ? "true" : undefined}
            className={`inline-flex min-h-8 items-center rounded-md px-2.5 text-[11px] font-semibold transition-colors ${
              selected
                ? "bg-blue-700 text-white"
                : "border border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-950/25"
            }`}
          >
            Inspect
          </Link>
          <Link
            href={ownerHref(row)}
            prefetch={false}
            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-gray-200 px-2.5 text-[11px] font-semibold capitalize text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.04]"
          >
            {row.owner}
            <ExternalLink className="size-3" />
          </Link>
        </div>
      </td>
    </tr>
  );
}

function TrustQueueMobileCard({
  row,
  selected,
  inspectHref,
}: {
  row: DataTrustQueueRow;
  selected: boolean;
  inspectHref: string;
}) {
  return (
    <article className={`border bg-white p-3 dark:bg-white/[0.02] ${
      selected
        ? "border-blue-200 ring-1 ring-blue-100 dark:border-blue-900/60 dark:ring-blue-950/30"
        : "border-black/[0.06] dark:border-white/[0.06]"
    }`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/admin/institution/${row.id}`}
            prefetch={false}
            className="block break-words text-sm font-semibold text-gray-900 hover:text-blue-700 dark:text-gray-100 dark:hover:text-blue-300"
          >
            {row.institution_name}
          </Link>
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            {[row.city, row.state_code].filter(Boolean).join(", ") || "-"} · {row.charter_type ?? "-"} · {formatAssets(row.asset_size)}
          </p>
        </div>
        <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${severityClass(row.severity)}`}>
          {row.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 tabular-nums">
        <MiniCount label="Ver." value={row.verified_fee_count} tone="ok" />
        <MiniCount label="Prov." value={row.provisional_fee_count} tone="warning" />
        <MiniCount label="Raw" value={row.raw_without_verified_count} />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
        {row.nextAction}
      </p>
      <p className="mt-2 break-words text-[11px] text-gray-500 dark:text-gray-400">
        Source: {row.fee_schedule_url ? truncate(row.fee_schedule_url, 58) : "No fee URL"} · Latest: {row.latest_source_status ?? "none"}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={inspectHref}
          prefetch={false}
          aria-current={selected ? "true" : undefined}
          className={`inline-flex min-h-8 items-center rounded-md px-2.5 text-[11px] font-semibold transition-colors ${
            selected
              ? "bg-blue-700 text-white"
              : "border border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-950/25"
          }`}
        >
          Inspect
        </Link>
        <Link
          href={ownerHref(row)}
          prefetch={false}
          className="inline-flex min-h-8 items-center gap-1 rounded-md border border-gray-200 px-2.5 text-[11px] font-semibold capitalize text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.04]"
        >
          {row.owner}
          <ExternalLink className="size-3" />
        </Link>
      </div>
    </article>
  );
}

function MiniCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warning";
}) {
  const color =
    tone === "ok"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "warning"
        ? "text-amber-700 dark:text-amber-300"
        : "text-gray-900 dark:text-gray-100";
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-sm font-semibold ${color}`}>{number(value)}</p>
    </div>
  );
}

function EvidenceInspector({ row }: { row: DataTrustQueueRow | null }) {
  if (!row) {
    return (
      <section className="border border-black/[0.06] bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <p className="admin-section-title">Evidence inspector</p>
        <p className="admin-meta mt-2">No queue item selected.</p>
      </section>
    );
  }

  return (
    <section className="border border-black/[0.06] bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="flex items-start gap-3">
        <FileSearch className="mt-0.5 size-4 text-[var(--brand-primary)]" />
        <div className="min-w-0">
          <p className="admin-section-title">Evidence inspector</p>
          <h2 className="mt-1 break-words text-base font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            {row.institution_name}
          </h2>
        </div>
      </div>
      <div className="mt-4 space-y-3 text-sm">
        <InspectorFact label="Queue state" value={row.label} />
        <InspectorFact label="Next action" value={row.nextAction} />
        <InspectorFact label="Verified rows" value={number(row.verified_fee_count)} />
        <InspectorFact label="Provisional rows" value={number(row.provisional_fee_count)} />
        <InspectorFact label="Raw unclassified" value={number(row.raw_without_verified_count)} />
        <InspectorFact label="Source status" value={row.latest_source_status ?? "none"} />
        <InspectorFact label="Last collected" value={row.latest_source_collected_at ?? "N/A"} />
        <InspectorFact label="Submissions" value={`${number(row.submission_count)} total / ${number(row.pending_submission_count)} pending`} />
        <InspectorFact
          label="Validation queue"
          value={
            row.validation_queue_count > 0
              ? `${number(row.validation_queue_count)} active / ${row.latest_validation_queue_status?.replaceAll("_", " ") ?? "queued"}`
              : "None"
          }
        />
      </div>
      {row.latest_submission_source_url && (
        <a
          href={row.latest_submission_source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex max-w-full items-center gap-1 truncate text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
        >
          Latest submitted source
          <ExternalLink className="size-3" />
        </a>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link
          href={`/admin/institution/${row.id}`}
          prefetch={false}
          className="inline-flex min-h-8 items-center justify-center rounded-md bg-gray-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-gray-800 dark:bg-white/[0.12] dark:hover:bg-white/[0.18]"
        >
          Open profile
        </Link>
        <Link
          href={`/institution/${row.id}`}
          prefetch={false}
          className="inline-flex min-h-8 items-center justify-center rounded-md border border-gray-200 px-3 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.04]"
        >
          Public page
        </Link>
      </div>
    </section>
  );
}

function InspectorFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-black/[0.05] pb-2 last:border-0 last:pb-0 dark:border-white/[0.06]">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="max-w-[58%] break-words text-right text-xs font-semibold text-gray-900 dark:text-gray-100">
        {value}
      </span>
    </div>
  );
}

function ProviderFailuresDeferred() {
  return (
    <section className="border border-black/[0.06] bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="flex items-center gap-2">
        <DatabaseZap className="size-4 text-gray-500" />
        <p className="admin-section-title">Provider failures</p>
      </div>
      <p className="admin-meta mt-2">
        Provider diagnostics are deferred so source validation never waits on usage-log reads.
      </p>
    </section>
  );
}

function InstitutionClaimItem({ claim }: { claim: InstitutionClaimRow }) {
  const canReview = claim.review_status === "pending" || claim.review_status === "needs_info";
  return (
    <article className="grid gap-4 border border-black/[0.06] bg-white p-4 lg:grid-cols-[minmax(0,1fr)_360px] dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${statusClass(claim.review_status)}`}>
            {claim.review_status.replace("_", " ")}
          </span>
          <span className="text-[11px] text-gray-500">{claim.updated_at}</span>
        </div>
        <h3 className="mt-2 break-words text-sm font-semibold text-gray-900 dark:text-gray-100">
          {claim.institution_name}
        </h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {[claim.city, claim.state_code].filter(Boolean).join(", ") || "No linked institution location"}
        </p>
        <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-3 dark:text-gray-400">
          <InspectorFact label="Claimant" value={claim.claimant_name} />
          <InspectorFact label="Email" value={claim.claimant_email ?? "N/A"} />
          <InspectorFact label="Role" value={claim.claimant_role ?? "N/A"} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/admin/institution/${claim.institution_id}`}
            prefetch={false}
            className="inline-flex min-h-8 items-center rounded-md border border-gray-200 px-2.5 text-[11px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.04]"
          >
            Admin profile
          </Link>
          <Link
            href={`/institution/${claim.institution_id}`}
            prefetch={false}
            className="inline-flex min-h-8 items-center rounded-md border border-gray-200 px-2.5 text-[11px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.04]"
          >
            Public page
          </Link>
          {claim.source_submission_id && (
            <span className="inline-flex min-h-8 items-center rounded-md border border-blue-200 px-2.5 text-[11px] font-semibold text-blue-700 dark:border-blue-900/50 dark:text-blue-300">
              Source submission {claim.source_submission_id}
            </span>
          )}
        </div>
        {(claim.claim_notes || claim.review_notes) && (
          <div className="mt-3 grid gap-2 text-xs lg:grid-cols-2">
            {claim.claim_notes && (
              <p className="rounded-md bg-gray-50 p-3 leading-relaxed text-gray-600 dark:bg-white/[0.04] dark:text-gray-400">
                {claim.claim_notes}
              </p>
            )}
            {claim.review_notes && (
              <p className="rounded-md bg-gray-50 p-3 leading-relaxed text-gray-600 dark:bg-white/[0.04] dark:text-gray-400">
                {claim.review_notes}
              </p>
            )}
          </div>
        )}
      </div>

      <form className="space-y-2" action={acceptInstitutionClaim}>
        <input type="hidden" name="claim_id" value={claim.id} />
        <textarea
          name="review_notes"
          rows={3}
          placeholder="Claim review notes"
          className="w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-100 dark:focus:ring-white/[0.2]"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="submit"
            disabled={!canReview}
            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 dark:disabled:bg-white/[0.08]"
          >
            <Check className="size-3.5" />
            Accept
          </button>
          <button
            formAction={requestInstitutionClaimInfo}
            disabled={!canReview}
            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-blue-200 px-3 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-950/25 dark:disabled:border-white/[0.08] dark:disabled:text-gray-500"
          >
            <MessageSquareMore className="size-3.5" />
            Info
          </button>
          <button
            formAction={rejectInstitutionClaim}
            disabled={!canReview}
            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/25 dark:disabled:border-white/[0.08] dark:disabled:text-gray-500"
          >
            <X className="size-3.5" />
            Reject
          </button>
        </div>
        {!canReview && (
          <p className="text-[11px] text-gray-500">
            Reviewed claims are locked for audit. Request a new claim or add a future event rather than overwriting the verdict.
          </p>
        )}
      </form>
    </article>
  );
}

function SourceSubmissionItem({ submission }: { submission: SourceSubmissionRow }) {
  const canReview = submission.review_status === "pending" || submission.review_status === "needs_info";
  return (
    <article className="grid gap-4 border border-black/[0.06] bg-white p-4 lg:grid-cols-[minmax(0,1fr)_360px] dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${statusClass(submission.review_status)}`}>
            {submission.review_status.replace("_", " ")}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {submission.submission_kind}
          </span>
          <span className="text-[11px] text-gray-500">{submission.created_at}</span>
        </div>
        <h3 className="mt-2 break-words text-sm font-semibold text-gray-900 dark:text-gray-100">
          {submission.linked_institution_name ?? submission.institution_name}
        </h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {[submission.city, submission.state_code].filter(Boolean).join(", ") || "No linked institution location"}
        </p>
        <a
          href={submission.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex max-w-full items-center gap-1 truncate text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
        >
          {truncate(submission.source_url, 86)}
          <ExternalLink className="size-3 shrink-0" />
        </a>
        <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-3 dark:text-gray-400">
          <InspectorFact label="Role" value={submission.submitter_role ?? "N/A"} />
          <InspectorFact label="Fee row" value={submission.fee_category ?? submission.fee_name} />
          <InspectorFact label="Resolution" value={submission.resolution ?? "N/A"} />
        </div>
        {(submission.notes || submission.review_notes) && (
          <div className="mt-3 grid gap-2 text-xs lg:grid-cols-2">
            {submission.notes && (
              <p className="rounded-md bg-gray-50 p-3 leading-relaxed text-gray-600 dark:bg-white/[0.04] dark:text-gray-400">
                {submission.notes}
              </p>
            )}
            {submission.review_notes && (
              <p className="rounded-md bg-gray-50 p-3 leading-relaxed text-gray-600 dark:bg-white/[0.04] dark:text-gray-400">
                {submission.review_notes}
              </p>
            )}
          </div>
        )}
      </div>

      <form className="space-y-2" action={acceptSourceSubmission}>
        <input type="hidden" name="submission_id" value={submission.id} />
        <textarea
          name="review_notes"
          rows={3}
          placeholder="Review notes"
          className="w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-100 dark:focus:ring-white/[0.2]"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="submit"
            disabled={!canReview}
            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 dark:disabled:bg-white/[0.08]"
          >
            <Check className="size-3.5" />
            Accept
          </button>
          <button
            formAction={requestSourceSubmissionInfo}
            disabled={!canReview}
            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-blue-200 px-3 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-950/25 dark:disabled:border-white/[0.08] dark:disabled:text-gray-500"
          >
            <MessageSquareMore className="size-3.5" />
            Info
          </button>
          <button
            formAction={rejectSourceSubmission}
            disabled={!canReview}
            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/25 dark:disabled:border-white/[0.08] dark:disabled:text-gray-500"
          >
            <X className="size-3.5" />
            Reject
          </button>
        </div>
        {!canReview && (
          <p className="text-[11px] text-gray-500">
            Reviewed submissions are locked for audit. Add follow-up notes through a future event, not by overwriting the verdict.
          </p>
        )}
      </form>
    </article>
  );
}
