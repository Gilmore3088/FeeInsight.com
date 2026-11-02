/**
 * The switch and ledger names of Darwin's hold source re-read (`hold-source-reread.ts`, Pipeline
 * wiring audit gap 2, Nov 2). Kept apart from the pass so `verify.ts` can read the switch for its
 * re-decision clause without importing the pass (which imports `verify.ts`).
 */

/** The pass's attempt strategy (`pipeline_attempts`, stage `verify`). */
export const HOLD_SOURCE_REREAD_STRATEGY = { strategy: "verify.hold_source_reread", version: 2 } as const;
/**
 * Magellan's request to fetch a held fee's page again (`pipeline_feedback`, reported by Darwin,
 * read by Magellan's live-source pass, `magellan/live-source-refetch.ts`).
 */
export const HOLD_REFETCH_REQUEST_KIND = "magellan_refetch_requested";
/** Check name on its events and feedback rows. */
export const HOLD_SOURCE_REREAD_CHECK = "darwin.hold_source_reread";
/**
 * The switch. Off (the default until James's yes on the dry-run count): each verify step reads the
 * oldest held fees, routes them and re-reads a few, and reports the counts in one event; it writes
 * no attempt, request, raw row or flag. On: a stale copy is sent to Magellan for a fresh fetch, a
 * matching re-read hands the hold back to Darwin's verify step only when today's range and peer
 * checks no longer hold it (v2; else `confirmed_still_held`, kept held), a changed read replaces the held
 * row, and a fee missing from the bank's current copy on two looks is archived.
 */
export const HOLD_SOURCE_REREAD_LIVE = false;

/**
 * SQL (attempt alias `pa`, a `verify.rules` attempt) for `darwinStandingDecisionSql`: with the switch
 * on, a range or peer hold whose current copy Darwin's hold re-read read back at the same amount
 * after the hold (`detail.outcome = 'confirmed'`) is no standing decision, so the verify step judges
 * it once more under today's rules. Its new attempt is newer than the confirmation, so it is
 * standing again; the pass reads the hold again only when its current copy's text changes.
 * Off: empty, so the verify selection is unchanged.
 */
export function holdRereadRecheckSql(live: boolean = HOLD_SOURCE_REREAD_LIVE): string {
  if (!live) return "";
  return `
              AND NOT (
                pa.detail->>'reason_code' IN ('outside_envelope', 'peer_outlier')
                AND EXISTS (
                  SELECT 1 FROM pipeline_attempts hr
                   WHERE hr.input_fingerprint = pa.input_fingerprint
                     AND hr.strategy = '${HOLD_SOURCE_REREAD_STRATEGY.strategy}'
                     AND hr.strategy_version = ${HOLD_SOURCE_REREAD_STRATEGY.version}
                     AND hr.detail->>'outcome' = 'confirmed'
                     AND hr.created_at > pa.created_at
                )
              )`;
}
