import { financialMeasureDefinition } from "@/lib/data-store/financial-peer-contract";
import type { FinancialSource } from "@/lib/data-store/financial-sources";
import type { MarketIncome } from "./types";

export const HISTORICAL_INCOME_CAVEAT = "Peer and national figures are dated filing cross-sections using current registry charter and size links. Reporter membership and business perimeter may change; this is not constant-cohort or merger-adjusted growth.";

/** Older mixed or unlineaged workspace payloads cannot establish a national income family. */
export function nationalIncomeFamily(rows: readonly MarketIncome[], expectedSource?: FinancialSource) {
  const sources = [...new Set(rows.map((row) => row.financialSource))];
  const source = expectedSource ?? (sources.length === 1 ? sources[0] : undefined);
  if (source !== "fdic" && source !== "ncua") return null;
  const definition = financialMeasureDefinition(source);
  const scoped = rows.filter((row) => row.financialSource === source
    && row.measureDefinition?.source === source && row.measureDefinition.charter_type === definition.charter_type
    && row.measureDefinition.measure === definition.measure && row.measureDefinition.period_basis === "standalone_quarter"
    && row.measureDefinition.unit === "USD");
  if (scoped.length === 0) return null;
  return {
    source,
    kind: source === "ncua" ? "credit unions" : "banks",
    measureLabel: source === "ncua" ? "Broad credit-union fee income" : "Deposit service charge income",
    definition,
    rows: scoped,
  };
}
