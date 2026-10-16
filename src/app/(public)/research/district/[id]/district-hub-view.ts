import type { DistrictHubData, HubComplaintGroup } from "@/lib/data-store/district-hub";
import { HUB_FEES, MIN_COMPLAINT_PEERS } from "@/lib/data-store/district-hub";
import type { IndicatorSeries, IndicatorPoint } from "@/lib/data-store/economic-context";
import type { FeeChangeEvent } from "@/lib/data-store/fee-changes";
import { CPI_BANK_SERVICES_SERIES } from "@/lib/regulatory/fed";
import { getDisplayName, isFeaturedFee } from "@/lib/fee-taxonomy";
import { FDIC_TIER_LABELS, FDIC_TIER_ORDER } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";

/**
 * Pure shaping for the district hub: every figure the hub draws, computed from the one hub
 * read (district-hub.ts) and the district fee index. Nothing here invents a value: a figure
 * with no data is null and the page leaves it out.
 */

const FROST_BANK = /frost bank/i;

/** The hub fees a visitor may read: featured fees for free visitors, all of them in Pro. */
export function hubFeeKeys(showAll: boolean): string[] {
  return HUB_FEES.filter((k) => showAll || isFeaturedFee(k));
}

export interface StateHubRow {
  code: string;
  name: string;
  institutions: number;
  banks: number;
  creditUnions: number;
  withFees: number;
  /** Share of the state's institutions with verified fees, 0-100; null with no institutions. */
  coveragePct: number | null;
  fees: Record<string, { median: number | null; institutions: number }>;
  /** Fee income in the hub's latest complete quarter, whole dollars (banks: deposit service charges). */
  serviceCharges: number | null;
  bankBranches: number | null;
  cuBranches: number | null;
  /** Bank deposits in the state's branches, whole dollars. */
  deposits: number | null;
  unemployment: { rate: number; date: string } | null;
  payrollYoyPct: number | null;
  medianIncome: number | null;
}

/** Quarters in order with the newest dropped when fewer than 90% of the prior quarter's filers have reported yet. */
export function completeQuarters(hub: Pick<DistrictHubData, "revenue">): string[] {
  const counts = new Map<string, number>();
  for (const r of hub.revenue) counts.set(r.quarter, (counts.get(r.quarter) ?? 0) + r.institutions);
  const quarters = [...counts.keys()].sort();
  if (quarters.length >= 2) {
    const last = counts.get(quarters[quarters.length - 1])!;
    const prior = counts.get(quarters[quarters.length - 2])!;
    if (last < prior * 0.9) quarters.pop();
  }
  return quarters;
}

export interface RevenueQuarter {
  quarter: string;
  /** Whole dollars. */
  banks: number;
  creditUnions: number;
  total: number;
  institutions: number;
}

/** The district's quarterly fee income, banks and credit unions, oldest first. */
export function revenueTrend(hub: Pick<DistrictHubData, "revenue">): RevenueQuarter[] {
  const keep = new Set(completeQuarters(hub));
  const by = new Map<string, RevenueQuarter>();
  for (const r of hub.revenue) {
    if (!keep.has(r.quarter)) continue;
    const q = by.get(r.quarter) ?? { quarter: r.quarter, banks: 0, creditUnions: 0, total: 0, institutions: 0 };
    const dollars = r.total * 1_000;
    if (r.charter_type === "bank") q.banks += dollars;
    else if (r.charter_type === "credit_union") q.creditUnions += dollars;
    q.total += dollars;
    q.institutions += r.institutions;
    by.set(r.quarter, q);
  }
  return [...by.values()].sort((a, b) => a.quarter.localeCompare(b.quarter));
}

/** "2026-Q2" reads as "Q2 2026". */
export function quarterLabel(quarter: string): string {
  const m = quarter.match(/^(\d{4})-Q(\d)$/);
  return m ? `Q${m[2]} ${m[1]}` : quarter;
}

function latestPayrollYoy(series: IndicatorSeries | undefined): number | null {
  if (!series?.year_ago || series.year_ago.value === 0) return null;
  return ((series.latest.value - series.year_ago.value) / series.year_ago.value) * 100;
}

/** One row per state of the district that has anything to show. */
export function stateHubRows(hub: DistrictHubData, states: string[]): StateHubRow[] {
  const quarters = completeQuarters(hub);
  const latest = quarters[quarters.length - 1] ?? null;
  return states
    .map((code) => {
      const groups = hub.institutions.filter((g) => g.state_code === code);
      const institutions = groups.reduce((s, g) => s + g.institutions, 0);
      const withFees = groups.reduce((s, g) => s + g.with_fees, 0);
      const revenue = latest ? hub.revenue.filter((r) => r.state_code === code && r.quarter === latest) : [];
      const bank = hub.branches?.by_state.find((b) => b.state_code === code);
      const cu = hub.branches?.cu_by_state.find((b) => b.state_code === code);
      const ur = hub.series[`${code}UR`];
      return {
        code,
        name: STATE_NAMES[code] ?? code,
        institutions,
        banks: groups.filter((g) => g.charter_type === "bank").reduce((s, g) => s + g.institutions, 0),
        creditUnions: groups.filter((g) => g.charter_type === "credit_union").reduce((s, g) => s + g.institutions, 0),
        withFees,
        coveragePct: institutions > 0 ? (withFees / institutions) * 100 : null,
        fees: hub.state_fees.find((s) => s.state_code === code)?.fees ?? {},
        serviceCharges: revenue.length > 0 ? revenue.reduce((s, r) => s + r.total, 0) * 1_000 : null,
        bankBranches: bank ? bank.branches : null,
        cuBranches: cu ? cu.branches : null,
        deposits: bank ? bank.deposits : null,
        unemployment: ur ? { rate: ur.latest.value, date: ur.latest.date } : null,
        payrollYoyPct: latestPayrollYoy(hub.series[`${code}NA`]),
        medianIncome: hub.demographics.find((d) => d.state_code === code)?.median_household_income ?? null,
      };
    })
    .filter((r) => r.institutions > 0 || r.bankBranches != null || r.unemployment != null);
}

export interface TierRow {
  tier: string;
  label: string;
  banks: number;
  creditUnions: number;
}

const OLD_TIER: Record<string, string> = {
  community_small: "micro",
  community_mid: "community",
  community_large: "midsize",
  large_regional: "regional",
  super_regional: "mega",
};

/** Institutions by asset size and charter, smallest first; institutions with no size on file are left out. */
export function tierMix(hub: Pick<DistrictHubData, "institutions">, state?: string): TierRow[] {
  const rows = new Map<string, TierRow>();
  for (const g of hub.institutions) {
    if (state && g.state_code !== state) continue;
    const tier = g.tier ? (OLD_TIER[g.tier] ?? g.tier) : null;
    if (!tier || !FDIC_TIER_LABELS[tier]) continue;
    const row = rows.get(tier) ?? { tier, label: FDIC_TIER_LABELS[tier], banks: 0, creditUnions: 0 };
    if (g.charter_type === "bank") row.banks += g.institutions;
    else if (g.charter_type === "credit_union") row.creditUnions += g.institutions;
    rows.set(tier, row);
  }
  return FDIC_TIER_ORDER.flatMap((t) => (rows.has(t) ? [rows.get(t)!] : [])).filter((r) => r.banks + r.creditUnions > 0);
}

export interface ComplaintRate {
  /** Fee complaints per $1B of deposits; null when fewer than MIN_COMPLAINT_PEERS institutions are matched. */
  rate: number | null;
  matched: number;
  feeComplaints: number;
}

function rateOf(groups: HubComplaintGroup[]): ComplaintRate {
  const matched = groups.reduce((s, g) => s + g.matched, 0);
  const withDeposits = groups.reduce((s, g) => s + g.with_deposits, 0);
  const deposits = groups.reduce((s, g) => s + g.deposits, 0);
  const rated = groups.reduce((s, g) => s + g.fee_complaints_rated, 0);
  const feeComplaints = groups.reduce((s, g) => s + g.fee_complaints, 0);
  // Deposits are in thousands: $1B is 1,000,000 thousand.
  const rate = withDeposits >= MIN_COMPLAINT_PEERS && deposits > 0 ? rated / (deposits / 1_000_000) : null;
  return { rate, matched, feeComplaints };
}

export interface ComplaintView {
  year: string;
  district: ComplaintRate;
  us: ComplaintRate;
  states: (ComplaintRate & { code: string; name: string })[];
}

/** District, U.S. and state fee complaint rates, each only from institutions with an accepted CFPB match. */
export function complaintView(hub: Pick<DistrictHubData, "complaints">, district: number, states: string[]): ComplaintView | null {
  const c = hub.complaints;
  if (!c) return null;
  const inDistrict = c.groups.filter((g) => g.fed_district === district);
  const view: ComplaintView = {
    year: c.year,
    district: rateOf(inDistrict),
    us: rateOf(c.groups),
    states: states
      .map((code) => ({ code, name: STATE_NAMES[code] ?? code, ...rateOf(inDistrict.filter((g) => g.state_code === code)) }))
      .filter((s) => s.matched > 0),
  };
  return view.district.matched > 0 ? view : null;
}

/** Price moves a district needs before the hub shows them; one or two read as noise. */
export const MIN_FEE_CHANGES = 5;

export interface FeeChangeSummary {
  up: number;
  down: number;
  added: number;
  removed: number;
  capped: boolean;
  recent: FeeChangeEvent[];
}

/** Price moves in the last twelve months; the list names only fees the visitor may read. */
export function feeChangeSummary(hub: Pick<DistrictHubData, "fee_changes" | "fee_changes_capped">, showAll: boolean, shown = 6): FeeChangeSummary | null {
  const changes = hub.fee_changes.filter((c) => !FROST_BANK.test(c.institution_name));
  if (changes.length < MIN_FEE_CHANGES) return null;
  const count = (t: FeeChangeEvent["change_type"]) => changes.filter((c) => c.change_type === t).length;
  return {
    up: count("increase"),
    down: count("decrease"),
    added: count("new"),
    removed: count("removed"),
    capped: hub.fee_changes_capped,
    recent: changes
      .filter((c) => (c.change_type === "increase" || c.change_type === "decrease") && (showAll || isFeaturedFee(c.fee_category)))
      .slice(0, shown),
  };
}

/** The 12-month change in the CPI for bank services, oldest first, for a trend line. */
export function cpiBankServices(hub: Pick<DistrictHubData, "series">): { latestPct: number; date: string; history: IndicatorPoint[] } | null {
  const s = hub.series[CPI_BANK_SERVICES_SERIES];
  if (!s) return null;
  const byDate = new Map(s.history.map((p) => [p.date, p.value]));
  const history: IndicatorPoint[] = [];
  for (const p of s.history) {
    const d = new Date(`${p.date}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    const prior = byDate.get(d.toISOString().slice(0, 10));
    if (prior) history.push({ date: p.date, value: ((p.value - prior) / prior) * 100 });
  }
  const last = history[history.length - 1];
  return last ? { latestPct: last.value, date: last.date, history } : null;
}

/** Fee names for the hub fees, short enough for a phone column. */
export const HUB_FEE_SHORT: Record<string, string> = {
  overdraft: "Overdraft",
  nsf: "NSF",
  monthly_maintenance: "Maintenance",
  atm_non_network: "Out-of-network ATM",
  wire_domestic_outgoing: "Outgoing wire",
};

export function hubFeeName(key: string): string {
  return HUB_FEE_SHORT[key] ?? getDisplayName(key);
}

/** "Jun 2026" from an ISO date. */
export function monthYear(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
