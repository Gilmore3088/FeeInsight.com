/**
 * Hamilton Pro Tables — query helpers for migration-backed Hamilton Pro tables.
 *
 * Tables:
 *   hamilton_saved_analyses  — Analyze screen: saved AI analysis responses per institution
 *   hamilton_scenarios       — Simulate screen: fee change scenarios with confidence tiers
 *   hamilton_reports         — Report screen: generated PDF-ready reports
 *   hamilton_watchlists      — Monitor screen: per-user watchlist configuration
 *   hamilton_workspace_contexts — Per-user selected institution context
 *   hamilton_signals         — Monitor screen: detected fee change signals
 *   hamilton_priority_alerts — Monitor screen: user-specific alert instances from signals
 *   hamilton_refresh_jobs    — Durable report/scenario/watchlist refresh work from signals
 *
 * All schema changes and seed data live in Supabase migrations.
 * Query helpers use the shared postgres sql client from data-store/connection.
 *
 * Soft-delete: analyses and scenarios have archived_at + status columns (D-07, D-08).
 * Reports, watchlists, signals, and alerts have NO soft-delete (D-09).
 *
 * Report status: 'generated' (user-created, private) | 'published' (BFI-authored, public to all pro users)
 */

import { sql } from "@/lib/data-store/connection";
import type { ReportArtifactMetadata, ReportSummaryResponse } from "@/lib/hamilton/types";
import type { HamiltonEvidencePolicy } from "@/lib/hamilton/request-contract";
import type { HamiltonPeerIndexSource } from "@/lib/hamilton/peer-index";
import type { HamiltonPersistedContextSource } from "@/lib/hamilton/context-source";

export interface HamiltonReportLibraryItem {
  id: string;
  institution_id: string | null;
  report_type: string;
  title: string;
  created_at: string;
  report_json: ReportSummaryResponse;
  artifact_metadata: ReportArtifactMetadata;
}

/**
 * Get all published BFI-authored reports (visible to all authenticated pro users).
 * Published reports use sentinel user_id = 0 and status = 'published'.
 * Returns newest first, limited to 20. Reports older than 90 days are left
 * out: their figures predate the current fee data, and the April 2026 seed
 * rows would otherwise sit at the top of the library as months-old news.
 */
export async function getPublishedReports(): Promise<HamiltonReportLibraryItem[]> {
  // Filter rows whose title is empty/whitespace — these are seed fixtures
  // with no real content (audit H-2 2026-04-17). Showing them produces 4
  // identical-date cards with no titles, which destroys trust.
  const rows = await sql`
    SELECT id, institution_id, report_type, created_at,
           report_json->>'title' AS title,
           report_json,
           evidence_policy,
           peer_set_id,
           peer_baseline_source,
           peer_baseline_label,
           peer_fallback_reason,
           selected_source,
           selected_source_label,
           selected_verified_fee_count,
           selected_provisional_fee_count,
           selected_fee_delta_count
    FROM hamilton_reports
    WHERE status = 'published'
      AND coalesce(nullif(trim(report_json->>'title'), ''), '') != ''
      AND created_at >= now() - interval '90 days'
    ORDER BY created_at DESC
    LIMIT 20
  `;
  return rows.map((row) => ({
    id: row.id as string,
    institution_id: row.institution_id == null ? null : String(row.institution_id),
    report_type: row.report_type as string,
    title: row.title as string,
    created_at: row.created_at as string,
    report_json: row.report_json as ReportSummaryResponse,
    artifact_metadata: {
      evidencePolicy: row.evidence_policy as HamiltonEvidencePolicy,
      selectedSource: row.selected_source as HamiltonPersistedContextSource,
      selectedSourceLabel: row.selected_source_label as string | null,
      peerSetId: row.peer_set_id as string | null,
      peerBaselineSource: row.peer_baseline_source as HamiltonPeerIndexSource | null,
      peerBaselineLabel: row.peer_baseline_label as string | null,
      peerFallbackReason: row.peer_fallback_reason as string | null,
      selectedVerifiedFeeCount: Number(row.selected_verified_fee_count ?? 0),
      selectedProvisionalFeeCount: Number(row.selected_provisional_fee_count ?? 0),
      selectedFeeDeltaCount: Number(row.selected_fee_delta_count ?? 0),
    },
  })) satisfies HamiltonReportLibraryItem[];
}

/**
 * Get a single scenario by ID, filtered by userId to prevent IDOR.
 * Used by the Reports page when arriving from Simulate with ?scenario_id=X.
 */
export async function getHamiltonScenarioById(
  scenarioId: string,
  userId: number
): Promise<{
  id: string;
  fee_category: string;
  institution_id: string;
  current_value: number;
  proposed_value: number;
  confidence_tier: string;
  peer_set_id: string | null;
  evidence_policy: HamiltonEvidencePolicy;
  peer_baseline_source: HamiltonPeerIndexSource | null;
  peer_baseline_label: string | null;
  peer_fallback_reason: string | null;
  selected_source: HamiltonPersistedContextSource;
  selected_source_label: string | null;
  created_at: string;
} | null> {
  const rows = await sql`
    SELECT id, fee_category, institution_id, current_value, proposed_value,
           confidence_tier, peer_set_id, evidence_policy, peer_baseline_source,
           peer_baseline_label, peer_fallback_reason, selected_source,
           selected_source_label, created_at
    FROM hamilton_scenarios
    WHERE id = ${scenarioId}
      AND user_id = ${userId}
      AND status = 'active'
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return {
    id: rows[0].id as string,
    fee_category: rows[0].fee_category as string,
    institution_id: String(rows[0].institution_id ?? ""),
    current_value: Number(rows[0].current_value),
    proposed_value: Number(rows[0].proposed_value),
    confidence_tier: rows[0].confidence_tier as string,
    peer_set_id: rows[0].peer_set_id as string | null,
    evidence_policy: rows[0].evidence_policy as HamiltonEvidencePolicy,
    peer_baseline_source: rows[0].peer_baseline_source as HamiltonPeerIndexSource | null,
    peer_baseline_label: rows[0].peer_baseline_label as string | null,
    peer_fallback_reason: rows[0].peer_fallback_reason as string | null,
    selected_source: rows[0].selected_source as HamiltonPersistedContextSource,
    selected_source_label: rows[0].selected_source_label as string | null,
    created_at: rows[0].created_at as string,
  };
}

/**
 * Save a generated report to hamilton_reports.
 * Returns the new report's UUID.
 * status defaults to 'generated' — user-created reports are always private.
 */
export async function saveHamiltonReport(params: {
  userId: number;
  institutionId: string;
  reportType: string;
  reportJson: ReportSummaryResponse;
  scenarioId?: string | null;
  evidencePolicy?: HamiltonEvidencePolicy;
  peerSetId?: string | null;
  peerBaselineSource?: HamiltonPeerIndexSource | null;
  peerBaselineLabel?: string | null;
  peerFallbackReason?: string | null;
  selectedSource?: HamiltonPersistedContextSource;
  selectedSourceLabel?: string | null;
  selectedVerifiedFeeCount?: number;
  selectedProvisionalFeeCount?: number;
  selectedFeeDeltaCount?: number;
}): Promise<string> {
  const rows = await sql`
    INSERT INTO hamilton_reports
      (
        user_id,
        institution_id,
        report_type,
        report_json,
        scenario_id,
        evidence_policy,
        peer_set_id,
        peer_baseline_source,
        peer_baseline_label,
        peer_fallback_reason,
        selected_source,
        selected_source_label,
        selected_verified_fee_count,
        selected_provisional_fee_count,
        selected_fee_delta_count,
        status
      )
    VALUES
      (
        ${params.userId},
        ${params.institutionId},
        ${params.reportType},
        ${JSON.stringify(params.reportJson)},
        ${params.scenarioId ?? null},
        ${params.evidencePolicy ?? "provisional-first"},
        ${params.peerSetId ?? null},
        ${params.peerBaselineSource ?? null},
        ${params.peerBaselineLabel ?? null},
        ${params.peerFallbackReason ?? null},
        ${params.selectedSource ?? "manual"},
        ${params.selectedSourceLabel ?? null},
        ${params.selectedVerifiedFeeCount ?? 0},
        ${params.selectedProvisionalFeeCount ?? 0},
        ${params.selectedFeeDeltaCount ?? 0},
        'generated'
      )
    RETURNING id
  `;
  return rows[0].id as string;
}

/**
 * Get generated reports for a user.
 * Returns newest first with enough artifact metadata for direct reuse/export.
 */
export async function getRecentHamiltonReports(
  userId: number,
  limit = 20,
): Promise<HamiltonReportLibraryItem[]> {
  const rows = await sql`
    SELECT
      id,
      institution_id,
      report_type,
      created_at,
      report_json->>'title' AS title,
      report_json,
      evidence_policy,
      peer_set_id,
      peer_baseline_source,
      peer_baseline_label,
      peer_fallback_reason,
      selected_source,
      selected_source_label,
      selected_verified_fee_count,
      selected_provisional_fee_count,
      selected_fee_delta_count
    FROM hamilton_reports
    WHERE user_id = ${userId}
      AND status = 'generated'
      AND coalesce(nullif(trim(report_json->>'title'), ''), '') != ''
      AND created_at >= now() - interval '90 days'
    ORDER BY created_at DESC
    LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))}
  `;
  return rows.map((row) => ({
    id: row.id as string,
    institution_id: row.institution_id == null ? null : String(row.institution_id),
    report_type: row.report_type as string,
    title: row.title as string,
    created_at: row.created_at as string,
    report_json: row.report_json as ReportSummaryResponse,
    artifact_metadata: {
      evidencePolicy: row.evidence_policy as HamiltonEvidencePolicy,
      selectedSource: row.selected_source as HamiltonPersistedContextSource,
      selectedSourceLabel: row.selected_source_label as string | null,
      peerSetId: row.peer_set_id as string | null,
      peerBaselineSource: row.peer_baseline_source as HamiltonPeerIndexSource | null,
      peerBaselineLabel: row.peer_baseline_label as string | null,
      peerFallbackReason: row.peer_fallback_reason as string | null,
      selectedVerifiedFeeCount: Number(row.selected_verified_fee_count ?? 0),
      selectedProvisionalFeeCount: Number(row.selected_provisional_fee_count ?? 0),
      selectedFeeDeltaCount: Number(row.selected_fee_delta_count ?? 0),
    },
  })) satisfies HamiltonReportLibraryItem[];
}

/**
 * Get active scenarios for a user (for scenario selector in ConfigSidebar).
 * Returns newest first, limited to 20. Reports older than 90 days are left
 * out: their figures predate the current fee data, and the April 2026 seed
 * rows would otherwise sit at the top of the library as months-old news.
 */
export async function getActiveScenarios(userId: number): Promise<Array<{
  id: string;
  fee_category: string;
  current_value: number;
  proposed_value: number;
  confidence_tier: string;
  created_at: string;
}>> {
  const rows = await sql`
    SELECT id, fee_category, current_value, proposed_value, confidence_tier, created_at
    FROM hamilton_scenarios
    WHERE user_id = ${userId}
      AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 20
  `;
  return rows as unknown as Array<{
    id: string;
    fee_category: string;
    current_value: number;
    proposed_value: number;
    confidence_tier: string;
    created_at: string;
  }>;
}

/**
 * Get a single report by ID (for report output display after generation).
 */
export async function getHamiltonReportById(reportId: string, userId: number): Promise<{
  id: string;
  institution_id: string | null;
  report_type: string;
  report_json: ReportSummaryResponse;
  scenario_id: string | null;
  artifact_metadata: ReportArtifactMetadata;
  created_at: string;
} | null> {
  const rows = await sql`
    SELECT
      id,
      institution_id,
      report_type,
      report_json,
      scenario_id,
      evidence_policy,
      peer_set_id,
      peer_baseline_source,
      peer_baseline_label,
      peer_fallback_reason,
      selected_source,
      selected_source_label,
      selected_verified_fee_count,
      selected_provisional_fee_count,
      selected_fee_delta_count,
      created_at
    FROM hamilton_reports
    WHERE id = ${reportId}
      AND user_id = ${userId}
      AND status = 'generated'
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return {
    id: rows[0].id as string,
    institution_id: rows[0].institution_id == null ? null : String(rows[0].institution_id),
    report_type: rows[0].report_type as string,
    report_json: rows[0].report_json as ReportSummaryResponse,
    scenario_id: rows[0].scenario_id as string | null,
    artifact_metadata: {
      evidencePolicy: rows[0].evidence_policy as HamiltonEvidencePolicy,
      selectedSource: rows[0].selected_source as HamiltonPersistedContextSource,
      selectedSourceLabel: rows[0].selected_source_label as string | null,
      peerSetId: rows[0].peer_set_id as string | null,
      peerBaselineSource: rows[0].peer_baseline_source as HamiltonPeerIndexSource | null,
      peerBaselineLabel: rows[0].peer_baseline_label as string | null,
      peerFallbackReason: rows[0].peer_fallback_reason as string | null,
      selectedVerifiedFeeCount: Number(rows[0].selected_verified_fee_count ?? 0),
      selectedProvisionalFeeCount: Number(rows[0].selected_provisional_fee_count ?? 0),
      selectedFeeDeltaCount: Number(rows[0].selected_fee_delta_count ?? 0),
    },
    created_at: rows[0].created_at as string,
  };
}
