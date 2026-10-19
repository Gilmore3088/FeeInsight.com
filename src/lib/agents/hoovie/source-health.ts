import { sql } from "@/lib/data-store/connection";
import { getRegistryFeedFreshness, type RegistryFeedFreshness } from "@/lib/data-store/feed-freshness";
import type { HoovieCadence, HoovieSourceContract } from "./contract";
import { HOOVIE_SOURCES } from "./sources";
import { inSavepoint } from "@/lib/agents/savepoint";

/**
 * Hoovie's source health report (#1866): one status per public-data source, with a reason and the
 * last success date, so a failed or empty load is heard about instead of sitting on the admin
 * data-feeds panel. Read-only: one read over `registry_ingest_partitions`
 * (`getRegistryFeedFreshness`), the scheduler's own partition plan (what it would run, and what it
 * holds) and the Hoovie contracts. Deming records it daily (`deming-source-health`) and the
 * morning brief lists the sources that are not fresh. Internal only; never shown to customers.
 *
 * Status, first match wins:
 *   skipped  the scheduler plans no partition for the source: its licence is held, a table it
 *            writes is over its size budget, or its API key is not set
 *   empty    nothing loaded yet; or the publisher's host refused production since the last
 *            success (`detail.missing_source`, #1806); or every load so far came back empty
 *   failed   a partition failed after the last success (its newest error is the reason)
 *   stale    the last success is older than the contract's cadence allows (`STALE_AFTER_DAYS`)
 *   fresh    otherwise
 *
 * A "success" is the registry's own: a partition that loaded rows, or a check that found the
 * publisher had nothing new (an empty partition that was not blocked).
 */

export type SourceHealthStatus = "fresh" | "stale" | "empty" | "failed" | "skipped";

/** The order sources are listed in: the ones that need someone first. */
export const SOURCE_HEALTH_ORDER: readonly SourceHealthStatus[] = ["failed", "empty", "stale", "skipped", "fresh"];

/**
 * Days since the last success after which a source is stale, by the publisher's cadence: the
 * cadence plus room for the publisher's own lag and the scheduler's round-robin. A one-time
 * source is never stale. An irregular source is stale after 90 days without a successful check.
 */
export const STALE_AFTER_DAYS: Readonly<Record<HoovieCadence, number | null>> = {
  daily: 3,
  weekly: 14,
  monthly: 45,
  quarterly: 120,
  annual: 400,
  irregular: 90,
  "one-time": null,
};

/** Longest error text carried into a reason. */
export const REASON_ERROR_CHARS = 160;

export interface SourceHealth {
  source: string;
  status: SourceHealthStatus;
  reason: string;
  cadence: HoovieCadence;
  /** The registry's last success (rows loaded, or a check that found nothing new). */
  lastSuccessAt: string | null;
  lastAttemptAt?: string | null;
  lastLoadedAt?: string | null;
  /** Newest partition that loaded rows. */
  latestPeriod: string | null;
}

export interface SourceHealthReport {
  readAt: string;
  sources: SourceHealth[];
  counts: Record<SourceHealthStatus, number>;
  /** Sources with partitions recorded but no contract (renamed or removed); not graded. */
  unlisted: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > REASON_ERROR_CHARS ? `${flat.slice(0, REASON_ERROR_CHARS - 1)}…` : flat;
}

const after = (a: string | null, b: string | null) => Boolean(a && (!b || a > b));

/**
 * Pure: why the scheduler plans no partition for a source, or null when it plans some.
 * `planned` is the source's partitions from `registryPartitionsBySource`.
 */
export function skipReason(
  contract: HoovieSourceContract,
  planned: readonly string[],
  { held, sizeHeld, env }: { held: ReadonlySet<string>; sizeHeld: ReadonlyMap<string, string[]>; env: Record<string, string | undefined> },
): string | null {
  if (held.has(contract.source) || contract.licence.status === "held") {
    return "held until James confirms the data terms";
  }
  const tables = sizeHeld.get(contract.source);
  if (tables && tables.length > 0) return `held: ${tables.join(", ")} over its size budget`;
  if (planned.length > 0) return null;
  if (contract.envKey && !env[contract.envKey]?.trim()) return `no ${contract.envKey} set`;
  return "the scheduler plans no partition for it";
}

/** Pure: one source's status and reason. */
export function sourceHealth(
  contract: HoovieSourceContract,
  feed: RegistryFeedFreshness | undefined,
  skip: string | null,
  now: Date,
): SourceHealth {
  const lastSuccessAt = feed?.lastSuccessAt ?? null;
  const base = { source: contract.source, cadence: contract.cadence, lastSuccessAt, latestPeriod: feed?.latestPeriod ?? null,
    lastAttemptAt: feed?.lastAttemptAt ?? null,
    // Older snapshots did not separate check/load dates. Do not infer a load from an empty check.
    lastLoadedAt: feed?.lastLoadedAt === undefined ? (feed?.succeeded ? lastSuccessAt : null) : feed.lastLoadedAt };
  const result = (status: SourceHealthStatus, reason: string): SourceHealth => ({ ...base, status, reason });

  if (skip) return result("skipped", skip);
  if (!feed || (!lastSuccessAt && feed.failed === 0 && feed.blocked === 0)) {
    const due = feed?.scheduled ? `; ${feed.scheduled} partition${feed.scheduled === 1 ? "" : "s"} waiting` : "";
    return result("empty", `nothing loaded yet${due}`);
  }
  if (feed.failed > 0 && after(feed.lastFailedAt, lastSuccessAt)) {
    const error = feed.lastError ? `: ${clip(feed.lastError)}` : "";
    return result("failed", `${feed.failed} partition${feed.failed === 1 ? "" : "s"} failed${error}`);
  }
  if (feed.blocked > 0 && after(feed.lastBlockedAt, lastSuccessAt)) {
    const host = feed.blockedHost ?? contract.missingSource?.host ?? "the publisher's host";
    const issue = contract.missingSource ? ` (#${contract.missingSource.issue})` : "";
    return result("empty", `${host} refused production's request${issue}`);
  }
  if (feed.succeeded === 0) return result("empty", "every load so far came back empty");
  const limit = STALE_AFTER_DAYS[contract.cadence];
  if (limit != null && lastSuccessAt) {
    const age = Math.floor((now.getTime() - new Date(lastSuccessAt).getTime()) / DAY_MS);
    if (age > limit) return result("stale", `last success ${age} days ago; a ${contract.cadence} source is stale after ${limit}`);
  }
  return result("fresh", `last success ${day(lastSuccessAt)}`);
}

/** Pure: the report over every contract, listed failed, empty, stale, skipped, then fresh. */
export function buildSourceHealthReport({
  contracts = HOOVIE_SOURCES,
  feeds,
  skips,
  now,
}: {
  contracts?: readonly HoovieSourceContract[];
  feeds: readonly RegistryFeedFreshness[];
  /** Each skipped source's reason (`skipReason`). */
  skips: ReadonlyMap<string, string>;
  now: Date;
}): SourceHealthReport {
  const bySource = new Map(feeds.map((feed) => [feed.source, feed]));
  const known = new Set(contracts.map((contract) => contract.source));
  const sources = contracts
    .map((contract) => sourceHealth(contract, bySource.get(contract.source), skips.get(contract.source) ?? null, now))
    .sort((a, b) => SOURCE_HEALTH_ORDER.indexOf(a.status) - SOURCE_HEALTH_ORDER.indexOf(b.status) || a.source.localeCompare(b.source));
  const counts = Object.fromEntries(SOURCE_HEALTH_ORDER.map((status) => [status, 0])) as Record<SourceHealthStatus, number>;
  for (const entry of sources) counts[entry.status] += 1;
  return {
    readAt: now.toISOString(),
    sources,
    counts,
    unlisted: feeds.map((feed) => feed.source).filter((source) => !known.has(source)).sort(),
  };
}

type SqlTag = typeof sql;

/** Reads the partitions and the scheduler's plan, then builds the report. Read-only. */
export async function readSourceHealth({
  db = sql,
  now = new Date(),
  env = process.env,
}: { db?: SqlTag; now?: Date; env?: Record<string, string | undefined> } = {}): Promise<SourceHealthReport> {
  // Loaded lazily: the scheduler imports run-store, which runs Deming's step that calls this.
  const [{ registryPartitionsBySource, backfillStart, HELD_REGISTRY_SOURCES }, { readLatestTableSizes }, { sourcesHeldForSize }] =
    await Promise.all([
      import("@/lib/agents/registry-scheduler"),
      import("@/lib/agents/atlas/storage-retention"),
      import("./size-budgets"),
    ]);
  const feeds = await getRegistryFeedFreshness(db);
  // No measurement (or a failed read) holds nothing, as in the scheduler. Its own savepoint, so a
  // failed read does not abort the step's transaction.
  const sizes = await inSavepoint(db, (scope) => readLatestTableSizes(scope)).catch(() => null);
  const sizeHeld = sourcesHeldForSize(sizes);
  const planned = new Map(
    registryPartitionsBySource(now, backfillStart(env.REGISTRY_BACKFILL_FROM), env as NodeJS.ProcessEnv, new Set(sizeHeld.keys()))
      .map((entry) => [entry.source, entry.partitions]),
  );
  const skips = new Map<string, string>();
  for (const contract of HOOVIE_SOURCES) {
    const reason = skipReason(contract, planned.get(contract.source) ?? [], { held: HELD_REGISTRY_SOURCES, sizeHeld, env });
    if (reason) skips.set(contract.source, reason);
  }
  return buildSourceHealthReport({ feeds, skips, now });
}

/** Most lines the morning brief gives stale and skipped sources; failed and empty ones are always named. */
export const BRIEF_SOURCE_LINES = 25;

function line(entry: SourceHealth): string {
  const text = `${entry.source}: ${entry.status}, ${entry.reason}`;
  // A stale or fresh reason already dates the last success.
  if (entry.status === "stale" || entry.status === "fresh") return text;
  const loaded = entry.lastLoadedAt === undefined ? (entry.latestPeriod ? entry.lastSuccessAt : null) : entry.lastLoadedAt;
  return `${text}; ${entry.lastAttemptAt ? `last attempt ${day(entry.lastAttemptAt)}; ` : ""}${loaded ? `last nonempty load ${day(loaded)}` : "no nonempty load recorded"}${entry.lastSuccessAt ? `; last successful check ${day(entry.lastSuccessAt)}` : ""}`;
}

/**
 * Pure: the brief's public-data lines, only the sources that are not fresh; none when every
 * source is fresh. Failed and empty sources are always named; stale and skipped ones fill the
 * rest up to `BRIEF_SOURCE_LINES`.
 */
export function sourceHealthLines(report: SourceHealthReport | null | undefined, limit = BRIEF_SOURCE_LINES): string[] {
  if (!report) return [];
  const notFresh = report.sources.filter((entry) => entry.status !== "fresh");
  if (notFresh.length === 0) return [];
  const urgent = notFresh.filter((entry) => entry.status === "failed" || entry.status === "empty");
  const rest = notFresh.filter((entry) => entry.status === "stale" || entry.status === "skipped");
  const shown = [...urgent, ...rest.slice(0, Math.max(0, limit - urgent.length))];
  const more = notFresh.length - shown.length;
  return [
    `Public data: ${notFresh.length} of ${report.sources.length} sources not fresh (${countsText(report)}).`,
    ...shown.map((entry) => `- ${line(entry)}`),
    ...(more > 0 ? [`- and ${more} more on /admin/data`] : []),
  ];
}

function countsText(report: SourceHealthReport): string {
  return SOURCE_HEALTH_ORDER.filter((status) => status !== "fresh" && report.counts[status] > 0)
    .map((status) => `${report.counts[status]} ${status}`)
    .join(", ");
}

/** The sources that need someone: failed or empty. */
export function urgentSourceCount(report: SourceHealthReport | null | undefined): number {
  return report ? report.counts.failed + report.counts.empty : 0;
}

export function summarizeSourceHealth(report: SourceHealthReport): string {
  const notFresh = report.sources.length - report.counts.fresh;
  const named = report.sources
    .filter((entry) => entry.status === "failed" || entry.status === "empty")
    .slice(0, 5)
    .map((entry) => entry.source);
  const alarm = named.length > 0 ? `; ALARM: ${named.join(", ")}${urgentSourceCount(report) > named.length ? " and more" : ""}` : "";
  return `Deming checked ${report.sources.length} public-data sources: ${report.counts.fresh} fresh${notFresh > 0 ? `, ${countsText(report)}` : ""}${alarm}.`;
}

export function sourceHealthDetail(report: SourceHealthReport): Record<string, unknown> {
  return {
    read_at: report.readAt,
    counts: report.counts,
    stale_after_days: STALE_AFTER_DAYS,
    unlisted: report.unlisted,
    sources: report.sources.map((entry) => ({
      source: entry.source,
      status: entry.status,
      reason: entry.reason,
      cadence: entry.cadence,
      last_success_at: entry.lastSuccessAt,
      last_attempt_at: entry.lastAttemptAt ?? null,
      last_loaded_at: entry.lastLoadedAt ?? null,
      latest_period: entry.latestPeriod,
    })),
  };
}
