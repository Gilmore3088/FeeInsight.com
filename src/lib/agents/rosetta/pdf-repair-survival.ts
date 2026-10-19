import { createHash } from "node:crypto";

/** Produced by the PDF geometry reader, never inferred from the stored text. */
export interface StackedGeometryReceipt {
  sourceHash: string;
  textHash: string;
  stackedPages: number[];
}

export function textSha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Columns may change line breaks and table separators, but not a single literal
 * token. Case, punctuation, currency, unit and qualifying words stay significant.
 * This is a conservation proof, not authority to extract or publish a price.
 */
export function conservedLayoutTokens(before: string, after: string): {
  conserved: boolean; lost: number; added: number; tokens: number;
} {
  const counts = (text: string) => {
    const result = new Map<string, number>();
    for (const token of text.match(/[^\s|]+/gu) ?? []) result.set(token, (result.get(token) ?? 0) + 1);
    return result;
  };
  const oldTokens = counts(before);
  const newTokens = counts(after);
  let lost = 0, added = 0, tokens = 0;
  for (const [token, count] of oldTokens) {
    tokens += count;
    lost += Math.max(0, count - (newTokens.get(token) ?? 0));
  }
  for (const [token, count] of newTokens) added += Math.max(0, count - (oldTokens.get(token) ?? 0));
  return { conserved: tokens > 0 && lost === 0 && added === 0, lost, added, tokens };
}

export function losslessStackedRecovery(
  before: string, after: string, sourceHash: string, receipt: StackedGeometryReceipt | null | undefined,
): boolean {
  return receipt != null && receipt.sourceHash === sourceHash && receipt.textHash === textSha256(after)
    && receipt.stackedPages.length > 0
    && receipt.stackedPages.every((page) => Number.isSafeInteger(page) && page > 0)
    && conservedLayoutTokens(before, after).conserved;
}
