import { tool } from "ai";
import { z } from "zod";
import {
  getFeeCategorySummaries,
  getFeeCategoryDetail,
} from "@/lib/data-store";
import { getNationalIndex, getPeerIndex } from "@/lib/data-store";
import {
  getInstitutionById,
  getFeesByInstitution,
  getFinancialsByInstitution,
  getInstitutionsByFilter,
} from "@/lib/data-store";
import {
  getInstitutionPeerRanking,
  getInstitutionRevenueTrend,
} from "@/lib/data-store/call-reports";
import { getInstitutionFeeScheduleEvidence } from "@/lib/data-store/institution";
import { getDisplayName, getFeeFamily, getFeeTier } from "@/lib/fee-taxonomy";
import { getFeePublicationStatusLabel } from "@/lib/institution-quality";

/**
 * Public tools — wrap the same logic as /api/v1/ routes but call DB directly
 * (avoids HTTP round-trip when running server-side in the same process).
 */

export const searchFees = tool({
  description:
    "Returns national statistics (median, P25, P75, min, max, institution count) for each fee category in the catalog. Optionally returns detailed breakdown for a single category by charter type, asset tier, Fed district, and state. When: fee benchmark questions, 'what is the national average overdraft fee?', category deep-dives. Combine with: searchIndex for filtered peer comparison, queryNationalData(complaints) when the category is overdraft/NSF (regulatory context adds value).",
  inputSchema: z.object({
    category: z
      .string()
      .optional()
      .describe(
        "Fee category slug (e.g., overdraft, nsf, monthly_maintenance). Omit for every category in the catalog."
      ),
  }),
  execute: async ({ category }) => {
    if (category) {
      const detail = await getFeeCategoryDetail(category);
      if (!detail || detail.fees.length === 0) {
        return { error: "Category not found", category };
      }
      return {
        category,
        display_name: getDisplayName(category),
        family: getFeeFamily(category),
        tier: getFeeTier(category),
        summary: {
          institution_count: new Set(
            detail.fees.map((f) => f.institution_id)
          ).size,
          observation_count: detail.fees.length,
        },
        by_charter_type: detail.by_charter_type,
        by_asset_tier: detail.by_asset_tier,
        by_fed_district: detail.by_fed_district,
        by_state: detail.by_state,
      };
    }

    const summaries = await getFeeCategorySummaries();
    return {
      total: summaries.length,
      data: summaries.map((s) => ({
        category: s.fee_category,
        display_name: getDisplayName(s.fee_category),
        family: getFeeFamily(s.fee_category),
        tier: getFeeTier(s.fee_category),
        median: s.median_amount,
        p25: s.p25_amount,
        p75: s.p75_amount,
        min: s.min_amount,
        max: s.max_amount,
        institution_count: s.institution_count,
      })),
    };
  },
});

export const searchIndex = tool({
  description:
    "Returns the national fee index or a filtered peer index with median, P25, P75 per category. Filter by state, charter type (bank/credit_union), or Fed district. When: peer benchmarking, 'how does District 7 compare to national?', charter-type comparison. Combine with: queryNationalData(economic) for macroeconomic context, queryNationalData(health) for ROA/efficiency alongside fee positioning.",
  inputSchema: z.object({
    state: z
      .string()
      .optional()
      .describe("Two-letter state code (e.g., CA, TX)"),
    charter: z
      .enum(["bank", "credit_union"])
      .optional()
      .describe("Charter type filter"),
    district: z
      .string()
      .optional()
      .describe("Fed district number(s), comma-separated (e.g., 7 or 2,7,12)"),
  }),
  execute: async ({ state, charter, district }) => {
    const hasFilters = state || charter || district;

    const entries = hasFilters
      ? await getPeerIndex({
          state_code: state?.toUpperCase(),
          charter_type: charter,
          fed_districts: district
            ? district
                .split(",")
                .map((d) => parseInt(d, 10))
                .filter((d) => d >= 1 && d <= 12)
            : undefined,
        })
      : await getNationalIndex();

    return {
      scope: hasFilters ? "filtered" : "national",
      filters: { state: state ?? null, charter: charter ?? null, district: district ?? null },
      total: entries.length,
      data: entries.map((e) => ({
        category: e.fee_category,
        display_name: getDisplayName(e.fee_category),
        family: getFeeFamily(e.fee_category),
        median: e.median_amount,
        p25: e.p25_amount,
        p75: e.p75_amount,
        min: e.min_amount,
        max: e.max_amount,
        institution_count: e.institution_count,
        bank_count: e.bank_count,
        cu_count: e.cu_count,
      })),
    };
  },
});

export const searchInstitutions = tool({
  description:
    "Lists financial institutions with fee data, paginated, filterable by state and charter type. Returns id, name, state, city, charter type, asset size, fee count. When: browsing institutions, finding institutions to profile, narrowing a question to a specific segment. Combine with: getInstitution for a single institution's full fee profile, searchIndex(state:XX) for that state's fee benchmark.",
  inputSchema: z.object({
    state: z
      .string()
      .optional()
      .describe("Two-letter state code (e.g., NY, CA)"),
    charter: z
      .enum(["bank", "credit_union"])
      .optional()
      .describe("Charter type filter"),
    page: z.number().optional().default(1).describe("Page number (default 1)"),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Results per page (default 20, max 50)"),
  }),
  execute: async ({ state, charter, page, limit }) => {
    const pageSize = Math.min(limit ?? 20, 50);
    const filters: {
      charter_type?: string;
      state_code?: string;
      page: number;
      pageSize: number;
    } = { page: page ?? 1, pageSize };

    if (charter) filters.charter_type = charter;
    if (state) filters.state_code = state.toUpperCase();

    const { rows, total } = await getInstitutionsByFilter(filters);

    return {
      total,
      page: filters.page,
      page_size: pageSize,
      data: rows.map((r) => ({
        id: r.id,
        name: r.institution_name,
        state: r.state_code,
        city: r.city,
        charter_type: r.charter_type,
        asset_size: r.asset_size,
        asset_tier: r.asset_size_tier,
        fed_district: r.fed_district,
        fee_count: r.fee_count,
      })),
    };
  },
});

export const getInstitution = tool({
  description:
    "Returns a single institution's full profile: identity, public fee publication status, verified fees, provisional fees, financials, revenue trend, peer ranking, and quality signals. When: institution-specific queries, 'what does Bank X charge?', profiling a named institution, URL-seeded institution analysis. Combine with: searchIndex(charter:bank, district:N) to benchmark verified rows against peer group, queryNationalData(complaints) if the institution is in a region with elevated complaint rates.",
  inputSchema: z.object({
    id: z.number().describe("Institution ID"),
  }),
  execute: async ({ id }) => {
    const inst = await getInstitutionById(id);
    if (!inst) return { error: "Institution not found", id };

    const [feesRaw, financials, revenueTrend, peerRanking, evidence] = await Promise.all([
      getFeesByInstitution(id),
      getFinancialsByInstitution(id).catch(() => []),
      getInstitutionRevenueTrend(id).catch(() => []),
      getInstitutionPeerRanking(id).catch(() => null),
      getInstitutionFeeScheduleEvidence(id).catch(() => null),
    ]);
    const fees = feesRaw.filter((f) => f.review_status !== "rejected");
    const mapFee = (f: (typeof fees)[number]) => ({
        fee_name: f.fee_name,
        fee_category: f.fee_category ?? null,
        display_name: getDisplayName(f.fee_category ?? f.fee_name),
        amount: f.amount,
        frequency: f.frequency,
        conditions: f.conditions,
        status: f.review_status === "approved" ? "verified" : "provisional",
        extraction_confidence: f.extraction_confidence,
        source_url: f.source_url ?? null,
    });
    const verifiedFees = fees.filter((f) => f.review_status === "approved").map(mapFee);
    const catalogProvisionalFees = fees.filter((f) => f.review_status !== "approved").map(mapFee);
    const pipelineProvisionalFees =
      catalogProvisionalFees.length === 0 && evidence
        ? [
            ...evidence.verified_fee_preview
              .filter((f) => f.review_status !== "rejected")
              .map((f) => ({
                fee_name: f.fee_name,
                fee_category: f.canonical_fee_key,
                display_name: getDisplayName(f.canonical_fee_key),
                amount: f.amount,
                frequency: f.frequency,
                conditions: null,
                status: "provisional",
                extraction_confidence: f.extraction_confidence,
                source_url: f.source_url,
                pipeline_stage: "verified_unpublished",
              })),
            ...evidence.raw_fee_preview.map((f) => ({
              fee_name: f.fee_name,
              fee_category: null,
              display_name: getDisplayName(f.fee_name),
              amount: f.amount,
              frequency: f.frequency,
              conditions: f.conditions,
              status: "provisional",
              extraction_confidence: f.extraction_confidence,
              source_url: f.source_url,
              pipeline_stage: "raw_unverified",
            })),
          ]
        : [];
    const provisionalFees = [...catalogProvisionalFees, ...pipelineProvisionalFees];
    const status = inst.fee_publication_status ?? "unavailable";

    return {
      identity: {
        id: inst.id,
        name: inst.institution_name,
        state: inst.state_code,
        city: inst.city,
        charter_type: inst.charter_type,
        asset_size: inst.asset_size,
        asset_tier: inst.asset_size_tier,
        fed_district: inst.fed_district,
        website_url: inst.website_url,
        fee_schedule_url: inst.fee_schedule_url,
      },
      public_fee_status: {
        status,
        label: getFeePublicationStatusLabel(status),
        insight_readiness: inst.insight_readiness ?? "source_needed",
        confidence_summary: inst.confidence_summary ?? null,
        source_needed_reason: inst.source_needed_reason ?? null,
        verified_fee_count: inst.published_fee_count ?? verifiedFees.length,
        provisional_fee_count: inst.provisional_fee_count ?? provisionalFees.length,
        total_visible_fee_count: fees.length,
        latest_source_status: inst.latest_source_status ?? null,
        latest_extracted_fee_count: inst.latest_extracted_fee_count ?? null,
        latest_source_collected_at: inst.latest_source_collected_at ?? null,
      },
      fees: {
        verified: verifiedFees,
        provisional: provisionalFees,
      },
      financials: {
        latest: financials[0] ?? null,
        records: financials.slice(0, 8),
      },
      revenue_trend: revenueTrend,
      peer_ranking: peerRanking,
      quality: {
        label: inst.quality_label ?? null,
        status: inst.quality_status ?? null,
        signals: inst.quality_signals ?? [],
      },
    };
  },
});

/** All public tools bundled for agent configs */
export const publicTools = {
  searchFees,
  searchIndex,
  searchInstitutions,
  getInstitution,
};
