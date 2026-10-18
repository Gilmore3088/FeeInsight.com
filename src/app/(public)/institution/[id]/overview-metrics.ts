import { formatAbsoluteDate } from "@/lib/public-stats";
import { formatCompactDollars } from "@/lib/format";
import type { FeeIncomeTerms } from "./financial-units";
import type { ProvenanceRow } from "./provenance";
import { fieldNotes } from "./ledger-fields";
import type { Ledger, LedgerMetric, LedgerQuarter } from "./quarterly-ledger";

/**
 * Names, units and definitions for the overview's call-report measures, defined once so the cards,
 * the charts and their Details say the same thing. "Revenue" is always net interest income plus
 * noninterest income for a bank; a credit union's 5300 revenue is interest income plus
 * noninterest income, and is labelled so.
 */
export interface MetricDef {
  key: LedgerMetric;
  /** Selector and card label. */
  label: string;
  /** What it measures, for Details. */
  measure: string;
  unit: "dollars" | "percent";
  /** Income over a quarter (bars) rather than a balance or ratio (line). */
  flow: boolean;
}

export function metricDefs(terms: FeeIncomeTerms, filer: "bank" | "credit_union" | null): Record<LedgerMetric, MetricDef> {
  const cu = filer === "credit_union";
  const revenueLabel = cu ? "Revenue (interest + noninterest income)" : "Revenue (net interest + noninterest income)";
  return {
    assets: { key: "assets", label: "Total assets", measure: "Total assets at quarter end", unit: "dollars", flow: false },
    deposits: {
      key: "deposits",
      label: cu ? "Shares and deposits" : "Total deposits",
      measure: cu ? "Total shares and deposits at quarter end" : "Total deposits at quarter end",
      unit: "dollars",
      flow: false,
    },
    revenue: {
      key: "revenue",
      label: "Revenue",
      measure: revenueLabel,
      unit: "dollars",
      flow: true,
    },
    serviceCharges: { key: "serviceCharges", label: terms.amount, measure: terms.definition, unit: "dollars", flow: true },
    netIncome: { key: "netIncome", label: "Net income", measure: "Net income for the quarter", unit: "dollars", flow: true },
    roaPct: {
      key: "roaPct",
      label: "Return on assets",
      measure: cu
        ? "Year-to-date net income, annualized, as a share of total assets"
        : "Quarterly net income, annualized, as a share of average assets",
      unit: "percent",
      flow: false,
    },
    sharePct: {
      key: "sharePct",
      label: `${shareName(terms)} of revenue`,
      measure: `${terms.definition} divided by ${revenueLabel.charAt(0).toLowerCase()}${revenueLabel.slice(1)}`,
      unit: "percent",
      flow: false,
    },
  };
}

/** "Service-charge share" or "Fee-income share", the name of the share as an adjective phrase. */
export function shareName(terms: FeeIncomeTerms): string {
  return terms.subject === "Fee income" ? "Fee-income share" : "Service-charge share";
}

export function formatMetric(def: Pick<MetricDef, "unit">, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not reported";
  if (def.unit === "percent") return `${value.toFixed(2)}%`;
  return formatCompactDollars(value);
}

/** "Jun 30, 2026" for a quarter-end date. */
export function quarterEndLabel(reportDate: string): string {
  return formatAbsoluteDate(`${reportDate}T12:00:00Z`) ?? reportDate;
}

export function entityLabel(name: string, filer: "bank" | "credit_union" | null): string {
  return filer === "credit_union" ? `${name} (credit union)` : `${name} (bank level, not the holding company)`;
}

/** Details rows for one measure over the given quarters (one quarter for a card). */
export function ledgerProvenance(input: {
  ledger: Ledger;
  def: MetricDef;
  quarters: LedgerQuarter[];
  institutionName: string;
}): ProvenanceRow[] {
  const { ledger, def, quarters, institutionName } = input;
  const notes = fieldNotes(ledger, def.key, quarters.filter((q) => q.values[def.key]));
  const withValue = quarters.filter((q) => q.values[def.key]);
  const first = withValue[0];
  const last = withValue[withValue.length - 1];
  const period = !first
    ? null
    : first === last
      ? `${first.quarter} (quarter ended ${quarterEndLabel(first.reportDate)})`
      : `${first.quarter} to ${last.quarter}, ${withValue.length} quarters`;
  const many = notes.length > 1;
  return [
    { label: "Source", value: notes.map((n) => n.sourceName).join("; ") || null },
    { label: "Entity", value: entityLabel(institutionName, ledger.filer) },
    { label: "Period", value: period },
    { label: "Measure", value: def.measure },
    {
      label: "Calculation",
      value: notes.map((n) => (many ? `${n.sourceName}: ${n.calculation}` : n.calculation)).join(". ") || null,
    },
    { label: "Fields", value: notes.map((n) => (many ? `${n.sourceName}: ${n.fields}` : n.fields)).filter(Boolean).join("; ") || null },
    { label: "Retrieved", value: ledger.retrievedAt ? formatAbsoluteDate(ledger.retrievedAt) : null },
  ];
}
