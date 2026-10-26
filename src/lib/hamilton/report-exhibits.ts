/**
 * Consultant-style exhibits for Hamilton reports, built only from data:
 * local competitors by name, the peer range, and what each price move does per item
 * and to the fee's rank. No fee income figure is sized from a price gap: that needs the
 * institution's own yearly volume, which filings do not report (#1896). The model never
 * writes these tables; it receives the same numbers in its DATA payload.
 */
import { getDisplayName } from "@/lib/fee-taxonomy";
import { computePercentile } from "@/lib/data-store/fees";
import { FINANCIAL_SOURCES, isFinancialSource } from "@/lib/data-store/financial-sources";
import { formatAmount, formatCompactDollars } from "@/lib/format";
import { FEE_MOVES_TRACKED_SINCE, type LocalFeeMove, type LocalMarket } from "@/lib/data-store/local-market";
import type { SelectedInstitutionFeeDelta } from "./report-evidence";
import { statedFeeText, type SeveralFees } from "@/lib/own-fee";
import { proseFeeName } from "@/lib/hamilton/workspace/names";
import type { ReportExhibit, ReportSource } from "./types";

/** A local median needs at least this many competitors publishing the fee (James, 2026-10-25). */
export const MIN_LOCAL_COMPETITORS_FOR_MEDIAN = 5;
const MAX_EXHIBIT_FEES = 6;
const NAMED_COMPETITORS_PER_FEE = 3;
const MIN_GAP_TO_SIZE = 0.5;

export interface AnnualServiceCharges {
  year: number;
  /** Whole dollars. */
  amount: number;
  source: string;
}

export interface LocalFeeComparison {
  fee_category: string;
  fee: string;
  your_amount: number;
  local_median: number | null;
  local_min: number;
  local_max: number;
  local_competitor_count: number;
  position_vs_local: "above" | "below" | "at" | null;
  /**
   * The named competitors. `amount` is the stated price, except where `several` is present:
   * the competitor states several different fees, `amount` is their median (it counts toward
   * the local median and range only) and `several` gives their range and each fee by name.
   */
  competitors: Array<{ name: string; amount: number; several?: SeveralFees }>;
  /** Every local competitor's amount for this fee, lowest first (for ranks). */
  local_amounts: number[];
}

export type PeerBand = "below the median" | "above the median" | "below the 25th percentile" | "between the 25th percentile and the median" | "at the median" | "between the median and the 75th percentile" | "above the 75th percentile";

export interface FeeImpactEstimate {
  fee_category: string;
  fee: string;
  your_amount: number;
  reference: "local median" | "peer median";
  reference_amount: number;
  /** reference − yours: the change per item charged. No income figure: filings give no volume (#1896). */
  gap_amount: number;
  /** Price-move scenario: rank among local competitors plus this institution, 1 = lowest price. */
  local_rank_today: number | null;
  local_rank_at_reference: number | null;
  local_field_size: number | null;
  peer_band_today: PeerBand;
  peer_band_at_reference: PeerBand;
}

export interface ReportExhibitData {
  local_market: {
    area: string;
    basis: string;
    sod_year: number;
    competitors_with_fees: number;
    comparisons: LocalFeeComparison[];
  } | null;
  annual_service_charges: { year: number; income: number; display: string; source: string; label: string } | null;
  fee_impacts: FeeImpactEstimate[];
  /** Price changes by local competitors on these fees; null when no local market was found. */
  local_moves: {
    tracked_since: string;
    moves: Array<{ competitor: string; fee: string; previous_amount: number; new_amount: number; change_amount: number; detected: string }>;
  } | null;
}

export interface ReportExhibitsResult {
  data: ReportExhibitData;
  exhibits: ReportExhibit[];
  sources: ReportSource[];
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function signed(amount: number): string {
  return `${amount >= 0 ? "+" : "-"}${formatAmount(Math.abs(amount))}`;
}

function fewFees(deltas: SelectedInstitutionFeeDelta[]): SelectedInstitutionFeeDelta[] {
  return [...deltas]
    .sort((a, b) => Math.abs(b.delta_percent ?? 0) - Math.abs(a.delta_percent ?? 0))
    .slice(0, MAX_EXHIBIT_FEES);
}

export function buildLocalComparisons(
  deltas: SelectedInstitutionFeeDelta[],
  market: LocalMarket | null,
): LocalFeeComparison[] {
  if (!market) return [];
  return fewFees(deltas).flatMap((delta) => {
    const competitors = market.competitors
      .filter((c) => c.fees[delta.fee_category] !== undefined)
      .map((c) => {
        const several = c.several?.[delta.fee_category];
        return { name: cleanName(c.institution_name), amount: c.fees[delta.fee_category], ...(several ? { several } : {}) };
      });
    if (competitors.length === 0) return [];
    const amounts = competitors.map((c) => c.amount).sort((a, b) => a - b);
    const median =
      competitors.length >= MIN_LOCAL_COMPETITORS_FOR_MEDIAN ? round2(computePercentile(amounts, 50)) : null;
    const position =
      median === null
        ? null
        : Math.abs(delta.institution_amount - median) < 0.005
          ? "at"
          : delta.institution_amount > median
            ? "above"
            : "below";
    return [{
      fee_category: delta.fee_category,
      fee: getDisplayName(delta.fee_category),
      your_amount: delta.institution_amount,
      local_median: median,
      local_min: amounts[0],
      local_max: amounts[amounts.length - 1],
      local_competitor_count: competitors.length,
      position_vs_local: position,
      competitors: competitors.slice(0, NAMED_COMPETITORS_PER_FEE),
      local_amounts: amounts,
    }];
  });
}

/** Rank among the competitors plus this institution at `amount`, 1 = lowest price (ties share the better rank). */
export function cheapestRank(amount: number, competitorAmounts: number[]): number {
  return 1 + competitorAmounts.filter((other) => other < amount - 0.005).length;
}

export function peerBand(amount: number, p25: number | null, median: number, p75: number | null): PeerBand {
  if (Math.abs(amount - median) < 0.005) return "at the median";
  if (p25 === null || p75 === null) return amount < median ? "below the median" : "above the median";
  if (amount < p25 - 0.005) return "below the 25th percentile";
  if (amount < median) return "between the 25th percentile and the median";
  if (amount <= p75 + 0.005) return "between the median and the 75th percentile";
  return "above the 75th percentile";
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** The fee as a title names it: its prose name, with "fee" added only when the name lacks it. */
function feeInTitle(feeCategory: string): string {
  const name = proseFeeName(feeCategory);
  return /\bfees?$/i.test(name) ? name : `${name} fee`;
}

export function buildFeeImpacts(
  deltas: SelectedInstitutionFeeDelta[],
  local: LocalFeeComparison[],
): FeeImpactEstimate[] {
  const localByCategory = new Map(local.map((row) => [row.fee_category, row]));
  return fewFees(deltas).flatMap((delta) => {
    const localMedian = localByCategory.get(delta.fee_category)?.local_median ?? null;
    const reference = localMedian ?? delta.peer_median;
    const gap = round2(reference - delta.institution_amount);
    if (Math.abs(gap) < MIN_GAP_TO_SIZE) return [];
    const localRow = localByCategory.get(delta.fee_category);
    return [{
      fee_category: delta.fee_category,
      fee: getDisplayName(delta.fee_category),
      your_amount: delta.institution_amount,
      reference: localMedian !== null ? "local median" : "peer median",
      reference_amount: reference,
      gap_amount: gap,
      local_rank_today: localRow ? cheapestRank(delta.institution_amount, localRow.local_amounts) : null,
      local_rank_at_reference: localRow ? cheapestRank(reference, localRow.local_amounts) : null,
      local_field_size: localRow ? localRow.local_amounts.length + 1 : null,
      peer_band_today: peerBand(delta.institution_amount, delta.peer_p25, delta.peer_median, delta.peer_p75),
      peer_band_at_reference: peerBand(reference, delta.peer_p25, delta.peer_median, delta.peer_p75),
    }];
  });
}

export function buildReportExhibits(params: {
  institutionName: string;
  deltas: SelectedInstitutionFeeDelta[];
  peerLabel: string;
  market: LocalMarket | null;
  serviceCharges: AnnualServiceCharges | null;
  feeScheduleUrl?: string | null;
  /** Recent price changes by the local competitors (see getLocalFeeMoves). */
  moves?: LocalFeeMove[];
}): ReportExhibitsResult {
  const { institutionName, deltas, peerLabel, market, serviceCharges } = params;
  const moves = (params.moves ?? []).map((move) => ({
    competitor: cleanName(move.institution_name),
    fee: getDisplayName(move.fee_category),
    previous_amount: move.previous_amount,
    new_amount: move.new_amount,
    change_amount: round2(move.new_amount - move.previous_amount),
    detected: move.detected_at,
  }));
  const trackedSince = FEE_MOVES_TRACKED_SINCE.slice(0, 10);
  const local = buildLocalComparisons(deltas, market);
  const impacts = buildFeeImpacts(deltas, local);
  const exhibits: ReportExhibit[] = [];

  if (market && local.length > 0) {
    const ranked = local.filter((row) => row.position_vs_local !== null);
    const above = ranked.filter((row) => row.position_vs_local === "above").length;
    const below = ranked.filter((row) => row.position_vs_local === "below").length;
    const competitorCount = market.competitors.length;
    exhibits.push({
      id: "local_market",
      title:
        ranked.length > 0
          ? `Against ${competitorCount} local competitors, ${institutionName} is above the local median on ${above} of ${ranked.length} fees and below on ${below}`
          : `Fewer than ${MIN_LOCAL_COMPETITORS_FOR_MEDIAN} local competitors publish each of these fees, so they are named without a median`,
      subtitle: `Institutions with branches in the ${market.label}, largest local deposits first (FDIC Summary of Deposits ${market.sod_year}).`,
      columns: ["Fee", institutionName, "Local median", "Local range", "Competitors (largest first)"],
      rows: local.map((row) => [
        row.fee,
        formatAmount(row.your_amount),
        row.local_median !== null ? formatAmount(row.local_median) : `n=${row.local_competitor_count}, too few`,
        row.local_min === row.local_max ? formatAmount(row.local_min) : `${formatAmount(row.local_min)} to ${formatAmount(row.local_max)}`,
        row.competitors.map((c) => `${c.name} ${statedFeeText(c.amount, c.several)}`).join("; "),
      ]),
      note:
        market.basis === "hq_city"
          ? "Credit unions do not file branch deposits with the FDIC, so the market is the counties around the headquarters city."
          : "Only published, verified fee amounts are shown. A competitor missing from a row does not publish that fee in the documents we hold.",
    });
  }

  if (deltas.length > 0) {
    const rows = fewFees(deltas);
    const above = rows.filter((d) => d.position === "above_peer_median").length;
    const largest = rows[0];
    exhibits.push({
      id: "peer_range",
      title: `${above} of ${rows.length} fees sit above the ${peerLabel} median; the largest gap is the ${getDisplayName(largest.fee_category).toLowerCase()} at ${signed(largest.delta_amount)}`,
      subtitle: `${institutionName} against the middle half (25th to 75th percentile) of ${peerLabel}.`,
      columns: ["Fee", institutionName, "25th pct", "Median", "75th pct", "Peers", "Evidence"],
      rows: rows.map((d) => [
        getDisplayName(d.fee_category),
        formatAmount(d.institution_amount),
        formatAmount(d.peer_p25),
        formatAmount(d.peer_median),
        formatAmount(d.peer_p75),
        String(d.institution_count),
        d.evidence_tier,
      ]),
      note: null,
    });
  }

  // NCUA 5300 reports total fee income; the FDIC call report breaks out deposit service charges.
  const incomeLabel = serviceCharges?.source === "ncua" ? "fee income" : "deposit service charges";
  if (impacts.length > 0) {
    // Per item and rank only, as Try a price shows it: no per-1,000-charges or share-of-income
    // figure, because filings do not report how often a fee is charged (#1896).
    const largest = [...impacts].sort((a, b) => Math.abs(b.gap_amount) - Math.abs(a.gap_amount))[0];
    exhibits.push({
      id: "dollar_impact",
      title: `The largest price move is the ${feeInTitle(largest.fee_category)}: ${formatAmount(largest.your_amount)} to the ${largest.reference} of ${formatAmount(largest.reference_amount)}, ${signed(largest.gap_amount)} per item`,
      subtitle:
        "What each price move does: the change per item and where the fee would rank locally and against peers. Filings do not report how often each fee is charged, so no fee income figure is shown.",
      columns: ["Fee", "Move", "Change per item", "Local rank, lowest price first", `Against ${peerLabel}`],
      rows: impacts.map((i) => [
        i.fee,
        `${formatAmount(i.your_amount)} to ${formatAmount(i.reference_amount)} (${i.reference})`,
        signed(i.gap_amount),
        i.local_rank_today !== null && i.local_rank_at_reference !== null && i.local_field_size !== null
          ? `${ordinal(i.local_rank_today)} to ${ordinal(i.local_rank_at_reference)} of ${i.local_field_size}`
          : "No local comparison",
        i.peer_band_today === i.peer_band_at_reference ? `Stays ${i.peer_band_today}` : `From ${i.peer_band_today} to ${i.peer_band_at_reference}`,
      ]),
      note: "Ranks count only competitors that publish the fee, plus your institution.",
    });
  }

  if (moves.length > 0) {
    const raised = moves.filter((m) => m.change_amount > 0).length;
    exhibits.push({
      id: "competitor_moves",
      title: `${moves.length} local price ${moves.length === 1 ? "change" : "changes"} on these fees since ${trackedSince}: ${raised} up, ${moves.length - raised} down`,
      subtitle: "Changes seen when a competitor's newer fee schedule showed a new amount for the same fee, newest first.",
      columns: ["Competitor", "Fee", "Was", "Now", "Change", "Seen"],
      rows: moves.map((m) => [m.competitor, m.fee, formatAmount(m.previous_amount), formatAmount(m.new_amount), signed(m.change_amount), m.detected]),
      note: "The date is when a newer schedule was collected, not the competitor's own effective date.",
    });
  }

  const sources: ReportSource[] = [];
  if (params.feeScheduleUrl) {
    sources.push({ label: `${institutionName} fee schedule`, detail: "Published fee schedule used for every amount shown for your institution.", url: params.feeScheduleUrl });
  }
  if (serviceCharges) {
    sources.push({
      label: `${serviceCharges.year} ${incomeLabel}`,
      detail: `${serviceCharges.source === "ncua" ? "NCUA 5300 call report" : "FDIC call report"}, full year.`,
      url: null,
    });
  }
  if (market) {
    sources.push({ label: `Local market: ${market.label}`, detail: `FDIC Summary of Deposits ${market.sod_year}.`, url: null });
    const named = new Set(local.flatMap((row) => row.competitors.map((c) => c.name)));
    for (const competitor of market.competitors) {
      const name = cleanName(competitor.institution_name);
      if (!named.has(name) || !competitor.document_url) continue;
      sources.push({
        label: `${name} fee schedule`,
        detail: competitor.document_date ? `Published amounts as of ${competitor.document_date}.` : "Published amounts.",
        url: competitor.document_url,
      });
    }
  }

  return {
    data: {
      local_market:
        market && local.length > 0
          ? {
              area: market.label,
              basis: market.basis === "hq_city" ? "counties around the headquarters city" : "counties holding most of the institution's deposits",
              sod_year: market.sod_year,
              competitors_with_fees: market.competitors.length,
              comparisons: local,
            }
          : null,
      annual_service_charges: serviceCharges
        ? {
            year: serviceCharges.year,
            income: serviceCharges.amount,
            display: formatCompactDollars(serviceCharges.amount),
            source: serviceCharges.source,
            label: incomeLabel,
          }
        : null,
      fee_impacts: impacts,
      local_moves: market ? { tracked_since: trackedSince, moves } : null,
    },
    exhibits,
    sources,
  };
}

/**
 * Last complete calendar year of deposit service-charge income, in whole dollars.
 * FDIC rows are quarterly (ISERCHGQ), so a year is the sum of its four quarters;
 * NCUA rows are year-to-date, so a year is its December value. Both store income
 * in thousands. Rows from any other source (the ffiec duplicates) are ignored.
 */
export function annualServiceCharges(
  records: Array<{ report_date: string; source: string; service_charge_income: number | null }>,
): AnnualServiceCharges | null {
  const bySourceYear = new Map<string, Map<string, number>>();
  for (const record of records) {
    if (record.service_charge_income === null || !Number.isFinite(Number(record.service_charge_income))) continue;
    const source = String(record.source ?? "").toLowerCase();
    if (!isFinancialSource(source)) continue;
    const date = String(record.report_date).slice(0, 10);
    const key = `${source}|${date.slice(0, 4)}`;
    const quarters = bySourceYear.get(key) ?? new Map<string, number>();
    quarters.set(date.slice(5), Number(record.service_charge_income));
    bySourceYear.set(key, quarters);
  }
  const candidates: AnnualServiceCharges[] = [];
  for (const [key, quarters] of bySourceYear) {
    const [source, yearText] = key.split("|");
    const year = Number(yearText);
    let thousands: number | null = null;
    if (source === "fdic") {
      const ends = ["03-31", "06-30", "09-30", "12-31"];
      if (ends.every((end) => quarters.has(end))) thousands = ends.reduce((sum, end) => sum + (quarters.get(end) ?? 0), 0);
    } else if (quarters.has("12-31")) {
      thousands = quarters.get("12-31") ?? null;
    }
    if (thousands !== null && thousands > 0) candidates.push({ year, amount: Math.round(thousands * 1_000), source });
  }
  const preference: readonly string[] = FINANCIAL_SOURCES;
  candidates.sort((a, b) => b.year - a.year || preference.indexOf(a.source) - preference.indexOf(b.source));
  return candidates[0] ?? null;
}
