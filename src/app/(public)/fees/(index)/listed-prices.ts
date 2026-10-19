import type { FeeRowDetail } from "@/lib/data-store/fees";
import type { FeeEvidence } from "@/lib/data-store/fee-evidence";
import type { FeeRecordContext } from "@/lib/data-store/fee-record-context";
import { productKey } from "@/lib/fee-product";

export interface ListedPrice { id: number; amount: number; detail: FeeRowDetail | null; evidence: FeeEvidence | null }
export interface DisplayPriceLine { key: string; amount: number; detail: FeeRowDetail | null; observations: ListedPrice[] }
interface ExpectedRecord { institutionId: number; category: string }
const positive = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const nullableId = (n: unknown) => n === null || positive(n);
const nullableText = (v: unknown) => v === null || typeof v === "string";
const nullableNumber = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));

function currentContext(c: FeeRecordContext | undefined): c is FeeRecordContext {
  return !!c && c.version === 1 && typeof c.stamp === "string" && /^[a-f0-9]{64}$/.test(c.stamp)
    && positive(c.publishedId) && positive(c.institutionId) && typeof c.category === "string" && !!c.category
    && nullableNumber(c.amount) && nullableId(c.verifiedId) && nullableId(c.rawId) && nullableId(c.sourceDocumentId)
    && nullableText(c.documentUrl) && nullableText(c.sourceUrl);
}

/** All represented context must fit the price/subject actually shown from the cached index. */
function detailFor(price: ListedPrice, expected: ExpectedRecord): FeeRowDetail | null {
  const d = price.detail, c = d?.context;
  if (!d || !currentContext(c) || c.publishedId !== price.id || c.institutionId !== expected.institutionId
    || c.category !== expected.category || c.amount !== price.amount || d.amount !== price.amount
    || (c.documentUrl ?? c.sourceUrl) !== d.document_url || c.sourceUrl !== d.source_url || d.amount_kind !== "flat") return null;
  const words = ["fee_name", "frequency", "account", "conditions", "fee_audience", "fee_treatment", "variant_type", "rate_basis", "read_on", "waiver_text"] as const;
  if (!words.every(key => Object.hasOwn(d, key) && nullableText(d[key]))) return null;
  if (![d.rate_percent, d.rate_min_amount, d.rate_max_amount, d.min_balance_to_avoid, d.min_opening_deposit].every(nullableNumber)) return null;
  return d;
}

function sameContext(a: FeeRecordContext, b: FeeRecordContext): boolean {
  return (Object.keys(a) as Array<keyof FeeRecordContext>).every(key => a[key] === b[key])
    && (Object.keys(b) as Array<keyof FeeRecordContext>).every(key => b[key] === a[key]);
}

/** A stored price/name match stays price context, never proof of an account/condition relationship. */
function evidenceFor(e: FeeEvidence | null, d: FeeRowDetail | null): FeeEvidence | null {
  if (!e || !d?.context || !currentContext(e.context) || !sameContext(d.context, e.context) || typeof e.line !== "string" || !e.line || !nullableText(e.heading)) return null;
  if (e.basis === "stored_line") return e.text_artifact === null ? e : null;
  const a = e.text_artifact;
  if (e.basis !== "traced" || !a || a.version !== 1 || !positive(a.id) || a.status !== "completed"
    || a.institutionId !== d.context.institutionId || a.sourceDocumentId !== d.context.sourceDocumentId
    || !positive(a.sourceDocumentId) || typeof a.textHash !== "string" || !/^[a-f0-9]{64}$/.test(a.textHash) || !nullableText(a.recordedAt)) return null;
  return e;
}

/** Display grouping only: it never feeds back into index rows, reductions, counts or weights. */
export function listedPriceLines(prices: readonly ListedPrice[], expected: ExpectedRecord): DisplayPriceLine[] {
  const groups = new Map<string, DisplayPriceLine>();
  for (const p of [...prices].sort((a, b) => a.amount - b.amount || a.id - b.id)) {
    const d = detailFor(p, expected);
    // Unknown product ownership, lineage or name cannot establish positive equivalence.
    const known = d?.account?.trim() && productKey(d.account) && d.context?.verifiedId && d.context.rawId && d.fee_name?.trim();
    const key = known ? JSON.stringify([p.amount, d.fee_name, productKey(d.account), d.fee_audience, d.fee_treatment,
      d.frequency, d.variant_type, d.amount_kind, d.rate_percent, d.rate_min_amount, d.rate_max_amount, d.rate_basis, d.conditions,
      d.waiver_text, d.min_balance_to_avoid, d.min_opening_deposit]) : `row:${p.id}`;
    const observation: ListedPrice = { ...p, detail: d, evidence: evidenceFor(p.evidence, d) };
    const group = groups.get(key);
    if (group) group.observations.push(observation);
    else groups.set(key, { key, amount: p.amount, detail: d, observations: [observation] });
  }
  return [...groups.values()];
}
