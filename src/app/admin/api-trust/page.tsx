export const dynamic = "force-dynamic";

import Link from "next/link";
import { Activity, Ban, CircleAlert, Gauge, LockKeyhole, Route, ShieldCheck } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireAuth } from "@/lib/auth";
import { getApiTrustOverview } from "@/lib/api-hardening/admin";

function money(microusd: number): string {
  const dollars = microusd / 1_000_000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dollars > 0 && dollars < 1 ? 4 : 2,
    maximumFractionDigits: dollars > 0 && dollars < 1 ? 4 : 2,
  }).format(dollars);
}

function time(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-black/[0.06] bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-gray-950 dark:text-gray-100">{value}</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{detail}</p>
    </div>
  );
}

export default async function ApiTrustPage() {
  await requireAuth("view");
  const overview = await getApiTrustOverview();

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Atlas", href: "/admin" }, { label: "API Trust" }]} />

      <section className="rounded-lg border border-black/[0.06] bg-white p-5 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="admin-eyebrow">Control · API Trust</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-950 dark:text-gray-50">
              Provider spend and route posture
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-600 dark:text-gray-300">
              Budget policies are fail-closed. Automation remains blocked until global provider caps and cron tick caps are explicitly enabled.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
          <Link
            href="/admin#atlas-safety"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-black/[0.08] px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-200 dark:hover:bg-white/[0.05]"
          >
            <ShieldCheck className="size-4" />
            Atlas safety
          </Link>
          <Link
            href="/admin/api-keys"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-black/[0.08] px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-200 dark:hover:bg-white/[0.05]"
          >
            <LockKeyhole className="size-4" />
            API keys
          </Link>
          </div>
        </div>

        <div className={`mt-5 rounded-md border px-4 py-3 ${
          overview.schemaReady && overview.policy.providerReady
            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200"
            : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200"
        }`}>
          <div className="flex gap-3">
            {overview.schemaReady && overview.policy.providerReady
              ? <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              : <LockKeyhole className="mt-0.5 size-4 shrink-0" />}
            <div>
              <p className="text-sm font-semibold">
                {overview.schemaReady && overview.policy.providerReady
                  ? "Provider pilot caps are configured"
                  : "Automation cannot resume yet"}
              </p>
              <p className="mt-1 text-xs opacity-80">
                {overview.blocker ?? "Global provider and cron tick policies have active caps."}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Stat label="Today spend" value={money(overview.spend.todayMicrousd)} detail={`${overview.counts.providerCallsToday.toLocaleString()} provider calls today`} />
        <Stat label="7-day spend" value={money(overview.spend.sevenDayMicrousd)} detail="Completed provider calls only" />
        <Stat label="Month spend" value={money(overview.spend.monthMicrousd)} detail="Estimated from provider usage" />
        <Stat label="Blocked today" value={overview.counts.blockedToday.toLocaleString()} detail={`${overview.counts.failedToday.toLocaleString()} route errors today`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-black/[0.06] bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-950 dark:text-gray-100">Budget policies</h2>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">Total</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-950 dark:text-gray-100">
                {overview.policy.total.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-gray-500">Seeded policy rows</p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">Enabled</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-950 dark:text-gray-100">
                {overview.policy.enabled.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-gray-500">{overview.policy.disabled.toLocaleString()} disabled</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-gray-500">
            Missing cap policies: {overview.policy.missingCaps.toLocaleString()}. Configure caps manually before the guarded pilot.
          </p>
        </div>

        <div className="rounded-lg border border-black/[0.06] bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="flex items-center gap-2">
            <Ban className="size-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-950 dark:text-gray-100">Automation stop</h2>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">State</dt>
              <dd className="font-semibold text-gray-950 dark:text-gray-100">
                {overview.automation.enabled === null
                  ? "Unknown"
                  : overview.automation.enabled ? "Enabled" : "Stopped"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Changed</dt>
              <dd className="text-gray-700 dark:text-gray-300">{time(overview.automation.changedAt)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Reason</dt>
              <dd className="mt-1 text-gray-700 dark:text-gray-300">
                {overview.automation.reason ?? "No stop reason recorded."}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-black/[0.06] bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="flex items-center gap-2">
            <Route className="size-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-950 dark:text-gray-100">Top routes, 7 days</h2>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-gray-500">
                <tr>
                  <th className="py-2 pr-4">Route</th>
                  <th className="py-2 pr-4 text-right">Hits</th>
                  <th className="py-2 pr-4 text-right">Blocked</th>
                  <th className="py-2 text-right">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
                {overview.topRoutes.length === 0 ? (
                  <tr><td colSpan={4} className="py-4 text-sm text-gray-500">No route audit events yet.</td></tr>
                ) : overview.topRoutes.map((route) => (
                  <tr key={route.routeId}>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">{route.routeId}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{route.hits}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{route.blocked}</td>
                    <td className="py-2 text-right tabular-nums">{route.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-black/[0.06] bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-950 dark:text-gray-100">Latest provider failure</h2>
          </div>
          {overview.latestProviderFailure ? (
            <div className="mt-4 space-y-2 text-sm">
              <p className="font-mono text-xs text-gray-600 dark:text-gray-300">
                {overview.latestProviderFailure.routeId ?? overview.latestProviderFailure.agentName ?? "provider"}
                {overview.latestProviderFailure.operation ? ` · ${overview.latestProviderFailure.operation}` : ""}
              </p>
              <p className="text-xs text-gray-500">{time(overview.latestProviderFailure.createdAt)}</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {overview.latestProviderFailure.error ?? "No error summary recorded."}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-500">No provider failures recorded.</p>
          )}

          <div className="mt-6 flex items-center gap-2">
            <CircleAlert className="size-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-950 dark:text-gray-100">Top subjects, 7 days</h3>
          </div>
          <div className="mt-3 space-y-2">
            {overview.topSubjects.length === 0 ? (
              <p className="text-sm text-gray-500">No subject activity yet.</p>
            ) : overview.topSubjects.map((subject) => (
              <div key={subject.subjectKey} className="flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 text-xs dark:bg-white/[0.04]">
                <span className="truncate font-mono text-gray-600 dark:text-gray-300">{subject.subjectKey}</span>
                <span className="shrink-0 tabular-nums text-gray-500">
                  {subject.hits} hit{subject.hits === 1 ? "" : "s"} · {subject.blocked} blocked
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
