/**
 * The institution report is paid by card through Stripe (James, 6 Oct 2026). Plain
 * helpers shared by /admin/leads (client), the pay page and the webhook; the signed pay
 * link lives in pay-link.ts (server only).
 */
export const PAY_LINK_LIFETIME_DAYS = 60;
/** Stripe's smallest card charge is $0.50; a report quote below $1 is a typo. */
export const MIN_QUOTE_CENTS = 100;
export const MAX_QUOTE_CENTS = 5_000_000;
export const REPORT_PAYMENT_KIND = "institution_report";

/** "$300" or "$1,250.50" from cents. */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** What James typed ("300", "$1,250.50") as cents, or null when it is not a usable price. */
export function parseQuoteCents(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return cents >= MIN_QUOTE_CENTS && cents <= MAX_QUOTE_CENTS ? cents : null;
}

/** Report requests store "institution_id=N" in use_case (lead-notifications buildReportUseCase). */
export function institutionIdFromUseCase(useCase: string | null | undefined): number | null {
  const match = useCase ? /(?:^|;\s*)institution_id=(\d{1,10})(?:;|$)/.exec(useCase) : null;
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Sources that ask for an institution report, the only leads that can be quoted. */
export function isReportRequestSource(source: string | null | undefined): boolean {
  if (!source) return false;
  return source.split(",").some((part) => ["report", "report_order", "contact_report"].includes(part.trim()));
}
