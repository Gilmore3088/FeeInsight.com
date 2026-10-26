/**
 * A wire price stated for one channel (#1912). Many banks print a general wire price
 * beside a channel-qualified one: "Outgoing Domestic Wire" $30 beside "Online Outgoing Domestic
 * Wire" $15, or "Wire transfers: Domestic outgoing (online)" $15 beside "(in branch)" $20. The
 * statistics contract's rule 11 (`fee-product.ts` isProductException) sets the channel row aside
 * when the bank states a general row in the same category, as it sets aside a named product's
 * price. A leaf module with no database import; `wireChannelSql` is the SQL twin and
 * `wire-channel.test.ts` holds the two together over every live wire fee name.
 *
 * Channel words: online, digital, mobile, internet, e-banking (and "EBANK"), eBranch, electronic
 * banking, electronically submitted, web or website, self-service, phone, telephone, fax, email,
 * PIN (a phone wire's "with PIN", never "Pinnacle"), and the repetitive, recurring, template or
 * standing wire set up in advance.
 *
 * Left out on purpose:
 * - "treasury", "cash management", "TM": they name a business service, an audience matter (rule 6,
 *   fee_audience), not a consumer channel. A "TM Online" row is still caught by "online".
 * - "app": "Mobile App" already says mobile, and a bare "app" also abbreviates "approval" or
 *   "application" in fee names.
 * - a bare "electronic": a wire is an electronic transfer, so "ELECTRONIC FUND TRANSFERS: Outgoing
 *   Consumer Domestic Wire" is a schedule heading over the general price, not a channel.
 * - "module" ("Wire Module", "Non-Module"): one vendor's word, not a channel on its own.
 *
 * Standard-channel words name the general price, so a name carrying one is general even when it
 * also names a channel: in branch, in person, manual, assisted (banker, agent, wire room),
 * representative, teller, non-recurring, non-repetitive and "not initiated online". "Outgoing
 * Domestic Wire (Phone/Branch)" and "(In Person/By Fax/Email)" are the bank's general price.
 */

/** The categories whose channel rows rule 11 sets aside. */
export const WIRE_CHANNEL_CATEGORIES: ReadonlySet<string> = new Set([
  "wire_domestic_outgoing",
  "wire_intl_outgoing",
  "wire_domestic_incoming",
  "wire_intl_incoming",
]);

const CHANNEL_WORDS =
  "online|digital|mobile|internet|e-?bank(?:ing)?|e-?branch|electronic\\s+banking|electronically\\s+submitted|web(?:site)?|self[- ]?service|phone|telephone|fax|e-?mail|pin|template|repetitive|recurring|standing";
const STANDARD_WORDS =
  "branch|in[- ]person|manual(?:ly)?|assisted|representative|teller|non-?recurring|non-?repetitive|not\\s+(?:initiated\\s+)?online";

const CHANNEL = new RegExp(`\\b(?:${CHANNEL_WORDS})\\b`, "i");
const STANDARD = new RegExp(`\\b(?:${STANDARD_WORDS})\\b`, "i");

/** PostgreSQL ARE: `\y` is the word boundary, and `(?:` is a non-capturing group in both. */
export const CHANNEL_SQL = `\\y(?:${CHANNEL_WORDS})\\y`;
export const STANDARD_SQL = `\\y(?:${STANDARD_WORDS})\\y`;

/** A fee name that names a non-standard wire channel and no standard one. */
export function namesWireChannel(name: string | null | undefined): boolean {
  if (!name) return false;
  return CHANNEL.test(name) && !STANDARD.test(name);
}

/** SQL twin of namesWireChannel over a static internal text column: true or false, never NULL. */
export function wireChannelSql(column: string): string {
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/i.test(column)) throw new Error("Invalid internal fee name column");
  return `COALESCE(${column} ~* '${CHANNEL_SQL}' AND ${column} !~* '${STANDARD_SQL}', false)`;
}
