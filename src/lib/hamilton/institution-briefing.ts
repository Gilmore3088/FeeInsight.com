import { financialSourceForCharter } from "@/lib/data-store/financial-peer-contract";
import { readerFeeConditions } from "@/lib/fee-conditions";
import {
  getFeesByInstitution,
  getFinancialsByInstitution,
  getInstitutionById,
} from "@/lib/data-store";
import {
  getInstitutionPeerRanking,
  getInstitutionRevenueTrend,
} from "@/lib/data-store/call-reports";
import { getInstitutionFeeScheduleEvidence } from "@/lib/data-store/institution";
import { getFeePublicationStatusLabel } from "@/lib/institution-quality";
import type { HamiltonRequestContract } from "@/lib/hamilton/request-contract";

const PEER_TIER_RANGES: Record<string, string> = {
  micro: "assets under $100M",
  community: "assets $100M to $1B",
  midsize: "assets $1B to $10B",
  regional: "assets $10B to $250B",
  mega: "assets over $250B",
};

function customerFeeRow(row: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...row };
  delete rest.confidence;
  delete rest.pipeline_stage;
  return rest;
}

/** institution_sources.asset_size is in thousands of dollars. */
function formatAssets(assetThousands: number | null | undefined): string {
  if (assetThousands === null || assetThousands === undefined || !Number.isFinite(assetThousands) || assetThousands <= 0) {
    return "unknown";
  }
  const dollars = assetThousands * 1_000;
  if (dollars >= 1e9) return `$${(dollars / 1e9).toFixed(1)}B`;
  return `$${(dollars / 1e6).toFixed(1)}M`;
}

type HamiltonBriefingContract = Pick<
  HamiltonRequestContract,
  "audience" | "intent" | "evidencePolicy" | "institutionId"
>;

/** Numeric facts are read-model fields, never numbers extracted from prompt prose. */
export interface HamiltonBriefingEvidence {
  institution_id: number;
  institution_name: string;
  context_role: "research" | "account_evidence";
  metric: string;
  value: number;
  unit: "USD" | "thousands of dollars" | "fraction" | "percent" | "count";
  report_date: string | null;
  period_basis: "point_in_time" | "ytd" | "quarter" | "reported_ratio" | "fee_schedule";
  source: string;
  publisher: string;
  evidence_tier: "regulatory" | "verified" | "provisional" | "registry";
  source_url?: string | null;
}

export interface HamiltonInstitutionBriefingSnapshot {
  prompt: string;
  evidence: HamiltonBriefingEvidence[];
}

interface HamiltonBriefingOptions {
  contextRole?: "research" | "account_evidence";
  /** Use dated filings, without the older mixed-charter ranking or unlineaged trend. */
  writtenAnswer?: boolean;
}

export async function buildHamiltonInstitutionBriefingSnapshot(
  contract: HamiltonBriefingContract,
  options: HamiltonBriefingOptions = {},
): Promise<HamiltonInstitutionBriefingSnapshot | null> {
  const institutionId = contract.institutionId;
  if (institutionId === null) return null;

  const [inst, fees, financials, revenueTrend, peerRanking, evidence] = await Promise.all([
    getInstitutionById(institutionId),
    getFeesByInstitution(institutionId).catch(() => []),
    getFinancialsByInstitution(institutionId).catch(() => []),
    options.writtenAnswer ? Promise.resolve([]) : getInstitutionRevenueTrend(institutionId).catch(() => []),
    options.writtenAnswer ? Promise.resolve(null) : getInstitutionPeerRanking(institutionId).catch(() => null),
    getInstitutionFeeScheduleEvidence(institutionId).catch(() => null),
  ]);

  if (!inst) return null;

  const visibleFees = fees.filter((fee) => fee.review_status !== "rejected");
  const verifiedFees = visibleFees.filter((fee) => fee.review_status === "approved");
  const provisionalFees = visibleFees.filter((fee) => fee.review_status !== "approved");
  const feeRows = [...verifiedFees.slice(0, 12), ...provisionalFees.slice(0, 12)].map((fee) => ({
    name: fee.fee_name,
    category: fee.fee_category ?? null,
    amount: fee.amount,
    frequency: fee.frequency,
    conditions: fee.conditions,
    status: fee.review_status === "approved" ? "verified" : "provisional",
    confidence: fee.extraction_confidence,
  }));
  const pipelineFeeRows =
    feeRows.length === 0 && evidence
      ? [
          ...evidence.verified_fee_preview
            .filter((fee) => fee.review_status !== "rejected")
            .map((fee) => ({
              name: fee.fee_name,
              category: fee.canonical_fee_key,
              amount: fee.amount,
              frequency: fee.frequency,
              conditions: null,
              status: "provisional",
              confidence: fee.extraction_confidence,
              pipeline_stage: "verified_unpublished",
            })),
          ...evidence.raw_fee_preview.map((fee) => ({
            name: fee.fee_name,
            category: null,
            amount: fee.amount,
            frequency: fee.frequency,
            conditions: readerFeeConditions(fee.conditions),
            status: "provisional",
            confidence: fee.extraction_confidence,
            pipeline_stage: "raw_unverified",
          })),
        ].slice(0, 18)
      : [];
  // Select the regulator from canonical identity; same-scale rows are not interchangeable.
  const expectedFinancialSource = financialSourceForCharter(inst.charter_type);
  const comparableFinancials = financials.filter((record) => expectedFinancialSource !== null && record.source === expectedFinancialSource);
  const latestFinancial = comparableFinancials[0] ?? null;
  const status = inst.fee_publication_status ?? "unavailable";
  // Operator-only fields (pipeline stage, extraction confidence, source and quality
  // codes) stay out of customer briefings so Hamilton cannot narrate them.
  const operator = contract.audience === "admin";
  const sampleRows: Array<Record<string, unknown>> = feeRows.length > 0 ? feeRows : pipelineFeeRows;
  const accountEvidence = options.contextRole === "account_evidence";
  const heading = accountEvidence
    ? "ACCOUNT INSTITUTION PUBLIC EVIDENCE (reference only; this does not change the research subject)"
    : "SELECTED INSTITUTION CONTEXT (treat this as the active institution; do not ask the user to identify it again)";

  const numericEvidence: HamiltonBriefingEvidence[] = [];
  const addEvidence = (fact: Omit<HamiltonBriefingEvidence, "institution_id" | "institution_name" | "context_role" | "value">, value: unknown) => {
    // Null and blank are missing, not zero. The readers return actual numeric fields.
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    numericEvidence.push({ institution_id: inst.id, institution_name: inst.institution_name,
      context_role: options.contextRole ?? "research", ...fact, value });
  };
  addEvidence({ metric: "registry_total_assets", unit: "thousands of dollars", report_date: null,
    period_basis: "point_in_time", source: "institution_sources", publisher: "Institution registry", evidence_tier: "registry" }, inst.asset_size);
  const sampledFees = [...verifiedFees.slice(0, 12), ...provisionalFees.slice(0, 12)];
  for (const fee of sampledFees) {
    addEvidence({ metric: `fee_schedule:${fee.fee_category ?? fee.fee_name}`, unit: "USD", report_date: null,
      period_basis: "fee_schedule", source: "published_fee_catalog", publisher: inst.institution_name,
      evidence_tier: fee.review_status === "approved" ? "verified" : "provisional", source_url: fee.source_url }, fee.amount);
  }
  if (sampledFees.length === 0) {
    for (const fee of pipelineFeeRows) {
      addEvidence({ metric: `fee_schedule:${fee.category ?? fee.name}`, unit: "USD", report_date: null,
        period_basis: "fee_schedule", source: fee.pipeline_stage, publisher: inst.institution_name,
        evidence_tier: "provisional" }, fee.amount);
    }
  }
  const financialFields = ["total_assets", "total_deposits", "service_charge_income", "total_revenue", "fee_income_ratio", "roa", "branch_count", "member_count", "employee_count"] as const;
  for (const record of comparableFinancials) {
    for (const metric of financialFields) {
      const ratio = metric === "fee_income_ratio" || metric === "roa";
      const count = metric === "branch_count" || metric === "member_count" || metric === "employee_count";
      const flow = metric === "service_charge_income" || metric === "total_revenue";
      addEvidence({ metric, unit: metric === "fee_income_ratio" ? "fraction" : metric === "roa" ? "percent" : count ? "count" : "thousands of dollars",
        report_date: record.report_date, period_basis: ratio ? "reported_ratio" : flow ? (record.source === "ncua" ? "ytd" : "quarter") : "point_in_time",
        source: record.source, publisher: record.source === "ncua" ? "NCUA" : "FDIC", evidence_tier: "regulatory" }, record[metric]);
    }
  }

  const financialContext = options.writtenAnswer
    ? `- Structured briefing evidence (each value carries its own institution, source, unit and period basis; null dates are undated context): ${JSON.stringify(numericEvidence)}
- NCUA service_charge_income is the broad filed fee-income line, not overdraft revenue or bank deposit service charges. NCUA income is year to date; a standalone quarter needs the same institution's prior quarter from the same year.
- A comparable peer ranking is not supplied here. Use a source-specific peer tool result before stating a peer position. Do not substitute a mixed bank/credit-union ranking or infer peer growth without a comparable cohort.\n`
    : `- Call Report figures below (financial record, revenue trend, peer ranking) are in thousands of dollars; fee_income_ratio is a fraction (0.068 = 6.8%). Peer ranking tier: ${peerRanking ? `${peerRanking.tier} (${PEER_TIER_RANGES[peerRanking.tier] ?? "by total assets"}), the peer group for the revenue rank` : "none"}.
- Latest financial record: ${latestFinancial ? JSON.stringify({
      report_date: latestFinancial.report_date,
      source: latestFinancial.source,
      total_assets: latestFinancial.total_assets,
      total_deposits: latestFinancial.total_deposits,
      service_charge_income: latestFinancial.service_charge_income,
      total_revenue: latestFinancial.total_revenue,
      fee_income_ratio: latestFinancial.fee_income_ratio,
      roa: latestFinancial.roa,
      branch_count: latestFinancial.branch_count,
    }) : "none"}
- Revenue trend: ${JSON.stringify(revenueTrend.slice(0, 8))}
- Peer ranking: ${peerRanking ? JSON.stringify(peerRanking) : "none"}\n`;

  const prompt = `\n\n${heading}:
- Institution ID: ${inst.id}
- Name: ${inst.institution_name}
- Location: ${[inst.city, inst.state_code].filter(Boolean).join(", ") || "unknown"}
- Charter: ${inst.charter_type ?? "unknown"}
- Total assets: ${formatAssets(inst.asset_size)}
- Fed district: ${inst.fed_district ?? "unknown"}
- Verified fee count: ${inst.published_fee_count ?? 0}
- Provisional fee count: ${inst.provisional_fee_count ?? 0}
- Confidence summary: ${inst.confidence_summary ?? "Official source evidence is needed before fee claims can be made."}
${operator ? `- Asset tier code: ${inst.asset_size_tier ?? "unknown"}
- Public fee publication status: ${getFeePublicationStatusLabel(status)} (${status})
- Insight readiness: ${inst.insight_readiness ?? "source_needed"}
- Quality label: ${inst.quality_label ?? "unknown"}
- Quality signals: ${(inst.quality_signals ?? []).map((signal) => `${signal.code}: ${signal.label}`).join("; ") || "none"}
- Latest source status: ${inst.latest_source_status ?? "unknown"}; collected at: ${inst.latest_source_collected_at ?? "unknown"}
` : ""}- Visible fee rows sample: ${JSON.stringify(operator ? sampleRows : sampleRows.map(customerFeeRow))}
${financialContext}

${accountEvidence ? "Account institution evidence rules" : "Selected institution workflow"}:
- Audience: ${contract.audience}
- Intent: ${contract.intent}
- Evidence policy: ${contract.evidencePolicy}
${accountEvidence ? "- These figures belong only to the named account institution. Keep the original research subject; never transfer either institution's figures to the other.\n" : ""}
- Separate verified evidence from provisional evidence.
- Do not use provisional fee rows in verified benchmark or score conclusions unless explicitly labeled as provisional/directional.
- ${contract.audience === "admin"
    ? "When data quality is weak, state the gap and give concrete diligence steps instead of filling in generic analysis."
    : "When data quality is weak, leave the weak rows out and say in one short sentence how confident the answer is. Do not describe duplicates, stale sources, provisional rows, missing source links or unit problems: those are internal data-quality work, not findings for the customer."}
- Prefer investor-grade, consulting-grade synthesis: implications, peer positioning, risks, and next decisions.\n`;
  return { prompt, evidence: numericEvidence };
}

/** Existing non-written consumers keep the string contract and their original context. */
export async function buildHamiltonInstitutionBriefing(
  contract: HamiltonBriefingContract,
  options: HamiltonBriefingOptions = {},
): Promise<string | null> {
  return (await buildHamiltonInstitutionBriefingSnapshot(contract, options))?.prompt ?? null;
}
