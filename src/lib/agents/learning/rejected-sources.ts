/**
 * The playbook's rejected list and its current source must agree (#1105): a profile never holds
 * as its current source (`canonical_source_url`) an address on its own `rejected_source_urls`.
 *
 * Every writer that rejects an address already clears the current source when it is that address
 * (Rosetta's `sendBackToMagellan`, Magellan's gone-link path, Darwin's document owner, Hamilton's
 * other-bank document). The writers that set the current source did not look at the list, so a
 * rejected address came back as current through a later fetch or read (26 profiles on Oct 26,
 * none of them locked). The rule those writers now share:
 *
 * - A read that judged the address's text a fee page (Rosetta `completed`) is newer evidence than
 *   a fee-page reject (not a fee schedule, a product page, a 404, a fetch failure): it drops those
 *   entries for the address, and the address is current. It is no evidence on who owns the page:
 *   another bank's schedule reads as a fee page too. So an ownership reject (`OWNERSHIP_REJECT_REASONS`:
 *   Darwin's document owner, Magellan's other-bank host, Hamilton's unconfirmed host, a person's
 *   hand-link repair) survives a completed read, and the address stays off the current source.
 * - Any other automated write of a rejected address as current (Magellan's fetch, ok or failed;
 *   a Rosetta read that did not complete; discovery; the profile sync) leaves the current source
 *   empty instead, as the reject itself did, until a read judges the page.
 * - A person's link (an admin's fee link) is the newest word: it drops the address from the list.
 * - A locked correction keeps its address, as before.
 *
 * Entries are `{ url, reason, at }` objects. The writers carry the check inline in their SQL as
 * `COALESCE(<profile>.rejected_source_urls, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('url', <address>))`
 * (an object or a scalar never contains an array, so a malformed list reads as "not on it").
 */

/**
 * Reasons a completed read never overturns: they judge whose page the address is, not whether it
 * is a fee page. `hand_link_repair` entries carry a note after the code (`hand_link_repair: ...`).
 */
export const OWNERSHIP_REJECT_REASONS = ["document_owner", "other_bank_host", "unconfirmed_document_host"] as const;
export const OWNERSHIP_REJECT_PREFIX = "hand_link_repair";

/** True when a stored reject's reason is an ownership verdict (`OWNERSHIP_REJECT_REASONS`). */
export function isOwnershipReject(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return (OWNERSHIP_REJECT_REASONS as readonly string[]).includes(reason) || reason.startsWith(OWNERSHIP_REJECT_PREFIX);
}

/** SQL text: true when `urlSql` is on `listSql` (a `rejected_source_urls` value). For `db.unsafe` reads. */
export function onRejectedListSql(listSql: string, urlSql: string): string {
  return `(${urlSql} IS NOT NULL AND COALESCE(${listSql}, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('url', (${urlSql})::text)))`;
}
