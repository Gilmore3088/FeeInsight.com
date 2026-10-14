/**
 * The fee name a reader sees. Stored names stay exactly as they trace to the bank's schedule; this
 * only fills in what a schedule row leaves to its heading. A safe deposit box row often names the
 * box size alone ("3 X 10", "5” x 10” Box"), so the page shows "Safe Deposit Box 3 X 10".
 */
const DIMENSION = String.raw`\d+(?:\.\d+)?\s*(?:"|”|''|in\.?|inch(?:es)?)?`;
const BOX_SIZE_ONLY = new RegExp(String.raw`^\s*(${DIMENSION}\s*[x×]\s*${DIMENSION}(?:\s*[x×]\s*${DIMENSION})?)(?:\s+box)?\s*$`, "i");

export function feeDisplayName(name: string, canonicalKey: string | null | undefined): string {
  if (canonicalKey !== "safe_deposit_box") return name;
  const size = BOX_SIZE_ONLY.exec(name);
  return size ? `Safe Deposit Box ${size[1].trim()}` : name;
}
