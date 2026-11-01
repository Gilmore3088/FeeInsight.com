import { getFeesByInstitution, getInstitutionById } from "@/lib/data-store";
import { getComplaintBenchmark, getInstitutionComplaintYears } from "@/lib/data-store/complaints";
import { getInstitutionOwnFees } from "@/lib/data-store/fee-index";
import { getInstitutionRegulators } from "@/lib/data-store/regulators";
import type { SavedFeeRef } from "@/lib/saved-output-corrections";
import { readFinancialPerformance } from "./financial-performance-read";
import { briefingFeeRefs, buildMonthlyBriefing, type CompetitionFeeInput, type MonthlyBriefing, type MonthlyBriefingInput } from "./monthly-briefing";
import { resolveHamiltonPeerIndex, type HamiltonPeerIndexContext } from "./peer-index";
import { regulatoryFacts } from "./workspace/regulators";
import { loadEconomy, loadWire } from "./workspace/research";
import { statePostFacts, wireFacts } from "./workspace/wire";

/** Overdraft is Hamilton's flagship fee: Regulation lists the rules and records that bear on it. */
const REGULATION_FEE = "overdraft";

/** The newest published row per fee category: its date and the schedule it came from. */
function ownFeeSources(rows: ReadonlyArray<{ fee_category?: string | null; created_at?: string | Date | null; source_url?: string | null }>): Map<string, { asOf: string | null; url: string | null }> {
  const out = new Map<string, { asOf: string | null; url: string | null }>();
  for (const row of rows) {
    if (!row.fee_category) continue;
    const asOf = row.created_at ? new Date(row.created_at).toISOString() : null;
    const seen = out.get(row.fee_category);
    if (!seen || (asOf && (!seen.asOf || asOf > seen.asOf))) out.set(row.fee_category, { asOf, url: row.source_url ?? null });
  }
  return out;
}

/**
 * Reads everything one monthly briefing needs, on request, from the readers the rest of Hamilton
 * uses: filed quarters, the saved peer set's medians, the state economy and the regulatory record.
 * A reader that fails leaves its section with a gap line; it never fails the whole briefing.
 * Deterministic: no model call.
 */
export async function readMonthlyBriefing(params: { institutionId: number; userId: number; now?: Date }): Promise<{ briefing: MonthlyBriefing; feeRefs: SavedFeeRef[]; peerIndex: HamiltonPeerIndexContext | null } | null> {
  const now = params.now ?? new Date();
  const institution = await getInstitutionById(params.institutionId);
  if (!institution) return null;
  const stateCode = institution.state_code ?? null;
  const regulatorsRead = getInstitutionRegulators(institution.id).catch(() => null);
  const [financial, peerIndex, ownFees, feeRows, economy, regulators, complaints, complaintBenchmark, wire] = await Promise.all([
    readFinancialPerformance(institution.id).catch(() => ({ view: null, peerReadFailed: true })),
    resolveHamiltonPeerIndex({ selectedInstitution: institution, institutionId: institution.id, userId: params.userId }).catch(() => null),
    getInstitutionOwnFees(institution.id).catch(() => null),
    getFeesByInstitution(institution.id).catch(() => []),
    loadEconomy(stateCode, institution.fed_district ?? null),
    regulatorsRead,
    getInstitutionComplaintYears(institution.id).catch(() => []),
    getComplaintBenchmark(institution.id).catch(() => null),
    regulatorsRead.then((r) => loadWire(stateCode, r?.primaryRegulator ?? null, now)).catch(() => null),
  ]);

  const sources = ownFeeSources(feeRows);
  const medians = new Map((peerIndex?.entries ?? []).map((e) => [e.fee_category, e]));
  const fees: CompetitionFeeInput[] = [];
  for (const [category, own] of ownFees ?? []) {
    const entry = medians.get(category);
    if (!entry || entry.median_amount === null) continue;
    fees.push({
      feeCategory: category,
      own: own.price,
      ownAsOf: sources.get(category)?.asOf ?? null,
      ownUrl: sources.get(category)?.url ?? null,
      peerMedian: entry.median_amount,
      peerCount: entry.institution_count,
    });
  }

  const ncua = financial.view?.source === "ncua" || institution.charter_type === "credit_union";
  const scope = { feeCategory: REGULATION_FEE, stateCode, primaryRegulator: regulators?.primaryRegulator ?? null, today: now };
  const input: MonthlyBriefingInput = {
    now,
    institution: { id: institution.id, name: institution.institution_name, charterType: institution.charter_type ?? null },
    financial: financial.view,
    financialPeerLabel: `${ncua ? "credit unions" : "banks"} in the same asset-size tier`,
    competition: peerIndex && ownFees
      ? { peerLabel: peerIndex.label, peerSource: peerIndex.source, fallbackReason: peerIndex.fallbackReason, peerAsOf: peerIndex.stamp?.readAt ?? null, fees }
      : null,
    economy,
    regulation: [
      ...regulatoryFacts({
        institutionName: institution.institution_name,
        feeCategory: REGULATION_FEE,
        stateCode,
        charterType: institution.charter_type,
        regulators,
        complaints,
        complaintBenchmark,
        readOn: now.toISOString().slice(0, 10),
      }),
      ...(wire ? [...wireFacts(wire, scope), ...statePostFacts(wire.posts, scope)] : []),
    ],
  };
  const briefing = buildMonthlyBriefing(input);
  return { briefing, feeRefs: briefingFeeRefs(institution.id, feeRows, briefing), peerIndex };
}
