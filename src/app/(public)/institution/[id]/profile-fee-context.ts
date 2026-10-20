import { readerFeeConditions, PIPELINE_NOTE_MARKERS } from "@/lib/fee-conditions";
import { readableProductName, readableWaiver } from "@/lib/agents/knox/lineup";
import type { ExtractedFee } from "@/lib/data-store/types";

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function customerText(value: string | null | undefined): string | null {
  const text = readerFeeConditions(value);
  return text && !PIPELINE_NOTE_MARKERS.test(text) && !/\b(?:excerpt|canonical_hint)=/.test(text) ? text : null;
}

// A general numeric match also accepts ages and balances. Require exactly one monetary fee
// price, allowing other dollar tokens only as explicitly worded balance thresholds. Competing
// service prices (even at the same amount) leave the context for review.
function corroboratesPrice(source: string | null | undefined, amount: number | null): source is string {
  if (!source || amount == null || !Number.isFinite(amount)) return false;
  const money = [...source.matchAll(/\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?(?![\d.,a-z])/gi)];
  let prices = 0;
  for (const match of money) {
    const before = source.slice(0, match.index).trimEnd();
    if (/\bbalance(?:\s+(?:in|the|account|falls?|drops?|is|of|over|under|below|above|at|least|minimum|maintained|required|than|less|more)){0,10}\s*$/i.test(before)) continue;
    if (Number(match[0].replace(/[$,\s]/g, "")) !== amount) return false;
    prices += 1;
  }
  return prices === 1;
}

/**
 * The table's existing notes also carry the account a price belongs to. A separate waiver is
 * shown only when the fee's own stored line corroborates its complete wording: older rows
 * can carry a neighbouring fee's waiver. Numeric tier boundaries alone do not prove a waiver.
 * Do not display the raw extraction line, which may be cut or contain several unrelated fees.
 */
export function feeScheduleContext(fee: Pick<ExtractedFee,
  "fee_name" | "amount" | "conditions" | "account_product_type" | "waiver_text" | "source_line"
>): string | null {
  const parts: string[] = [];
  const conditions = customerText(fee.conditions);
  const product = readableProductName(customerText(fee.account_product_type));
  const source = fee.source_line;
  const sourceHasPrice = corroboratesPrice(source, fee.amount);
  if (product && sourceHasPrice && normalized(source).includes(normalized(product))
    && !/\b(?:account fees?|comparison table)\b/i.test(product)
    && !normalized(fee.fee_name).includes(normalized(product))
    && !(conditions && normalized(conditions).includes(normalized(product)))) {
    parts.push(`Account: ${product}`);
  }
  if (conditions) parts.push(conditions);
  const waiver = readableWaiver(customerText(fee.waiver_text));
  if (waiver && sourceHasPrice && normalized(source).includes(normalized(waiver))
    && !parts.some((part) => normalized(part).includes(normalized(waiver)))) {
    parts.push(waiver);
  }
  return parts.length ? parts.join(" · ") : null;
}
