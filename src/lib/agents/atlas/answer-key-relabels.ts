import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Atlas's answer-key relabels: a fixed list of hand-checked answer-key lines (`answer_key_fees`)
 * whose category a decision of James's changed after they were keyed. A step in Atlas's daily
 * scoreboard run, before the score, so the day's score already reads the corrected key.
 *
 * First list, James, Oct 16 (#1099 night deposit, option A; DECISIONS.md): `night_deposit` is the
 * night depository service only. A bag or key bought for it is a supply sale, which the taxonomy
 * has no category for, so those lines leave scoring: `canonical_key` becomes `unmapped`, the key
 * value the answer-key score and Deming's Knox replay leave out (as the Knox gate does for an
 * unplaced line). A lost or replaced bag or key, and an annual or service fee, stay
 * `night_deposit`, as the v60 category guard has it.
 *
 * A line changes only while it still reads as listed (same id, institution, category, price and
 * source line), so a second run changes nothing and a line a person has since edited is left
 * alone. The line's `conditions` gains a note naming the decision. Every change (id, before,
 * after) goes in the step's ledger detail; a dry run lists them and changes nothing. Add later
 * entries below, never edit a past one.
 */
export const ANSWER_KEY_RELABEL_VERSION = 1;
export const OUT_OF_SCOPE_KEY = "unmapped";

export interface AnswerKeyRelabel {
  feeId: number;
  institutionId: number;
  fromKey: string;
  toKey: string;
  amount: number;
  sourceLine: string;
  /** Appended to `conditions`. */
  note: string;
}

const BAG_NOTE = "Out of scope for scoring (James, Oct 16, #1099): a night deposit bag or key purchase is a supply sale, not the night deposit service.";
const bag = (feeId: number, institutionId: number, amount: number, sourceLine: string): AnswerKeyRelabel =>
  ({ feeId, institutionId, fromKey: "night_deposit", toKey: OUT_OF_SCOPE_KEY, amount, sourceLine, note: BAG_NOTE });

export const ANSWER_KEY_RELABELS: readonly AnswerKeyRelabel[] = [
  bag(49, 61, 35, "Night Depository, Lock Bags......... $35"),
  bag(70, 61, 5, "Zipper Bags......... $5 small bag, $6 medium bag, $7 large bag"),
  bag(71, 61, 6, "Zipper Bags......... $5 small bag, $6 medium bag, $7 large bag"),
  bag(72, 61, 7, "Zipper Bags......... $5 small bag, $6 medium bag, $7 large bag"),
  bag(174, 80, 35, "Night Depository Locked Bag | $35.00"),
  bag(176, 80, 5, "Night Depository Zipper Bag | $5.00"),
  bag(178, 80, 10, "ACH Items Originated | Large Night Depository Zipper Bag | $10.00"),
  bag(282, 160, 18, "Small.........................................................................................$18.00 ea."),
  bag(283, 160, 23, "Large.........................................................................................$23.00 ea."),
  bag(445, 316, 5, "Zipper Bag: $5"),
  bag(446, 316, 15, "Zipper Bag with Lock: $15"),
  bag(521, 395, 5, "Zipper Bag (no lock).....$5.00"),
  bag(796, 1390, 25, "Lock bag.......$25.00"),
  bag(797, 1390, 5, "Zipper bag.......$5.00"),
  bag(798, 1390, 6, "Large zipper bag.......$6.00"),
  bag(799, 1390, 2, "Coin zipper bag .......$2.00"),
  bag(800, 1390, 4, "Draw string deposit bags.......$4.00"),
  // FSBT's schedule: "CANVAS KEY LOCK DEPOSIT BAG • $25.00", "ZIP DEPOSIT BAG • $5.00".
  bag(1020, 1987, 25, "$25.00"),
  bag(1021, 1987, 5, "$5.00"),
  bag(1074, 2694, 5, "Night Deposit Bags (Zipper Only / Lock Bags) | $5 / $25"),
  bag(1075, 2694, 25, "Night Deposit Bags (Zipper Only / Lock Bags) | $5 / $25"),
  bag(1247, 4600, 30, "| Key Lock Zipper Bags | $30.00 each |"),
  bag(1248, 4600, 10, "| Vinyl Zipper Bags | $10.00 each |"),
  bag(1249, 4600, 8, "| Vinyl Zipper Bags | $8.00 each |"),
  bag(2212, 7288, 22, "Night Drop Bag & Keys | $22"),
  bag(2232, 7288, 3, "Zipper Bag | $3"),
  bag(2714, 8448, 0.25, "Night Depository Tamper Resistant Bags | $0.25 each or $100 per box/500"),
  bag(2715, 8448, 100, "Night Depository Tamper Resistant Bags | $0.25 each or $100 per box/500"),
];

export interface KeyFeeRow {
  id: number | string;
  institution_id: number | string;
  canonical_key: string;
  amount: number | string | null;
  source_line: string | null;
}

export interface AnswerKeyRelabelChange {
  feeId: number;
  institutionId: number;
  before: string;
  after: string;
  amount: number;
}

export interface AnswerKeyRelabelResult {
  version: number;
  dryRun: boolean;
  ready: boolean;
  changed: AnswerKeyRelabelChange[];
  skipped: Array<{ feeId: number; reason: string }>;
}

const sameAmount = (a: number | string | null, b: number) => a != null && Math.abs(Number(a) - b) < 0.005;

/** Pure: which listed lines change, from their rows as they read now. */
export function planAnswerKeyRelabels(rows: KeyFeeRow[], list: readonly AnswerKeyRelabel[] = ANSWER_KEY_RELABELS): Pick<AnswerKeyRelabelResult, "changed" | "skipped"> {
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const changed: AnswerKeyRelabelChange[] = [];
  const skipped: AnswerKeyRelabelResult["skipped"] = [];
  for (const entry of list) {
    const row = byId.get(entry.feeId);
    if (!row) {
      skipped.push({ feeId: entry.feeId, reason: "not in the key" });
      continue;
    }
    if (row.canonical_key === entry.toKey) {
      skipped.push({ feeId: entry.feeId, reason: "already relabelled" });
      continue;
    }
    if (Number(row.institution_id) !== entry.institutionId || row.canonical_key !== entry.fromKey ||
        !sameAmount(row.amount, entry.amount) || (row.source_line ?? "") !== entry.sourceLine) {
      skipped.push({ feeId: entry.feeId, reason: "changed since listed" });
      continue;
    }
    changed.push({ feeId: entry.feeId, institutionId: entry.institutionId, before: entry.fromKey, after: entry.toKey, amount: entry.amount });
  }
  return { changed, skipped };
}

export async function runAnswerKeyRelabels({
  db = sql,
  dryRun = false,
  list = ANSWER_KEY_RELABELS,
}: { db?: SqlTag; dryRun?: boolean; list?: readonly AnswerKeyRelabel[] } = {}): Promise<AnswerKeyRelabelResult> {
  const result: AnswerKeyRelabelResult = { version: ANSWER_KEY_RELABEL_VERSION, dryRun, ready: false, changed: [], skipped: [] };
  const [ready] = await db<Array<{ ready: boolean }>>`SELECT to_regclass('answer_key_fees') IS NOT NULL AS ready`;
  if (!ready?.ready || list.length === 0) return result;
  result.ready = true;
  const ids = list.map((entry) => entry.feeId);
  const rows = await db<KeyFeeRow[]>`
    SELECT f.id, ak.institution_id, f.canonical_key, f.amount, f.source_line
      FROM answer_key_fees f
      JOIN answer_key_institutions ak ON ak.id = f.answer_key_institution_id
     WHERE f.id = ANY(${ids}::bigint[])
  `;
  const plan = planAnswerKeyRelabels(rows, list);
  result.skipped = plan.skipped;
  if (dryRun) return { ...result, changed: plan.changed };
  await inSavepoint(db, async (scope) => {
    for (const change of plan.changed) {
      const entry = list.find((candidate) => candidate.feeId === change.feeId)!;
      const updated = await scope<{ id: number | string }[]>`
        UPDATE answer_key_fees
           SET canonical_key = ${entry.toKey},
               conditions = CASE WHEN COALESCE(conditions, '') = '' THEN ${entry.note} ELSE conditions || ' ' || ${entry.note} END,
               updated_at = NOW()
         WHERE id = ${entry.feeId}
           AND canonical_key = ${entry.fromKey}
           AND abs(amount - ${entry.amount}::numeric) < 0.005
           AND COALESCE(source_line, '') = ${entry.sourceLine}
        RETURNING id
      `;
      if (updated.length > 0) result.changed.push(change);
      else result.skipped.push({ feeId: change.feeId, reason: "changed before the write" });
    }
  });
  return result;
}

export function summarizeAnswerKeyRelabels(result: AnswerKeyRelabelResult): string {
  if (!result.ready) return "Atlas had no answer key to relabel.";
  const verb = result.dryRun ? "would relabel" : "relabelled";
  const banks = new Set(result.changed.map((change) => change.institutionId)).size;
  return result.changed.length === 0
    ? `Atlas found no answer-key line left to relabel (${result.skipped.length} listed lines already done or changed).`
    : `Atlas ${verb} ${result.changed.length} answer-key line${result.changed.length === 1 ? "" : "s"} at ${banks} bank${banks === 1 ? "" : "s"} by James's decisions (night deposit bags and keys out of scoring); ${result.skipped.length} listed lines left alone.`;
}

export function answerKeyRelabelDetail(result: AnswerKeyRelabelResult) {
  return {
    version: result.version,
    dry_run: result.dryRun,
    ready: result.ready,
    changed: result.changed.map((change) => ({ answer_key_fee_id: change.feeId, institution_id: change.institutionId, before: change.before, after: change.after, amount: change.amount })),
    skipped: result.skipped,
  };
}
