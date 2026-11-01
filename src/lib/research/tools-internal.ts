import { CPI_BANK_SERVICES_SERIES } from "@/lib/regulatory/fed";
import { tool } from "ai";
import { z } from "zod";
import { getDistrictStats, getStateStats } from "@/lib/data-store/geographic";
import { getLatestBeigeBook } from "@/lib/data-store/fed";
import {
  getFiledFeeIncomeData,
  getFeeRevenueData,
  getTierFeeRevenueSummary,
  getCharterFeeRevenueSummary,
} from "@/lib/data-store/fee-revenue";
import { getStats } from "@/lib/data-store/core";
import { feeIncomeAgainstPeers } from "./fee-income-peers";
import { FINANCIAL_SOURCES, type FinancialSource } from "@/lib/data-store/financial-sources";
import { financialMeasureDefinition, financialSourceForCharter } from "@/lib/data-store/financial-peer-contract";
import { getCollectionHealth } from "@/lib/data-store/dashboard";
import { sql } from "@/lib/data-store/connection";
import { getKnoxReviewCounts } from "@/lib/data-store/knox-reviews";
import { startAgentRun } from "@/lib/agents/run-store";
import type { AdminAgent } from "@/lib/agents/types";

// queryNationalData imports -- Phase 23-25 query functions
import {
  getRevenueTrend,
  getTopRevenueInstitutions,
  getRevenueByTier,
  getDistrictFeeRevenue,
} from "@/lib/data-store/call-reports";
import {
  getNationalEconomicSummary,
  getBeigeBookThemes,
  getFredSummary,
  getDistrictEconomicSummary,
  getDistrictContent,
  getRecentSpeeches,
} from "@/lib/data-store/fed";
import {
  getIndustryHealthMetrics,
  getDepositGrowthTrend,
  getLoanGrowthTrend,
  getInstitutionCountTrends,
} from "@/lib/data-store/health";
import {
  getStateDemographics,
  getLatestIndicators,
  getSodMarketShare,
  getNyFedData,
  getOfrData,
} from "@/lib/data-store/financial";
import { getDistrictComplaintSummary, getNationalComplaintSummary } from "@/lib/data-store/complaints";
import { getContractFeeRows, getNationalIndexStamped, getPeerIndexStamped } from "@/lib/data-store/fee-index";
import { datasetCitation } from "@/lib/dataset-note";
import { institutionPositions } from "@/lib/data-store/fee-stats";
import {
  getRevenueConcentration,
  getFeeDependencyTrend,
  getRevenuePerInstitutionTrend,
} from "@/lib/data-store/derived-analytics";
import {
  searchExternalIntelligence,
  listIntelligence,
} from "@/lib/data-store/intelligence";

/**
 * Admin-only tools for Fee Analyst and Custom Query agents.
 * These access internal DB functions not exposed via the public API.
 */

export const queryDistrictData = tool({
  description:
    "Returns institution count, fee count, coverage stats, and Beige Book commentary for a Fed district. When: district-level analysis, regional benchmarking. Combine with: queryNationalData, queryNationalData(complaints, district:N) for CFPB signals, queryNationalData(economic, district:N) for BLS labor/inflation data.",
  inputSchema: z.object({
    districtId: z.number().min(1).max(12).describe("Fed district number (1-12)"),
  }),
  execute: async ({ districtId }) => {
    const stats = await getDistrictStats(districtId);
    const beigeBook = await getLatestBeigeBook(districtId);

    return {
      district: districtId,
      stats,
      beige_book: beigeBook.map((b) => ({
        section: b.section_name,
        content: b.content_text.substring(0, 500),
      })),
    };
  },
});

export const queryStateData = tool({
  description:
    "Returns institution count, fee count, and coverage stats for a US state. When: state-level scoping, geography filters, state ranking. Combine with: queryNationalData, queryNationalData(deposits, stateFips:XX) for deposit market share.",
  inputSchema: z.object({
    stateCode: z.string().length(2).describe("Two-letter state code (e.g., CA, TX)"),
  }),
  execute: async ({ stateCode }) => {
    return await getStateStats(stateCode.toUpperCase());
  },
});

export const queryFeeRevenueCorrelation = tool({
  description:
    "Returns filed income comparisons or correlation between published fee schedules and separately defined bank deposit service charges or NCUA broad credit-union fee income. Financial outputs are partitioned by canonical source and charter, never pooled. Views: peers (one institution's filed fee income against a same-quarter, same-source, same-charter peer group, without requiring a published fee schedule), institutions (per-institution price/income correlation), by_tier (asset tier correlation summary per source), by_charter (separate bank and CU correlation groups). The three correlation views require at least three eligible published fee categories per institution; peers does not. When: fee income compared with peers, revenue dependency questions, fee-to-income analysis. For peers, pass institution_id and the peer group's filters (the reader's saved peer set when there is one). Combine with: queryNationalData, queryNationalData(health) for ROA/efficiency context.",
  inputSchema: z.object({
    view: z
      .enum(["peers", "institutions", "by_tier", "by_charter"])
      .optional()
      .default("by_tier")
      .describe("Which view to return"),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Max institutions to return (only for 'institutions' view)"),
    financial_source: z.enum(["fdic", "ncua"]).optional().describe("Only bank deposit service charges (fdic) or broad credit-union fee income (ncua); omit for separate groups, never a combined financial benchmark"),
    institution_id: z.number().int().positive().optional().describe("The institution compared (required for 'peers')"),
    peer_institution_ids: z.array(z.number().int().positive()).max(200).optional().describe("Exactly these peers (a hand-picked peer set)"),
    states: z.array(z.string().length(2)).max(60).optional().describe("Peers in any of these states"),
    charter_type: z.enum(["bank", "credit_union"]).optional().describe("Peers of this charter"),
    asset_tiers: z.array(z.string()).max(10).optional().describe("Peers in any of these asset tiers"),
    fed_districts: z.array(z.number().int().min(1).max(12)).max(12).optional().describe("Peers in any of these Fed districts"),
  }),
  execute: async ({ view, limit, financial_source, institution_id, peer_institution_ids, states, charter_type, asset_tiers, fed_districts }) => {
    const source = financial_source ?? financialSourceForCharter(charter_type) ?? undefined;
    if (financial_source && charter_type && financialSourceForCharter(charter_type) !== financial_source) {
      return { error: "financial_source conflicts with the canonical charter: bank requires fdic; credit_union requires ncua." };
    }
    if (view === "peers") {
      if (!institution_id) return { view: "peers", error: "Pass institution_id for the institution being compared." };
      return feeIncomeAgainstPeers(await getFiledFeeIncomeData(source), institution_id, {
        institutionIds: peer_institution_ids,
        states: states?.map((state) => state.toUpperCase()),
        charterType: charter_type,
        assetTiers: asset_tiers,
        fedDistricts: fed_districts,
      });
    }
    return {
      view,
      financial_groups: await Promise.all(financialSources(source).map(async (financialSource) => {
        const data = view === "institutions" ? await getFeeRevenueData(financialSource)
          : view === "by_charter" ? await getCharterFeeRevenueSummary(financialSource)
            : await getTierFeeRevenueSummary(financialSource);
        return {
          ...financialGroup(financialSource),
          population_basis: "fee_price_income_correlation",
          eligibility: {
            minimum_published_fee_categories: 3,
            definition: "At least three distinct approved, sourced fee categories eligible under the published-fee statistics contract, with computable canonical standalone-quarter income",
          },
          income_per_10k_assets: {
            fields: ["fee_income_ratio", "avg_fee_income_ratio"],
            definition: "Standalone-quarter income divided by reported total assets, multiplied by 10,000; not fee income as a share of revenue",
            unit: "USD income per 10,000 USD assets",
            period_basis: "standalone_quarter",
          },
          fee_schedule_amount_unit: "USD",
          units: "thousands of dollars",
          ...(view === "institutions" ? { total: data.length } : {}),
          data: (view === "institutions" ? data.slice(0, limit ?? 20) : data).map((row) => ({
            ...row,
            field_units: {
              avg_fee: "USD", avg_fee_amount: "USD", median_overdraft: "USD",
              fee_income_ratio: "USD income per 10,000 USD assets",
              avg_fee_income_ratio: "USD income per 10,000 USD assets",
            },
          })),
        };
      })),
    };
  },
});

export const queryOutliers = tool({
  description:
    "Returns fees flagged as statistical outliers — amounts significantly above or below category median. When: outlier detection, pricing anomalies, data quality review. Combine with: queryRegulatoryRisk if the outlier category is overdraft/NSF/junk fees, rankInstitutions(above_p75) for breadth across all categories.",
  inputSchema: z.object({
    category: z.string().optional().describe("Filter to a specific fee category"),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Max results to return"),
  }),
  execute: async ({ category, limit }) => {
    const n = Math.min(Math.max(limit ?? 20, 1), 100);
    const categoryFilter = category ? sql`AND ef.fee_category = ${category}` : sql``;
    const [count] = await sql<{ cnt: number | string }[]>`
      SELECT COUNT(*) AS cnt
        FROM published_fee_catalog ef
       WHERE ef.validation_flags IS NOT NULL
         AND ef.validation_flags != '[]'::jsonb
         AND ef.validation_flags != '{}'::jsonb
         ${categoryFilter}
    `;
    const rows = await sql<{
      id: number;
      institution_name: string;
      fee_name: string;
      amount: number | null;
      fee_category: string | null;
      validation_flags: unknown;
      state_code: string | null;
    }[]>`
      SELECT ef.id,
             ct.institution_name,
             ef.fee_name,
             ef.amount,
             ef.fee_category,
             ef.validation_flags,
             ct.state_code
        FROM published_fee_catalog ef
        JOIN institution_sources ct ON ct.id = ef.institution_id
       WHERE ef.validation_flags IS NOT NULL
         AND ef.validation_flags != '[]'::jsonb
         AND ef.validation_flags != '{}'::jsonb
         ${categoryFilter}
       ORDER BY ef.created_at DESC, ef.id DESC
       LIMIT ${n}
    `;
    return {
      total: Number(count?.cnt ?? 0),
      data: rows.map((f) => ({
        id: f.id,
        institution_name: f.institution_name,
        fee_name: f.fee_name,
        amount: f.amount,
        fee_category: f.fee_category,
        flag_reason: f.validation_flags,
        state: f.state_code,
      })),
    };
  },
});

export const getCollectionStatus = tool({
  description:
    "Returns source collection health: total institutions, success rates, recent source activity. When: pipeline status questions, 'did the last collection run?', coverage freshness checks. Combine with: getReviewQueueStats for review backlog, queryDataQuality(funnel) for end-to-end coverage picture.",
  inputSchema: z.object({}),
  execute: async () => {
    const health = await getCollectionHealth();
    const stats = await getStats();
    return {
      total_institutions: stats.total_institutions,
      institutions_with_fees: stats.with_fee_url,
      total_fees: stats.total_fees,
      collection_health: health,
    };
  },
});

export const getReviewQueueStats = tool({
  description:
    "Returns the record counts of the retired Knox rejection-decision queue (retired Oct 9, 2026; nobody reviews it and an override cannot publish). When: questions about that old queue only; it is not a review backlog. Combine with: queryDataQuality(review_status) for published fee status.",
  inputSchema: z.object({}),
  execute: async () => {
    const counts = await getKnoxReviewCounts();
    return {
      queue: "knox_decisions",
      retired: "2026-10-09",
      note: "Retired queue: these verdicts are kept on record and are not reviewed.",
      pending: counts.pending,
      confirmed: counts.confirmed,
      overridden: counts.overridden,
      total: counts.total,
      source: "agent_messages",
    };
  },
});

export const searchInstitutionsByName = tool({
  description:
    "Returns matching institutions with IDs, state, city, charter type, and asset tier. When: named institution lookups, finding institution IDs for follow-up queries. Combine with: getInstitution (public tool) for full fee profile, queryFeeRevenueCorrelation(institutions) for revenue correlation.",
  inputSchema: z.object({
    query: z.string().describe("Institution name to search for"),
    limit: z.number().optional().default(10).describe("Max results"),
  }),
  execute: async ({ query, limit }) => {
    const rows = await sql`
      SELECT id, institution_name, state_code, city, charter_type, asset_size_tier
      FROM institution_sources
      WHERE institution_name LIKE ${"%" + query + "%"}
      ORDER BY institution_name
      LIMIT ${limit ?? 10}
    ` as Array<{
      id: number;
      institution_name: string;
      state_code: string;
      city: string;
      charter_type: string;
      asset_size_tier: string;
    }>;

    return {
      total: rows.length,
      data: rows.map((r) => ({
        id: r.id,
        name: r.institution_name,
        state: r.state_code,
        city: r.city,
        charter_type: r.charter_type,
        asset_tier: r.asset_size_tier,
      })),
    };
  },
});

export const rankInstitutions = tool({
  description:
    "Ranks institutions by above_p75 (most fees above 75th pct), below_p25, total_fees, or outlier_flags. When: 'which institutions have the highest fees?', pricing leadership, outlier leaderboard. Combine with: queryRegulatoryRisk if ranking by overdraft/NSF categories, queryNationalData(complaints) to correlate pricing with complaints.",
  inputSchema: z.object({
    metric: z
      .enum(["above_p75", "below_p25", "total_fees", "outlier_flags"])
      .describe("Ranking metric: above_p75 (most fees above 75th pct), below_p25 (most below 25th), total_fees (most observations), outlier_flags (most validation flags)"),
    charter: z
      .enum(["bank", "credit_union"])
      .optional()
      .describe("Filter by charter type"),
    limit: z.number().int().min(1).max(50).optional().default(10).describe("Number of results (max 50)"),
  }),
  execute: async ({ metric, charter, limit }) => {
    const charterClause = charter ? sql`AND ct.charter_type = ${charter}` : sql``;
    const n = Math.min(limit ?? 10, 50);

    if (metric === "above_p75" || metric === "below_p25") {
      // Statistics contract: one value per institution per category, sourced rows,
      // $0 included, no percentiles below the minimum sample.
      const rows = await getContractFeeRows({ charter });
      const names = new Map(rows.map((r) => [r.institution_id, r]));
      const counts: Record<number, { name: string; state: string; charter: string; tier: string; count: number; total: number; categories: string[] }> = {};
      for (const position of institutionPositions(rows)) {
        const info = names.get(position.institution_id);
        if (!info) continue;
        const entry = (counts[position.institution_id] ??= {
          name: info.institution_name, state: info.state_code ?? "", charter: info.charter_type ?? "", tier: info.asset_size_tier ?? "",
          count: 0, total: 0, categories: [],
        });
        entry.total++;
        const pass = metric === "above_p75" ? position.value > position.p75 : position.value < position.p25;
        if (pass) {
          entry.count++;
          entry.categories.push(position.fee_category);
        }
      }

      const ranked = Object.entries(counts)
        .map(([id, data]) => ({ id: Number(id), ...data, pct_above: Math.round(data.count / Math.max(data.total, 1) * 100) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, n);

      return {
        metric,
        results: ranked.map(r => ({
          institution: r.name,
          state: r.state,
          charter_type: r.charter,
          asset_tier: r.tier,
          matching_fees: r.count,
          total_fees: r.total,
          pct: r.pct_above + "%",
          categories: r.categories.slice(0, 5),
        })),
      };
    }

    if (metric === "total_fees") {
      const rows = await sql`
        SELECT ct.institution_name, ct.state_code, ct.charter_type, ct.asset_size_tier,
               COUNT(*) as fee_count
        FROM published_fee_catalog ef
        JOIN institution_sources ct ON ef.institution_id = ct.id
        WHERE ef.review_status = 'approved' ${charterClause}
        GROUP BY ct.id, ct.institution_name, ct.state_code, ct.charter_type, ct.asset_size_tier
        ORDER BY fee_count DESC
        LIMIT ${n}
      ` as { institution_name: string; state_code: string; charter_type: string; asset_size_tier: string; fee_count: number }[];

      return { metric, results: rows };
    }

    if (metric === "outlier_flags") {
      const rows = await sql`
        SELECT ct.institution_name, ct.state_code, ct.charter_type, ct.asset_size_tier,
               COUNT(*) as flag_count
        FROM published_fee_catalog ef
        JOIN institution_sources ct ON ef.institution_id = ct.id
        WHERE ef.validation_flags IS NOT NULL AND ef.validation_flags != '[]'
          AND ef.review_status = 'approved' ${charterClause}
        GROUP BY ct.id, ct.institution_name, ct.state_code, ct.charter_type, ct.asset_size_tier
        ORDER BY flag_count DESC
        LIMIT ${n}
      ` as { institution_name: string; state_code: string; charter_type: string; asset_size_tier: string; flag_count: number }[];

      return { metric, results: rows };
    }

    return { error: "Unknown metric" };
  },
});

export const queryJobStatus = tool({
  description:
    "Returns recent, active, or detailed agent run status. When: 'did the last run succeed?', 'what's running now?', run failure investigation. Combine with: getCollectionStatus for coverage impact of recent runs.",
  inputSchema: z.object({
    view: z
      .enum(["recent", "active", "detail"])
      .describe("'recent' for last 10 runs, 'active' for running/queued, 'detail' for a specific run"),
    jobId: z.number().optional().describe("Run ID for detail view"),
  }),
  execute: async ({ view, jobId }) => {
    if (view === "detail" && jobId) {
      const [run] = await sql`
        SELECT id, title, agent_name, run_kind, status, started_at, completed_at,
               updated_at, summary, error_summary
          FROM agent_runs
         WHERE id = ${jobId}
      `;
      return run || { error: "Run not found" };
    }
    if (view === "active") {
      return await sql`
        SELECT id, title, agent_name, run_kind, status, triggered_by, started_at
          FROM agent_runs
         WHERE status IN ('running', 'queued')
           AND run_kind IN ('workflow', 'workflow_lane', 'report', 'manual_repair', 'dry_run')
         ORDER BY started_at DESC
      `;
    }
    return await sql`
      SELECT id, title, agent_name, run_kind, status, triggered_by, started_at, completed_at, summary
        FROM agent_runs
       WHERE run_kind IN ('workflow', 'workflow_lane', 'report', 'manual_repair', 'dry_run')
       ORDER BY started_at DESC
       LIMIT 10
    `;
  },
});

export const queryDataQuality = tool({
  description:
    "Returns data quality metrics: funnel (coverage), uncategorized fees, stale institutions, published review_status breakdown. When: coverage gap questions, data hygiene review, pre-analysis quality check. Combine with: getCollectionStatus for pipeline health, queryNationalData(fee_index) to contextualize coverage against category depth.",
  inputSchema: z.object({
    view: z
      .enum(["funnel", "uncategorized", "stale", "review_status"])
      .describe("Which quality metric to query"),
  }),
  execute: async ({ view }) => {
    if (view === "funnel") {
      const [row] = await sql`
        SELECT
          (SELECT COUNT(*) FROM institution_sources) as total_institutions,
          (SELECT COUNT(*) FROM institution_sources WHERE fee_schedule_url IS NOT NULL) as with_fee_url,
          (SELECT COUNT(DISTINCT institution_id) FROM published_fee_catalog) as with_fees,
          (SELECT COUNT(DISTINCT institution_id) FROM published_fee_catalog) as with_approved,
          (SELECT COUNT(*) FROM published_fee_catalog) as total_fees,
          (SELECT COUNT(*) FROM published_fee_catalog) as approved_fees
      `;
      return row;
    }
    if (view === "uncategorized") {
      const [count] = await sql`
        SELECT COUNT(*) as cnt FROM published_fee_catalog WHERE fee_category IS NULL
      ` as { cnt: number }[];
      const top = await sql`
        SELECT fee_name, COUNT(*) as cnt FROM published_fee_catalog
        WHERE fee_category IS NULL
        GROUP BY fee_name ORDER BY cnt DESC LIMIT 15
      `;
      return { total_uncategorized: count.cnt, top_names: top };
    }
    if (view === "stale") {
      const [stale] = await sql`
        SELECT COUNT(*) as cnt FROM institution_sources
        WHERE fee_schedule_url IS NOT NULL
          AND (last_crawl_at IS NULL OR last_crawl_at < NOW() - INTERVAL '90 days')
      ` as { cnt: number }[];
      return { stale_institutions: stale.cnt, threshold_days: 90 };
    }
    // Published status shape is kept for callers that still ask for review_status.
    return await sql`
      SELECT review_status, COUNT(*) as cnt
      FROM published_fee_catalog
      GROUP BY review_status
      ORDER BY cnt DESC
    `;
  },
});

const SAFE_PIPELINE_COMMANDS = new Set([
  "enhance", "classify", "verify", "review", "publish",
]);

const SAFE_PIPELINE_AGENTS: Record<string, AdminAgent> = {
  enhance: "atlas",
  classify: "darwin",
  verify: "darwin",
  review: "knox",
  // Publishing is Gutenberg's (#1075 step 2).
  publish: "gutenberg",
};

export const triggerPipelineJob = tool({
  description:
    "Creates a visible agentic run for an implemented pipeline step: enhance, classify, verify, review, publish. Does not launch retired external workers.",
  inputSchema: z.object({
    command: z.string().describe("Pipeline command name"),
    dryRun: z.boolean().optional().default(false).describe("If true, pass --dry-run flag"),
  }),
  execute: async ({ command, dryRun }) => {
    if (!SAFE_PIPELINE_COMMANDS.has(command)) {
      return { error: `Command '${command}' not allowed. Safe commands: ${[...SAFE_PIPELINE_COMMANDS].join(", ")}` };
    }
    try {
      const agent = SAFE_PIPELINE_AGENTS[command] ?? "atlas";
      const result = await startAgentRun({
        agent,
        kind: dryRun ? "dry_run" : "manual_repair",
        title: `Research-requested ${command}`,
        params: { command, dry_run: dryRun, source: "hamilton.research_tool" },
        triggeredBy: "hamilton",
        triggerSource: "agent",
        idempotencyKey: `research:${command}:${dryRun ? "dry-run" : "run"}`,
        steps: [
          {
            key: command,
            agent,
            title: `${dryRun ? "Dry-run" : "Run"} ${command}`,
            input: { dry_run: dryRun },
          },
        ],
        summary: "Agentic research-requested run accepted. Watch Atlas live status for step events.",
      });
      return { success: true, runId: result.run.id, reused: result.reused };
    } catch (e) {
      return { error: String(e) };
    }
  },
});

// ── Unified National Data Tool ───────────────────────────────────────────────

const VALID_SOURCES = ["call_reports", "economic", "health", "complaints", "fee_index", "derived", "fed_content", "labor", "demographics", "research", "deposits", "external"] as const;

export const queryNationalData = tool({
  description:
    "Query national summary data across all 12 source domains. Sources: call_reports (FDIC/NCUA revenue trends), economic (Fed Board and BLS rates, Beige Book themes), health (ROA, efficiency, deposits, loans), complaints (CFPB district summaries), fee_index (national/peer fee medians), derived (concentration, fee dependency), fed_content (Fed speeches/papers by district), labor (BLS unemployment, payroll, bank-fee CPI), demographics (Census ACS income/poverty by state), research (NY Fed + OFR financial stability data), deposits (FDIC SOD market share), external (admin-curated research, surveys, reports -- use 'query' param for full-text search). When: any macroeconomic, regional, or financial context question. Combine with: district analysis → economic+complaints+fed_content; compliance question → complaints+fee_index+fed_content; consumer impact → demographics+labor+fee_index; external context → external+fee_index for industry research alongside fee data.",
  inputSchema: z.object({
    source: z.enum(["call_reports", "economic", "health", "complaints", "fee_index", "derived", "fed_content", "labor", "demographics", "research", "deposits", "external"])
      .describe("Data source category to query"),
    view: z.string().optional()
      .describe("Specific view within the source (e.g., 'trend', 'by_tier', 'fred', 'concentration'). For external source, doubles as category filter."),
    query: z.string().optional()
      .describe("Search query text (used for external source full-text search)"),
    limit: z.number().optional().default(10)
      .describe("Limit results (for top_institutions, fee_index)"),
    quarters: z.number().optional().default(8)
      .describe("Number of quarters for trend data"),
    district: z.number().min(1).max(12).optional()
      .describe("Fed district number (for complaints, economic district view, fed_content)"),
    charter: z.enum(["bank", "credit_union"]).optional()
      .describe("Charter type filter; financial views select its canonical regulator"),
    financial_source: z.enum(["fdic", "ncua"]).optional()
      .describe("Financial views only: select bank deposit service charges (fdic) or NCUA broad credit-union fee income (ncua). Omit to return separate groups, never a pooled financial benchmark."),
    tiers: z.array(z.string()).optional()
      .describe("Asset size tier filter (for fee_index peer queries)"),
    top_n: z.number().optional().default(5)
      .describe("Top N for concentration analysis"),
    stateFips: z.string().optional()
      .describe("State FIPS code for demographics/deposits (e.g., '06' for California, '36' for New York)"),
    seriesIds: z.array(z.string()).optional()
      .describe("BLS series IDs for labor view (defaults to unemployment, payroll, bank fee CPI)"),
  }),
  execute: async ({ source, view, query, limit, quarters, district, charter, financial_source, tiers, top_n, stateFips, seriesIds }) => {
    const financialSource = financial_source ?? financialSourceForCharter(charter) ?? undefined;
    if (["call_reports", "health", "derived"].includes(source) && financial_source && charter && financialSourceForCharter(charter) !== financial_source) {
      return { error: "financial_source conflicts with the canonical charter: bank requires fdic; credit_union requires ncua." };
    }
    switch (source) {
      case "call_reports":
        return handleCallReports(view, quarters, limit, district, financialSource);
      case "economic":
        return handleEconomic(view, district);
      case "health":
        return handleHealth(view, quarters, financialSource);
      case "complaints":
        return handleComplaints(district);
      case "fee_index":
        return handleFeeIndex(charter, tiers, limit);
      case "derived":
        return handleDerived(view, top_n, quarters, financialSource);
      case "fed_content":
        return handleFedContent(district, limit ?? 10);
      case "labor":
        return handleLabor(seriesIds);
      case "demographics":
        return handleDemographics(stateFips);
      case "research":
        return handleResearch(limit ?? 20);
      case "deposits":
        return handleDeposits(stateFips, limit ?? 10);
      case "external":
        return handleExternal(query, view, limit);
      default:
        return { error: `Unknown source '${source}'. Valid sources: ${VALID_SOURCES.join(", ")}` };
    }
  },
});

function financialSources(source?: FinancialSource): readonly FinancialSource[] {
  return source ? [source] : FINANCIAL_SOURCES;
}

function financialGroup(source: FinancialSource) {
  return {
    source,
    financial_source: source,
    charter_type: source === "ncua" ? "credit_union" : "bank",
    fee_income_definition: financialMeasureDefinition(source),
    comparison_rule: "Financial measures are comparable only within this source and canonical charter. Do not rank, average, or combine bank deposit service charges with broader credit-union fee income. Time-series reporting populations can change; these aggregates do not establish constant-cohort or merger-adjusted growth.",
  };
}

async function handleCallReports(
  view: string | undefined,
  quarters: number,
  limit: number,
  district: number | undefined,
  source?: FinancialSource,
) {
  if (view && !["all", "trend", "top_institutions", "by_tier", "by_district"].includes(view)) {
    return { error: `Unknown call_reports view '${view}'. Valid: trend, top_institutions, by_tier, by_district` };
  }
  return { financial_groups: await Promise.all(financialSources(source).map(async (financialSource) => {
    const all = !view || view === "all";
    const [trend, topInstitutions, byTier, districtRevenue] = await Promise.all([
      all || view === "trend" ? getRevenueTrend(quarters, financialSource) : undefined,
      all || view === "top_institutions" ? getTopRevenueInstitutions(limit, financialSource) : undefined,
      all || view === "by_tier" ? getRevenueByTier(undefined, financialSource) : undefined,
      view === "by_district" ? getDistrictFeeRevenue(district ?? 1, undefined, financialSource) : undefined,
    ]);
    return {
      ...financialGroup(financialSource),
      units: "dollar amounts in thousands; historical groups are dated cross-sections; yoy_change_pct is withheld because comparable economic-cohort growth is not established",
      ...(trend === undefined ? {} : { trend }),
      ...(topInstitutions === undefined ? {} : { top_institutions: topInstitutions }),
      ...(byTier === undefined ? {} : { by_tier: byTier }),
      ...(districtRevenue === undefined ? {} : { district_revenue: districtRevenue }),
    };
  })) };
}

async function handleEconomic(view: string | undefined, district: number | undefined) {
  if (!view || view === "all") {
    const [national_summary, beige_book_themes, fred_summary] = await Promise.all([
      getNationalEconomicSummary(),
      getBeigeBookThemes(),
      getFredSummary(),
    ]);
    return { national_summary, beige_book_themes, fred_summary };
  }
  switch (view) {
    case "fred":
      return { fred_summary: await getFredSummary() };
    case "beige_book":
      return { beige_book_themes: await getBeigeBookThemes() };
    case "national":
      return { national_summary: await getNationalEconomicSummary() };
    case "district":
      if (!district) return { error: "district parameter required for economic district view" };
      return { district_summary: await getDistrictEconomicSummary(district) };
    default:
      return { error: `Unknown economic view '${view}'. Valid: fred, beige_book, national, district` };
  }
}

async function handleHealth(view: string | undefined, quarters: number, source?: FinancialSource) {
  if (view && !["all", "metrics", "by_charter", "deposits", "loans", "institution_counts"].includes(view)) {
    return { error: `Unknown health view '${view}'. Valid: metrics, by_charter, deposits, loans, institution_counts` };
  }
  return { financial_groups: await Promise.all(financialSources(source).map(async (financialSource) => {
    const all = !view || view === "all";
    const [metrics, deposits, loans, institutionCounts] = await Promise.all([
      all || view === "metrics" || view === "by_charter" ? getIndustryHealthMetrics(financialSource) : undefined,
      all || view === "deposits" ? getDepositGrowthTrend(quarters, financialSource) : undefined,
      all || view === "loans" ? getLoanGrowthTrend(quarters, financialSource) : undefined,
      all || view === "institution_counts" ? getInstitutionCountTrends(quarters, financialSource) : undefined,
    ]);
    return {
      ...financialGroup(financialSource),
      ...(metrics === undefined ? {} : { metrics: { ...metrics, unit: "percent" } }),
      ...(deposits === undefined ? {} : { deposits: growthWithUnits(deposits) }),
      ...(loans === undefined ? {} : { loans: growthWithUnits(loans) }),
      ...(institutionCounts === undefined ? {} : { institution_counts: institutionCounts.map((row) => ({
        ...row, unit: "count", field_units: { bank_change_pct: "percent", cu_change_pct: "percent" },
      })) }),
    };
  })) };
}

function growthWithUnits(trend: Awaited<ReturnType<typeof getDepositGrowthTrend>>) {
  if (!trend || !Array.isArray(trend.history)) return null;
  return {
    ...trend,
    unit: "percent",
    history: trend.history.map((row) => ({ ...row, field_units: { absolute: "thousands of dollars", yoy_pct: "percent" } })),
  };
}

async function handleComplaints(district: number | undefined) {
  if (!district) return { error: "district parameter required for complaints source" };
  return { complaints: await getDistrictComplaintSummary(district) };
}

async function handleFeeIndex(
  charter: string | undefined,
  tiers: string[] | undefined,
  limit: number
) {
  // #1924: each read's stamp travels with its figures, so an answer can cite it.
  if (charter || tiers) {
    const filters: { charter_type?: string; asset_tiers?: string[] } = {};
    if (charter) filters.charter_type = charter;
    if (tiers) filters.asset_tiers = tiers;
    const { entries, stamp } = await getPeerIndexStamped(filters);
    return { index: entries, dataset: datasetCitation(stamp) };
  }
  const { entries, stamp } = await getNationalIndexStamped();
  return { index: entries.slice(0, limit), dataset: datasetCitation(stamp) };
}

async function handleDerived(
  view: string | undefined,
  top_n: number,
  quarters: number,
  source?: FinancialSource,
) {
  if (view && !["all", "concentration", "dependency", "revenue_per_institution"].includes(view)) {
    return { error: `Unknown derived view '${view}'. Valid: concentration, dependency, revenue_per_institution` };
  }
  const all = !view || view === "all";
  // This is a fee-schedule aggregation, not call-report income: cross-charter prices remain comparable.
  const concentration = all || view === "concentration" ? await getRevenueConcentration(top_n) : undefined;
  return {
    ...(concentration === undefined ? {} : { concentration, concentration_basis: "Published fee-schedule prices and institution prevalence; not realized fee income" }),
    ...(view === "concentration" ? {} : { financial_groups: await Promise.all(financialSources(source).map(async (financialSource) => {
      const [dependency, revenuePerInstitution] = await Promise.all([
        all || view === "dependency" ? getFeeDependencyTrend(quarters, financialSource) : undefined,
        all || view === "revenue_per_institution" ? getRevenuePerInstitutionTrend(quarters, financialSource) : undefined,
      ]);
      return {
        ...financialGroup(financialSource),
        ...(dependency === undefined ? {} : { dependency: {
          ...dependency,
          unit: "percent",
          measure_definition: {
            measure: "fee_income_share_of_total_revenue",
            unit: "percent",
            period_basis: financialSource === "ncua" ? "year_to_date" : "standalone_quarter",
            definition: financialSource === "ncua" ? "Mean of each credit union's year-to-date broad fee income divided by year-to-date total revenue" : "Mean of each bank's quarterly deposit-account service charges divided by quarterly total revenue",
          },
        } }),
        ...(revenuePerInstitution === undefined ? {} : { revenue_per_institution: {
          ...revenuePerInstitution,
          unit: "USD",
          signals: { ...revenuePerInstitution.signals, unit: "percent" },
          measure_definition: { ...financialMeasureDefinition(financialSource), unit: "USD", aggregation: "mean income per reporting institution" },
        } }),
      };
    })) }),
  };
}

// ── New source handlers (Phase 36) ───────────────────────────────────────────

const BLS_LABOR_SERIES = ["LNS14000000", "CES0000000001", CPI_BANK_SERVICES_SERIES] as const;

async function handleFedContent(district: number | undefined, limit: number) {
  if (district) {
    const content = await getDistrictContent(district, limit);
    return {
      district,
      content: content.map((c) => ({
        type: c.content_type,
        title: c.title,
        speaker: c.speaker,
        published: c.published_at,
        description: c.description,
      })),
    };
  }
  const speeches = await getRecentSpeeches(limit);
  return {
    speeches: speeches.map((c) => ({
      type: c.content_type,
      title: c.title,
      speaker: c.speaker,
      district: c.fed_district,
      published: c.published_at,
    })),
  };
}

async function handleLabor(seriesIds: string[] | undefined) {
  const ids = seriesIds && seriesIds.length > 0 ? seriesIds : [...BLS_LABOR_SERIES];
  const indicators = await getLatestIndicators(ids);
  return { labor_indicators: indicators };
}

async function handleDemographics(stateFips: string | undefined) {
  if (!stateFips) {
    return {
      error: "stateFips parameter required for demographics source (e.g., '06' for California, '36' for New York)",
    };
  }
  const state = await getStateDemographics(stateFips);
  return { state_demographics: state };
}

async function handleResearch(limit: number) {
  const [nyfed, ofr] = await Promise.all([getNyFedData(limit), getOfrData(limit)]);
  return { nyfed_data: nyfed, ofr_data: ofr };
}

async function handleDeposits(stateFips: string | undefined, limit: number) {
  const data = await getSodMarketShare(stateFips);
  return { deposit_market_share: data.slice(0, limit) };
}

async function handleExternal(
  query: string | undefined,
  view: string | undefined,
  limit: number
) {
  if (query) {
    const category = view || undefined;
    const results = await searchExternalIntelligence(query, category ? { category } : undefined);
    return {
      query,
      results: results.map((r) => ({
        source_name: r.source_name,
        source_date: r.source_date,
        category: r.category,
        tags: r.tags,
        headline: r.headline,
        content_snippet: r.content_text.substring(0, 500),
        source_url: r.source_url,
        citation: `[Source: ${r.source_name}, ${r.source_date}]`,
      })),
      total: results.length,
    };
  }

  const { items, total } = await listIntelligence(limit, 0);
  return {
    items: items.map((r) => ({
      source_name: r.source_name,
      source_date: r.source_date,
      category: r.category,
      tags: r.tags,
      content_snippet: r.content_text.substring(0, 300),
      source_url: r.source_url,
      citation: `[Source: ${r.source_name}, ${r.source_date}]`,
    })),
    total,
  };
}

// ── Regulatory Risk Tool ──────────────────────────────────────────────────────

const REGULATED_FEE_CATEGORIES = [
  "overdraft",
  "nsf",
  "monthly_maintenance",
  "atm_non_network",
  "wire_domestic_outgoing",
] as const;

const REGULATORY_KEYWORDS = [
  "overdraft",
  "junk fee",
  "consumer protection",
  "fee",
  "cfpb",
  "enforcement",
] as const;

export const queryRegulatoryRisk = tool({
  description:
    "Assesses regulatory risk by cross-referencing fee outliers in scrutinized categories (overdraft, NSF, junk fees), CFPB complaint volumes for fee-related products, and recent Fed speeches mentioning enforcement signals. Returns risk score (0-100), affected institution count, and three signal sources. When: compliance risk questions, 'how many institutions face enforcement risk?', CFPB enforcement impact analysis, regulatory pressure on fee categories. Combine with: queryOutliers for institution-level outlier detail, queryNationalData(complaints) for district-level complaint breakdown, queryNationalData(fed_content) for full speech text.",
  inputSchema: z.object({
    categories: z
      .array(z.string())
      .optional()
      .describe(
        "Fee categories to assess (default: overdraft, nsf, monthly_maintenance, atm_non_network, wire_domestic_outgoing)"
      ),
    limit: z.number().optional().default(5).describe("Max outlier institutions to surface"),
  }),
  execute: async ({ categories, limit }) => {
    const targetCategories = categories && categories.length > 0
      ? categories
      : [...REGULATED_FEE_CATEGORIES];
    const n = limit ?? 5;

    // 1. Fee outlier signals — institutions above P75 in regulated categories
    const feeOutlierSignals = await (async () => {
      try {
        // Statistics contract: each institution's value vs. the category p75.
        const rows = await getContractFeeRows({ categories: targetCategories });
        const names = new Map(rows.map((r) => [r.institution_id, r.institution_name]));
        const outliers = institutionPositions(rows).filter((position) => position.value > position.p75);
        const uniqueInstitutions = [...new Set(outliers.map((position) => names.get(position.institution_id) ?? String(position.institution_id)))];
        const categoriesWithOutliers = [...new Set(outliers.map((position) => position.fee_category))];

        return {
          outlier_institution_count: uniqueInstitutions.length,
          top_institutions: uniqueInstitutions.slice(0, n),
          categories_with_outliers: categoriesWithOutliers,
        };
      } catch {
        return { outlier_institution_count: 0, top_institutions: [], categories_with_outliers: [] };
      }
    })();

    // 2. Complaint signals — fee-related CFPB products
    const complaintSignals = await (async () => {
      try {
        const national = await getNationalComplaintSummary();
        return {
          total_fee_complaints: national.total_complaints,
          fee_related_pct: national.fee_related_pct,
          average_per_institution: national.average_per_institution,
        };
      } catch {
        return { total_fee_complaints: 0, fee_related_pct: 0, average_per_institution: 0 };
      }
    })();

    // 3. Fed Content signals — recent speeches mentioning regulatory keywords
    const fedContentSignals = await (async () => {
      try {
        const speeches = await getRecentSpeeches(30);
        const relevant = speeches.filter((s) => {
          const text = `${s.title ?? ""} ${s.description ?? ""}`.toLowerCase();
          return REGULATORY_KEYWORDS.some((kw) => text.includes(kw));
        });
        return {
          signal_count: relevant.length,
          recent_titles: relevant.slice(0, 3).map((s) => ({
            title: s.title,
            speaker: s.speaker,
            published: s.published_at,
          })),
        };
      } catch {
        return { signal_count: 0, recent_titles: [] };
      }
    })();

    // Compute risk score: up to 33 points per signal source
    const outlierScore = Math.min(
      33,
      Math.round((feeOutlierSignals.outlier_institution_count / 100) * 33)
    );
    const complaintScore = Math.min(
      33,
      Math.round((Math.min(complaintSignals.total_fee_complaints, 1000) / 1000) * 33)
    );
    const fedScore = Math.min(34, fedContentSignals.signal_count * 10);
    const riskScore = Math.min(100, outlierScore + complaintScore + fedScore);

    return {
      risk_score: riskScore,
      risk_label: riskScore >= 70 ? "high" : riskScore >= 40 ? "moderate" : "low",
      signal_count:
        feeOutlierSignals.categories_with_outliers.length +
        (fedContentSignals.signal_count > 0 ? 1 : 0) +
        (complaintSignals.total_fee_complaints > 0 ? 1 : 0),
      affected_institutions: feeOutlierSignals.outlier_institution_count,
      fee_outlier_signals: feeOutlierSignals,
      complaint_signals: complaintSignals,
      fed_content_signals: fedContentSignals,
      categories_assessed: targetCategories,
    };
  },
});

/** All internal tools bundled for admin agent configs */
export const internalTools = {
  queryDistrictData,
  queryStateData,
  queryFeeRevenueCorrelation,
  queryOutliers,
  getCollectionStatus,
  getReviewQueueStats,
  searchInstitutionsByName,
  rankInstitutions,
  queryJobStatus,
  queryDataQuality,
  triggerPipelineJob,
  queryNationalData,
  queryRegulatoryRisk,
};
