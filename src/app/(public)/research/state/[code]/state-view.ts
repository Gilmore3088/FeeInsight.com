import type { IndexEntry, StateInstitutionValue } from "@/lib/data-store/fee-index";
import { getDisplayName, isFeaturedFee } from "@/lib/fee-taxonomy";
import { BENCHMARK_KEYS } from "@/lib/research-report/benchmark-keys";
import type { StateComparison } from "@/lib/research-report/state-findings";
import type { Finding } from "@/lib/research-report/finding";

export type Position = "below" | "within" | "above";

/** The U.S. figures a state's fee is read against. */
export interface UsBand {
  p25: number;
  median: number;
  p75: number;
}

/**
 * One fee as the state's interactive board draws it. Everything here comes from the state's
 * one index read, so the board, the chart and the banks/credit unions split count the same
 * institutions. Values are [amount, charter] with charter 1 bank, 2 credit union, 0 neither.
 */
export interface BoardFee {
  key: string;
  name: string;
  institutions: number;
  median: number;
  p25: number | null;
  p75: number | null;
  bank: { median: number | null; institutions: number };
  cu: { median: number | null; institutions: number };
  us: UsBand | null;
  position: Position | null;
  values: [number, 0 | 1 | 2][];
}

export function positionIn(value: number, us: UsBand): Position {
  if (value < us.p25) return "below";
  if (value > us.p75) return "above";
  return "within";
}

function usBand(c: StateComparison): UsBand | null {
  if (c.national_median == null || c.national_p25 == null || c.national_p75 == null) return null;
  return { p25: c.national_p25, median: c.national_median, p75: c.national_p75 };
}

const CHARTER_CODE = { b: 1, c: 2 } as const;

/**
 * The fees the board lists: the everyday fees first, in their usual order, then the rest by how
 * many institutions stand behind them.
 */
export function boardFees(
  comparisons: StateComparison[],
  bank: IndexEntry[],
  creditUnion: IndexEntry[],
  values: Record<string, StateInstitutionValue[]> | undefined,
): BoardFee[] {
  const bankBy = new Map(bank.map((e) => [e.fee_category, e]));
  const cuBy = new Map(creditUnion.map((e) => [e.fee_category, e]));
  const everyday = new Map<string, number>(BENCHMARK_KEYS.map((k, i) => [k, i]));
  const ordered = [...comparisons].sort((a, b) => {
    const ia = everyday.get(a.fee_category) ?? Infinity;
    const ib = everyday.get(b.fee_category) ?? Infinity;
    return ia - ib || b.institution_count - a.institution_count;
  });
  return ordered.map((c) => {
    const us = usBand(c);
    return {
      key: c.fee_category,
      name: getDisplayName(c.fee_category),
      institutions: c.institution_count,
      median: c.median_amount,
      p25: c.p25_amount,
      p75: c.p75_amount,
      bank: { median: bankBy.get(c.fee_category)?.median_amount ?? null, institutions: c.bank_count },
      cu: { median: cuBy.get(c.fee_category)?.median_amount ?? null, institutions: c.cu_count },
      us,
      position: us ? positionIn(c.median_amount, us) : null,
      values: (values?.[c.fee_category] ?? []).map((p) => [p.v, p.c ? CHARTER_CODE[p.c] : 0]),
    };
  });
}

/** Free visitors read the featured fees; the rest are named, with no figure, as Hamilton's. */
export function splitForAccess(fees: BoardFee[], showAll: boolean): { shown: BoardFee[]; locked: BoardFee[] } {
  if (showAll) return { shown: fees, locked: [] };
  return { shown: fees.filter((f) => isFeaturedFee(f.key)), locked: fees.filter((f) => !isFeaturedFee(f.key)) };
}

/** Fees where both banks and credit unions have a median, for the charter exhibit. */
export function charterFees(fees: BoardFee[]): BoardFee[] {
  return fees.filter((f) => f.bank.median != null && f.cu.median != null);
}

/** "Credit unions are lower on 8 of 13 fees", or null when nothing is compared. */
export function charterHeadline(fees: BoardFee[]): string | null {
  const paired = charterFees(fees);
  if (paired.length === 0) return null;
  const cuLower = paired.filter((f) => f.cu.median! < f.bank.median!).length;
  const bankLower = paired.filter((f) => f.bank.median! < f.cu.median!).length;
  const of = `of ${paired.length} ${paired.length === 1 ? "fee" : "fees"}`;
  if (cuLower >= bankLower) return `Credit unions are lower on ${cuLower} ${of}`;
  return `Banks are lower on ${bankLower} ${of}`;
}

/** The three findings the page leads with, each tied to a fee on the board when it names one. */
export function leadFindings(findings: Finding[], fees: BoardFee[]): (Finding & { fee: string | null })[] {
  const onBoard = new Set(fees.map((f) => f.key));
  return findings.slice(0, 3).map((f) => ({ ...f, fee: f.fee_category && onBoard.has(f.fee_category) ? f.fee_category : null }));
}
