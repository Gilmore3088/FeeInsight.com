/**
 * Consultant-style exhibits for Hamilton reports, built only from data:
 * local competitors by name, the peer range, and dollar sensitivity from the
 * institution's own call report / 5300 service-charge income. The model never
 * writes these tables; it receives the same numbers in its DATA payload.
 */
import { getDisplayName } from "@/lib/fee-taxonomy";
import { computePercentile } from "@/lib/data-store/fees";
import { formatAmount, formatCompactDollars } from "@/lib/format";
import type { LocalMarket } from "@/lib/data-store/local-market";
import type { SelectedInstitutionFeeDelta } from "./report-evidence";
import type { ReportExhibit, ReportSource } from "./types";

/** A local median needs at least this many competitors publishing the fee. */
export const MIN_LOCAL_COMPETITORS_FOR_MEDIAN = 3;
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
  competitors: Array<{ name: string; amount: number }>;
}

export interface FeeImpactEstimate {
  fee_category: string;
  fee: string;
  your_amount: number;
  reference: "local median" | "peer median";
  reference_amount: number;
  /** reference − yours: positive means moving to the reference raises income. */
  gap_amount: number;
  /** Income change per 1,000 charges a year at the reference price, whole dollars. */
  income_per_1000_amount: number;
  /** That change as a percent of last full year's deposit service-charge income. */
  share_of_service_charges_pct: number | null;
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
      .map((c) => ({ name: cleanName(c.institution_name), amount: c.fees[delta.fee_category] }));
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
    }];
  });
}

export function buildFeeImpacts(
  deltas: SelectedInstitutionFeeDelta[],
  local: LocalFeeComparison[],
  serviceCharges: AnnualServiceCharges | null,
): FeeImpactEstimate[] {
  const localByCategory = new Map(local.map((row) => [row.fee_category, row]));
  return fewFees(deltas).flatMap((delta) => {
    const localMedian = localByCategory.get(delta.fee_category)?.local_median ?? null;
    const reference = localMedian ?? delta.peer_median;
    const gap = round2(reference - delta.institution_amount);
    if (Math.abs(gap) < MIN_GAP_TO_SIZE) return [];
    const per1000 = Math.round(gap * 1000);
    return [{
      fee_category: delta.fee_category,
      fee: getDisplayName(delta.fee_category),
      your_amount: delta.institution_amount,
      reference: localMedian !== null ? "local median" : "peer median",
      reference_amount: reference,
      gap_amount: gap,
      income_per_1000_amount: per1000,
      share_of_service_charges_pct:
        serviceCharges && serviceCharges.amount > 0
          ? Math.round((per1000 / serviceCharges.amount) * 1000) / 10
          : null,
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
}): ReportExhibitsResult {
  const { institutionName, deltas, peerLabel, market, serviceCharges } = params;
  const local = buildLocalComparisons(deltas, market);
  const impacts = buildFeeImpacts(deltas, local, serviceCharges);
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
        row.competitors.map((c) => `${c.name} ${formatAmount(c.amount)}`).join("; "),
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
    const largest = [...impacts].sort((a, b) => Math.abs(b.income_per_1000_amount) - Math.abs(a.income_per_1000_amount))[0];
    const largestText = `the ${largest.fee.toLowerCase()} gap is worth ${signed(largest.income_per_1000_amount).replace(".00", "")} per 1,000 charges a year`;
    exhibits.push({
      id: "dollar_impact",
      title: serviceCharges
        ? `${institutionName} earned ${formatCompactDollars(serviceCharges.amount)} in ${incomeLabel} in ${serviceCharges.year}; ${largestText}`
        : `At today's prices, ${largestText}`,
      subtitle:
        "Income change from moving each fee to the reference price, per 1,000 times it is charged a year. Filings do not report how often each fee is charged, so read across to your own volumes.",
      columns: ["Fee", "Yours", "Reference", "Gap", "Per 1,000 charges", serviceCharges ? `Share of ${serviceCharges.year} ${incomeLabel}` : `Share of ${incomeLabel}`],
      rows: impacts.map((i) => [
        i.fee,
        formatAmount(i.your_amount),
        `${formatAmount(i.reference_amount)} ${i.reference}`,
        signed(i.gap_amount),
        signed(i.income_per_1000_amount).replace(".00", ""),
        i.share_of_service_charges_pct !== null ? `${i.share_of_service_charges_pct.toFixed(1)}%` : "Not reported",
      ]),
      note: "An estimate of price, not volume: it assumes the same number of charges at the new price.",
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
    },
    exhibits,
    sources,
  };
}

/**
 * Last complete calendar year of deposit service-charge income, in whole dollars.
 * FDIC rows are quarterly (ISERCHGQ), so a year is the sum of its four quarters;
 * NCUA and FFIEC rows are year-to-date, so a year is its December value. Every
 * source stores income in thousands except FFIEC, which is over-scaled by 1,000.
 */
export function annualServiceCharges(
  records: Array<{ report_date: string; source: string; service_charge_income: number | null }>,
): AnnualServiceCharges | null {
  const bySourceYear = new Map<string, Map<string, number>>();
  for (const record of records) {
    if (record.service_charge_income === null || !Number.isFinite(Number(record.service_charge_income))) continue;
    const source = String(record.source ?? "").toLowerCase();
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
      thousands = source === "ffiec" ? (quarters.get("12-31") ?? 0) / 1_000_000 : quarters.get("12-31") ?? null;
    }
    if (thousands !== null && thousands > 0) candidates.push({ year, amount: Math.round(thousands * 1_000), source });
  }
  const preference = ["fdic", "ncua", "ffiec"];
  candidates.sort((a, b) => b.year - a.year || preference.indexOf(a.source) - preference.indexOf(b.source));
  return candidates[0] ?? null;
}
