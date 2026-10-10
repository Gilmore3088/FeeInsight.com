import { statsRowFilter } from "./fee-stats";

/**
 * A displayed consumer price move needs a real live successor and an eligible,
 * same-audience predecessor. An audience correction is not a new bank fee policy.
 * Callers retain their own time window and like-for-like gate.
 */
export function consumerPriceMoveSql(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("Invalid price-move table alias");
  return `EXISTS (
    SELECT 1 FROM published_fee_catalog consumer_live
    JOIN published_fee_records consumer_previous
      ON consumer_previous.fee_published_id = ${alias}.previous_fee_published_id
    WHERE consumer_live.fee_published_id = ${alias}.new_fee_published_id
      AND consumer_live.institution_id = ${alias}.institution_id
      AND consumer_previous.institution_id = ${alias}.institution_id
      AND consumer_live.canonical_fee_key = ${alias}.fee_category
      AND consumer_previous.canonical_fee_key = ${alias}.fee_category
      AND ${statsRowFilter("consumer_live")}
      AND consumer_previous.fee_audience = consumer_live.fee_audience
      AND consumer_previous.quarantined_at IS NULL
      AND consumer_live.amount = ${alias}.new_amount
      AND consumer_previous.amount = COALESCE(${alias}.previous_amount, ${alias}.old_amount)
      AND NOT EXISTS (
        SELECT 1 FROM pipeline_feedback pending
        WHERE pending.fee_published_id = consumer_live.fee_published_id
          AND pending.kind = 'takedown_pending'
      )
  )`;
}
