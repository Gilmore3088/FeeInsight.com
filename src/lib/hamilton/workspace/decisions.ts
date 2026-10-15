/**
 * The decisions ledger: a sum over decisions, never a separate counter. Pure and client-safe.
 *
 * Recording the option management chose, its dollar effect and the watches that would reopen
 * it were built but never reachable from Pro, and were removed (#1083).
 */

import type { DecisionRecord, DecisionStatus } from "./types";

// ─── The ledger ──────────────────────────────────────────────────────────────

export interface LedgerLine {
  decisionId: string;
  title: string;
  feeCategory: string | null;
  status: DecisionStatus;
}

export interface Ledger {
  decisions: number;
  byStatus: Record<DecisionStatus, number>;
  lines: LedgerLine[];
}

const STATUSES: DecisionStatus[] = ["researching", "modeling", "decided", "implementing", "monitoring", "closed"];

export function buildLedger(decisions: DecisionRecord[]): Ledger {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<DecisionStatus, number>;
  for (const d of decisions) byStatus[d.status]++;
  return {
    decisions: decisions.length,
    byStatus,
    lines: decisions.map((d) => ({ decisionId: d.id, title: d.title, feeCategory: d.feeCategory, status: d.status })),
  };
}
