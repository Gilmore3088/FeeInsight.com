import { sql } from "@/lib/data-store/connection";
import { getLatestAnswerKeyScoreRun } from "@/lib/data-store/answer-key";

/**
 * The quality ledger James reads on #1026, as lines for the morning email (Oct 15): the answer
 * key's newest precision and recall, and three counts over live fees that should reach 0.
 * Read-only SQL over `published_fee_catalog`; never calls a model.
 *
 *   stored notes      live fees whose stored `conditions` still holds Knox's audit note
 *                     (#1234; #1336 moves it to `extraction_note`)
 *   per-item breaks   James's per-item rule (#1339): an overdraft or returned deposited item fee
 *                     stored as daily, monthly, quarterly or annual, or a continuous overdraft fee
 *                     stored by the month, quarter or year
 *   no source link    live fees with no http(s) link to the bank's own document (#1342)
 */

type SqlTag = typeof sql;

export interface QualityLedger {
  answerKey: { precision: number | null; recall: number | null; scoredAt: string; scorerVersion: number } | null;
  liveFees: number;
  storedNotes: number;
  perItemBreaks: number;
  noSourceLink: number;
}

export async function readQualityLedger(db: SqlTag = sql): Promise<QualityLedger> {
  const [[row], run] = await Promise.all([
    db`
      SELECT count(*)::int AS live_fees,
             count(*) FILTER (WHERE conditions ~ 'Rosetta artifact #[0-9]+')::int AS stored_notes,
             count(*) FILTER (
               WHERE (fee_category IN ('overdraft', 'deposited_item_return')
                      AND frequency IN ('daily', 'monthly', 'quarterly', 'annual'))
                  OR (fee_category = 'continuous_od' AND frequency IN ('monthly', 'quarterly', 'annual'))
             )::int AS per_item_breaks,
             count(*) FILTER (WHERE source_url IS NULL OR source_url !~* '^https?://')::int AS no_source_link
        FROM published_fee_catalog
    `,
    getLatestAnswerKeyScoreRun(db),
  ]);
  return {
    answerKey: run
      ? { precision: run.precision, recall: run.recall, scoredAt: run.scored_at, scorerVersion: run.scorer_version }
      : null,
    liveFees: Number(row?.live_fees ?? 0),
    storedNotes: Number(row?.stored_notes ?? 0),
    perItemBreaks: Number(row?.per_item_breaks ?? 0),
    noSourceLink: Number(row?.no_source_link ?? 0),
  };
}

const count = (value: number) => value.toLocaleString("en-US");
const pct = (value: number | null) => (value == null ? "not scored" : `${(value * 100).toFixed(1)}%`);

export function qualityLedgerLines(ledger: QualityLedger): string[] {
  const k = ledger.answerKey;
  return [
    k
      ? `Answer key (scorer v${k.scorerVersion}, ${k.scoredAt.slice(0, 10)}): ${pct(k.precision)} of the fees we publish are right; we find ${pct(k.recall)} of the fees we should.`
      : "Answer key: no score yet.",
    `Knox's note still stored in a live fee's conditions: ${count(ledger.storedNotes)} of ${count(ledger.liveFees)} (target 0).`,
    `Per-item rule breaks (overdraft and returned items stored by a period): ${count(ledger.perItemBreaks)} (target 0).`,
    `Live fees with no link to the bank's own document: ${count(ledger.noSourceLink)} (target 0).`,
  ];
}
