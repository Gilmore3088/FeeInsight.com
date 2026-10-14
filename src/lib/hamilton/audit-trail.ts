/**
 * The visible trail behind every Hamilton screen and deliverable, so a figure can be defended to
 * an examiner or a board: where each number came from, how current it is, the method applied,
 * every assumption, and whether it rests on market data or the bank's own figures. Built from data
 * the page already read; it never adds a figure of its own.
 */
import type { LocalMarketInfo, OwnFeeRow } from "./workspace/types";
import type { LayerSummary } from "./research-layers";
import { WORKSPACE_ENGINE_VERSION, type Provenance } from "./workspace/types";

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
  ownFeeRows: OwnFeeRow[];
  /** Figures the bank gave Hamilton, with who gave each one and when. */
  clientFacts: AuditClientFact[];
  /** The peer group the comparison rests on and how many institutions are in it. */
  peerGroup: { label: string; n: number } | null;
  /** The Hamilton engine version that built this output, so a saved copy names its maker. */
  engineVersion: string;
  preparedAt: string;
}

export interface AuditClientFact {
  label: string;
  value: string;
  givenBy: string | null;
  givenAt: string;
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
  ownFeeRows: OwnFeeRow[];
  local?: Pick<LocalMarketInfo, "basis" | "places" | "sodYear"> | null;
  callReport?: { quarter: string; source: string } | null;
  complaints?: boolean;
  /** Fee changes seen on published schedules in the bank's state (the engine's change feed). */
  stateChanges?: { state: string; days: number; asOf: string | null } | null;
  clientFigures?: { paidItems: number | null; waiverRate: number | null } | null;
  /** Who entered the client figures (the signed-in user's name). */
  enteredBy?: string | null;
  extraAssumptions?: string[];
  now?: Date;
}): AuditTrail {
  const preparedAt = (input.now ?? new Date()).toISOString();
  const sources: AuditSource[] = [];
  const layerSource = (layer: LayerSummary, dates: readonly (string | null)[]): AuditSource => {
    const range = publishedRange(dates);
    return {
      label: `${input.feeName} fees, ${layer.label}`,
      detail: `${layer.n} institutions: ${layer.scope.charAt(0).toLowerCase() + layer.scope.slice(1)}. Bank Fee Index published fee records.`,
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
      label: `Research institution ${input.feeName.toLowerCase()} fee`,
      detail: `${input.ownFeeRows.length} published ${input.ownFeeRows.length === 1 ? "line" : "lines"} from the research institution's fee schedule (listed below).`,
      asOf: dateOnly(latest),
      href: input.ownFeeRows.map((r) => r.documentUrl ?? r.sourceUrl).find(Boolean) ?? null,
    });
  }
  if (input.local) {
    sources.push({
      label: "Local market",
      detail:
        input.local.basis === "hq_city"
          ? `Institutions headquartered in ${input.local.places.join("; ")}. The research institution isn't in the FDIC Summary of Deposits, so the market uses its headquarters city.`
          : `Institutions with branches in ${input.local.places.join("; ")}, by deposits held there. FDIC Summary of Deposits.`,
      asOf: `June 30, ${input.local.sodYear}`,
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
      detail: "CFPB Consumer Complaint Database, matched to the research institution.",
      asOf: null,
      href: "https://www.consumerfinance.gov/data-research/consumer-complaints/",
    });
  }

  if (input.stateChanges) {
    sources.push({
      label: `Fee changes in ${input.stateChanges.state}`,
      detail: `Changes seen on published schedules in ${input.stateChanges.state}, last ${input.stateChanges.days} days. Bank Fee Index change records.`,
      asOf: dateOnly(input.stateChanges.asOf),
    });
  }

  const assumptions = [...(input.extraAssumptions ?? [])];
  const figures = input.clientFigures;
  const clientFacts: AuditClientFact[] = [];
  const givenBy = input.enteredBy ?? null;
  if (figures) {
    if (figures.paidItems != null) {
      clientFacts.push({ label: "Items charged a year", value: figures.paidItems.toLocaleString("en-US"), givenBy, givenAt: preparedAt });
    }
    if (figures.waiverRate != null) {
      clientFacts.push({ label: "Share waived or refunded", value: `${Math.round(figures.waiverRate * 1000) / 10}%`, givenBy, givenAt: preparedAt });
    }
    if (clientFacts.length === 0) assumptions.push("No volume assumed: without your figures, income is shown per 1,000 items only.");
  }

  return {
    evidence: clientFacts.length > 0 ? "Market data and your figures" : "Market data only",
    sources,
    method: STANDARD_METHOD,
    assumptions,
    ownFeeRows: input.ownFeeRows,
    clientFacts,
    peerGroup: input.layer ? { label: input.layer.label, n: input.layer.n } : null,
    engineVersion: WORKSPACE_ENGINE_VERSION,
    preparedAt,
  };
}

function factValue(value: unknown): string {
  if (typeof value === "number") return value > 0 && value < 1 ? `${Math.round(value * 1000) / 10}%` : value.toLocaleString("en-US");
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Plain words for the memory field keys the engine stores client figures under ("fee.overdraft.annual_items"). */
const FACT_LABELS: Record<string, string> = {
  annual_items: "Items charged a year",
  waiver_rate: "Share waived or refunded",
  affected_accounts: "Accounts affected",
};

function factLabel(fieldKey: string): string {
  const parts = fieldKey.split(".");
  const field = parts[parts.length - 1];
  const label = FACT_LABELS[field] ?? field.replace(/_/g, " ");
  return parts.length === 3 && parts[0] === "fee" ? `${label} (${parts[1].replace(/_/g, " ")})` : label;
}

/**
 * The engine's provenance (PR 170) as the panel's trail: every source with its link and date, the
 * peer group and its size, the engine version and build time, each assumption, and each figure the
 * bank gave with who gave it and when. Adds nothing the engine didn't record.
 */
export function provenanceToTrail(
  provenance: Provenance,
  opts: { method?: string[]; ownFeeRows?: OwnFeeRow[]; extraAssumptions?: string[] } = {},
): AuditTrail {
  const clientFacts: AuditClientFact[] = provenance.clientFacts.map((f) => ({
    label: factLabel(f.fieldKey),
    value: factValue(f.value),
    givenBy: f.givenBy,
    givenAt: f.givenAt,
  }));
  const asOfFor = (table: string | undefined, asOf: string | null | undefined): string | null => {
    if (asOf) return dateOnly(asOf);
    if (table === "published_fee_catalog") return dateOnly(provenance.dataAsOf.fees);
    if (table === "institution_financial_records") return dateOnly(provenance.dataAsOf.financials);
    if (table === "fee_change_records") return dateOnly(provenance.dataAsOf.changes);
    return null;
  };
  const evidence =
    clientFacts.length > 0 || (provenance.evidenceLevel && provenance.evidenceLevel !== "market")
      ? "Market data and your figures"
      : "Market data only";
  return {
    evidence,
    sources: provenance.sources.map((s) => ({
      label: s.label,
      detail: s.table ? `Bank Fee Index table ${s.table}.` : "",
      asOf: asOfFor(s.table, s.asOf),
      href: s.url ?? null,
    })),
    method: opts.method ?? STANDARD_METHOD,
    assumptions: [...provenance.assumptions, ...(opts.extraAssumptions ?? [])],
    ownFeeRows: opts.ownFeeRows ?? [],
    clientFacts,
    peerGroup: provenance.peerGroup ?? null,
    engineVersion: provenance.engineVersion,
    preparedAt: provenance.generatedAt,
  };
}
