/**
 * The paid-report offer at the foot of the monthly edition (src/lib/agents/marketing/email.ts).
 * It is written as MailerLite merge fields with the free-reader wording as their defaults, so
 * one campaign serves everyone: a Hamilton Pro customer has these fields set on their
 * subscriber record (syncProCustomerToMailerLite) and reads a Hamilton line instead of an
 * upsell, while still getting the monthly digest. Each field must exist in MailerLite.
 */
export const MONTHLY_OFFER_FIELDS = {
  text: "monthly_offer_text",
  cta: "monthly_offer_cta",
  url: "monthly_offer_url",
} as const;

/** What a Pro customer reads in place of the report offer. */
export const PRO_MONTHLY_OFFER: Record<string, string> = {
  [MONTHLY_OFFER_FIELDS.text]: "Compare these figures with your own peer set in Hamilton.",
  [MONTHLY_OFFER_FIELDS.cta]: "Open Hamilton",
  [MONTHLY_OFFER_FIELDS.url]: "https://feeinsight.com/pro/hamilton",
};

export const FREE_MONTHLY_OFFER = {
  text: "Want your own institution against the competitors you name? We check that your market has enough published data, then reply with scope and price.",
  cta: "Request your report",
};

/** A MailerLite merge tag that falls back to `fallback`; the fallback must not contain a quote. */
export function mergeTag(field: string, fallback: string): string {
  if (/['"]/.test(fallback)) throw new Error(`Merge-tag fallback for ${field} can't contain quotes.`);
  return `{$${field}|default('${fallback}')}`;
}
