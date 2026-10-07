/**
 * Admin dashboard queries — Postgres-native, all primitives out.
 *
 * Every function:
 * - Uses `sql` from connection.ts
 * - Wraps COUNT/SUM with Number()
 * - Converts dates with toDateStr()
 * - Has try/catch with safe fallback (never crashes the page)
 * - Returns plain objects (string | number | boolean only)
 */

import { sql } from "@/lib/data-store/connection";
import { toDateStr } from "@/lib/pg-helpers";
import { paymentFieldsOf } from "@/lib/data-store/report-payments";
import {
  classifyInstitutionQuality,
  type AgentFailureClass,
  type InstitutionQualityFilter,
  type InstitutionQualitySignal,
  type InstitutionQualityStatus,
} from "@/lib/institution-quality";
import { DISTRICT_NAMES, STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import {
  DATA_TRUST_QUEUE_STATES,
  classifyDataTrustQueue,
  type DataTrustQueueDecision,
  type DataTrustQueueState,
} from "@/lib/data-trust";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardStats {
  total_institutions: number;
  with_fees: number;
  with_urls: number;
  coverage_pct: number;
}

export interface RecentCrawlRun {
  id: number;
  started_at: string;
  completed_at: string;
  status: string;
  targets_crawled: number;
  targets_succeeded: number;
  fees_extracted: number;
  success_rate: number;
}

export interface StateCoverage {
  state_code: string;
  total: number;
  with_fees: number;
  pct: number;
}

export interface StateOverviewRow {
  state_code: string;
  name: string;
  district: number | null;
  district_name: string | null;
  total: number;
  with_urls: number;
  with_fees: number;
  missing_url: number;
  url_but_zero: number;
  latest_failed: number;
  extracted_not_published: number;
  pct: number;
}

export interface DiscoveryStatusRow {
  status: string;
  count: number;
}

export interface PipelineOverview {
  total_institutions: number;
  with_url: number;
  with_fees: number;
  source_collection_runs: number;
}

export type AgentStatus = "live" | "stubbed" | "missing" | "blocked";

export interface PipelineStageAgent {
  name: string;
  status: AgentStatus;
  note?: string;
}

export interface PipelineStageSummary {
  id: "scrape" | "discovery" | "extraction" | "review" | "publish";
  label: string;
  one_liner: string;
  current: number;
  current_label: string;
  throughput_24h: number;
  agents: PipelineStageAgent[];
}

export interface PipelineMapData {
  stages: PipelineStageSummary[];
  generated_at: string;
}

export interface OpsJob {
  id: number;
  command: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  triggered_by: string | null;
  error_summary: string | null;
}

export interface JobQueueRow {
  queue: string;
  status: string;
  count: number;
}

export interface IntegrityCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
  count: number;
}

export interface CoverageFunnelData {
  total_institutions: number;
  with_website: number;
  with_fee_url: number;
  with_fees: number;
  with_approved: number;
}

export interface UncategorizedFee {
  fee_name: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    const [row] = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE fee_schedule_url IS NOT NULL)::int AS with_urls,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM published_fee_catalog ef
           WHERE ef.institution_id = ct.id
             AND ef.review_status = 'approved'
        ))::int AS with_fees
      FROM institution_sources ct
      WHERE status = 'active'
        AND COALESCE(document_type, '') NOT IN ('offline', 'no_website')
    `;
    const total = Number(row.total);
    const withUrls = Number(row.with_urls);
    const withFees = Number(row.with_fees);
    return {
      total_institutions: total,
      with_fees: withFees,
      with_urls: withUrls,
      coverage_pct: total > 0 ? Math.round((withFees / total) * 100) : 0,
    };
  } catch (e) {
    console.error("getDashboardStats failed:", e);
    return { total_institutions: 0, with_fees: 0, with_urls: 0, coverage_pct: 0 };
  }
}

export interface DataQualityStats {
  total_with_fees: number;
  good_6plus: number;
  incomplete_1to5: number;
  url_no_fees: number;
  no_url: number;
  freeform_fees: number;
  rejected_fees: number;
  quality_pct: number;
}

export async function getDataQualityStats(): Promise<DataQualityStats> {
  try {
    // Institutions with 6+ fees (credible)
    const [goodRow] = await sql`
      SELECT COUNT(*) as cnt FROM (
        SELECT institution_id FROM published_fee_catalog
        WHERE review_status = 'approved'
        GROUP BY institution_id HAVING COUNT(*) >= 6
      ) sub`;

    // Institutions with 1-5 fees (incomplete)
    const [incompleteRow] = await sql`
      SELECT COUNT(*) as cnt FROM (
        SELECT institution_id FROM published_fee_catalog
        WHERE review_status = 'approved'
        GROUP BY institution_id HAVING COUNT(*) BETWEEN 1 AND 5
      ) sub`;

    // Have URL but no fees
    const [urlNoFeesRow] = await sql`
        SELECT COUNT(*) as cnt FROM institution_sources ct
        WHERE ct.fee_schedule_url IS NOT NULL AND ct.status = 'active'
          AND NOT EXISTS (
          SELECT 1 FROM published_fee_catalog ef
          WHERE ef.institution_id = ct.id
            AND ef.review_status = 'approved'
        )`;

    // No URL at all (addressable)
    const [noUrlRow] = await sql`
      SELECT COUNT(*) as cnt FROM institution_sources ct
      WHERE ct.fee_schedule_url IS NULL AND ct.status = 'active'
        AND ct.website_url IS NOT NULL
        AND (ct.document_type IS NULL OR ct.document_type != 'offline')`;

    // Freeform fees (not in the fee taxonomy)
    const [freeformRow] = await sql`
      SELECT COUNT(*) as cnt FROM published_fee_catalog
      WHERE fee_category NOT IN (
          'overdraft','nsf','wire_domestic_outgoing','wire_domestic_incoming',
          'wire_intl_outgoing','wire_intl_incoming','atm_non_network','atm_international',
          'monthly_maintenance','minimum_balance','dormant_account','account_closing',
          'early_closure','paper_statement','estatement_fee','stop_payment',
          'cashiers_check','money_order','check_printing','check_image','counter_check',
          'check_cashing','certified_check','card_replacement','card_foreign_txn',
          'card_dispute','rush_card','cash_advance','ach_origination','ach_return',
          'od_protection_transfer','od_daily_cap','od_line_of_credit','nsf_daily_cap',
          'continuous_od','deposited_item_return','late_payment','garnishment_levy',
          'legal_process','notary_fee','safe_deposit_box','coin_counting','bill_pay',
          'mobile_deposit','zelle_fee','night_deposit','account_research',
          'account_verification','balance_inquiry','appraisal_fee','loan_origination'
        )
        AND review_status = 'approved'`;

    const [rejectedRow] = await sql`SELECT 0::int as cnt`;

    const good = Number(goodRow.cnt);
    const incomplete = Number(incompleteRow.cnt);
    const total = good + incomplete;

    return {
      total_with_fees: total,
      good_6plus: good,
      incomplete_1to5: incomplete,
      url_no_fees: Number(urlNoFeesRow.cnt),
      no_url: Number(noUrlRow.cnt),
      freeform_fees: Number(freeformRow.cnt),
      rejected_fees: Number(rejectedRow.cnt),
      quality_pct: total > 0 ? Math.round((good / total) * 100) : 0,
    };
  } catch (e) {
    console.error("getDataQualityStats failed:", e);
    return { total_with_fees: 0, good_6plus: 0, incomplete_1to5: 0, url_no_fees: 0, no_url: 0, freeform_fees: 0, rejected_fees: 0, quality_pct: 0 };
  }
}

export async function getRecentCrawlRuns(limit = 10): Promise<RecentCrawlRun[]> {
  try {
    const rows = await sql`
      SELECT
        id, started_at, completed_at, status,
        targets_crawled, targets_succeeded, fees_extracted
      FROM source_collection_runs
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      started_at: toDateStr(r.started_at as string | Date),
      completed_at: toDateStr(r.completed_at as string | Date),
      status: String(r.status),
      targets_crawled: Number(r.targets_crawled),
      targets_succeeded: Number(r.targets_succeeded),
      fees_extracted: Number(r.fees_extracted),
      success_rate:
        Number(r.targets_crawled) > 0
          ? Math.round((Number(r.targets_succeeded) / Number(r.targets_crawled)) * 100)
          : 0,
    }));
  } catch (e) {
    console.error("getRecentCrawlRuns failed:", e);
    return [];
  }
}

export async function getCoverageByState(): Promise<StateCoverage[]> {
  try {
    const rows = await sql`
      SELECT
        t.state_code,
        COUNT(DISTINCT t.id) as total,
        COUNT(DISTINCT e.institution_id) as with_fees
      FROM institution_sources t
      LEFT JOIN published_fee_catalog e
        ON e.institution_id = t.id
       AND e.review_status = 'approved'
      WHERE t.state_code IS NOT NULL
        AND t.status = 'active'
        AND COALESCE(t.document_type, '') NOT IN ('offline', 'no_website')
      GROUP BY t.state_code
      ORDER BY t.state_code
    `;
    return rows.map((r) => {
      const total = Number(r.total);
      const withFees = Number(r.with_fees);
      return {
        state_code: String(r.state_code),
        total,
        with_fees: withFees,
        pct: total > 0 ? Math.round((withFees / total) * 100) : 0,
      };
    });
  } catch (e) {
    console.error("getCoverageByState failed:", e);
    return [];
  }
}

export async function getStateOverview(): Promise<StateOverviewRow[]> {
  try {
    const rows = await sql`
      WITH fee_counts AS (
        SELECT institution_id, COUNT(*) FILTER (WHERE review_status = 'approved')::int AS published_fee_count
        FROM published_fee_catalog
        GROUP BY institution_id
      ),
      latest_docs AS (
        SELECT DISTINCT ON (institution_id)
          institution_id,
          status AS latest_source_status,
          COALESCE(fees_extracted, 0)::int AS latest_extracted_fee_count
        FROM source_documents
        ORDER BY institution_id, crawled_at DESC NULLS LAST, id DESC
      )
      SELECT
        ct.state_code,
        COUNT(DISTINCT ct.id)::int AS total,
        COUNT(DISTINCT CASE
          WHEN ct.fee_schedule_url IS NOT NULL AND btrim(ct.fee_schedule_url) <> '' THEN ct.id
        END)::int AS with_urls,
        COUNT(DISTINCT CASE
          WHEN COALESCE(fc.published_fee_count, 0) > 0 THEN ct.id
        END)::int AS with_fees,
        COUNT(DISTINCT CASE
          WHEN ct.fee_schedule_url IS NULL OR btrim(ct.fee_schedule_url) = '' THEN ct.id
        END)::int AS missing_url,
        COUNT(DISTINCT CASE
          WHEN ct.fee_schedule_url IS NOT NULL
            AND btrim(ct.fee_schedule_url) <> ''
            AND COALESCE(fc.published_fee_count, 0) = 0
          THEN ct.id
        END)::int AS url_but_zero,
        COUNT(DISTINCT CASE
          WHEN ld.latest_source_status = 'failed' THEN ct.id
        END)::int AS latest_failed,
        COUNT(DISTINCT CASE
          WHEN ld.latest_source_status = 'success'
            AND COALESCE(ld.latest_extracted_fee_count, 0) > 0
            AND COALESCE(fc.published_fee_count, 0) = 0
          THEN ct.id
        END)::int AS extracted_not_published
      FROM institution_sources ct
      LEFT JOIN fee_counts fc ON fc.institution_id = ct.id
      LEFT JOIN latest_docs ld ON ld.institution_id = ct.id
      WHERE ct.state_code IS NOT NULL
        AND btrim(ct.state_code) <> ''
      GROUP BY ct.state_code
      ORDER BY ct.state_code
    `;

    const byCode = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      byCode.set(String(row.state_code).toUpperCase(), row);
    }

    const codes = [
      ...new Set([
        ...Object.keys(STATE_NAMES),
        ...rows.map((row) => String(row.state_code).toUpperCase()),
      ]),
    ].sort((a, b) => a.localeCompare(b));

    return codes.map((code) => {
      const row = byCode.get(code);
      const total = Number(row?.total ?? 0);
      const withFees = Number(row?.with_fees ?? 0);
      const district = STATE_TO_DISTRICT[code] ?? null;
      return {
        state_code: code,
        name: STATE_NAMES[code] ?? code,
        district,
        district_name: district ? DISTRICT_NAMES[district] ?? `District ${district}` : null,
        total,
        with_urls: Number(row?.with_urls ?? 0),
        with_fees: withFees,
        missing_url: Number(row?.missing_url ?? 0),
        url_but_zero: Number(row?.url_but_zero ?? 0),
        latest_failed: Number(row?.latest_failed ?? 0),
        extracted_not_published: Number(row?.extracted_not_published ?? 0),
        pct: total > 0 ? Math.round((withFees / total) * 100) : 0,
      };
    });
  } catch (e) {
    console.error("getStateOverview failed:", e);
    return [];
  }
}

export async function getDiscoveryStatus(): Promise<DiscoveryStatusRow[]> {
  try {
    const rows = await sql`
      SELECT status, COUNT(*) as cnt
      FROM agent_runs
      WHERE run_kind IN ('workflow', 'workflow_lane', 'report', 'manual_repair', 'dry_run')
      GROUP BY status
      ORDER BY cnt DESC
    `;
    return rows.map((r) => ({
      status: String(r.status),
      count: Number(r.cnt),
    }));
  } catch (e) {
    console.error("getDiscoveryStatus failed:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function getPipelineMap(): Promise<PipelineMapData> {
  const stages: PipelineStageSummary[] = [
    {
      id: "scrape",
      label: "Scrape",
      one_liner: "Fetch raw HTML/PDF from institution fee-schedule URLs.",
      current: 0,
      current_label: "crawl targets",
      throughput_24h: 0,
      agents: [
        { name: "Magellan fetch", status: "live", note: "TypeScript agentic worker" },
      ],
    },
    {
      id: "discovery",
      label: "Discovery",
      one_liner: "Find the correct fee_schedule_url for each institution.",
      current: 0,
      current_label: "urls known",
      throughput_24h: 0,
      agents: [
        { name: "Magellan", status: "live", note: "5-rung ladder; shipped v1" },
      ],
    },
    {
      id: "extraction",
      label: "Extraction",
      one_liner: "Parse source text/PDF into raw fee observations.",
      current: 0,
      current_label: "raw observations",
      throughput_24h: 0,
      agents: [
        { name: "Rosetta", status: "live", note: "normalize source text before extraction" },
        { name: "Knox extract", status: "live", note: "conservative raw fee observations" },
      ],
    },
    {
      id: "review",
      label: "Review",
      one_liner: "Classify, score confidence, and verify raw observations.",
      current: 0,
      current_label: "verified observations",
      throughput_24h: 0,
      agents: [
        { name: "Darwin", status: "live", note: "verify canonical-hinted raw rows" },
        { name: "Knox decisions", status: "live", note: "anomaly-only rejection review" },
      ],
    },
    {
      id: "publish",
      label: "Publish",
      one_liner: "Adversarial handshake and promote to published records.",
      current: 0,
      current_label: "published records",
      throughput_24h: 0,
      agents: [
        { name: "Hamilton publish", status: "live", note: "promote verified rows into Tier-3 ledger" },
      ],
    },
  ];

  try {
    // Scrape: total crawl targets + source_collection_runs in last 24h
    const [scrapeNow] = await sql`SELECT COUNT(*)::int AS n FROM institution_sources`;
    const [scrape24h] = await sql`
      SELECT COUNT(*)::int AS n FROM source_collection_runs WHERE started_at > NOW() - INTERVAL '24 hours'
    `;
    stages[0].current = Number(scrapeNow?.n ?? 0);
    stages[0].throughput_24h = Number(scrape24h?.n ?? 0);

    // Discovery: targets with fee_schedule_url known
    const [discoveryNow] = await sql`
      SELECT COUNT(*)::int AS n FROM institution_sources WHERE fee_schedule_url IS NOT NULL
    `;
    const [discovery24h] = await sql`
      SELECT COUNT(*)::int AS n FROM institution_sources
       WHERE fee_schedule_url IS NOT NULL AND discovered_at > NOW() - INTERVAL '24 hours'
    `;
    stages[1].current = Number(discoveryNow?.n ?? 0);
    stages[1].throughput_24h = Number(discovery24h?.n ?? 0);

    // Extraction: raw fee observations (cumulative) + last 24h
    const [extractionNow] = await sql`SELECT COUNT(*)::int AS n FROM raw_fee_observations`;
    const [extraction24h] = await sql`
      SELECT COUNT(*)::int AS n FROM raw_fee_observations WHERE created_at > NOW() - INTERVAL '24 hours'
    `;
    stages[2].current = Number(extractionNow?.n ?? 0);
    stages[2].throughput_24h = Number(extraction24h?.n ?? 0);

    // Review: verified fee observations + last 24h
    const [reviewNow] = await sql`SELECT COUNT(*)::int AS n FROM verified_fee_observations`;
    const [review24h] = await sql`
      SELECT COUNT(*)::int AS n FROM verified_fee_observations WHERE created_at > NOW() - INTERVAL '24 hours'
    `;
    stages[3].current = Number(reviewNow?.n ?? 0);
    stages[3].throughput_24h = Number(review24h?.n ?? 0);

    // Publish: published records + last 24h. Filter out rolled-back rows;
    // rolled_back_at IS NULL is the live subset used downstream.
    const [publishNow] = await sql`
      SELECT COUNT(*)::int AS n FROM published_fee_records WHERE rolled_back_at IS NULL
    `;
    const [publish24h] = await sql`
      SELECT COUNT(*)::int AS n FROM published_fee_records
       WHERE rolled_back_at IS NULL AND published_at > NOW() - INTERVAL '24 hours'
    `;
    stages[4].current = Number(publishNow?.n ?? 0);
    stages[4].throughput_24h = Number(publish24h?.n ?? 0);
  } catch (e) {
    console.error("getPipelineMap failed:", e);
  }

  return { stages, generated_at: new Date().toISOString() };
}

export async function getPipelineOverview(): Promise<PipelineOverview> {
  try {
    const [totalRow] = await sql`SELECT COUNT(*) as cnt FROM institution_sources`;
    const [urlRow] = await sql`SELECT COUNT(*) as cnt FROM institution_sources WHERE fee_schedule_url IS NOT NULL`;
    const [feeRow] = await sql`SELECT COUNT(DISTINCT institution_id) as cnt FROM published_fee_catalog`;
    const [runRow] = await sql`SELECT COUNT(*) as cnt FROM source_collection_runs`;
    return {
      total_institutions: Number(totalRow.cnt),
      with_url: Number(urlRow.cnt),
      with_fees: Number(feeRow.cnt),
      source_collection_runs: Number(runRow.cnt),
    };
  } catch (e) {
    console.error("getPipelineOverview failed:", e);
    return { total_institutions: 0, with_url: 0, with_fees: 0, source_collection_runs: 0 };
  }
}

// ---------------------------------------------------------------------------
// Job freshness / cron health (Reliability Roadmap #1)
// ---------------------------------------------------------------------------

export interface JobFreshness {
  job_name: string;
  display_name: string;
  source: "agent_runs" | "agent_run_steps" | "report_jobs";
  last_completed_at: string | null;
  hours_since: number | null;
  expected_within_hours: number;
  status: "ok" | "failed" | "stale" | "never_ran";
}

export interface JobHealthSummary {
  generated_at: string;
  stale_count: number;
  failed_count: number;
  ok_count: number;
  never_ran_count: number;
  jobs: JobFreshness[];
}

// The scheduled work the agentic backend runs, read from the run ledger it writes.
// (The old workers_last_run markers were written by the retired Modal workers and
// stopped in August, so reading them reported live jobs as overdue.)
const JOB_INVENTORY: Array<
  Pick<JobFreshness, "job_name" | "display_name" | "source" | "expected_within_hours">
> = [
  { job_name: "atlas_state_lanes", display_name: "Atlas state lanes",                 source: "agent_runs",      expected_within_hours: 26 },
  { job_name: "agent_executor",    display_name: "Agent tick (every 5 minutes)",      source: "agent_run_steps", expected_within_hours: 1 },
  { job_name: "registry_sync",     display_name: "Magellan registry sync",            source: "agent_runs",      expected_within_hours: 26 },
  { job_name: "monthly_pulse",     display_name: "Hamilton monthly pulse (3rd of the month)", source: "report_jobs", expected_within_hours: 24 * 35 },
];

interface JobMarker {
  completedAt: Date | null;
  failed: boolean;
  // False when there is nothing for the job to do, so a quiet job is not overdue.
  hasWork: boolean;
}

async function readJobMarkers(): Promise<Record<string, JobMarker>> {
  const [row] = await sql`
    SELECT
      (SELECT MAX(completed_at) FROM agent_runs
        WHERE agent_name = 'atlas' AND run_kind = 'workflow_lane' AND status = 'completed') AS atlas_lane_done,
      (SELECT MAX(completed_at) FROM agent_run_steps
        WHERE status IN ('completed', 'failed', 'skipped')) AS step_done,
      EXISTS (SELECT 1 FROM agent_run_steps WHERE status = 'queued') AS steps_queued,
      (SELECT MAX(completed_at) FROM agent_runs
        WHERE triggered_by = 'api.admin.registry.tick' AND status = 'completed') AS registry_done,
      (SELECT MAX(completed_at) FROM report_jobs
        WHERE report_type = 'monthly_pulse' AND status = 'complete') AS pulse_done,
      (SELECT status FROM report_jobs
        WHERE report_type = 'monthly_pulse' ORDER BY created_at DESC LIMIT 1) AS pulse_latest_status
  `;
  const at = (value: unknown) => (value ? new Date(value as string | Date) : null);
  return {
    atlas_state_lanes: { completedAt: at(row?.atlas_lane_done), failed: false, hasWork: true },
    agent_executor: { completedAt: at(row?.step_done), failed: false, hasWork: Boolean(row?.steps_queued) },
    registry_sync: { completedAt: at(row?.registry_done), failed: false, hasWork: true },
    monthly_pulse: {
      completedAt: at(row?.pulse_done),
      failed: row?.pulse_latest_status === "failed",
      hasWork: true,
    },
  };
}

function classifyJobFreshness(
  marker: JobMarker | undefined,
  expectedWithinHours: number,
  now: number,
): { status: JobFreshness["status"]; hoursSince: number | null } {
  const lastCompleted = marker?.completedAt ?? null;
  const hoursSince = lastCompleted ? (now - lastCompleted.getTime()) / (1000 * 60 * 60) : null;
  if (marker?.failed) return { status: "failed", hoursSince };
  if (hoursSince === null) return { status: marker && !marker.hasWork ? "ok" : "never_ran", hoursSince };
  if (hoursSince > expectedWithinHours && marker?.hasWork !== false) return { status: "stale", hoursSince };
  return { status: "ok", hoursSince };
}

export async function getJobFreshness(): Promise<JobHealthSummary> {
  const jobs: JobFreshness[] = [];

  let markers: Record<string, JobMarker> = {};
  let markersRead = true;
  try {
    markers = await readJobMarkers();
  } catch (e) {
    markersRead = false;
    console.error("getJobFreshness marker read failed:", e);
  }

  const now = Date.now();
  for (const spec of JOB_INVENTORY) {
    const marker = markers[spec.job_name];
    const lastCompleted = marker?.completedAt ?? null;
    // A failed read is not evidence a job stopped; report nothing rather than a false alarm.
    const { status, hoursSince } = markersRead
      ? classifyJobFreshness(marker, spec.expected_within_hours, now)
      : { status: "ok" as const, hoursSince: null };

    jobs.push({
      job_name: spec.job_name,
      display_name: spec.display_name,
      source: spec.source,
      last_completed_at: lastCompleted ? toDateStr(lastCompleted) : null,
      hours_since: hoursSince !== null ? Math.round(hoursSince * 10) / 10 : null,
      expected_within_hours: spec.expected_within_hours,
      status,
    });
  }

  return {
    generated_at: new Date().toISOString(),
    stale_count: jobs.filter((j) => j.status === "stale").length,
    failed_count: jobs.filter((j) => j.status === "failed").length,
    ok_count: jobs.filter((j) => j.status === "ok").length,
    never_ran_count: jobs.filter((j) => j.status === "never_ran").length,
    jobs,
  };
}

// Reliability Roadmap #11 — URL freshness surface.
// Stale URLs are surfaced by the admin data-quality checks and agentic run queue.
// by setting failure_reason='url_stale'. This helper counts them per state
// so /admin/coverage can expose the pool that is not being rechecked.
export interface UrlFreshnessStats {
  total_with_url: number;
  stale_count: number;
  stale_pct: number;
  last_revalidated_at: string | null;
}

export async function getUrlFreshnessStats(): Promise<UrlFreshnessStats> {
  try {
    const [row] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE fee_schedule_url IS NOT NULL)::int AS total_with_url,
        COUNT(*) FILTER (WHERE failure_reason = 'url_stale')::int AS stale_count,
        MAX(failure_reason_updated_at) FILTER (WHERE failure_reason = 'url_stale') AS last_revalidated_at
      FROM institution_sources
    `;
    const total = Number(row?.total_with_url ?? 0);
    const stale = Number(row?.stale_count ?? 0);
    const lastAt = row?.last_revalidated_at as Date | null;
    return {
      total_with_url: total,
      stale_count: stale,
      stale_pct: total > 0 ? Math.round((stale / total) * 1000) / 10 : 0,
      last_revalidated_at: lastAt ? toDateStr(lastAt) : null,
    };
  } catch (e) {
    console.error("getUrlFreshnessStats failed:", e);
    return { total_with_url: 0, stale_count: 0, stale_pct: 0, last_revalidated_at: null };
  }
}

// Reliability Roadmap #13 — classification history read helper. The migration
// at docs/archive/supabase-migrations-2026-08-16/20260418_classification_history.sql records every
// canonical_fee_key or variant_type transition. This helper pulls the log for
// a single fee; the /admin/fees/[id]/history page renders it.
export interface ClassificationChange {
  id: number;
  old_canonical_key: string | null;
  new_canonical_key: string;
  old_variant_type: string | null;
  new_variant_type: string | null;
  changed_at: string;
  changed_by: string | null;
}

export async function getClassificationHistory(
  feeVerifiedId: number,
): Promise<ClassificationChange[]> {
  try {
    const rows = await sql`
      SELECT id, old_canonical_key, new_canonical_key,
             old_variant_type, new_variant_type, changed_at, changed_by
      FROM classification_history
      WHERE fee_verified_id = ${feeVerifiedId}
      ORDER BY changed_at DESC
      LIMIT 100
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      old_canonical_key: r.old_canonical_key ? String(r.old_canonical_key) : null,
      new_canonical_key: String(r.new_canonical_key),
      old_variant_type: r.old_variant_type ? String(r.old_variant_type) : null,
      new_variant_type: r.new_variant_type ? String(r.new_variant_type) : null,
      changed_at: toDateStr(r.changed_at as string | Date),
      changed_by: r.changed_by ? String(r.changed_by) : null,
    }));
  } catch (e) {
    console.error("getClassificationHistory failed:", e);
    return [];
  }
}

// Reliability Roadmap #14 — surface how many institutions are in each
// backoff tier so humans can see where Magellan is choosing not to retry and
// why. Exposed on /admin/coverage so dormant URLs are visible, not silently
// ignored.
export interface CollectionHealthTiers {
  healthy: number;
  short_backoff: number;
  long_backoff: number;
  dormant: number;
  total_active: number;
}

export async function getCollectionHealthTiers(): Promise<CollectionHealthTiers> {
  try {
    const [row] = await sql`
      SELECT
        COUNT(*) FILTER (
          WHERE status != 'dormant' AND consecutive_failures < 3
        )::int AS healthy,
        COUNT(*) FILTER (
          WHERE status != 'dormant' AND consecutive_failures BETWEEN 3 AND 6
        )::int AS short_backoff,
        COUNT(*) FILTER (
          WHERE status != 'dormant' AND consecutive_failures BETWEEN 7 AND 13
        )::int AS long_backoff,
        COUNT(*) FILTER (WHERE status = 'dormant')::int AS dormant,
        COUNT(*)::int AS total_active
      FROM institution_sources
      WHERE fee_schedule_url IS NOT NULL
    `;
    return {
      healthy: Number(row?.healthy ?? 0),
      short_backoff: Number(row?.short_backoff ?? 0),
      long_backoff: Number(row?.long_backoff ?? 0),
      dormant: Number(row?.dormant ?? 0),
      total_active: Number(row?.total_active ?? 0),
    };
  } catch (e) {
    console.error("getCollectionHealthTiers failed:", e);
    return { healthy: 0, short_backoff: 0, long_backoff: 0, dormant: 0, total_active: 0 };
  }
}

export async function getRecentJobs(limit = 20): Promise<OpsJob[]> {
  try {
    const rows = await sql`
      SELECT id, COALESCE(title, run_kind) AS command, status,
             started_at AS created_at, started_at, completed_at,
             triggered_by, error_summary
      FROM agent_runs
      WHERE run_kind IN ('workflow', 'workflow_lane', 'report', 'manual_repair', 'dry_run')
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      command: String(r.command),
      status: String(r.status),
      created_at: toDateStr(r.created_at as string | Date),
      started_at: r.started_at ? toDateStr(r.started_at as string | Date) : null,
      completed_at: r.completed_at ? toDateStr(r.completed_at as string | Date) : null,
      triggered_by: r.triggered_by ? String(r.triggered_by) : null,
      error_summary: r.error_summary ? String(r.error_summary) : null,
    }));
  } catch (e) {
    console.error("getRecentJobs failed:", e);
    return [];
  }
}

export async function getJobQueueStatus(): Promise<JobQueueRow[]> {
  try {
    const rows = await sql`
      SELECT
        COALESCE(agent_name, 'unknown') as queue,
        status,
        COUNT(*) as cnt
      FROM agent_runs
      WHERE run_kind IN ('workflow', 'workflow_lane', 'report', 'manual_repair', 'dry_run')
      GROUP BY agent_name, status
      ORDER BY agent_name, status
    `;
    return rows.map((r) => ({
      queue: String(r.queue),
      status: String(r.status),
      count: Number(r.cnt),
    }));
  } catch (e) {
    console.error("getJobQueueStatus failed:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Data Quality
// ---------------------------------------------------------------------------

export async function getIntegrityChecks(): Promise<IntegrityCheck[]> {
  const checks: IntegrityCheck[] = [];

  // 1. Orphaned fees
  try {
    const [row] = await sql`
      SELECT COUNT(*) as cnt
      FROM published_fee_catalog ef
      LEFT JOIN institution_sources ct ON ef.institution_id = ct.id
      WHERE ct.id IS NULL
    `;
    const cnt = Number(row.cnt);
    checks.push({
      name: "No orphaned fees",
      status: cnt === 0 ? "pass" : "fail",
      detail: cnt === 0 ? "All fees linked to valid institutions" : `${cnt} fees with missing crawl_target`,
      count: cnt,
    });
  } catch {
    checks.push({ name: "No orphaned fees", status: "warn", detail: "Check failed", count: -1 });
  }

  // 2. Negative amounts
  try {
    const [row] = await sql`
      SELECT COUNT(*) as cnt FROM published_fee_catalog
      WHERE amount < 0
    `;
    const cnt = Number(row.cnt);
    checks.push({
      name: "No negative amounts",
      status: cnt === 0 ? "pass" : "fail",
      detail: cnt === 0 ? "All fee amounts are non-negative" : `${cnt} fees with negative amounts`,
      count: cnt,
    });
  } catch {
    checks.push({ name: "No negative amounts", status: "warn", detail: "Check failed", count: -1 });
  }

  // 3. Extreme amounts (> $10,000)
  try {
    const [row] = await sql`
      SELECT COUNT(*) as cnt FROM published_fee_catalog
      WHERE amount > 10000
    `;
    const cnt = Number(row.cnt);
    checks.push({
      name: "No extreme amounts (> $10k)",
      status: cnt === 0 ? "pass" : "warn",
      detail: cnt === 0 ? "No suspiciously large fee amounts" : `${cnt} fees exceed $10,000`,
      count: cnt,
    });
  } catch {
    checks.push({ name: "No extreme amounts (> $10k)", status: "warn", detail: "Check failed", count: -1 });
  }

  // 4. Duplicate institution names
  try {
    const [row] = await sql`
      SELECT COUNT(*) as cnt FROM (
        SELECT institution_name FROM institution_sources
        GROUP BY institution_name HAVING COUNT(*) > 1
      ) sub
    `;
    const cnt = Number(row.cnt);
    checks.push({
      name: "No duplicate institution names",
      status: cnt === 0 ? "pass" : "warn",
      detail: cnt === 0 ? "All institution names are unique" : `${cnt} institution names appear more than once`,
      count: cnt,
    });
  } catch {
    checks.push({ name: "No duplicate institution names", status: "warn", detail: "Check failed", count: -1 });
  }

  // 5. Uncategorized fees
  try {
    const [row] = await sql`
      SELECT COUNT(*) as cnt FROM published_fee_catalog
      WHERE fee_category IS NULL
    `;
    const cnt = Number(row.cnt);
    checks.push({
      name: "All fees categorized",
      status: cnt === 0 ? "pass" : cnt < 50 ? "warn" : "fail",
      detail: cnt === 0 ? "Every non-rejected fee has a category" : `${cnt} fees missing category`,
      count: cnt,
    });
  } catch {
    checks.push({ name: "All fees categorized", status: "warn", detail: "Check failed", count: -1 });
  }

  // 6. Null amounts
  try {
    const [row] = await sql`
      SELECT COUNT(*) as cnt FROM published_fee_catalog
      WHERE amount IS NULL
        AND LOWER(fee_name) NOT LIKE '%free%'
        AND LOWER(fee_name) NOT LIKE '%waived%'
    `;
    const cnt = Number(row.cnt);
    checks.push({
      name: "All fees have amounts",
      status: cnt === 0 ? "pass" : cnt < 100 ? "warn" : "fail",
      detail: cnt === 0 ? "Every non-free fee has a dollar amount" : `${cnt} fees missing amount`,
      count: cnt,
    });
  } catch {
    checks.push({ name: "All fees have amounts", status: "warn", detail: "Check failed", count: -1 });
  }

  // 7. Stale institutions
  try {
    const [row] = await sql`
      SELECT COUNT(*) as cnt FROM institution_sources
      WHERE last_crawl_at < NOW() - INTERVAL '90 days' OR last_crawl_at IS NULL
    `;
    const cnt = Number(row.cnt);
    checks.push({
      name: "Data freshness (90-day threshold)",
      status: cnt === 0 ? "pass" : "warn",
      detail: cnt === 0 ? "All institutions crawled within 90 days" : `${cnt} institutions not crawled in 90+ days`,
      count: cnt,
    });
  } catch {
    checks.push({ name: "Data freshness (90-day threshold)", status: "warn", detail: "Check failed", count: -1 });
  }

  // 8. Missing financials
  try {
    const [row] = await sql`
      SELECT COUNT(*) as cnt
      FROM institution_sources ct
      LEFT JOIN institution_financial_records ifin ON ct.id = ifin.institution_id
      WHERE ifin.id IS NULL
    `;
    const cnt = Number(row.cnt);
    checks.push({
      name: "Financial data linked",
      status: cnt === 0 ? "pass" : "warn",
      detail: cnt === 0 ? "All institutions have financial data" : `${cnt} institutions missing financials`,
      count: cnt,
    });
  } catch {
    checks.push({ name: "Financial data linked", status: "warn", detail: "Check failed", count: -1 });
  }

  // 9. Stale agent runs
  try {
    const [row] = await sql`
      SELECT COUNT(*) as cnt FROM agent_runs
      WHERE status = 'running'
        AND started_at < NOW() - INTERVAL '2 hours'
        AND run_kind IN ('workflow', 'workflow_lane', 'report', 'manual_repair', 'dry_run')
    `;
    const cnt = Number(row.cnt);
    checks.push({
      name: "No stale agent runs",
      status: cnt === 0 ? "pass" : "fail",
      detail: cnt === 0 ? "No runs stuck in running state" : `${cnt} runs running for 2+ hours`,
      count: cnt,
    });
  } catch {
    checks.push({ name: "No stale agent runs", status: "warn", detail: "Check failed", count: -1 });
  }

  // 10. Invalid state codes
  try {
    const [row] = await sql`
      SELECT COUNT(*) as cnt FROM institution_sources
      WHERE state_code IS NOT NULL AND LENGTH(state_code) != 2
    `;
    const cnt = Number(row.cnt);
    checks.push({
      name: "Valid state codes",
      status: cnt === 0 ? "pass" : "fail",
      detail: cnt === 0 ? "All state codes are valid format" : `${cnt} institutions with invalid state codes`,
      count: cnt,
    });
  } catch {
    checks.push({ name: "Valid state codes", status: "warn", detail: "Check failed", count: -1 });
  }

  return checks;
}

export async function getCoverageFunnelData(): Promise<CoverageFunnelData> {
  try {
    const [totalRow] = await sql`SELECT COUNT(*) as cnt FROM institution_sources`;
    const [webRow] = await sql`SELECT COUNT(*) as cnt FROM institution_sources WHERE website_url IS NOT NULL`;
    const [urlRow] = await sql`SELECT COUNT(*) as cnt FROM institution_sources WHERE fee_schedule_url IS NOT NULL`;
    const [feeRow] = await sql`SELECT COUNT(DISTINCT institution_id) as cnt FROM published_fee_catalog`;
    const [appRow] = await sql`SELECT COUNT(DISTINCT institution_id) as cnt FROM published_fee_catalog`;
    return {
      total_institutions: Number(totalRow.cnt),
      with_website: Number(webRow.cnt),
      with_fee_url: Number(urlRow.cnt),
      with_fees: Number(feeRow.cnt),
      with_approved: Number(appRow.cnt),
    };
  } catch (e) {
    console.error("getCoverageFunnelData failed:", e);
    return { total_institutions: 0, with_website: 0, with_fee_url: 0, with_fees: 0, with_approved: 0 };
  }
}

export async function getUncategorizedTopFees(limit = 20): Promise<UncategorizedFee[]> {
  try {
    const rows = await sql`
      SELECT fee_name, COUNT(*) as cnt
      FROM published_fee_catalog
      WHERE fee_category IS NULL
      GROUP BY fee_name
      ORDER BY cnt DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      fee_name: String(r.fee_name),
      count: Number(r.cnt),
    }));
  } catch (e) {
    console.error("getUncategorizedTopFees failed:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
export interface FeeCatalogRow {
  fee_category: string;
  display_name: string;
  count: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

// ---------------------------------------------------------------------------
// Fees Catalog
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Operations (Ops)
// ---------------------------------------------------------------------------

export interface OpsJobRow {
  id: number;
  command: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  duration_sec: number | null;
  result_summary: string | null;
  triggered_by: string | null;
  error_summary: string | null;
}

export async function getOpsJobs(limit = 50): Promise<OpsJobRow[]> {
  try {
    const rows = await sql`
      SELECT id, COALESCE(title, run_kind) AS command, status, started_at, completed_at,
             CASE WHEN started_at IS NOT NULL AND completed_at IS NOT NULL
               THEN EXTRACT(EPOCH FROM (completed_at - started_at))::int
               ELSE NULL END as duration_sec,
             summary AS result_summary, triggered_by, error_summary
      FROM agent_runs
      WHERE run_kind IN ('workflow', 'workflow_lane', 'report', 'manual_repair', 'dry_run')
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      command: String(r.command),
      status: String(r.status),
      started_at: r.started_at ? toDateStr(r.started_at as string | Date) : null,
      completed_at: r.completed_at ? toDateStr(r.completed_at as string | Date) : null,
      duration_sec: r.duration_sec != null ? Number(r.duration_sec) : null,
      result_summary: r.result_summary ? String(r.result_summary) : null,
      triggered_by: r.triggered_by ? String(r.triggered_by) : null,
      error_summary: r.error_summary ? String(r.error_summary) : null,
    }));
  } catch (e) {
    console.error("getOpsJobs failed:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Institutions
// ---------------------------------------------------------------------------

export interface InstitutionRow {
  id: number;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  charter_type: string | null;
  asset_size: number | null;
  source: string | null;
  cert_number: string | null;
  rssd_id: string | null;
  lei: string | null;
  website_url: string | null;
  fee_schedule_url: string | null;
  document_type: string | null;
  has_fee_url: boolean;
  fee_count: number;
  published_fee_count: number;
  provisional_fee_count: number;
  visible_fee_count: number;
  latest_source_status: string | null;
  latest_extracted_fee_count: number;
  latest_source_error: string | null;
  latest_source_collected_at: string | null;
  last_agent_failure_class: AgentFailureClass;
  quality_status: InstitutionQualityStatus;
  quality_signals: InstitutionQualitySignal[];
  recommended_action: string;
}

export interface SearchInstitutionsResult {
  institutions: InstitutionRow[];
  total: number;
}

// Allowlist of sortable columns — SQL identifiers come straight off the URL
// query string, so they MUST be gated here. Each entry maps to a safe ORDER BY
// fragment already bound to the query's table aliases.
const INSTITUTIONS_SORT_SQL: Record<string, string> = {
  institution_name: "ct.institution_name",
  state_code: "ct.state_code",
  charter_type: "ct.charter_type",
  asset_size: "ct.asset_size",
  has_fee_url: "(ct.fee_schedule_url IS NOT NULL)",
  fee_count: "(COALESCE(fc.published_fee_count, 0) + COALESCE(fc.catalog_provisional_fee_count, 0) + COALESCE(vuc.verified_unpublished_fee_count, 0))",
};

const INSTITUTION_QUALITY_CTE = `
  WITH fee_counts AS (
    SELECT
      institution_id,
      COUNT(*) FILTER (WHERE review_status = 'approved')::int AS published_fee_count,
      COUNT(*) FILTER (WHERE review_status <> 'approved' AND review_status <> 'rejected')::int AS catalog_provisional_fee_count
    FROM published_fee_catalog
    GROUP BY institution_id
  ),
  verified_unpublished_counts AS (
    SELECT fv.institution_id, COUNT(*)::int AS verified_unpublished_fee_count
    FROM verified_fee_observations fv
    WHERE fv.review_status <> 'rejected'
      AND NOT EXISTS (
        SELECT 1
        FROM published_fee_catalog pfc
        WHERE pfc.fee_verified_id = fv.fee_verified_id
          AND pfc.review_status <> 'rejected'
      )
    GROUP BY fv.institution_id
  ),
  latest_docs AS (
    SELECT DISTINCT ON (institution_id)
      institution_id,
      status AS latest_source_status,
      COALESCE(fees_extracted, 0)::int AS latest_extracted_fee_count,
      error_message AS latest_source_error,
      crawled_at AS latest_source_collected_at
    FROM source_documents
    ORDER BY institution_id, crawled_at DESC NULLS LAST, id DESC
  )
`;

const HAS_FEE_URL_SQL = "(ct.fee_schedule_url IS NOT NULL AND btrim(ct.fee_schedule_url) <> '')";
const ZERO_PUBLISHED_SQL = "COALESCE(fc.published_fee_count, 0) = 0";
const PROVIDER_FAILURE_SQL = "(ld.latest_source_error ILIKE '%credit balance is too low%')";
const IDENTITY_GAP_SQL = `(
  ct.source IS NULL OR btrim(ct.source) = ''
  OR ct.cert_number IS NULL OR btrim(ct.cert_number) = ''
  OR ct.website_url IS NULL OR btrim(ct.website_url) = ''
)`;
const SUSPECT_FEE_URL_SQL = `(
  lower(COALESCE(ct.fee_schedule_url, '')) LIKE '%/ir/news/%'
  OR lower(COALESCE(ct.fee_schedule_url, '')) LIKE '%press%release%'
  OR lower(COALESCE(ct.fee_schedule_url, '')) LIKE '%newsroom%'
  OR lower(COALESCE(ct.fee_schedule_url, '')) LIKE '%page-not-found%'
  OR lower(COALESCE(ct.fee_schedule_url, '')) LIKE '%pagenotfound%'
  OR lower(COALESCE(ct.fee_schedule_url, '')) LIKE '%shareholder%rights%'
  OR lower(COALESCE(ct.fee_schedule_url, '')) LIKE '%credit-card-agreements%'
  OR lower(COALESCE(ct.fee_schedule_url, '')) LIKE '%wrap-fee-agreement%'
  OR lower(COALESCE(ct.fee_schedule_url, '')) LIKE '%advice/understanding-banking-fees%'
)`;

function institutionQualityWhere(filter?: InstitutionQualityFilter): string | null {
  switch (filter) {
    case "needs_review":
      return `(
        ${SUSPECT_FEE_URL_SQL}
        OR (${HAS_FEE_URL_SQL} AND ${ZERO_PUBLISHED_SQL})
        OR (ld.latest_source_status = 'success' AND COALESCE(ld.latest_extracted_fee_count, 0) > 0 AND ${ZERO_PUBLISHED_SQL})
        OR ld.latest_source_status = 'failed'
        OR ${PROVIDER_FAILURE_SQL}
        OR ${IDENTITY_GAP_SQL}
      )`;
    case "url_but_zero_fees":
      return `(${HAS_FEE_URL_SQL} AND ${ZERO_PUBLISHED_SQL})`;
    case "extracted_not_published":
      return `(ld.latest_source_status = 'success' AND COALESCE(ld.latest_extracted_fee_count, 0) > 0 AND ${ZERO_PUBLISHED_SQL})`;
    case "latest_failed":
      return `(ld.latest_source_status = 'failed')`;
    case "missing_url":
      return `(NOT ${HAS_FEE_URL_SQL})`;
    case "verified":
      return `(
        COALESCE(fc.published_fee_count, 0) > 0
        AND NOT ${SUSPECT_FEE_URL_SQL}
        AND COALESCE(ld.latest_source_status, '') <> 'failed'
        AND NOT ${PROVIDER_FAILURE_SQL}
        AND NOT ${IDENTITY_GAP_SQL}
      )`;
    default:
      return null;
  }
}

export async function searchInstitutions(
  query: string | undefined,
  page: number,
  limit: number,
  sort?: string,
  dir?: "asc" | "desc",
  quality?: InstitutionQualityFilter,
): Promise<SearchInstitutionsResult> {
  try {
    const offset = (page - 1) * limit;

    const sortCol = sort && INSTITUTIONS_SORT_SQL[sort]
      ? INSTITUTIONS_SORT_SQL[sort]
      : "ct.asset_size";
    const sortDir = dir === "asc" ? "ASC" : "DESC";
    const orderBy = `${sortCol} ${sortDir} NULLS LAST`;

    const params: (string | number)[] = [];
    const whereParts: string[] = [];
    if (query && query.trim()) {
      const pattern = `%${query.trim()}%`;
      params.push(pattern);
      whereParts.push(`ct.institution_name ILIKE $${params.length}`);
    }

    const qualityWhere = institutionQualityWhere(quality);
    if (qualityWhere) whereParts.push(qualityWhere);

    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const countResult = await sql.unsafe(
      `
      ${INSTITUTION_QUALITY_CTE}
      SELECT COUNT(*) as cnt
      FROM institution_sources ct
      LEFT JOIN fee_counts fc ON fc.institution_id = ct.id
      LEFT JOIN verified_unpublished_counts vuc ON vuc.institution_id = ct.id
      LEFT JOIN latest_docs ld ON ld.institution_id = ct.id
      ${where}
      `,
      params,
    );
    const total = Number(countResult[0].cnt);

    const rows = await sql.unsafe(
      `
      ${INSTITUTION_QUALITY_CTE}
      SELECT ct.id, ct.institution_name, ct.city, ct.state_code, ct.charter_type, ct.asset_size,
             ct.source, ct.cert_number, ct.rssd_id, ct.lei, ct.website_url,
             ct.fee_schedule_url, ct.document_type,
             ${HAS_FEE_URL_SQL} as has_fee_url,
             COALESCE(fc.published_fee_count, 0) as published_fee_count,
             (
               COALESCE(fc.catalog_provisional_fee_count, 0)
               + COALESCE(vuc.verified_unpublished_fee_count, 0)
             ) as provisional_fee_count,
             (
               COALESCE(fc.published_fee_count, 0)
               + COALESCE(fc.catalog_provisional_fee_count, 0)
               + COALESCE(vuc.verified_unpublished_fee_count, 0)
             ) as visible_fee_count,
             ld.latest_source_status,
             COALESCE(ld.latest_extracted_fee_count, 0) as latest_extracted_fee_count,
             ld.latest_source_error,
             ld.latest_source_collected_at,
             CASE
               WHEN ld.latest_source_error ILIKE '%credit balance is too low%' THEN 'provider_credit'
               WHEN ld.latest_source_error ILIKE '%tool_use%' THEN 'tool_protocol'
               WHEN ld.latest_source_error ILIKE '%timeout%' OR ld.latest_source_error ILIKE '%timed out%' THEN 'timeout'
               WHEN ld.latest_source_error IS NULL OR btrim(ld.latest_source_error) = '' THEN 'none'
               ELSE 'other'
             END as last_agent_failure_class
      FROM institution_sources ct
      LEFT JOIN fee_counts fc ON fc.institution_id = ct.id
      LEFT JOIN verified_unpublished_counts vuc ON vuc.institution_id = ct.id
      LEFT JOIN latest_docs ld ON ld.institution_id = ct.id
      ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, limit, offset],
    );

    return {
      total,
      institutions: rows.map(mapInstitutionRow),
    };
  } catch (e) {
    console.error("searchInstitutions failed:", e);
    return { institutions: [], total: 0 };
  }
}

function mapInstitutionRow(r: Record<string, unknown>): InstitutionRow {
  const latestSourceCollectedAt = r.latest_source_collected_at
    ? toDateStr(r.latest_source_collected_at as string | Date)
    : null;
  const publishedFeeCount = Number(r.published_fee_count ?? 0);
  const provisionalFeeCount = Number(r.provisional_fee_count ?? 0);
  const visibleFeeCount = Number(r.visible_fee_count ?? (publishedFeeCount + provisionalFeeCount));
  const lastAgentFailureClass = String(r.last_agent_failure_class ?? "none") as AgentFailureClass;
  const quality = classifyInstitutionQuality({
    source: r.source ? String(r.source) : null,
    certNumber: r.cert_number ? String(r.cert_number) : null,
    rssdId: r.rssd_id ? String(r.rssd_id) : null,
    lei: r.lei ? String(r.lei) : null,
    websiteUrl: r.website_url ? String(r.website_url) : null,
    feeScheduleUrl: r.fee_schedule_url ? String(r.fee_schedule_url) : null,
    publishedFeeCount,
    latestSourceStatus: r.latest_source_status ? String(r.latest_source_status) : null,
    latestExtractedFeeCount: Number(r.latest_extracted_fee_count ?? 0),
    latestSourceError: r.latest_source_error ? String(r.latest_source_error) : null,
    latestSourceCollectedAt,
    lastAgentFailureClass,
  });

  return {
    id: Number(r.id),
    institution_name: String(r.institution_name),
    city: r.city ? String(r.city) : null,
    state_code: r.state_code ? String(r.state_code) : null,
    charter_type: r.charter_type ? String(r.charter_type) : null,
    asset_size: r.asset_size != null ? Number(r.asset_size) : null,
    source: r.source ? String(r.source) : null,
    cert_number: r.cert_number ? String(r.cert_number) : null,
    rssd_id: r.rssd_id ? String(r.rssd_id) : null,
    lei: r.lei ? String(r.lei) : null,
    website_url: r.website_url ? String(r.website_url) : null,
    fee_schedule_url: r.fee_schedule_url ? String(r.fee_schedule_url) : null,
    document_type: r.document_type ? String(r.document_type) : null,
    has_fee_url: Boolean(r.has_fee_url),
    fee_count: visibleFeeCount,
    published_fee_count: publishedFeeCount,
    provisional_fee_count: provisionalFeeCount,
    visible_fee_count: visibleFeeCount,
    latest_source_status: r.latest_source_status ? String(r.latest_source_status) : null,
    latest_extracted_fee_count: Number(r.latest_extracted_fee_count ?? 0),
    latest_source_error: r.latest_source_error ? String(r.latest_source_error) : null,
    latest_source_collected_at: latestSourceCollectedAt,
    last_agent_failure_class: lastAgentFailureClass,
    quality_status: quality.quality_status,
    quality_signals: quality.quality_signals,
    recommended_action: quality.recommended_action,
  };
}

// ---------------------------------------------------------------------------
// Data Trust Workbench
// ---------------------------------------------------------------------------

export type SourceSubmissionReviewStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "needs_info"
  | "all";

export interface SourceSubmissionCounts {
  pending: number;
  accepted: number;
  rejected: number;
  needs_info: number;
  total: number;
}

const SOURCE_SUBMISSION_COUNTS_CACHE_TTL_MS = 30_000;
let sourceSubmissionCountsCache: { value: SourceSubmissionCounts; expiresAt: number } | null = null;
let sourceSubmissionCountsInFlight: Promise<SourceSubmissionCounts> | null = null;

export function clearSourceSubmissionCountsCache(): void {
  sourceSubmissionCountsCache = null;
}

export interface SourceSubmissionRow {
  id: number;
  institution_id: number | null;
  institution_name: string;
  linked_institution_name: string | null;
  city: string | null;
  state_code: string | null;
  source_url: string;
  fee_name: string;
  fee_category: string | null;
  amount: number | null;
  frequency: string | null;
  submitter_role: string | null;
  notes: string | null;
  submission_kind: string;
  review_status: string;
  created_at: string;
  reviewed_at: string | null;
  reviewer_id: number | null;
  reviewer_name: string | null;
  review_notes: string | null;
  resolution: string | null;
  source_document_id: number | null;
  agent_run_id: number | null;
}

export type InstitutionClaimReviewStatus = "pending" | "accepted" | "rejected" | "needs_info" | "all";

export interface InstitutionClaimCounts {
  pending: number;
  accepted: number;
  rejected: number;
  needs_info: number;
  total: number;
}

export interface InstitutionClaimRow {
  id: number;
  institution_id: number;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  claimant_user_id: number;
  claimant_name: string;
  claimant_email: string | null;
  claimant_role: string | null;
  claim_notes: string | null;
  source_submission_id: number | null;
  review_status: string;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewer_id: number | null;
  reviewer_name: string | null;
  review_notes: string | null;
  resolution: string | null;
}

export interface DataTrustQueueRow extends DataTrustQueueDecision {
  id: number;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  charter_type: string | null;
  asset_size: number | null;
  asset_size_tier: string | null;
  fed_district: number | null;
  website_url: string | null;
  fee_schedule_url: string | null;
  verified_fee_count: number;
  provisional_fee_count: number;
  visible_fee_count: number;
  raw_fee_count: number;
  raw_without_verified_count: number;
  verified_without_published_count: number;
  latest_source_status: string | null;
  latest_source_error: string | null;
  latest_source_collected_at: string | null;
  latest_extracted_fee_count: number;
  submission_count: number;
  pending_submission_count: number;
  accepted_submission_count: number;
  rejected_submission_count: number;
  needs_info_submission_count: number;
  latest_submission_id: number | null;
  latest_submission_status: string | null;
  latest_submission_source_url: string | null;
  latest_submission_created_at: string | null;
  validation_queue_count: number;
  latest_validation_queue_status: string | null;
  latest_validation_mode: string | null;
  knox_pending_count: number;
}

export interface DataTrustQueueResult {
  rows: DataTrustQueueRow[];
  total: number;
  counts: Record<DataTrustQueueState, number>;
}

export interface ProviderFailureRow {
  id: number;
  provider: string;
  model: string;
  agent: string;
  operation: string;
  status: string;
  error: string;
  created_at: string;
}

function emptyTrustCounts(): Record<DataTrustQueueState, number> {
  return DATA_TRUST_QUEUE_STATES.reduce((acc, state) => {
    acc[state] = 0;
    return acc;
  }, {} as Record<DataTrustQueueState, number>);
}

function mapSourceSubmissionRow(r: Record<string, unknown>): SourceSubmissionRow {
  return {
    id: Number(r.id),
    institution_id: r.institution_id != null ? Number(r.institution_id) : null,
    institution_name: String(r.institution_name),
    linked_institution_name: r.linked_institution_name
      ? String(r.linked_institution_name)
      : null,
    city: r.city ? String(r.city) : null,
    state_code: r.state_code ? String(r.state_code) : null,
    source_url: String(r.source_url),
    fee_name: String(r.fee_name),
    fee_category: r.fee_category ? String(r.fee_category) : null,
    amount: r.amount != null ? Number(r.amount) : null,
    frequency: r.frequency ? String(r.frequency) : null,
    submitter_role: r.submitter_role ? String(r.submitter_role) : null,
    notes: r.notes ? String(r.notes) : null,
    submission_kind: String(r.submission_kind ?? "fee_row"),
    review_status: String(r.review_status ?? "pending"),
    created_at: toDateStr(r.created_at as string | Date | null),
    reviewed_at: r.reviewed_at ? toDateStr(r.reviewed_at as string | Date) : null,
    reviewer_id: r.reviewer_id != null ? Number(r.reviewer_id) : null,
    reviewer_name: r.reviewer_name ? String(r.reviewer_name) : null,
    review_notes: r.review_notes ? String(r.review_notes) : null,
    resolution: r.resolution ? String(r.resolution) : null,
    source_document_id: r.source_document_id != null ? Number(r.source_document_id) : null,
    agent_run_id: r.agent_run_id != null ? Number(r.agent_run_id) : null,
  };
}

function mapInstitutionClaimRow(r: Record<string, unknown>): InstitutionClaimRow {
  return {
    id: Number(r.id),
    institution_id: Number(r.institution_id),
    institution_name: String(r.institution_name),
    city: r.city ? String(r.city) : null,
    state_code: r.state_code ? String(r.state_code) : null,
    claimant_user_id: Number(r.claimant_user_id),
    claimant_name: r.claimant_name ? String(r.claimant_name) : "Unknown user",
    claimant_email: r.claimant_email ? String(r.claimant_email) : null,
    claimant_role: r.claimant_role ? String(r.claimant_role) : null,
    claim_notes: r.claim_notes ? String(r.claim_notes) : null,
    source_submission_id: r.source_submission_id != null ? Number(r.source_submission_id) : null,
    review_status: String(r.review_status ?? "pending"),
    created_at: toDateStr(r.created_at as string | Date | null),
    updated_at: toDateStr(r.updated_at as string | Date | null),
    reviewed_at: r.reviewed_at ? toDateStr(r.reviewed_at as string | Date) : null,
    reviewer_id: r.reviewer_id != null ? Number(r.reviewer_id) : null,
    reviewer_name: r.reviewer_name ? String(r.reviewer_name) : null,
    review_notes: r.review_notes ? String(r.review_notes) : null,
    resolution: r.resolution ? String(r.resolution) : null,
  };
}

export async function getSourceSubmissionCounts(): Promise<SourceSubmissionCounts> {
  const now = Date.now();
  if (sourceSubmissionCountsCache && sourceSubmissionCountsCache.expiresAt > now) {
    return sourceSubmissionCountsCache.value;
  }
  if (sourceSubmissionCountsInFlight) return sourceSubmissionCountsInFlight;

  sourceSubmissionCountsInFlight = (async () => {
    try {
      const rows = await sql<{ review_status: string; count: string }[]>`
        SELECT review_status, COUNT(*) AS count
        FROM community_fee_submissions
        GROUP BY review_status
      `;
      const counts: SourceSubmissionCounts = {
        pending: 0,
        accepted: 0,
        rejected: 0,
        needs_info: 0,
        total: 0,
      };
      for (const row of rows) {
        const value = Number(row.count ?? 0);
        if (row.review_status === "pending") counts.pending = value;
        else if (row.review_status === "accepted") counts.accepted = value;
        else if (row.review_status === "rejected") counts.rejected = value;
        else if (row.review_status === "needs_info") counts.needs_info = value;
        counts.total += value;
      }
      sourceSubmissionCountsCache = {
        value: counts,
        expiresAt: Date.now() + SOURCE_SUBMISSION_COUNTS_CACHE_TTL_MS,
      };
      return counts;
    } catch (e) {
      console.error("getSourceSubmissionCounts failed:", e);
      return { pending: 0, accepted: 0, rejected: 0, needs_info: 0, total: 0 };
    } finally {
      sourceSubmissionCountsInFlight = null;
    }
  })();

  return sourceSubmissionCountsInFlight;
}

export async function getInstitutionClaimCounts(): Promise<InstitutionClaimCounts> {
  try {
    const rows = await sql<{ review_status: string; count: string }[]>`
      SELECT review_status, COUNT(*) AS count
      FROM institution_claims
      GROUP BY review_status
    `;
    const counts: InstitutionClaimCounts = {
      pending: 0,
      accepted: 0,
      rejected: 0,
      needs_info: 0,
      total: 0,
    };
    for (const row of rows) {
      const value = Number(row.count ?? 0);
      if (row.review_status === "pending") counts.pending = value;
      else if (row.review_status === "accepted") counts.accepted = value;
      else if (row.review_status === "rejected") counts.rejected = value;
      else if (row.review_status === "needs_info") counts.needs_info = value;
      counts.total += value;
    }
    return counts;
  } catch (e) {
    console.error("getInstitutionClaimCounts failed:", e);
    return { pending: 0, accepted: 0, rejected: 0, needs_info: 0, total: 0 };
  }
}

export async function listSourceSubmissions({
  status = "pending",
  page = 1,
  pageSize = 25,
}: {
  status?: SourceSubmissionReviewStatus;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ rows: SourceSubmissionRow[]; total: number; page: number; pageSize: number }> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(5, pageSize));
  const offset = (safePage - 1) * safePageSize;
  const statusFilter =
    status === "all" ? sql`TRUE` : sql`cfs.review_status = ${status}`;

  try {
    const countRows = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count
      FROM community_fee_submissions cfs
      WHERE ${statusFilter}
    `;
    const rows = await sql<Record<string, unknown>[]>`
      SELECT
        cfs.id,
        cfs.institution_id,
        cfs.institution_name,
        inst.institution_name AS linked_institution_name,
        inst.city,
        inst.state_code,
        cfs.source_url,
        cfs.fee_name,
        cfs.fee_category,
        cfs.amount,
        cfs.frequency,
        cfs.submitter_role,
        cfs.notes,
        cfs.submission_kind,
        cfs.review_status,
        cfs.created_at,
        cfs.reviewed_at,
        cfs.reviewer_id,
        reviewer.username AS reviewer_name,
        cfs.review_notes,
        cfs.resolution,
        cfs.source_document_id,
        cfs.agent_run_id
      FROM community_fee_submissions cfs
      LEFT JOIN institution_sources inst ON inst.id = cfs.institution_id
      LEFT JOIN users reviewer ON reviewer.id = cfs.reviewer_id
      WHERE ${statusFilter}
      ORDER BY
        CASE WHEN cfs.review_status = 'pending' THEN 0 ELSE 1 END,
        cfs.created_at DESC,
        cfs.id DESC
      LIMIT ${safePageSize} OFFSET ${offset}
    `;

    return {
      rows: rows.map(mapSourceSubmissionRow),
      total: Number(countRows[0]?.count ?? 0),
      page: safePage,
      pageSize: safePageSize,
    };
  } catch (e) {
    console.error("listSourceSubmissions failed:", e);
    return { rows: [], total: 0, page: safePage, pageSize: safePageSize };
  }
}

export async function listInstitutionClaims({
  status = "pending",
  page = 1,
  pageSize = 12,
}: {
  status?: InstitutionClaimReviewStatus;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ rows: InstitutionClaimRow[]; total: number; page: number; pageSize: number }> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(5, pageSize));
  const offset = (safePage - 1) * safePageSize;
  const statusFilter =
    status === "all" ? sql`TRUE` : sql`ic.review_status = ${status}`;

  try {
    const countRows = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count
      FROM institution_claims ic
      WHERE ${statusFilter}
    `;
    const rows = await sql<Record<string, unknown>[]>`
      SELECT
        ic.id,
        ic.institution_id,
        inst.institution_name,
        inst.city,
        inst.state_code,
        ic.claimant_user_id,
        COALESCE(claimant.display_name, claimant.username) AS claimant_name,
        claimant.email AS claimant_email,
        ic.claimant_role,
        ic.claim_notes,
        ic.source_submission_id,
        ic.review_status,
        ic.created_at,
        ic.updated_at,
        ic.reviewed_at,
        ic.reviewer_id,
        reviewer.username AS reviewer_name,
        ic.review_notes,
        ic.resolution
      FROM institution_claims ic
      JOIN institution_sources inst ON inst.id = ic.institution_id
      JOIN users claimant ON claimant.id = ic.claimant_user_id
      LEFT JOIN users reviewer ON reviewer.id = ic.reviewer_id
      WHERE ${statusFilter}
      ORDER BY
        CASE WHEN ic.review_status = 'pending' THEN 0 ELSE 1 END,
        ic.updated_at DESC,
        ic.id DESC
      LIMIT ${safePageSize} OFFSET ${offset}
    `;

    return {
      rows: rows.map(mapInstitutionClaimRow),
      total: Number(countRows[0]?.count ?? 0),
      page: safePage,
      pageSize: safePageSize,
    };
  } catch (e) {
    console.error("listInstitutionClaims failed:", e);
    return { rows: [], total: 0, page: safePage, pageSize: safePageSize };
  }
}

export async function getDataTrustQueueRows({
  state,
  query,
  page = 1,
  pageSize = 50,
  automationEnabled,
}: {
  state?: DataTrustQueueState | "all";
  query?: string;
  page?: number;
  pageSize?: number;
  automationEnabled?: boolean | null;
} = {}): Promise<DataTrustQueueResult> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(10, pageSize));
  const queryFilter = query?.trim()
    ? sql`ct.institution_name ILIKE ${`%${query.trim()}%`}`
    : sql`TRUE`;
  const stateFilter =
    state && state !== "all" ? sql`trust_state = ${state}` : sql`TRUE`;
  const offset = (safePage - 1) * safePageSize;

  try {
    const resultRows = await sql<{
      rows_json: Record<string, unknown>[] | string | null;
      counts_json: Record<string, number> | string | null;
      filtered_total: number | string | null;
    }[]>`
      WITH catalog_counts AS (
        SELECT
          institution_id,
          COUNT(*) FILTER (WHERE review_status = 'approved')::int AS verified_fee_count,
          COUNT(*) FILTER (WHERE review_status <> 'approved' AND review_status <> 'rejected')::int AS catalog_provisional_fee_count
        FROM published_fee_catalog
        GROUP BY institution_id
      ),
      verified_unpublished_counts AS (
        SELECT fv.institution_id, COUNT(*)::int AS verified_without_published_count
        FROM verified_fee_observations fv
        WHERE fv.review_status <> 'rejected'
          AND NOT EXISTS (
            SELECT 1
            FROM published_fee_catalog pfc
            WHERE pfc.fee_verified_id = fv.fee_verified_id
              AND pfc.review_status <> 'rejected'
          )
        GROUP BY fv.institution_id
      ),
      raw_counts AS (
        SELECT
          fr.institution_id,
          COUNT(*)::int AS raw_fee_count,
          COUNT(*) FILTER (
            WHERE NOT EXISTS (
              SELECT 1
              FROM verified_fee_observations fv
              WHERE fv.fee_raw_id = fr.fee_raw_id
                AND fv.review_status <> 'rejected'
            )
          )::int AS raw_without_verified_count
        FROM raw_fee_observations fr
        GROUP BY fr.institution_id
      ),
      latest_docs AS (
        SELECT DISTINCT ON (institution_id)
          institution_id,
          status AS latest_source_status,
          COALESCE(fees_extracted, 0)::int AS latest_extracted_fee_count,
          error_message AS latest_source_error,
          crawled_at AS latest_source_collected_at
        FROM source_documents
        ORDER BY institution_id, crawled_at DESC NULLS LAST, id DESC
      ),
      submission_counts AS (
        SELECT
          institution_id,
          COUNT(*)::int AS submission_count,
          COUNT(*) FILTER (WHERE review_status = 'pending')::int AS pending_submission_count,
          COUNT(*) FILTER (WHERE review_status = 'accepted')::int AS accepted_submission_count,
          COUNT(*) FILTER (WHERE review_status = 'rejected')::int AS rejected_submission_count,
          COUNT(*) FILTER (WHERE review_status = 'needs_info')::int AS needs_info_submission_count
        FROM community_fee_submissions
        WHERE institution_id IS NOT NULL
        GROUP BY institution_id
      ),
      latest_submissions AS (
        SELECT DISTINCT ON (institution_id)
          institution_id,
          id AS latest_submission_id,
          review_status AS latest_submission_status,
          source_url AS latest_submission_source_url,
          created_at AS latest_submission_created_at
        FROM community_fee_submissions
        WHERE institution_id IS NOT NULL
        ORDER BY institution_id, created_at DESC, id DESC
      ),
      validation_queue AS (
        SELECT
          institution_id,
          COUNT(*) FILTER (WHERE queue_status NOT IN ('completed', 'canceled'))::int AS validation_queue_count,
          (ARRAY_AGG(queue_status ORDER BY updated_at DESC, id DESC))[1] AS latest_validation_queue_status,
          (ARRAY_AGG(validation_mode ORDER BY updated_at DESC, id DESC))[1] AS latest_validation_mode
        FROM source_validation_queue
        GROUP BY institution_id
      ),
      knox_pending AS (
        SELECT fv.institution_id, COUNT(*)::int AS knox_pending_count
        FROM agent_messages am
        LEFT JOIN knox_overrides ko ON ko.rejection_msg_id = am.message_id
        JOIN verified_fee_observations fv
          ON fv.fee_verified_id = NULLIF(am.payload->>'fee_verified_id','')::bigint
        WHERE am.sender_agent = 'knox'
          AND am.intent = 'reject'
          AND ko.id IS NULL
        GROUP BY fv.institution_id
      ),
      base AS (
          SELECT
            ct.id,
            ct.institution_name,
            ct.city,
            ct.state_code,
            ct.charter_type,
            ct.asset_size,
            ct.asset_size_tier,
            ct.fed_district,
            ct.website_url,
            ct.fee_schedule_url,
            COALESCE(cc.verified_fee_count, 0) AS verified_fee_count,
            (
              COALESCE(cc.catalog_provisional_fee_count, 0)
              + COALESCE(vuc.verified_without_published_count, 0)
              + COALESCE(rc.raw_without_verified_count, 0)
            ) AS provisional_fee_count,
            (
              COALESCE(cc.verified_fee_count, 0)
              + COALESCE(cc.catalog_provisional_fee_count, 0)
              + COALESCE(vuc.verified_without_published_count, 0)
              + COALESCE(rc.raw_without_verified_count, 0)
            ) AS visible_fee_count,
            COALESCE(rc.raw_fee_count, 0) AS raw_fee_count,
            COALESCE(rc.raw_without_verified_count, 0) AS raw_without_verified_count,
            COALESCE(vuc.verified_without_published_count, 0) AS verified_without_published_count,
            ld.latest_source_status,
            ld.latest_source_error,
            ld.latest_source_collected_at,
            COALESCE(ld.latest_extracted_fee_count, 0) AS latest_extracted_fee_count,
            COALESCE(sc.submission_count, 0) AS submission_count,
            COALESCE(sc.pending_submission_count, 0) AS pending_submission_count,
            COALESCE(sc.accepted_submission_count, 0) AS accepted_submission_count,
            COALESCE(sc.rejected_submission_count, 0) AS rejected_submission_count,
            COALESCE(sc.needs_info_submission_count, 0) AS needs_info_submission_count,
            ls.latest_submission_id,
            ls.latest_submission_status,
            ls.latest_submission_source_url,
            ls.latest_submission_created_at,
            COALESCE(vq.validation_queue_count, 0) AS validation_queue_count,
            vq.latest_validation_queue_status,
            vq.latest_validation_mode,
            COALESCE(kp.knox_pending_count, 0) AS knox_pending_count
          FROM institution_sources ct
          LEFT JOIN catalog_counts cc ON cc.institution_id = ct.id
          LEFT JOIN verified_unpublished_counts vuc ON vuc.institution_id = ct.id
          LEFT JOIN raw_counts rc ON rc.institution_id = ct.id
          LEFT JOIN latest_docs ld ON ld.institution_id = ct.id
          LEFT JOIN submission_counts sc ON sc.institution_id = ct.id
          LEFT JOIN latest_submissions ls ON ls.institution_id = ct.id
          LEFT JOIN validation_queue vq ON vq.institution_id = ct.id
          LEFT JOIN knox_pending kp ON kp.institution_id = ct.id
          WHERE ct.status = 'active'
            AND COALESCE(ct.document_type, '') NOT IN ('offline', 'no_website')
            AND ${queryFilter}
        ),
        classified AS (
          SELECT
            base.*,
            CASE
              WHEN pending_submission_count > 0
                THEN 'submitted_source_pending_review'
              WHEN (accepted_submission_count > 0 OR validation_queue_count > 0)
                AND latest_source_status IS DISTINCT FROM 'success'
                AND verified_fee_count = 0
                THEN 'source_accepted_awaiting_validation'
              WHEN latest_source_status = 'failed'
                THEN 'source_failed'
              WHEN raw_without_verified_count > 0
                OR (latest_extracted_fee_count > 0 AND verified_fee_count = 0)
                THEN 'extracted_rows_pending_classification'
              WHEN verified_without_published_count > 0
                THEN 'extracted_rows_pending_classification'
              WHEN knox_pending_count > 0
                THEN 'knox_decisions_pending'
              WHEN verified_fee_count > 0
                THEN 'verified_public_ready'
              WHEN COALESCE(btrim(fee_schedule_url), '') = ''
                THEN 'source_needed'
              ELSE 'source_accepted_awaiting_validation'
            END AS trust_state,
            CASE
              WHEN pending_submission_count > 0 THEN 0
              WHEN latest_source_status = 'failed' THEN 1
              WHEN knox_pending_count > 0 THEN 2
              WHEN raw_without_verified_count > 0 THEN 3
              WHEN verified_fee_count = 0 THEN 4
              ELSE 5
            END AS sort_bucket
          FROM base
        ),
        filtered AS (
          SELECT *
          FROM classified
          WHERE ${stateFilter}
        ),
        paged AS (
          SELECT *
          FROM filtered
          ORDER BY sort_bucket, asset_size DESC NULLS LAST, institution_name ASC
          LIMIT ${safePageSize} OFFSET ${offset}
        )
        SELECT
          COALESCE(jsonb_agg(to_jsonb(paged) ORDER BY paged.sort_bucket, paged.asset_size DESC NULLS LAST, paged.institution_name ASC), '[]'::jsonb) AS rows_json,
          (
            SELECT COALESCE(jsonb_object_agg(trust_state, state_count), '{}'::jsonb)
            FROM (
              SELECT trust_state, COUNT(*)::int AS state_count
              FROM classified
              GROUP BY trust_state
            ) counts
          ) AS counts_json,
          (SELECT COUNT(*)::int FROM filtered) AS filtered_total
        FROM paged
    `;

    const result = resultRows[0];
    const rowsValue = result?.rows_json ?? [];
    const countsValue = result?.counts_json ?? {};
    const rows = Array.isArray(rowsValue)
      ? rowsValue
      : JSON.parse(String(rowsValue)) as Record<string, unknown>[];
    const countsJson = typeof countsValue === "string"
      ? JSON.parse(countsValue) as Record<string, number>
      : countsValue;

    const mapped = rows.map((row) => {
      const decision = classifyDataTrustQueue({
        feeScheduleUrl: row.fee_schedule_url ? String(row.fee_schedule_url) : null,
        verifiedFeeCount: Number(row.verified_fee_count ?? 0),
        provisionalFeeCount: Number(row.provisional_fee_count ?? 0),
        rawFeeCount: Number(row.raw_fee_count ?? 0),
        rawWithoutVerifiedCount: Number(row.raw_without_verified_count ?? 0),
        verifiedWithoutPublishedCount: Number(row.verified_without_published_count ?? 0),
        latestSourceStatus: row.latest_source_status ? String(row.latest_source_status) : null,
        latestExtractedFeeCount: Number(row.latest_extracted_fee_count ?? 0),
        pendingSubmissionCount: Number(row.pending_submission_count ?? 0),
        acceptedSubmissionCount: Number(row.accepted_submission_count ?? 0),
        validationQueueCount: Number(row.validation_queue_count ?? 0),
        knoxPendingCount: Number(row.knox_pending_count ?? 0),
        automationEnabled,
      });
      return {
        ...decision,
        id: Number(row.id),
        institution_name: String(row.institution_name),
        city: row.city ? String(row.city) : null,
        state_code: row.state_code ? String(row.state_code) : null,
        charter_type: row.charter_type ? String(row.charter_type) : null,
        asset_size: row.asset_size != null ? Number(row.asset_size) : null,
        asset_size_tier: row.asset_size_tier ? String(row.asset_size_tier) : null,
        fed_district: row.fed_district != null ? Number(row.fed_district) : null,
        website_url: row.website_url ? String(row.website_url) : null,
        fee_schedule_url: row.fee_schedule_url ? String(row.fee_schedule_url) : null,
        verified_fee_count: Number(row.verified_fee_count ?? 0),
        provisional_fee_count: Number(row.provisional_fee_count ?? 0),
        visible_fee_count: Number(row.visible_fee_count ?? 0),
        raw_fee_count: Number(row.raw_fee_count ?? 0),
        raw_without_verified_count: Number(row.raw_without_verified_count ?? 0),
        verified_without_published_count: Number(row.verified_without_published_count ?? 0),
        latest_source_status: row.latest_source_status ? String(row.latest_source_status) : null,
        latest_source_error: row.latest_source_error ? String(row.latest_source_error) : null,
        latest_source_collected_at: row.latest_source_collected_at
          ? toDateStr(row.latest_source_collected_at as string | Date)
          : null,
        latest_extracted_fee_count: Number(row.latest_extracted_fee_count ?? 0),
        submission_count: Number(row.submission_count ?? 0),
        pending_submission_count: Number(row.pending_submission_count ?? 0),
        accepted_submission_count: Number(row.accepted_submission_count ?? 0),
        rejected_submission_count: Number(row.rejected_submission_count ?? 0),
        needs_info_submission_count: Number(row.needs_info_submission_count ?? 0),
        latest_submission_id: row.latest_submission_id != null ? Number(row.latest_submission_id) : null,
        latest_submission_status: row.latest_submission_status ? String(row.latest_submission_status) : null,
        latest_submission_source_url: row.latest_submission_source_url ? String(row.latest_submission_source_url) : null,
        latest_submission_created_at: row.latest_submission_created_at
          ? toDateStr(row.latest_submission_created_at as string | Date)
          : null,
        validation_queue_count: Number(row.validation_queue_count ?? 0),
        latest_validation_queue_status: row.latest_validation_queue_status
          ? String(row.latest_validation_queue_status)
          : null,
        latest_validation_mode: row.latest_validation_mode
          ? String(row.latest_validation_mode)
          : null,
        knox_pending_count: Number(row.knox_pending_count ?? 0),
      } satisfies DataTrustQueueRow;
    });

    const counts = emptyTrustCounts();
    for (const item of DATA_TRUST_QUEUE_STATES) {
      counts[item] = Number(countsJson?.[item] ?? 0);
    }

    return {
      rows: mapped,
      total: Number(result?.filtered_total ?? 0),
      counts,
    };
  } catch (e) {
    console.error("getDataTrustQueueRows failed:", e);
    return { rows: [], total: 0, counts: emptyTrustCounts() };
  }
}

export async function getRecentProviderFailures(limit = 5): Promise<ProviderFailureRow[]> {
  try {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT id, provider, model, agent_name, operation, status,
             COALESCE(error_summary, 'No provider error detail recorded') AS error_summary,
             created_at
      FROM ai_api_usage_events
      WHERE status IN ('failed', 'blocked')
      ORDER BY created_at DESC
      LIMIT ${Math.min(20, Math.max(1, limit))}
    `;
    return rows.map((row) => ({
      id: Number(row.id),
      provider: String(row.provider),
      model: String(row.model),
      agent: String(row.agent_name),
      operation: String(row.operation),
      status: String(row.status),
      error: String(row.error_summary).replace(/\s+/g, " ").slice(0, 500),
      created_at: toDateStr(row.created_at as string | Date | null),
    }));
  } catch (e) {
    console.error("getRecentProviderFailures failed:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export interface LeadRow {
  id: number;
  name: string;
  email: string;
  company: string | null;
  role: string | null;
  use_case: string | null;
  source: string | null;
  status: string;
  created_at: string;
  /** Full timestamp, for the lead's due time. */
  created_at_iso: string;
  /** Institution report quote and payment (null until quoted / paid, or before the migration). */
  quote_cents: number | null;
  quote_institution_id: number | null;
  quote_sent_at: string | null;
  paid_at: string | null;
  /** False until migration 20270110000003 has added the payment columns. */
  payment_columns: boolean;
}

export interface LeadsSummary {
  total: number;
  new_this_week: number;
  new_today: number;
  latest_at: string | null;
}

export async function getLeadsSummary(): Promise<LeadsSummary> {
  try {
    const [row] = await sql<
      {
        total: string;
        new_this_week: string;
        new_today: string;
        latest_at: string | Date | null;
      }[]
    >`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::text AS new_this_week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::text AS new_today,
        MAX(created_at) AS latest_at
      FROM leads
    `;
    return {
      total: Number(row?.total ?? 0),
      new_this_week: Number(row?.new_this_week ?? 0),
      new_today: Number(row?.new_today ?? 0),
      latest_at: row?.latest_at ? toDateStr(row.latest_at) : null,
    };
  } catch (e) {
    console.error("getLeadsSummary failed:", e);
    return { total: 0, new_this_week: 0, new_today: 0, latest_at: null };
  }
}

export async function getLeads(limit = 200): Promise<LeadRow[]> {
  try {
    const rows = await sql`
      SELECT id, name, email, company, role, use_case, source, status, created_at,
        to_jsonb(leads) AS fields
      FROM leads
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => {
      const payment = paymentFieldsOf(r.fields as Record<string, unknown> | null);
      return {
      id: Number(r.id),
      name: String(r.name),
      email: String(r.email),
      company: r.company ? String(r.company) : null,
      role: r.role ? String(r.role) : null,
      use_case: r.use_case ? String(r.use_case) : null,
      source: r.source ? String(r.source) : null,
      status: String(r.status || "new"),
      created_at: toDateStr(r.created_at as string | Date),
      created_at_iso: new Date(r.created_at as string | Date).toISOString(),
      quote_cents: payment.quoteCents,
      quote_institution_id: payment.quoteInstitutionId,
      quote_sent_at: payment.quoteSentAt,
      paid_at: payment.paidAt,
      payment_columns: payment.paymentColumns,
      };
    });
  } catch (e) {
    console.error("getLeads failed:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fees Catalog
// ---------------------------------------------------------------------------

export async function getFeeCatalogSummary(): Promise<FeeCatalogRow[]> {
  try {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT
        fee_category,
        COUNT(*) as cnt,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) as median,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount) as p25,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount) as p75
      FROM published_fee_catalog
      WHERE fee_category IS NOT NULL
        AND amount IS NOT NULL
      GROUP BY fee_category
      ORDER BY cnt DESC
    `;

    // Build display name lookup inline to avoid importing taxonomy at module level
    const { DISPLAY_NAMES } = await import("@/lib/fee-taxonomy");

    return rows.map((r) => {
      const cat = String(r.fee_category);
      return {
        fee_category: cat,
        display_name: DISPLAY_NAMES[cat] || cat.replace(/_/g, " "),
        count: Number(r.cnt),
        median: r.median != null ? Number(Number(r.median).toFixed(2)) : null,
        p25: r.p25 != null ? Number(Number(r.p25).toFixed(2)) : null,
        p75: r.p75 != null ? Number(Number(r.p75).toFixed(2)) : null,
      };
    });
  } catch (e) {
    console.error("getFeeCatalogSummary failed:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Districts Overview
// ---------------------------------------------------------------------------

export interface DistrictOverviewRow {
  district: number;
  name: string;
  states: string[];
  total: number;
  with_urls: number;
  with_fees: number;
  url_but_zero: number;
  latest_failed: number;
  extracted_not_published: number;
  pct: number;
}

export async function getDistrictOverview(): Promise<DistrictOverviewRow[]> {
  try {
    const rows = await sql`
      WITH fee_counts AS (
        SELECT institution_id, COUNT(*) FILTER (WHERE review_status = 'approved')::int AS published_fee_count
        FROM published_fee_catalog
        GROUP BY institution_id
      ),
      latest_docs AS (
        SELECT DISTINCT ON (institution_id)
          institution_id,
          status AS latest_source_status,
          COALESCE(fees_extracted, 0)::int AS latest_extracted_fee_count
        FROM source_documents
        ORDER BY institution_id, crawled_at DESC NULLS LAST, id DESC
      )
      SELECT
        ct.fed_district as district,
        COUNT(DISTINCT ct.id)::int as total,
        COUNT(DISTINCT CASE
          WHEN ct.fee_schedule_url IS NOT NULL AND btrim(ct.fee_schedule_url) <> '' THEN ct.id
        END)::int AS with_urls,
        COUNT(DISTINCT CASE
          WHEN COALESCE(fc.published_fee_count, 0) > 0 THEN ct.id
        END)::int AS with_fees,
        COUNT(DISTINCT CASE
          WHEN ct.fee_schedule_url IS NOT NULL
            AND btrim(ct.fee_schedule_url) <> ''
            AND COALESCE(fc.published_fee_count, 0) = 0
          THEN ct.id
        END)::int AS url_but_zero,
        COUNT(DISTINCT CASE
          WHEN ld.latest_source_status = 'failed' THEN ct.id
        END)::int AS latest_failed,
        COUNT(DISTINCT CASE
          WHEN ld.latest_source_status = 'success'
            AND COALESCE(ld.latest_extracted_fee_count, 0) > 0
            AND COALESCE(fc.published_fee_count, 0) = 0
          THEN ct.id
        END)::int AS extracted_not_published
      FROM institution_sources ct
      LEFT JOIN fee_counts fc ON fc.institution_id = ct.id
      LEFT JOIN latest_docs ld ON ld.institution_id = ct.id
      WHERE ct.fed_district IS NOT NULL
      GROUP BY ct.fed_district
      ORDER BY ct.fed_district
    `;

    const byDistrict = new Map<number, Record<string, unknown>>();
    for (const row of rows) {
      byDistrict.set(Number(row.district), row);
    }

    return Array.from({ length: 12 }, (_, index) => index + 1).map((d) => {
      const row = byDistrict.get(d);
      const total = Number(row?.total ?? 0);
      const withFees = Number(row?.with_fees ?? 0);
      const states = Object.entries(STATE_TO_DISTRICT)
        .filter(([, district]) => district === d)
        .map(([code]) => code)
        .sort((a, b) => a.localeCompare(b));
      return {
        district: d,
        name: DISTRICT_NAMES[d] ?? `District ${d}`,
        states,
        total,
        with_urls: Number(row?.with_urls ?? 0),
        with_fees: withFees,
        url_but_zero: Number(row?.url_but_zero ?? 0),
        latest_failed: Number(row?.latest_failed ?? 0),
        extracted_not_published: Number(row?.extracted_not_published ?? 0),
        pct: total > 0 ? Math.round((withFees / total) * 100) : 0,
      };
    });
  } catch (e) {
    console.error("getDistrictOverview failed:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// National Fee Index
// ---------------------------------------------------------------------------

export interface NationalIndexRow {
  fee_category: string;
  display_name: string;
  fee_family: string | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min_amount: number | null;
  max_amount: number | null;
  institution_count: number;
  observation_count: number;
  approved_count: number;
  bank_count: number;
  cu_count: number;
  maturity: string;
}

export async function getNationalIndexData(): Promise<NationalIndexRow[]> {
  try {
    // Through the shared reader: it ignores a stale or old-method cache and computes live.
    const { getNationalIndexCached } = await import("@/lib/data-store/fee-index");
    const rows = await getNationalIndexCached();

    const { DISPLAY_NAMES } = await import("@/lib/fee-taxonomy");

    return rows.map((r) => {
      const cat = String(r.fee_category);
      return {
        fee_category: cat,
        display_name: DISPLAY_NAMES[cat] || cat.replace(/_/g, " "),
        fee_family: r.fee_family ? String(r.fee_family) : null,
        median: r.median_amount != null ? Number(Number(r.median_amount).toFixed(2)) : null,
        p25: r.p25_amount != null ? Number(Number(r.p25_amount).toFixed(2)) : null,
        p75: r.p75_amount != null ? Number(Number(r.p75_amount).toFixed(2)) : null,
        min_amount: r.min_amount != null ? Number(Number(r.min_amount).toFixed(2)) : null,
        max_amount: r.max_amount != null ? Number(Number(r.max_amount).toFixed(2)) : null,
        institution_count: Number(r.institution_count),
        observation_count: Number(r.observation_count),
        approved_count: Number(r.approved_count),
        bank_count: Number(r.bank_count),
        cu_count: Number(r.cu_count),
        maturity: String(r.maturity_tier),
      };
    });
  } catch (e) {
    console.error("getNationalIndexData failed:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Market Index (segment vs national)
// ---------------------------------------------------------------------------

export interface MarketIndexRow {
  fee_category: string;
  display_name: string;
  national_median: number | null;
  segment_median: number | null;
  delta_pct: number | null;
  institution_count: number;
}

export async function getMarketData(filters: {
  charter_type?: string;
  asset_tier?: string;
  state_code?: string;
}): Promise<MarketIndexRow[]> {
  try {
    // National baseline through the shared cached reader
    const { getNationalIndexCached } = await import("@/lib/data-store/fee-index");
    const national = await getNationalIndexCached();

    const { DISPLAY_NAMES } = await import("@/lib/fee-taxonomy");

    const nationalMap = new Map<string, { median: number | null; count: number }>();
    for (const r of national) {
      nationalMap.set(String(r.fee_category), {
        median: r.median_amount != null ? Number(r.median_amount) : null,
        count: Number(r.institution_count),
      });
    }

    const hasFilters = !!(filters.charter_type || filters.asset_tier || filters.state_code);

    if (!hasFilters) {
      return national.map((r) => {
        const cat = String(r.fee_category);
        return {
          fee_category: cat,
          display_name: DISPLAY_NAMES[cat] || cat.replace(/_/g, " "),
          national_median: r.median_amount != null ? Number(Number(r.median_amount).toFixed(2)) : null,
          segment_median: null,
          delta_pct: null,
          institution_count: Number(r.institution_count),
        };
      });
    }

    // Build filtered segment query
    const conditions = [
      "ef.fee_category IS NOT NULL",
      "ef.amount IS NOT NULL",
    ];
    const params: (string | number | null)[] = [];
    let paramIdx = 1;

    if (filters.charter_type) {
      conditions.push(`ct.charter_type = $${paramIdx++}`);
      params.push(filters.charter_type);
    }
    if (filters.asset_tier) {
      conditions.push(`ct.asset_size_tier = $${paramIdx++}`);
      params.push(filters.asset_tier);
    }
    if (filters.state_code) {
      conditions.push(`ct.state_code = $${paramIdx++}`);
      params.push(filters.state_code);
    }

    const where = conditions.join(" AND ");
    const segRows = await sql.unsafe(
      `SELECT ef.fee_category,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ef.amount) as median,
              COUNT(DISTINCT ct.id) as inst_count
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ef.institution_id = ct.id
       WHERE ${where}
       GROUP BY ef.fee_category`,
      params,
    );

    const segMap = new Map<string, { median: number; count: number }>();
    for (const r of segRows) {
      segMap.set(String(r.fee_category), {
        median: Number(r.median),
        count: Number(r.inst_count),
      });
    }

    // Merge: union of all categories
    const allCats = new Set([...nationalMap.keys(), ...segMap.keys()]);
    const results: MarketIndexRow[] = [];
    for (const cat of allCats) {
      const nat = nationalMap.get(cat);
      const seg = segMap.get(cat);
      const natMedian = nat?.median ?? null;
      const segMedian = seg?.median ?? null;
      let deltaPct: number | null = null;
      if (natMedian != null && natMedian !== 0 && segMedian != null) {
        deltaPct = Number(((segMedian - natMedian) / natMedian * 100).toFixed(1));
      }
      results.push({
        fee_category: cat,
        display_name: DISPLAY_NAMES[cat] || cat.replace(/_/g, " "),
        national_median: natMedian != null ? Number(natMedian.toFixed(2)) : null,
        segment_median: segMedian != null ? Number(segMedian.toFixed(2)) : null,
        delta_pct: deltaPct,
        institution_count: seg?.count ?? nat?.count ?? 0,
      });
    }

    results.sort((a, b) => b.institution_count - a.institution_count);
    return results;
  } catch (e) {
    console.error("getMarketData failed:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Peer Index
// ---------------------------------------------------------------------------

export interface PeerIndexRow {
  fee_category: string;
  display_name: string;
  peer_median: number | null;
  national_median: number | null;
  delta_pct: number | null;
  peer_count: number;
  national_count: number;
}

export async function getPeerIndexData(filters: {
  charter_type?: string;
  asset_tier?: string;
  fed_district?: number;
}): Promise<PeerIndexRow[]> {
  try {
    const { getNationalIndexCached } = await import("@/lib/data-store/fee-index");
    const national = await getNationalIndexCached();

    const { DISPLAY_NAMES } = await import("@/lib/fee-taxonomy");

    const nationalMap = new Map<string, { median: number | null; count: number }>();
    for (const r of national) {
      nationalMap.set(String(r.fee_category), {
        median: r.median_amount != null ? Number(r.median_amount) : null,
        count: Number(r.institution_count),
      });
    }

    const conditions = [
      "ef.fee_category IS NOT NULL",
      "ef.amount IS NOT NULL",
    ];
    const params: (string | number | null)[] = [];
    let paramIdx = 1;

    if (filters.charter_type) {
      conditions.push(`ct.charter_type = $${paramIdx++}`);
      params.push(filters.charter_type);
    }
    if (filters.asset_tier) {
      conditions.push(`ct.asset_size_tier = $${paramIdx++}`);
      params.push(filters.asset_tier);
    }
    if (filters.fed_district) {
      conditions.push(`ct.fed_district = $${paramIdx++}`);
      params.push(filters.fed_district);
    }

    const where = conditions.join(" AND ");
    const peerRows = await sql.unsafe(
      `SELECT ef.fee_category,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ef.amount) as median,
              COUNT(DISTINCT ct.id) as inst_count
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ef.institution_id = ct.id
       WHERE ${where}
       GROUP BY ef.fee_category`,
      params,
    );

    const results: PeerIndexRow[] = [];
    for (const r of peerRows) {
      const cat = String(r.fee_category);
      const nat = nationalMap.get(cat);
      const peerMedian = Number(r.median);
      const natMedian = nat?.median ?? null;
      let deltaPct: number | null = null;
      if (natMedian != null && natMedian !== 0) {
        deltaPct = Number(((peerMedian - natMedian) / natMedian * 100).toFixed(1));
      }
      results.push({
        fee_category: cat,
        display_name: DISPLAY_NAMES[cat] || cat.replace(/_/g, " "),
        peer_median: Number(peerMedian.toFixed(2)),
        national_median: natMedian != null ? Number(natMedian.toFixed(2)) : null,
        delta_pct: deltaPct,
        peer_count: Number(r.inst_count),
        national_count: nat?.count ?? 0,
      });
    }

    results.sort((a, b) => b.peer_count - a.peer_count);
    return results;
  } catch (e) {
    console.error("getPeerIndexData failed:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Gold Standard Verification
// ---------------------------------------------------------------------------

export interface GoldStandardCandidate {
  id: number;
  institution_name: string;
  state_code: string | null;
  asset_size_tier: string | null;
  asset_size: number | null;
  fee_schedule_url: string | null;
  fee_count: number;
}

export async function getGoldStandardCandidates(
  limit = 50
): Promise<GoldStandardCandidate[]> {
  try {
    const rows = await sql`
      SELECT ct.id,
             ct.institution_name,
             ct.state_code,
             ct.asset_size_tier,
             ct.asset_size,
             ct.fee_schedule_url,
             COUNT(ef.id) as fee_count
      FROM institution_sources ct
      JOIN published_fee_catalog ef
        ON ef.institution_id = ct.id
       AND ef.review_status = 'approved'
      GROUP BY ct.id, ct.institution_name, ct.state_code,
               ct.asset_size_tier, ct.asset_size, ct.fee_schedule_url
      ORDER BY ct.asset_size DESC NULLS LAST
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      institution_name: String(r.institution_name),
      state_code: r.state_code ? String(r.state_code) : null,
      asset_size_tier: r.asset_size_tier ? String(r.asset_size_tier) : null,
      asset_size: r.asset_size != null ? Number(r.asset_size) : null,
      fee_schedule_url: r.fee_schedule_url ? String(r.fee_schedule_url) : null,
      fee_count: Number(r.fee_count),
    }));
  } catch (e) {
    console.error("getGoldStandardCandidates failed:", e);
    return [];
  }
}

export async function getGoldStandardCandidate(
  id: number
): Promise<GoldStandardCandidate | null> {
  try {
    const rows = await sql`
      SELECT ct.id,
             ct.institution_name,
             ct.state_code,
             ct.asset_size_tier,
             ct.asset_size,
             ct.fee_schedule_url,
             COUNT(ef.id) as fee_count
      FROM institution_sources ct
      JOIN published_fee_catalog ef
        ON ef.institution_id = ct.id
       AND ef.review_status = 'approved'
      WHERE ct.id = ${id}
      GROUP BY ct.id, ct.institution_name, ct.state_code,
               ct.asset_size_tier, ct.asset_size, ct.fee_schedule_url
    `;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: Number(r.id),
      institution_name: String(r.institution_name),
      state_code: r.state_code ? String(r.state_code) : null,
      asset_size_tier: r.asset_size_tier ? String(r.asset_size_tier) : null,
      asset_size: r.asset_size != null ? Number(r.asset_size) : null,
      fee_schedule_url: r.fee_schedule_url ? String(r.fee_schedule_url) : null,
      fee_count: Number(r.fee_count),
    };
  } catch (e) {
    console.error("getGoldStandardCandidate failed:", e);
    return null;
  }
}

export interface ExtractedFeeRow {
  id: number;
  fee_name: string;
  amount: number | null;
  fee_category: string | null;
  frequency: string | null;
  review_status: string;
}

export async function getExtractedFeesForInstitution(
  institutionId: number
): Promise<ExtractedFeeRow[]> {
  try {
    const rows = await sql`
      SELECT id, fee_name, amount, fee_category, frequency, review_status
      FROM published_fee_catalog
      WHERE institution_id = ${institutionId}
      ORDER BY fee_category NULLS LAST, fee_name
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      fee_name: String(r.fee_name),
      amount: r.amount != null ? Number(r.amount) : null,
      fee_category: r.fee_category ? String(r.fee_category) : null,
      frequency: r.frequency ? String(r.frequency) : null,
      review_status: String(r.review_status),
    }));
  } catch (e) {
    console.error("getExtractedFeesForInstitution failed:", e);
    return [];
  }
}
