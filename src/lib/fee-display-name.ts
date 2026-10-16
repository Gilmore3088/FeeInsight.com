import { liveFragmentName, nameHasCutShape } from "@/lib/fee-name-fragments";
import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";

/**
 * The fee name a reader sees. Stored names stay exactly as they trace to the bank's schedule; this
 * only fills in what a schedule row leaves to its heading. A safe deposit box row often names the
 * box size alone ("3 X 10", "5” x 10” Box"), so the page shows "Safe Deposit Box 3 X 10".
 *
 * A name cut from its line ("Chase Mobile to send a wire from your account to") shows the
 * category's own name instead (#1180). The cut test is the pipeline's own: Darwin's
 * `nameHasCutShape` and Knox's live fragment shapes (`liveFragmentName`), so the page and the
 * agents agree on what a fragment is; both live in the pure `fee-name-fragments` module (#1483),
 * so this helper reaches no agent code. The stored name is untouched; Rosetta and Knox own the fix.
 */
const DIMENSION = String.raw`\d+(?:\.\d+)?\s*(?:"|”|''|in\.?|inch(?:es)?)?`;
const BOX_SIZE_ONLY = new RegExp(String.raw`^\s*(${DIMENSION}\s*[x×]\s*${DIMENSION}(?:\s*[x×]\s*${DIMENSION})?)(?:\s+box)?\s*$`, "i");

/**
 * A name that stops on an audience adjective right after a count or a determiner has lost the noun
 * it described: "Counter Check: A blank page of 3 personal" (checks). Display only: the agents'
 * shared fragment shapes are untouched, so this moves no live fee. A name whose audience is its
 * own label ("Monthly Service Fee - Business", "Small Business") does not match.
 */
const DANGLING_AUDIENCE = /\b(?:\d+|a|an|the|your|our|each|per|any|all)\s+(?:personal|business|consumer|commercial)\s*$/i;

/** True when a stored fee name is a fragment of its schedule line rather than a name. */
export function isCutFeeName(name: string | null | undefined): boolean {
  const current = (name ?? "").trim();
  if (!current) return false;
  return nameHasCutShape(current) || liveFragmentName(current) !== null || DANGLING_AUDIENCE.test(current);
}

export function feeDisplayName(name: string, canonicalKey: string | null | undefined): string {
  return apiFeeName(name, canonicalKey).fee_name;
}

/**
 * The API's fee name pair (#1482): `fee_name` as the site shows it, and whether that name is the
 * category's own name standing in for a cut-off stored name. The stored fragment is not exposed.
 */
export function apiFeeName(
  name: string,
  canonicalKey: string | null | undefined,
): { fee_name: string; name_is_category_fallback: boolean } {
  if (canonicalKey === "safe_deposit_box") {
    const size = BOX_SIZE_ONLY.exec(name);
    if (size) return { fee_name: `Safe Deposit Box ${size[1].trim()}`, name_is_category_fallback: false };
  }
  const categoryName = canonicalKey ? DISPLAY_NAMES[canonicalKey] : undefined;
  if (categoryName && isCutFeeName(name)) return { fee_name: categoryName, name_is_category_fallback: true };
  return { fee_name: name, name_is_category_fallback: false };
}
