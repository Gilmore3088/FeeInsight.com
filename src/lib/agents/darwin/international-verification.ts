import { abbreviatesInternationalWire } from "@/lib/fee-fold";
import { sourceOwnedWireScope, reviewInternationalDirection, hasLiteralOutsideUsaWireCue,
  type InternationalDirectionReview } from "@/lib/custom-report/own-wire-scope";
import { INTERNATIONAL_WIRE_ELIGIBILITY_FLAG } from "../knox/international-wire-eligibility";
import { matchOriginalRawSource, type LockedSourceSnapshot } from "./locked-raw-source";
import { VerificationAudienceDeferred, type VerificationAudienceAdmission } from "./verification-audience";

type ActualRaw = Parameters<typeof matchOriginalRawSource>[0] & {
  fee_name: string;
  amount: number | string | null;
  outlier_flags: unknown;
};
/** Facts held by the shared audience admission; never reconstructed from a CAS stamp. */
export type CurrentSource = { kind: "bound"; source: LockedSourceSnapshot; currentRaw: ActualRaw }
  | { kind: "busy" | "changed" | "unavailable" };
export type InternationalVerificationDecision = { kind: "not_applicable" | "ready" }
  | { kind: "deferred"; reason: "private_eligibility_hold" | "source_unavailable" | "original_unavailable" | "own_direction_unproven" };
/** The decision with the direction review behind it, when one ran (#1912: Darwin's live re-check reads why). */
export type InternationalDirectionOutcome = InternationalVerificationDecision & { review?: InternationalDirectionReview };

function flagValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

/**
 * Review final admission, after existing category checks and the fresh raw CAS. The
 * raw-resolved category only identifies an affected stale caller; it supplies no price,
 * new category, geography or direction. Ordinary domestic missing-source behavior stays.
 */
export function internationalVerificationDecision(raw: ActualRaw, finalCategory: string,
  existingRawResolvedCategory: string | null, context: CurrentSource): InternationalVerificationDecision {
  const outcome = internationalDirectionOutcome(raw, finalCategory, existingRawResolvedCategory, context);
  return outcome.kind === "deferred" ? { kind: "deferred", reason: outcome.reason } : { kind: outcome.kind };
}

/**
 * The same decision, keeping the direction review (hold reason and the source's own scope). One rule
 * for new rows at verify and for live rows in Darwin's re-check (`international-direction-check.ts`, #1912).
 * `originalTextProved` is only for that re-check, which has no locked admission: it has proved that the
 * stored text is byte for byte the text Knox read the fee from (its sha256 is the note's `text_hash`),
 * where the same text can sit under a newer artifact id or a re-read note can name the artifact twice.
 */
export function internationalDirectionOutcome(raw: ActualRaw, finalCategory: string,
  existingRawResolvedCategory: string | null, context: CurrentSource,
  options: { originalTextProved?: boolean } = {}): InternationalDirectionOutcome {
  const actual = context.kind === "bound" ? context.currentRaw : raw;
  const flags = flagValues(actual.outlier_flags);
  if (flags.includes(INTERNATIONAL_WIRE_ELIGIBILITY_FLAG)) return { kind: "deferred", reason: "private_eligibility_hold" };
  // This finite current-name cue routes uncertainty only; it never supplies a category.
  // #1513: "Wire Trans. (Intern. Outgoing)" and "Int. Wire Transfer" name one too (`abbreviatesInternationalWire`).
  const namedInternationalWire = (/\b(?:international|foreign|intl|int['’]?l)\b/i.test(actual.fee_name)
    && /\b(?:wires?|transfers?)\b/i.test(actual.fee_name)) || abbreviatesInternationalWire(actual.fee_name) || hasLiteralOutsideUsaWireCue(actual.fee_name);
  const affected = namedInternationalWire || finalCategory.startsWith("wire_intl_") || existingRawResolvedCategory?.startsWith("wire_intl_");
  if (context.kind !== "bound") return affected ? { kind: "deferred", reason: "source_unavailable" } : { kind: "not_applicable" };
  if (actual.amount == null || actual.amount === "" || !Number.isFinite(Number(actual.amount)))
    return affected ? { kind: "deferred", reason: "own_direction_unproven" } : { kind: "not_applicable" };
  const scope = sourceOwnedWireScope(context.source.normalizedText, actual.fee_name, Number(actual.amount));
  // A stale ordinary key cannot negate a positive actual own international wire
  // clause. Conversely a nonwire "International Money Order" is not a wire fact.
  if (!affected && !(scope.kind === "owned" && scope.geography === "international"
    && /\b(?:wires?|transfers?)\b/i.test(scope.ownText))) return { kind: "not_applicable" };
  if (!options.originalTextProved && matchOriginalRawSource(actual, context.source).kind !== "matched")
    return { kind: "deferred", reason: "original_unavailable" };
  const review = reviewInternationalDirection(scope, finalCategory);
  return review.kind === "admit" ? { kind: "ready", review }
    : { kind: "deferred", reason: "own_direction_unproven", review };
}

/** Same transient protocol as the shared admission; no ordinary attempt/lesson on uncertainty. */
export function requireInternationalVerification(admission: VerificationAudienceAdmission,
  finalCategory: string | null, existingRawResolvedCategory: string | null): void {
  const decision = internationalVerificationDecision({ ...admission.row,
    extraction_note: admission.sourceContext.kind === "bound" ? admission.sourceContext.currentRaw.extraction_note : null },
  finalCategory ?? "", existingRawResolvedCategory, admission.sourceContext);
  if (decision.kind === "deferred") throw new VerificationAudienceDeferred(`international_${decision.reason}`);
}
