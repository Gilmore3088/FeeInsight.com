import { sql } from "@/lib/data-store/connection";
import { getLatestAnswerKeyScoreRun } from "@/lib/data-store/answer-key";
import { CHECKED_PERIODS } from "@/lib/fee-frequency";
import { readAccuracyHistory, type AccuracyHistory } from "./deming/accuracy-history";
import { accuracyStatusLabel, formatAccuracyBound } from "./deming/accuracy-measure";

/**
 * The quality ledger James reads on #1026, as lines for the morning email (Oct 15): the answer
 * key's newest precision and recall, and three counts over live fees.
 * Read-only SQL over `published_fee_catalog`; never calls a model.
 *
 *   stored notes      live fees whose stored `conditions` still holds Knox's audit note
 *                     (#1234; #1336 moves it to `extraction_note`)
 *   per-item periods  James's per-item rule (#1339): an NSF, overdraft or returned-item fee stored
 *                     by a period the frequency fill checks (`CHECKED_PERIODS`), or a continuous
 *                     overdraft fee stored by the month, quarter or year. Not a target of 0: the
 *                     fill keeps an overdraft program the bank prices by the period, and a
 *                     continuous overdraft fee whose own line states one.
 *   no source link    live fees with no http(s) link to the bank's own document (#1342)
 */

type SqlTag = typeof sql;

/** The per-item rule as SQL over the catalog, built from the frequency fill's own lists. */
const PER_ITEM_PERIOD_SQL = [
  ...Object.entries(CHECKED_PERIODS).map(
    ([key, periods]) => `(fee_category = '${key}' AND frequency IN (${[...periods].map((period) => `'${period}'`).join(", ")}))`,
  ),
  "(fee_category = 'continuous_od' AND frequency IN ('monthly', 'quarterly', 'annual'))",
].join(" OR ");

export interface QualityLedger {
  answerKey: { precision: number | null; recall: number | null; scoredAt: string; scorerVersion: number } | null;
  liveFees: number;
  storedNotes: number;
  perItemPeriods: number;
  noSourceLink: number;
  /** Persisted calendar weeks, split where scoring changed; null when the read failed. */
  accuracyHistory?: AccuracyHistory | null;
}

export async function readQualityLedger(db: SqlTag = sql): Promise<QualityLedger> {
  const [[row], run, accuracyHistory] = await Promise.all([
    db`
      SELECT count(*)::int AS live_fees,
             count(*) FILTER (WHERE conditions ~ 'Rosetta artifact #[0-9]+')::int AS stored_notes,
             count(*) FILTER (WHERE ${db.unsafe(PER_ITEM_PERIOD_SQL)})::int AS per_item_periods,
             count(*) FILTER (WHERE source_url IS NULL OR btrim(source_url) !~* '^https?://')::int AS no_source_link
        FROM published_fee_catalog
    `,
    getLatestAnswerKeyScoreRun(db),
    readAccuracyHistory(db).catch((error) => {
      console.error("Quality ledger accuracy history could not be read", error);
      return null;
    }),
  ]);
  return {
    answerKey: run
      ? { precision: run.precision, recall: run.recall, scoredAt: run.scored_at, scorerVersion: run.scorer_version }
      : null,
    liveFees: Number(row?.live_fees ?? 0),
    storedNotes: Number(row?.stored_notes ?? 0),
    perItemPeriods: Number(row?.per_item_periods ?? 0),
    noSourceLink: Number(row?.no_source_link ?? 0),
    accuracyHistory,
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
    `NSF, overdraft and returned-item fees stored by a period (James's per-item rule): ${count(ledger.perItemPeriods)}, including overdraft programs the bank prices by the period, which the rule keeps.`,
    `Live fees with no link to the bank's own document: ${count(ledger.noSourceLink)} (target 0).`,
    ...(ledger.accuracyHistory == null
      ? ["Automated stored-copy audit history: unavailable."]
      : ledger.accuracyHistory.weeks.filter((week) => week.audits > 0).map((week) =>
        `Automated stored-copy audit, week ${week.weekStart}${week.partial ? " (so far)" : ""}, ${week.series ?? "legacy, versions unknown"}${week.scoringChanged ? " (scoring changed; separate series)" : ""}: ${count(week.right)}/${count(week.scorable)} (${pct(week.accuracy)}); ${accuracyStatusLabel(week)}${week.range ? `; 95% range ${formatAccuracyBound(week.range.low, "low")}–${formatAccuracyBound(week.range.high, "high")}` : ""}.`)),
    ...(ledger.accuracyHistory?.legacySnapshots?.map((snapshot) => `Legacy rolling audit snapshot ${snapshot.asOf}: ${count(snapshot.right)}/${count(snapshot.scorable)} (${pct(snapshot.accuracy)}); versions and individual audit dates unavailable, no confidence or target claim.`) ?? []),
  ];
}
