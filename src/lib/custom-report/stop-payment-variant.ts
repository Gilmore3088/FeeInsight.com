/**
 * v181 (Knox backlog dry run 12): bulleted variants under a stop payment row that prints its own price, in the
 * last column of a two-column page. St. Louis Community FCU (text 3810) prints its stop payment list on the
 * right: "Save to Prosper4 | Stop Payment Fee – Check or ACH (per item): | $20.00" over "• Save to Prosper
 * Withdrawal Fee | $25.00 | Check series | $25.00" over "Savings accounts | • Corporate Check | $15.00". The
 * heading is priced, so no reader takes it as the bullets' parent, and "Corporate Check" alone reads as a
 * cashier's check. Shared by Knox's read (`stopPaymentVariantRead`) and the source check, which admits the
 * read's composed name ("Stop Payment Fee – Check or ACH (per item): Corporate Check") only at such a row. Pure.
 *
 * A variant is the last label of its line, bulleted, at the line's last price, and names only an item a stop
 * payment is placed on (`STOP_PAYMENT_VARIANT`). Walking up the last label of each line above, past other such
 * variants (bulleted or not: "Check series"), must reach a stop payment label that prints its own price, is not
 * itself bulleted and introduces its list with a colon. A label that names anything else ends the walk, so a bullet
 * list of different fees is never read this way.
 */
export const STOP_PAYMENT_VARIANT = /^(?:(?:personal|official|corporate|cashier['’]?s|teller['’]?s|counter|certified|electronic|recurring|pre-?authori[sz]ed|share|business)\s+)*(?:checks?(?:\s+series)?|series\s+(?:of\s+)?checks?|check\s+range|range\s+of\s+checks?|drafts?|share\s+drafts?|money\s+orders?|ach(?:\s+(?:debits?|items?|payments?))?|debits?|items?)$/i;
const STOP_PAYMENT_LABEL = /\bstop\s*-?\s*pay(?:ment)?s?\b/i;
const MAX_VARIANT_WALK = 4;
const PRICE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?/g;
const HAS_PRICE = /\$\s?\d/;
const BULLET = /^[•●▪‣]\s*/;

export interface StopPaymentVariantRow {
  heading: string;
  variant: string;
  amount: number;
  row: string;
}

function label(value: string): string {
  return value.replace(/[•●▪‣*·]/g, " ").replace(/\s+/g, " ").replace(/^[\s\-–—|:;,.]+/, "").replace(/[\s|:;,\-–—.]+$/, "").trim();
}

/** A line's last label and the price printed after it, as the last column of a two-column page prints them. */
export function lastLabeledPrice(line: string): { label: string; bulleted: boolean; introduces: boolean; amount: number } | null {
  const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
  for (let at = cells.length - 1; at >= 0; at -= 1) {
    const prices = [...cells[at].matchAll(PRICE)];
    if (prices.length === 0) continue;
    const price = prices[prices.length - 1];
    const own = cells[at].slice(0, price.index).trim();
    const raw = /[a-z]/i.test(own) ? own : at > 0 ? cells[at - 1] : "";
    if (!raw || HAS_PRICE.test(raw) || !/[a-z]/i.test(raw)) return null;
    return { label: label(raw), bulleted: BULLET.test(raw), introduces: /:\s*$/.test(raw), amount: Number(`${price[1].replace(/,/g, "")}${price[2] ?? ""}`) };
  }
  return null;
}

export function stopPaymentVariantRows(text: string): StopPaymentVariantRow[] {
  if (!text.includes("•") || !STOP_PAYMENT_LABEL.test(text)) return [];
  const lines = text.split("\n").map((line) => line.replace(/\s+/g, " ").trim());
  const rows: StopPaymentVariantRow[] = [];
  lines.forEach((line, index) => {
    const own = lastLabeledPrice(line);
    if (!own || !own.bulleted || !STOP_PAYMENT_VARIANT.test(own.label)) return;
    for (let above = index - 1; above >= 0 && index - above <= MAX_VARIANT_WALK; above -= 1) {
      const row = lastLabeledPrice(lines[above]);
      if (!row) return;
      if (STOP_PAYMENT_LABEL.test(row.label)) {
        // The parent introduces its list ("Stop Payment Fee – Check or ACH (per item): | $20.00") and is no item of
        // a bullet list itself: "• Check Stop Payment Fee Per Item | $30.00" over "• Certified Checks | $10.00" is a
        // list of different fees (review of the live dry run, #75973).
        if (row.bulleted || !row.introduces) return;
        rows.push({ heading: row.label, variant: own.label, amount: own.amount, row: line });
        return;
      }
      if (!STOP_PAYMENT_VARIANT.test(row.label)) return;
    }
  });
  return rows;
}

/** The name a variant's read takes: its stop payment label, then the variant. */
export function stopPaymentVariantName(row: StopPaymentVariantRow): string {
  return `${row.heading}: ${row.variant}`;
}

/** The row an admitted variant read traces to, or null. */
export function stopPaymentVariantRow(text: string, feeName: string, amount: number): string | null {
  const wanted = feeName.replace(/\s+/g, " ").trim().toLowerCase();
  const cents = Math.round(amount * 100);
  const found = stopPaymentVariantRows(text).filter((row) => stopPaymentVariantName(row).toLowerCase() === wanted && Math.round(row.amount * 100) === cents);
  return found.length === 1 ? found[0].row : null;
}
