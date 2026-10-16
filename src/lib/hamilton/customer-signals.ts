/**
 * Which monitor signals a Pro reader may see. Knox and Darwin raise "needs review"
 * signals when a bank's fees need a second look inside the pipeline; that is
 * housekeeping for the operator, not market news for a customer (#1114), so the
 * Pro feed, the home feed and their counts leave these types out. Pure and
 * client-safe.
 */

export const INTERNAL_REVIEW_SIGNAL_TYPES: readonly string[] = [
  "darwin_verification_needs_review",
  "knox_extraction_needs_review",
];

export function isCustomerSignal(signalType: string): boolean {
  return !INTERNAL_REVIEW_SIGNAL_TYPES.includes(signalType);
}

/** The institution a signal is about, from its "Name - what happened" title. */
function titleInstitution(title: string): string | null {
  const index = title.indexOf(" - ");
  return index > 0 ? title.slice(0, index).trim() : null;
}

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/**
 * The words a Pro reader sees for a stored signal. The pipeline writes its signals in operator
 * language (agent names, "raw observations", "refresh competitive briefs"), and rows already in
 * the table keep that wording, so the Pro feed, the briefing's "What changed" and alerts rewrite
 * pipeline types here, at read time. Other types (a competitor's fee change) pass through.
 */
export function customerSignalCopy(signal: { signalType: string; title: string; body: string }): { title: string; body: string } {
  const name = titleInstitution(signal.title);
  const subject = name ?? "This institution";
  const its = name ? possessive(name) : "this institution's";
  const titled = (what: string) => (name ? `${name} - ${what}` : what.charAt(0).toUpperCase() + what.slice(1));
  switch (signal.signalType) {
    case "knox_extraction_completed":
      return { title: titled("new fee schedule read"),
        body: `Hamilton read ${its} fee schedule. Its fees are checked against the document before any comparison changes.` };
    case "darwin_verification_completed":
      return { title: titled("fees checked"),
        body: `Fees from ${its} schedule were checked against the institution's own document. They reach comparisons once published.` };
    case "hamilton_publication_completed":
      return { title: titled("published fees updated"),
        body: `${name ? possessive(name) : "This institution's"} published fees were updated. Rerun a saved report to use the new figures.` };
    case "hamilton_fee_movement_detected": {
      const count = Number(/(\d+) published fee movement/.exec(signal.title)?.[1] ?? signal.body.match(/(\d+) published fee movement/)?.[1]);
      const fees = Number.isInteger(count) && count > 0 ? `${count} published fee${count === 1 ? "" : "s"}` : "published fees";
      return { title: titled(Number.isInteger(count) && count > 0 ? `${fees} changed` : "published fees changed"),
        body: `${subject} changed ${fees} since the last reading. Rerun a saved brief to use the new figures.` };
    }
    case "source_accepted":
      return { title: titled("official fee schedule found"),
        body: `An official fee schedule for ${name ?? "this institution"} was accepted. Its fees are checked before any comparison changes.` };
    case "source_rejected":
      return { title: titled("submitted fee schedule not accepted"),
        body: "The submitted document isn't the institution's official fee schedule. Send a link to the official schedule." };
    case "source_needs_info":
      return { title: titled("submitted fee schedule needs more detail"),
        body: "We need more detail before we can use the submitted fee schedule." };
    default:
      return { title: signal.title, body: signal.body };
  }
}
