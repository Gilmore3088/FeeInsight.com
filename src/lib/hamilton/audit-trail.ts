/**
 * The visible trail behind every Hamilton screen and deliverable, so a figure can be defended to
 * an examiner or a board: where each number came from, how current it is, the method applied,
 * every assumption, and whether it rests on market data or the bank's own figures. Built from data
 * the page already read; it never adds a figure of its own.
 */
import type { FeeEvidenceRow, LocalMarket } from "@/lib/data-store/fee-research";
import type { LayerSummary } from "./research-layers";

export interface AuditSource {
  label: string;
  detail: string;
  asOf: string | null;
  href?: string | null;
}

export interface AuditTrail {
  evidence: "Market data only" | "Market data and your figures";
  sources: AuditSource[];
  method: string[];
  assumptions: string[];
  /** The bank's own published rows behind "your fee", each traceable to its schedule. */
  ownFeeRows: FeeEvidenceRow[];
  preparedAt: string;
}

export const STANDARD_METHOD = [
  "Only published fees count: each was read from the institution's own fee schedule, checked against that document, and linked to it.",
  "One value per institution: the median of its published amounts for the fee, except overdraft, which counts at its highest tier.",
  "A real $0 fee counts as $0. An institution that hasn't published the fee is left out, not counted as $0.",
  "Medians and middle halves are shown only as computed; layers with too few institutions are marked.",
];

export function dateOnly(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/** The oldest and newest publish dates among a layer's institutions. */
export function publishedRange(dates: readonly (string | null)[]): { from: string; to: string } | null {
  const valid = dates.filter((d): d is string => Boolean(d)).sort();
  return valid.length ? { from: valid[0].slice(0, 10), to: valid[valid.length - 1].slice(0, 10) } : null;
}

export function buildAuditTrail(input: {
  feeName: string;
  layer: LayerSummary | null;
  layerDates: readonly (string | null)[];
  /** More layers a deliverable compares against, each listed as its own source. */
  extraLayers?: { layer: LayerSummary; dates: readonly (string | null)[] }[];
  ownFeeRows: FeeEvidenceRow[];
  local?: LocalMarket | null;
  callReport?: { quarter: string; source: string } | null;
  complaints?: boolean;
  clientFigures?: { paidItems: number | null; waiverRate: number | null } | null;
  extraAssumptions?: string[];
  now?: Date;
}): AuditTrail {
  const sources: AuditSource[] = [];
  const layerSource = (layer: LayerSummary, dates: readonly (string | null)[]): AuditSource => {
    const range = publishedRange(dates);
    return {
      label: `${input.feeName} fees, ${layer.label}`,
      detail: `${layer.n} institutions: ${layer.scope.toLowerCase()}. Bank Fee Index published fee records.`,
      asOf: range ? (range.from === range.to ? range.to : `${range.from} to ${range.to}`) : null,
    };
  };
  if (input.layer) sources.push(layerSource(input.layer, input.layerDates));
  for (const extra of input.extraLayers ?? []) {
    if (extra.layer.key !== input.layer?.key) sources.push(layerSource(extra.layer, extra.dates));
  }
  if (input.ownFeeRows.length > 0) {
    const latest = input.ownFeeRows.map((r) => r.publishedAt).filter(Boolean).sort().pop() ?? null;
    sources.push({
      label: `Your ${input.feeName.toLowerCase()} fee`,
      detail: `${input.ownFeeRows.length} published ${input.ownFeeRows.length === 1 ? "line" : "lines"} from your own fee schedule (listed below).`,
      asOf: dateOnly(latest),
      href: input.ownFeeRows.find((r) => r.sourceUrl)?.sourceUrl ?? null,
    });
  }
  if (input.local) {
    sources.push({
      label: "Local market",
      detail: `Branch deposits in your ${input.local.countyCount} ${input.local.countyCount === 1 ? "county" : "counties"}, FDIC Summary of Deposits.`,
      asOf: `June 30, ${input.local.year}`,
      href: "https://www.fdic.gov/resources/data-tools/summary-of-deposits",
    });
  }
  if (input.callReport) {
    sources.push({
      label: "Service charge income",
      detail: input.callReport.source,
      asOf: input.callReport.quarter,
    });
  }
  if (input.complaints) {
    sources.push({
      label: "Consumer complaints",
      detail: "CFPB Consumer Complaint Database, matched to your institution.",
      asOf: null,
      href: "https://www.consumerfinance.gov/data-research/consumer-complaints/",
    });
  }

  const assumptions = [...(input.extraAssumptions ?? [])];
  const figures = input.clientFigures;
  const hasFigures = Boolean(figures && (figures.paidItems != null || figures.waiverRate != null));
  if (figures) {
    if (figures.paidItems != null) {
      assumptions.push(`Items charged a year: ${figures.paidItems.toLocaleString("en-US")}, entered by you on this page.`);
    }
    if (figures.waiverRate != null) {
      assumptions.push(`Share waived or refunded: ${Math.round(figures.waiverRate * 1000) / 10}%, entered by you on this page.`);
    }
    if (!hasFigures) assumptions.push("No volume assumed: without your figures, income is shown per 1,000 items only.");
  }

  return {
    evidence: hasFigures ? "Market data and your figures" : "Market data only",
    sources,
    method: STANDARD_METHOD,
    assumptions,
    ownFeeRows: input.ownFeeRows,
    preparedAt: (input.now ?? new Date()).toISOString(),
  };
}
