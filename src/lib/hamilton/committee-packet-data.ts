/**
 * Server reads for the pricing committee packet. Every read is an existing governed reader:
 * - fees and peers: getEngineFeePeers (published_fee_catalog via getPeerFeeValues /
 *   getInstitutionFeeValues; the same peer choice as Research) and getInstitutionFeeRows;
 * - quarter on quarter: getQuarterlyChanges (hamilton_briefing_snapshots);
 * - peer fee changes: loadConfirmedFeeChanges (fee_change_records, borne out by each schedule);
 * - filed income trend: getEngineFeePeers' financials (institution_financial_records);
 * - rules: loadWire + wireFacts (reg_tracker_items, institution_enforcement_actions);
 * - price and yield: getFeeRevenueDataCached (institution_financial_records, latest quarter).
 * Read-only and deterministic: no provider calls, no writes. Each read fails to empty on its own,
 * so a missing piece becomes one line under "Not available in this packet" rather than taking the
 * packet down.
 */
import { getFeeRevenueDataCached } from "@/lib/data-store/public-cached-reads";
import { getInstitutionFeeRows, getInstitutionFeeValues } from "@/lib/data-store/fee-index";
import { getWatchedFeeCategories } from "@/lib/data-store/hamilton-workspace";
import { getInstitutionRegulators } from "@/lib/data-store/regulators";
import { loadConfirmedFeeChanges } from "@/lib/report-assemblers/monthly-pulse";
import { getActivePeerSet } from "./active-peer-set";
import { getQuarterlyChanges } from "./briefing-snapshots";
import {
  buildCommitteePacket,
  MAX_PACKET_FEES,
  previousQuarterStart,
  type CommitteePacket,
  type PacketChange,
  type PacketFeeInput,
  type PacketIncomeRow,
} from "./committee-packet";
import { FEATURED_FEES } from "./fee-workspace-data";
import { getEngineFeePeers, loadWire } from "./workspace/research";
import { wireFacts } from "./workspace/wire";
import type { Fact } from "./workspace/types";

/** The watchlist's fees, else the bank's published fees with the featured ones first. */
export async function packetFeeList(userId: number, institutionId: number): Promise<{ fees: string[]; source: "watchlist" | "published" }> {
  const watched = await getWatchedFeeCategories(userId);
  if (watched.length) return { fees: watched.slice(0, MAX_PACKET_FEES), source: "watchlist" };
  const own = await getInstitutionFeeValues(institutionId).catch(() => new Map<string, number>());
  const rank = (c: string) => {
    const i = (FEATURED_FEES as readonly string[]).indexOf(c);
    return i === -1 ? FEATURED_FEES.length : i;
  };
  const fees = [...own.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, MAX_PACKET_FEES);
  return { fees, source: "published" };
}

export async function loadCommitteePacket(params: {
  userId: number;
  institutionId: number;
  institutionName: string;
  yieldFee?: string | null;
  now?: Date;
}): Promise<CommitteePacket | null> {
  const now = params.now ?? new Date();
  const { userId, institutionId } = params;
  const [list, peerSet, quarterly, regulators] = await Promise.all([
    packetFeeList(userId, institutionId),
    getActivePeerSet({ userId, institutionId }).catch(() => null),
    getQuarterlyChanges(institutionId),
    getInstitutionRegulators(institutionId).catch(() => null),
  ]);
  const engine = list.fees.length
    ? await getEngineFeePeers(institutionId, list.fees, { peerSet }).catch((error) => {
        console.error("[committee-packet] engine read failed", error instanceof Error ? error.message : String(error));
        return null;
      })
    : null;
  if (list.fees.length && !engine) return null;
  // "Since last quarter": from the earlier stored copy when two are compared, else the start of the last quarter.
  const changesSince = quarterly?.kind === "diff" ? quarterly.diff.fromGeneratedAt.slice(0, 10) : previousQuarterStart(now.toISOString());
  const [ownRows, changes, wire, income] = await Promise.all([
    Promise.all(list.fees.map((fee) => getInstitutionFeeRows(institutionId, fee).catch(() => []))),
    loadConfirmedFeeChanges(`${changesSince}T00:00:00.000Z`).then((r) => r.changes).catch(() => []),
    loadWire(engine?.stateCode ?? null, regulators?.primaryRegulator ?? null, now).catch(() => null),
    getFeeRevenueDataCached().catch(() => []),
  ]);
  const fees: PacketFeeInput[] = (engine?.fees ?? []).map((fee, i) => ({
    feeCategory: fee.feeCategory,
    current: fee.current,
    peerLabel: fee.peerLabel,
    peers: fee.peers,
    ownRows: (ownRows[i] ?? []).map((r) => ({
      amount: r.amount,
      sourceDocumentId: r.sourceDocumentId,
      documentUrl: r.documentUrl,
      publishedAt: r.publishedAt,
      feeName: r.feeName,
      frequency: r.frequency,
      conditions: r.conditions,
    })),
  }));
  const packetChanges: PacketChange[] = changes
    .filter((c) => typeof c.institution_id === "number")
    .map((c) => ({
      institutionId: c.institution_id as number,
      institutionName: c.institution_name,
      feeCategory: c.fee_category,
      oldAmount: c.old_amount,
      newAmount: c.new_amount,
      changedAt: c.changed_at,
      scheduleUrl: c.schedule_url,
    }));
  const rules: Fact[] = wire
    ? list.fees.flatMap((feeCategory) => wireFacts(wire, { feeCategory, stateCode: engine?.stateCode ?? null, primaryRegulator: regulators?.primaryRegulator ?? null, today: now }))
    : [];
  const wanted = new Set([institutionId, ...fees.flatMap((f) => f.peers.map((p) => p.institutionId))]);
  const incomeRows: PacketIncomeRow[] = income
    .filter((r) => wanted.has(Number(r.institution_id)))
    .map((r) => ({
      institutionId: Number(r.institution_id),
      institutionName: r.institution_name,
      reportDate: r.report_date ?? null,
      source: r.financial_source ?? null,
      serviceChargeIncomeThousands: r.service_charge_income === null ? null : Number(r.service_charge_income),
      totalAssetsThousands: r.total_assets === null ? null : Number(r.total_assets),
      incomePer10kAssets: r.fee_income_ratio === null ? null : Number(r.fee_income_ratio),
    }));
  return buildCommitteePacket({
    institutionId,
    institutionName: engine?.institutionName ?? params.institutionName,
    generatedAt: now.toISOString(),
    peerSetLabel: peerSet?.label ?? null,
    feeListSource: list.source,
    fees,
    quarterly,
    changesSince,
    changes: packetChanges,
    financials: engine?.financials ?? null,
    rules,
    income: incomeRows,
    yieldFee: params.yieldFee ?? null,
  });
}
