/**
 * Server loaders for the Hamilton workspace: the Briefing and one fee's Research.
 * Deterministic reads of live data; no provider calls. Every figure comes from
 * published_fee_catalog, fee_change_records or institution_financial_records.
 */

import { sql } from "@/lib/data-store/connection";
import { getInstitutionById } from "@/lib/data-store/core";
import { getFeeChangeEvents } from "@/lib/data-store/fee-changes";
import { getInstitutionFeeValues, getPeerFeeValues, type PeerFeeValue } from "@/lib/data-store/fee-index";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { buildInstitutionPeerFilterCandidates, describePeerFilters, type HamiltonPeerFilters } from "../peer-index";
import {
  competitorMoveObservations,
  marketPositionObservations,
  rankObservations,
  revenueShiftObservation,
  type FeeChangeInput,
} from "./observations";
import { priceBands } from "./bands";
import { MIN_PEERS_FOR_POSITION } from "./scenario";
import { serviceChargeTrend, type ServiceChargeRow } from "./revenue";
import type { Briefing, Fact, FeeResearch, PeerValue } from "./types";

/** Competitor moves older than this are history, not news. */
export const COMPETITOR_MOVE_WINDOW_DAYS = 180;

interface CategoryPeers {
  label: string;
  values: PeerFeeValue[];
}

interface WorkspaceBase {
  institutionId: number;
  institutionName: string;
  stateCode: string | null;
  charterType: string;
  /** The narrowest default peer group, named on the Briefing. */
  peerLabel: string;
  ownValues: Map<string, number>;
  /** Per fee, the narrowest peer group with enough institutions publishing it. */
  peers: Map<string, CategoryPeers>;
}

function peerLabel(filters: HamiltonPeerFilters): string {
  return Object.keys(filters).length === 0 ? "Verified national index" : describePeerFilters(filters);
}

/**
 * Peers per fee: the first of the institution's default peer groups (state, charter, size
 * and district, then progressively wider, then national) where at least
 * MIN_PEERS_FOR_POSITION other institutions publish that fee.
 */
export function choosePeers(
  candidates: HamiltonPeerFilters[],
  valuesBySet: Map<string, PeerFeeValue[]>[],
  categories: string[],
): Map<string, CategoryPeers> {
  const chosen = new Map<string, CategoryPeers>();
  for (const category of categories) {
    for (const [index, filters] of candidates.entries()) {
      const values = valuesBySet[index]?.get(category) ?? [];
      if (values.length >= MIN_PEERS_FOR_POSITION || index === candidates.length - 1) {
        chosen.set(category, { label: peerLabel(filters), values });
        break;
      }
    }
  }
  return chosen;
}

async function loadBase(institutionId: number, categories?: string[]): Promise<WorkspaceBase | null> {
  const institution = await getInstitutionById(institutionId);
  if (!institution) return null;
  const ownValues = await getInstitutionFeeValues(institutionId, categories);
  const wanted = categories ?? [...ownValues.keys()];
  const candidates: HamiltonPeerFilters[] = [...buildInstitutionPeerFilterCandidates(institution), {}];
  const valuesBySet = await getPeerFeeValues(candidates, wanted, institutionId);
  return {
    institutionId,
    institutionName: institution.institution_name,
    stateCode: institution.state_code,
    charterType: institution.charter_type,
    peerLabel: peerLabel(candidates[0]),
    ownValues,
    peers: choosePeers(candidates, valuesBySet, wanted),
  };
}

function sinceDate(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function loadStateChanges(stateCode: string | null, feeCategory?: string): Promise<FeeChangeInput[]> {
  if (!stateCode) return [];
  const events = await getFeeChangeEvents({
    state_code: stateCode,
    since: sinceDate(COMPETITOR_MOVE_WINDOW_DAYS),
    limit: 500,
  });
  return events
    .filter((e) => !feeCategory || e.fee_category === feeCategory)
    .map((e) => ({
      institutionName: e.institution_name,
      feeCategory: e.fee_category,
      oldAmount: e.old_amount,
      newAmount: e.new_amount,
      changedAt: e.changed_at,
    }));
}

async function loadServiceChargeRows(institutionId: number): Promise<ServiceChargeRow[]> {
  const rows = await sql`
    SELECT report_date, source, service_charge_income
      FROM institution_financial_records
     WHERE institution_id = ${institutionId}
       AND source IN ('fdic', 'ncua')
     ORDER BY report_date DESC
     LIMIT 24`;
  return rows.map((r) => ({
    report_date: String(r.report_date).slice(0, 10),
    source: String(r.source),
    service_charge_income: r.service_charge_income === null ? null : Number(r.service_charge_income),
  }));
}

export async function getWorkspaceBriefing(institutionId: number, now = new Date()): Promise<Briefing | null> {
  const base = await loadBase(institutionId);
  if (!base) return null;
  const [changes, financialRows] = await Promise.all([
    loadStateChanges(base.stateCode),
    loadServiceChargeRows(institutionId),
  ]);
  const positions = [...base.ownValues].map(([feeCategory, current]) => {
    const peers = base.peers.get(feeCategory);
    return {
      feeCategory,
      current,
      peers: (peers?.values ?? []).map((p) => p.amount),
      peerLabel: peers?.label ?? base.peerLabel,
    };
  });
  const shift = revenueShiftObservation(serviceChargeTrend(financialRows));
  const observations = rankObservations([
    ...marketPositionObservations(positions),
    ...competitorMoveObservations(changes, new Set(base.ownValues.keys()), base.stateCode ?? "your state"),
    ...(shift ? [shift] : []),
  ]);
  return {
    institutionId,
    institutionName: base.institutionName,
    observations,
    feesReviewed: base.ownValues.size,
    peerLabel: base.peerLabel,
    generatedAt: now.toISOString(),
  };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)) * 100) / 100;
}

export async function getFeeResearch(institutionId: number, feeCategory: string): Promise<FeeResearch | null> {
  const base = await loadBase(institutionId, [feeCategory]);
  if (!base) return null;
  const changes = await loadStateChanges(base.stateCode, feeCategory);
  const chosen = base.peers.get(feeCategory);
  const peers: PeerValue[] = (chosen?.values ?? []).map((p) => ({
    institutionId: p.institution_id,
    institutionName: p.institution_name,
    amount: p.amount,
    stateCode: p.state_code,
  }));
  const sorted = peers.map((p) => p.amount).sort((a, b) => a - b);
  const current = base.ownValues.get(feeCategory) ?? null;
  const recentChanges: Fact[] = changes
    .filter((c) => c.oldAmount !== null && c.newAmount !== null)
    .slice(0, 10)
    .map((c) => ({
      text: `${c.institutionName}: $${c.oldAmount} to $${c.newAmount}, seen ${c.changedAt.slice(0, 10)}.`,
      source: { label: "Fee changes seen on published schedules", table: "fee_change_records", asOf: c.changedAt.slice(0, 10) },
    }));
  return {
    institutionId,
    institutionName: base.institutionName,
    feeCategory,
    displayName: getDisplayName(feeCategory),
    current,
    peerLabel: chosen?.label ?? base.peerLabel,
    peers,
    band: sorted.length > 0
      ? { p25: quantile(sorted, 0.25), median: quantile(sorted, 0.5), p75: quantile(sorted, 0.75), n: sorted.length }
      : null,
    bands: priceBands(sorted, current),
    // Named local competitors arrive with the local-market reader (PR 93).
    localCompetitors: null,
    recentChanges,
    // Per-fee income lines (NCUA overdraft and NSF fee income, the bank overdraft line)
    // are not stored yet; until they are, scenarios stay at the market level.
    revenueLine: null,
  };
}
