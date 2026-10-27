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
 *
 * v2 (#1912, Sound Community Bank 978, fee 15716):
 * - A negated standard channel names the premium channel, not the standard one: "Outgoing Domestic -
 *   Not in Person" $60 beside "Outgoing Domestic" $30, "Non-Branch", "outside the branch", "other
 *   than in person". Its "in person" or "branch" no longer counts as the standard word.
 * - "remote" is a channel ("Wire Transfer - Remote Outgoing" $40 beside "Wire Transfer - Outgoing" $20).
 * - A phone, fax, email or text word that only says how the bank tells the customer ("Incoming Wire
 *   with Phone Notification", "Email or Fax Confirmation", "notice by phone") names no channel: the
 *   wire itself was not requested that way.
 */

/** The categories whose channel rows rule 11 sets aside. */
export const WIRE_CHANNEL_CATEGORIES: ReadonlySet<string> = new Set([
  "wire_domestic_outgoing",
  "wire_intl_outgoing",
  "wire_domestic_incoming",
  "wire_intl_incoming",
]);

export const CHANNEL_WORDS =
  "online|remote|digital|mobile|internet|e-?bank(?:ing)?|e-?branch|electronic\\s+banking|electronically\\s+submitted|web(?:site)?|self[- ]?service|phone|telephone|fax|e-?mail|pin|template|repetitive|recurring|standing";
export const STANDARD_WORDS =
  "branch|in[- ]person|manual(?:ly)?|assisted|representative|teller|non-?recurring|non-?repetitive|not\\s+(?:initiated\\s+)?online";

/** v2: a negated standard channel ("Not in Person", "Non-Branch") names the premium channel. */
export const NEGATED_STANDARD_WORDS =
  "(?:not|non)[- ]+(?:in[- ]+)?(?:person|branch)|outside\\s+(?:of\\s+)?(?:the\\s+|a\\s+)?branch|other\\s+than\\s+(?:in[- ]+)?(?:person|branch)";
/** v2: how the bank tells the customer about a wire ("with Phone Notification"), not how it is requested. */
const NOTICE_WORDS =
  "(?:phone|telephone|fax|e-?mail|text)\\s+(?:or\\s+(?:phone|telephone|fax|e-?mail|text)\\s+)?(?:notification|notice|confirmation|advice|alert)s?|(?:notification|notice|confirmation|advice|alert)s?\\s+(?:by|via)\\s+(?:phone|telephone|fax|e-?mail|text)";

const CHANNEL = new RegExp(`\\b(?:${CHANNEL_WORDS})\\b`, "i");
const STANDARD = new RegExp(`\\b(?:${STANDARD_WORDS})\\b`, "i");
const NEGATED_STANDARD = new RegExp(`\\b(?:${NEGATED_STANDARD_WORDS})\\b`, "i");
const NEGATED_STANDARD_ALL = new RegExp(`\\b(?:${NEGATED_STANDARD_WORDS})\\b`, "gi");
const NOTICE_ALL = new RegExp(`\\b(?:${NOTICE_WORDS})\\b`, "gi");

/** PostgreSQL ARE: `\y` is the word boundary, and `(?:` is a non-capturing group in both. */
export const CHANNEL_SQL = `\\y(?:${CHANNEL_WORDS})\\y`;
export const STANDARD_SQL = `\\y(?:${STANDARD_WORDS})\\y`;
export const NEGATED_STANDARD_SQL = `\\y(?:${NEGATED_STANDARD_WORDS})\\y`;
export const NOTICE_SQL = `\\y(?:${NOTICE_WORDS})\\y`;

/**
 * A fee name that names a non-standard wire channel and no standard one. v2: a negated standard
 * channel counts as a channel and not as the standard word; a notice word names no channel.
 */
export function namesWireChannel(name: string | null | undefined): boolean {
  if (!name) return false;
  const channel = CHANNEL.test(name.replace(NOTICE_ALL, " ")) || NEGATED_STANDARD.test(name);
  return channel && !STANDARD.test(name.replace(NEGATED_STANDARD_ALL, " "));
}

/**
 * Words that state a wire's channel of any kind: a premium one, a negated standard one or the
 * standard one ("phone request", "Recurring", "Not in Person", "in branch"). A notice word names no
 * channel. Hamilton's live name refresh (#1912) reads the clause a re-read added to a wire's name.
 */
export function statesWireChannel(text: string | null | undefined): boolean {
  if (!text) return false;
  const words = text.replace(NOTICE_ALL, " ");
  return CHANNEL.test(words) || STANDARD.test(words) || NEGATED_STANDARD.test(text);
}

/** SQL twin of namesWireChannel over a static internal text column: true or false, never NULL. */
export function wireChannelSql(column: string): string {
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/i.test(column)) throw new Error("Invalid internal fee name column");
  return `COALESCE((regexp_replace(${column}, '${NOTICE_SQL}', ' ', 'gi') ~* '${CHANNEL_SQL}' OR ${column} ~* '${NEGATED_STANDARD_SQL}')`
    + ` AND regexp_replace(${column}, '${NEGATED_STANDARD_SQL}', ' ', 'gi') !~* '${STANDARD_SQL}', false)`;
}
