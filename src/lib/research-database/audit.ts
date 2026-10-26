import { HOOVIE_SOURCES } from "@/lib/agents/hoovie/sources";
import type { RegistryFeedFreshness } from "@/lib/data-store/feed-freshness";
import type { ResearchAuditRow } from "./types";

/** A source contract is metadata, never evidence that its rows actually loaded. */
export function buildResearchAudit(feeds: RegistryFeedFreshness[], now = new Date()): ResearchAuditRow[] {
  const bySource = new Map(feeds.map(f => [f.source, f]));
  return HOOVIE_SOURCES.map(source => {
    const feed = bySource.get(source.source);
    const allowed = ["public-domain", "open-licence", "fee-insight"].includes(source.licence.status);
    const staleHours = source.checkEveryHours ? source.checkEveryHours * 3 : ({ daily: 72, weekly: 24 * 21, monthly: 24 * 100, quarterly: 24 * 200, annual: 24 * 800 } as Record<string, number>)[source.cadence];
    const elapsed = feed?.lastSuccessAt ? (now.getTime() - new Date(feed.lastSuccessAt).getTime()) / 3_600_000 : null;
    const blocked = !allowed || !!source.missingSource || !!feed?.blocked || !!feed?.unreachable;
    const loaded = !!feed?.succeeded && !!feed.latestPeriod;
    const stale = loaded && (!Number.isFinite(elapsed) || elapsed === null || (staleHours !== undefined && elapsed > staleHours));
    return {
      source: source.source, publisher: source.publisher, licence: source.licence.status, tables: source.tables,
      latestPeriod: feed?.latestPeriod ?? null, lastSuccessAt: feed?.lastSuccessAt ?? null,
      loadedPartitions: feed?.succeeded ?? 0,
      status: blocked ? "blocked" : !loaded ? "unmeasured" : stale ? "stale" : "ready",
      reason: !allowed ? source.licence.note ?? "Commercial reuse needs review."
        : source.missingSource ? source.missingSource.observed
        : blocked ? feed?.lastError ?? feed?.unreachablePages ?? "Publisher access is blocked."
        : !loaded ? "No successful loaded partition measured; table contents still need inspection."
        : stale ? "Refresh receipt is overdue or missing."
        : "Loaded partition measured; report-specific coverage is checked separately.",
    };
  });
}
