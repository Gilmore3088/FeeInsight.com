/**
 * Monitor Screen — Data Fetcher
 * Fetches all data for the /pro/monitor page.
 * Per D-11 pattern: NOT ISR cached — fresh on every page load.
 * All DB calls wrapped in try/catch, degrade gracefully to empty state.
 */

import { sql } from "@/lib/data-store/connection";
import {
  getHamiltonInstitutionContext,
  type HamiltonSelectedInstitutionContext,
} from "@/lib/hamilton/institution-context";
import type { SignalEntry, AlertEntry } from "@/lib/hamilton/home-data";
import {
  fetchQueuedHamiltonRefreshJobs,
  type HamiltonRefreshJobEntry,
} from "@/lib/hamilton/refresh-jobs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WatchlistEntry {
  institutionId: string;
  /** Display label derived from institutionId for v8.0 */
  displayName: string;
  /** Status derivation is deferred — always "unknown" for v8.0 */
  status: "current" | "review_due" | "unknown";
}

export interface MonitorPageData {
  status: {
    overall: "stable" | "watch" | "worsening";
    newSignals: number;
    highPriorityAlerts: number;
  };
  monitoringScope: {
    institutionIds: string[];
    isScoped: boolean;
    label: string;
  };
  topAlert: AlertEntry | null;
  signalFeed: SignalEntry[];
  watchlist: WatchlistEntry[];
  refreshJobs: HamiltonRefreshJobEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveDisplayName(institutionId: string): string {
  return institutionId
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function deriveWatchlistStatus(
  feePublicationStatus: string | null | undefined,
  insightReadiness: string | null | undefined,
): WatchlistEntry["status"] {
  if (feePublicationStatus === "verified" || insightReadiness === "public_ready") {
    return "current";
  }
  if (
    feePublicationStatus === "unavailable" ||
    insightReadiness === "source_needed" ||
    insightReadiness === "under_review"
  ) {
    return "review_due";
  }
  return "unknown";
}

export function createWatchlistEntryFromInstitution(
  institution: HamiltonSelectedInstitutionContext,
): WatchlistEntry {
  return {
    institutionId: String(institution.id),
    displayName: institution.name,
    status: deriveWatchlistStatus(
      institution.feePublicationStatus,
      institution.insightReadiness,
    ),
  };
}

function deriveOverallStatus(
  newSignals: number,
  highAlerts: number,
  recentHigh: number
): "stable" | "watch" | "worsening" {
  if (recentHigh > 0) return "worsening";
  if (highAlerts > 0 || newSignals > 2) return "watch";
  return "stable";
}

function normalizeInstitutionScope(
  ids: Array<string | number | null | undefined>,
): string[] {
  const seen = new Set<string>();
  ids.forEach((id) => {
    if (id === null || id === undefined || id === "") return;
    const value = String(id).trim();
    if (!/^[1-9]\d*$/.test(value)) return;
    seen.add(value);
  });
  return Array.from(seen);
}

function buildScopeLabel(institutionIds: string[], watchlistCount: number): string {
  if (institutionIds.length === 0) {
    return watchlistCount > 0
      ? "Add matched institutions to your watchlist to see their signals here."
      : "Choose an institution or add one to your watchlist to see its signals here.";
  }
  if (institutionIds.length === 1) {
    return watchlistCount > 0
      ? "Watching 1 institution on your list."
      : "Watching your institution.";
  }
  return `Watching ${institutionIds.length} institutions: yours and your list.`;
}

// ---------------------------------------------------------------------------
// DB queries
// ---------------------------------------------------------------------------

async function fetchSignalFeed(
  limit: number,
  institutionIds: string[] = [],
): Promise<SignalEntry[]> {
  // Signals belong to institutions: with nothing selected or watched there is nothing
  // to show (the old "global sample" leaked other customers' institution activity).
  if (institutionIds.length === 0) return [];
  try {
    const rows = institutionIds.length > 0
      ? await sql`
          SELECT
            id,
            institution_id,
            signal_type,
            severity,
            title,
            body,
            created_at,
            source_json ->> 'evidence_policy' AS evidence_policy,
            COALESCE((source_json ->> 'provider_call_queued')::boolean, false) AS provider_call_queued
          FROM hamilton_signals
          WHERE institution_id = ANY(${institutionIds}::text[])
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT
            id,
            institution_id,
            signal_type,
            severity,
            title,
            body,
            created_at,
            source_json ->> 'evidence_policy' AS evidence_policy,
            COALESCE((source_json ->> 'provider_call_queued')::boolean, false) AS provider_call_queued
          FROM hamilton_signals
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
    return rows.map((r) => ({
      id: String(r.id),
      institutionId: r.institution_id == null ? null : String(r.institution_id),
      signalType: String(r.signal_type),
      severity: String(r.severity),
      title: String(r.title),
      body: String(r.body),
      createdAt: String(r.created_at),
      evidencePolicy: r.evidence_policy == null ? null : String(r.evidence_policy) as SignalEntry["evidencePolicy"],
      providerCallQueued: r.provider_call_queued === true,
    }));
  } catch {
    return [];
  }
}

async function fetchTopAlert(
  userId: number,
  institutionIds: string[] = [],
): Promise<AlertEntry | null> {
  try {
    const rows = institutionIds.length > 0
      ? await sql`
          SELECT
            pa.id,
            pa.signal_id,
            pa.status,
            pa.created_at,
            s.institution_id,
            s.signal_type,
            s.severity,
            s.title,
            s.body,
            s.source_json ->> 'evidence_policy' AS evidence_policy,
            COALESCE((s.source_json ->> 'provider_call_queued')::boolean, false) AS provider_call_queued
          FROM hamilton_priority_alerts pa
          JOIN hamilton_signals s ON pa.signal_id = s.id
          WHERE pa.user_id = ${userId}
            AND pa.status = 'active'
            AND s.institution_id = ANY(${institutionIds}::text[])
          ORDER BY
            CASE s.severity
              WHEN 'high'   THEN 1
              WHEN 'medium' THEN 2
              WHEN 'low'    THEN 3
              ELSE 4
            END ASC,
            pa.created_at DESC
          LIMIT 1
        `
      : await sql`
          SELECT
            pa.id,
            pa.signal_id,
            pa.status,
            pa.created_at,
            s.institution_id,
            s.signal_type,
            s.severity,
            s.title,
            s.body,
            s.source_json ->> 'evidence_policy' AS evidence_policy,
            COALESCE((s.source_json ->> 'provider_call_queued')::boolean, false) AS provider_call_queued
          FROM hamilton_priority_alerts pa
          JOIN hamilton_signals s ON pa.signal_id = s.id
          WHERE pa.user_id = ${userId}
            AND pa.status = 'active'
          ORDER BY
            CASE s.severity
              WHEN 'high'   THEN 1
              WHEN 'medium' THEN 2
              WHEN 'low'    THEN 3
              ELSE 4
            END ASC,
            pa.created_at DESC
          LIMIT 1
        `;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: String(r.id),
      signalId: String(r.signal_id),
      institutionId: r.institution_id == null ? null : String(r.institution_id),
      signalType: String(r.signal_type),
      severity: String(r.severity),
      title: String(r.title),
      body: String(r.body),
      status: String(r.status),
      createdAt: String(r.created_at),
      evidencePolicy: r.evidence_policy == null ? null : String(r.evidence_policy) as AlertEntry["evidencePolicy"],
      providerCallQueued: r.provider_call_queued === true,
    };
  } catch {
    return null;
  }
}

async function fetchStatusMetrics(
  userId: number,
  institutionIds: string[] = [],
): Promise<{
  newSignals: number;
  highPriorityAlerts: number;
  recentHighSignals: number;
}> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [newRows, alertRows, recentHighRows] = institutionIds.length > 0
      ? await Promise.all([
          sql`
            SELECT COUNT(*)::int AS count
            FROM hamilton_signals
            WHERE created_at >= ${cutoff}
              AND institution_id = ANY(${institutionIds}::text[])
          `,
          sql`
            SELECT COUNT(*)::int AS count
            FROM hamilton_priority_alerts pa
            JOIN hamilton_signals s ON pa.signal_id = s.id
            WHERE pa.user_id = ${userId}
              AND pa.status = 'active'
              AND s.severity = 'high'
              AND s.institution_id = ANY(${institutionIds}::text[])
          `,
          sql`
            SELECT COUNT(*)::int AS count
            FROM hamilton_signals
            WHERE severity = 'high'
              AND created_at >= ${cutoff}
              AND institution_id = ANY(${institutionIds}::text[])
          `,
        ])
      : await Promise.all([
          // Unscoped users see only their own alerts; other institutions' signal
          // volume must not drive their status.
          Promise.resolve([{ count: 0 }]),
          sql`
            SELECT COUNT(*)::int AS count
            FROM hamilton_priority_alerts pa
            JOIN hamilton_signals s ON pa.signal_id = s.id
            WHERE pa.user_id = ${userId}
              AND pa.status = 'active'
              AND s.severity = 'high'
          `,
          Promise.resolve([{ count: 0 }]),
        ]);

    return {
      newSignals: Number(newRows[0]?.count ?? 0),
      highPriorityAlerts: Number(alertRows[0]?.count ?? 0),
      recentHighSignals: Number(recentHighRows[0]?.count ?? 0),
    };
  } catch {
    return { newSignals: 0, highPriorityAlerts: 0, recentHighSignals: 0 };
  }
}

/** Watchlist size limit: each entry is an institution lookup on every Monitor load. */
export const MAX_WATCHLIST_INSTITUTIONS = 25;

async function fetchWatchlist(userId: number): Promise<WatchlistEntry[]> {
  try {
    const rows = await sql`
      SELECT institution_ids
      FROM hamilton_watchlists
      WHERE user_id = ${userId}
      LIMIT 1
    `;
    if (rows.length === 0) return [];

    const ids: string[] = Array.isArray(rows[0]?.institution_ids)
      ? (rows[0].institution_ids as string[]).slice(0, MAX_WATCHLIST_INSTITUTIONS)
      : [];

    return Promise.all(
      ids.map(async (id) => {
        const institutionId = String(id);
        const { institution } = await getHamiltonInstitutionContext(institutionId).catch(() => ({
          institution: null,
        }));
        if (institution) return createWatchlistEntryFromInstitution(institution);
        return {
          institutionId,
          displayName: deriveDisplayName(institutionId),
          status: "unknown" as const,
        };
      }),
    );
  } catch {
    return [];
  }
}

async function fetchRefreshJobs(userId: number, institutionIds: string[]): Promise<HamiltonRefreshJobEntry[]> {
  // Jobs are institution-scoped: nothing selected or watched means nothing to refresh.
  if (institutionIds.length === 0) return [];
  try {
    return await fetchQueuedHamiltonRefreshJobs({ institutionIds, userId, limit: 8 });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function fetchMonitorPageData(
  userId: number,
  options: { selectedInstitutionId?: string | number | null } = {},
): Promise<MonitorPageData> {
  const watchlist = await fetchWatchlist(userId);
  const institutionIds = normalizeInstitutionScope([
    options.selectedInstitutionId,
    ...watchlist.map((entry) => entry.institutionId),
  ]);

  const [signalFeed, topAlert, metrics, refreshJobs] = await Promise.all([
    fetchSignalFeed(20, institutionIds),
    fetchTopAlert(userId, institutionIds),
    fetchStatusMetrics(userId, institutionIds),
    fetchRefreshJobs(userId, institutionIds),
  ]);

  const overall = deriveOverallStatus(
    metrics.newSignals,
    metrics.highPriorityAlerts,
    metrics.recentHighSignals
  );

  return {
    status: {
      overall,
      newSignals: metrics.newSignals,
      highPriorityAlerts: metrics.highPriorityAlerts,
    },
    monitoringScope: {
      institutionIds,
      isScoped: institutionIds.length > 0,
      label: buildScopeLabel(institutionIds, watchlist.length),
    },
    topAlert,
    signalFeed,
    watchlist,
    refreshJobs,
  };
}
