import { refileCategory, refileFromLine } from "@/lib/fee-category-guard";
import { reviewInternationalDirection, sourceOwnedWireScope } from "@/lib/custom-report/own-wire-scope";

/** Private applicability provenance; neither callers nor model output may supply it. */
export const INTERNATIONAL_WIRE_ELIGIBILITY_FLAG = "knox_eligibility:international_wire";

type Candidate = { feeName: string; amount: number; canonicalHint: string; excerpt: string };

/** Match Darwin's existing refile, including the incoming PDF's initial domestic hint. */
export function resolvedWireCategory(candidate: Candidate): string | null {
  return refileFromLine(candidate.canonicalHint, candidate.feeName,
    { amount: candidate.amount, conditions: `excerpt="${candidate.excerpt}"` })
    ?? refileCategory(candidate.canonicalHint, candidate.feeName);
}

/** Only resolved international rows acquire a missing-content source requirement. */
export function requiresInternationalWireSource(candidate: Candidate): boolean {
  return resolvedWireCategory(candidate)?.startsWith("wire_intl_") ?? false;
}

/** Source facts review an already admitted price; they cannot choose a new category. */
export function internationalWireEligibility(text: string, candidate: Candidate) {
  const resolved = resolvedWireCategory(candidate);
  if (!resolved?.startsWith("wire_")) return { kind: "not_applicable" } as const;
  return reviewInternationalDirection(sourceOwnedWireScope(text, candidate.feeName, candidate.amount), resolved);
}
