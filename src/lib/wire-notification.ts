/**
 * Knox v166 / guard v106 (re-read backlog dry run, Nov 2): a wire row whose subject is the notice the
 * bank sends about the wire is not the wire fee. Intercredit Bank (institution 827, doc 7822) prints
 * "‐Incoming Wire Transfer Email Notification ... No Fee" and "‐Outgoing Wire Transfer Email
 * Notification ... No Fee" beside its own $15 incoming and $50 outgoing wires; Knox's free read filed
 * both notices as the wire fee at $0, which would tell readers the bank's wires are free. Live, four
 * notices stood as the incoming wire fee (Nov 2, read-only): "Incoming Wire Notification" $5 beside
 * the bank's own "Wire Transfer Fee (Incoming) $15.00" (45083), "Incoming Wire Notification or Special
 * Handling" $10 (32466), "Wire Notification – Incoming" $8 and "Electronic Wire Notification Incoming"
 * $15 (104525, 158510).
 *
 * A notice charge has no type of the 50, so a match is never re-filed: Knox holds it, the guard
 * refuses it under every wire type. A wire priced with its notice included ("Incoming Wire with Phone
 * Notification" $25, 129879) is the wire fee and stays.
 *
 * Scope is the wire types only. Elsewhere a notice is often the fee itself: an escheat or dormancy
 * notice is the dormant account fee, "Levy or Garnishment (per notification)" the garnishment fee
 * (Nov 2 live read: 15 dormant, 4 garnishment, 7 returned mail rows name a notice).
 *
 * A wire that names its notice only as a qualifier is the wire too: "Incoming Wire (no notification)",
 * "Outgoing Wire w/ notification", "Incoming wire and notification", "notification included", or the
 * notice in brackets after the wire ("Incoming Wire Transfer (notification by phone)").
 *
 * Knox v168 / guard v108 (second re-read backlog dry run, Nov 2): a confirmation is the same notice.
 * Century FCU (institution 7131, doc 42055) prints "Wire Sent Confirmation: | $5.00 per item" beside its
 * own "Outgoing Wire – Domestic | $20.00"; Knox filed the confirmation as the outgoing wire at $5, and
 * it was live the same way (131028). The qualifier skips read it too: "Outgoing Wire with confirmation",
 * "Outgoing Wire w/ confirmation", "confirmation included", "Incoming Wire (confirmation by fax)" are the
 * wire. Live, a wire confirmation filed elsewhere ("Wire Confirmation Fax" as research, 101387; "Photocopy
 * of Wire Confirmation" as document reproduction, 125903) is outside the wire types and not read here.
 */
export const WIRE_NOTIFICATION_NAME =
  /^(?![^|]*\b(?:with|includ\w*|plus)\b[^|]{0,40}\b(?:notifications?|alerts?|confirmations?)\b)(?![^|]*(?:\bw\/\s*|\b(?:and|no|without)\s+)(?:[a-z]+\s+){0,2}(?:notifications?|alerts?|confirmations?)\b)(?![^|]*\b(?:notifications?|alerts?|confirmations?)\s+includ)(?![^|]*\(\s*(?:[a-z]+\s+)?(?:notifications?|alerts?|confirmations?)\b)[^|]*\b(?:notifications?|alerts?|confirmations?)\b/i;

/** True when a wire row's subject is the bank's notice of the wire, not the wire. Pure. */
export function wireNotificationName(name: string | null | undefined): boolean {
  return Boolean(name) && WIRE_NOTIFICATION_NAME.test(name ?? "");
}
