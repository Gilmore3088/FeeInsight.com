import { distinctPredictions, predictionMatches, type PipelineFee } from "@/lib/agents/answer-key-score";

export type ExpectedFee = Parameters<typeof predictionMatches>[0];
import type { BankReconciliation, Conflict, DiffKind, PipelineStep, Winner } from "./types";

/**
 * Pure: one grade for live and one for the shadow, on the same banks and with the same measures as the
 * daily answer-key review: precision and recall against confirmed answer keys (scorer v3's
 * `predictionMatches` on distinct (category, amount)), unknown audience, wrong after publish (fees
 * that lose their reconciliation), and right document (live fees on the current copy of their page
 * and found there by the shared check).
 */

export interface KeyedBank {
  institutionId: number;
  expected: ExpectedFee[];
}

export interface KeyScore {
  banks: number;
  expected: number;
  matched: number;
  predicted: number;
  correct: number;
  precision: number | null;
  recall: number | null;
}

export interface SideGrade {
  fees: number;
  /** Against the answer keys of the cohort the daily review scores (null when no keyed bank was run). */
  keys: KeyScore | null;
  /** Against the keys of the banks eligible today (James's daily review cohort). */
  keysEligibleToday: KeyScore | null;
  unknownAudience: number;
  unknownAudienceShare: number | null;
  /** Fees that lose their reconciliation: published but not what the bank's document says. */
  lost: number;
  lostShare: number | null;
  /** Fees the shared check finds on one of the bank's current documents. */
  supportedOnCurrent: number;
  supportedShare: number | null;
  /** Live only: fees on a superseded copy of their page. */
  onSupersededCopy?: number;
}

export interface ReconcileGrade {
  banks: number;
  live: SideGrade;
  shadow: SideGrade;
  diff: Record<DiffKind, number>;
  winners: Record<Winner, number>;
  /** Differences by pipeline step and cause, most first: the fix list. */
  byCause: Array<{ step: PipelineStep; cause: string; winner: Winner; count: number; examples: Conflict[] }>;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 10_000) / 10_000 : null);

export function scoreKeys(banks: readonly KeyedBank[], sets: ReadonlyMap<number, ReadonlyArray<[string, number]>>): KeyScore | null {
  const run = banks.filter((bank) => sets.has(bank.institutionId));
  if (run.length === 0) return null;
  let expected = 0, matched = 0, predicted = 0, correct = 0;
  for (const bank of run) {
    const predictions: PipelineFee[] = distinctPredictions((sets.get(bank.institutionId) ?? []).map(([key, cents]) => ({ canonicalKey: key, amount: cents / 100 })));
    expected += bank.expected.length;
    predicted += predictions.length;
    matched += bank.expected.filter((fee) => predictions.some((p) => predictionMatches(fee, p))).length;
    correct += predictions.filter((p) => bank.expected.some((fee) => predictionMatches(fee, p))).length;
  }
  return { banks: run.length, expected, matched, predicted, correct, precision: ratio(correct, predicted), recall: ratio(matched, expected) };
}

export function gradeReconciliation(
  banks: readonly BankReconciliation[],
  keyed: readonly KeyedBank[],
  eligibleToday: readonly KeyedBank[],
  examplesPerCause = 3,
): ReconcileGrade {
  const sum = (pick: (bank: BankReconciliation) => number) => banks.reduce((total, bank) => total + pick(bank), 0);
  const liveSets = new Map(banks.map((bank) => [bank.institutionId, bank.liveSet] as const));
  const shadowSets = new Map(banks.map((bank) => [bank.institutionId, bank.shadowSet] as const));
  const liveFees = sum((b) => b.liveFees);
  const shadowFees = sum((b) => b.shadowFees);
  const diff = {} as Record<DiffKind, number>;
  const winners = {} as Record<Winner, number>;
  const causes = new Map<string, ReconcileGrade["byCause"][number]>();
  for (const bank of banks) {
    for (const [kind, count] of Object.entries(bank.counts)) diff[kind as DiffKind] = (diff[kind as DiffKind] ?? 0) + count;
    for (const [winner, count] of Object.entries(bank.winners)) winners[winner as Winner] = (winners[winner as Winner] ?? 0) + count;
    for (const conflict of bank.conflicts) {
      const id = `${conflict.step}|${conflict.cause}|${conflict.winner}`;
      const row = causes.get(id) ?? { step: conflict.step, cause: conflict.cause, winner: conflict.winner, count: 0, examples: [] };
      row.count += 1;
      if (row.examples.length < examplesPerCause) row.examples.push(conflict);
      causes.set(id, row);
    }
  }
  return {
    banks: banks.length,
    live: {
      fees: liveFees,
      keys: scoreKeys(keyed, liveSets),
      keysEligibleToday: scoreKeys(eligibleToday, liveSets),
      unknownAudience: sum((b) => b.liveUnknownAudience),
      unknownAudienceShare: ratio(sum((b) => b.liveUnknownAudience), liveFees),
      lost: sum((b) => b.liveLost),
      lostShare: ratio(sum((b) => b.liveLost), liveFees),
      supportedOnCurrent: sum((b) => b.liveSupportedCurrent),
      supportedShare: ratio(sum((b) => b.liveSupportedCurrent), liveFees),
      onSupersededCopy: sum((b) => b.liveOnSupersededCopy),
    },
    shadow: {
      fees: shadowFees,
      keys: scoreKeys(keyed, shadowSets),
      keysEligibleToday: scoreKeys(eligibleToday, shadowSets),
      unknownAudience: sum((b) => b.shadowUnknownAudience),
      unknownAudienceShare: ratio(sum((b) => b.shadowUnknownAudience), shadowFees),
      lost: sum((b) => b.shadowLost),
      lostShare: ratio(sum((b) => b.shadowLost), shadowFees),
      supportedOnCurrent: sum((b) => b.shadowSupported),
      supportedShare: ratio(sum((b) => b.shadowSupported), shadowFees),
    },
    diff,
    winners,
    byCause: [...causes.values()].sort((a, b) => b.count - a.count),
  };
}

const pct = (value: number | null) => (value == null ? "n/a" : `${(value * 100).toFixed(1)}%`);

export function gradeSummary(grade: ReconcileGrade): string {
  const side = (name: string, g: SideGrade) =>
    `${name}: ${g.fees} fees, precision ${pct(g.keys?.precision ?? null)}, recall ${pct(g.keys?.recall ?? null)}`
    + ` (today's review cohort ${pct(g.keysEligibleToday?.precision ?? null)} / ${pct(g.keysEligibleToday?.recall ?? null)}),`
    + ` unknown audience ${pct(g.unknownAudienceShare)}, lose reconciliation ${pct(g.lostShare)}, on a current document ${pct(g.supportedShare)}`;
  const top = grade.byCause.slice(0, 3).map((row) => `${row.step} ${row.cause} (${row.winner}) ${row.count}`).join("; ");
  return `Reconciled ${grade.banks} banks. ${side("Live", grade.live)}. ${side("Shadow", grade.shadow)}. Top causes: ${top || "none"}.`;
}
