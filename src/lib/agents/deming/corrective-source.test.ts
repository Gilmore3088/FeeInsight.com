import { describe, expect, it } from "vitest";
import { CORRECTIVE_KIND, CASE_BYTE_CAP, SOURCE_PHASE_BYTE_CAP, encodedBytes, fixtureArtifact, replayCorrective, sourceHash, validCorrectiveReceipt, type CorrectiveInput } from "./corrective-source";

/** Synthetic server-shaped context. Pure validation is not an authority grant; real SQL tests bind it. */
export function context(text = "OTHER SERVICES\nStop Payment Fee | $35.00"): CorrectiveInput {
  const before = { canonicalFeeKey: "stop_payment", feeName: "Stop Payment Fee", amount: 25, frequency: "per_item", conditions: null };
  const after = { ...before, amount: 35 };
  const canonical = { id: 1, version: 1, fee_chain_id: 2, previous_fee_published_id: 2, fee_published_id: 3, institution_id: 4,
    action: "correct", actor_user_id: 5, actor_name: "Fixture operator", source_document_id: 6, source_excerpt: "Stop Payment Fee | $35.00", source_location: "row 1",
    before_canonical_fee_key: before.canonicalFeeKey, before_fee_name: before.feeName, before_amount: before.amount, before_frequency: before.frequency, before_conditions: null,
    canonical_fee_key: after.canonicalFeeKey, fee_name: after.feeName, amount: after.amount, frequency: after.frequency, conditions: null, reason: "Correct the price" };
  const detail = { action: "correct", institution_id: 4, actor_id: 5, actor: "Fixture operator", fee_published_id: 2, fee_chain_id: 2, version: 1,
    reason: canonical.reason, before, after };
  const payload = { context: "human_validated_edition" as const, originalExtractionBinding: "unknown" as const, canonical, feeContext: { amount_kind: "flat", rate_percent: null },
    documents: [{ id: 6, institutionId: 4, astId: 7, astInstitutionId: 4, status: "completed" as const, documentUrl: "https://fixture.invalid/fees", contentHash: "edition", sourceHash: "edition", textHash: sourceHash(text), normalizedText: text }],
    origin: { run: { id: 8, agent_name: "hamilton", run_kind: "manual_repair", status: "completed", trigger_source: "admin", triggered_by: "user:5", params_json: detail },
      step: { id: 9, agent_run_id: 8, agent_name: "hamilton", step_key: "admin.fee_correct", status: "completed", input_payload: detail },
      event: { id: 10, agent_run_id: 8, step_id: 9, event_type: "fee.correct", status: "completed", detail },
      feedback: { id: 11, agent_run_id: 8, reported_by: "human", kind: "admin_correction", signal: "wrong", check_name: "admin.fee_correction", dedupe_key: "admin.fee_correction:1",
        institution_id: 4, source_document_id: 6, fee_published_id: 2, canonical_fee_key: "stop_payment", amount: 25, evidence: { ...detail, correction_id: 1, new_fee_published_id: 3,
          source_excerpt: canonical.source_excerpt, source_location: canonical.source_location } } } };
  return { kind: CORRECTIVE_KIND, receipt: { protocol: 2, payload, digest: "a".repeat(64), databaseDigest: "a".repeat(64) } };
}

describe("one-document corrective replay", () => {
  it("keeps a usable human corrective context even when original extraction binding is unknown", () => {
    expect(validCorrectiveReceipt(context().receipt)).toBe(true);
    expect(replayCorrective(context())).toEqual({ evaluated: true, caught: true, verdict: "old_refused_corrected_accepted" });
  });
  it("does not pass a reject-everything checker or a both-accepted rule miss", () => {
    const miss = context("Stop Payment Fee | $25.00\nStop Payment Fee | $35.00");
    expect(replayCorrective(miss)).toEqual({ evaluated: true, caught: false, verdict: "both_accepted" });
    const changed = context(); changed.receipt.payload.canonical.amount = 36;
    // Label/source positive failure is evaluated as a semantic failure, not a caught mistake.
    const d = changed.receipt.payload;
    for (const item of [d.origin.run, d.origin.step, d.origin.event]) {
      const v = item as Record<string, unknown>; const detail = (v.params_json ?? v.input_payload ?? v.detail) as Record<string, unknown>;
      (detail.after as Record<string, unknown>).amount = 36;
    }
    ((d.origin.feedback as Record<string, unknown>).evidence as Record<string, unknown>).after = (d.origin.run as Record<string, unknown>).params_json && ((d.origin.run as Record<string, unknown>).params_json as Record<string, unknown>).after;
    expect(replayCorrective(changed)).toEqual({ evaluated: true, caught: false, verdict: "corrected_refused" });
  });
  it.each([null, false, "{}", [], {}, { protocol: 1 }])("never decodes a malformed packet twice: %j", (bad) => {
    expect(replayCorrective({ kind: CORRECTIVE_KIND, receipt: bad }).evaluated).toBe(false);
  });
  it.each([0, 2, 8])("requires exactly one complete document, not %i", (count) => {
    const c = context(); c.receipt.payload.documents = Array.from({ length: count }, () => c.receipt.payload.documents[0]);
    expect(replayCorrective(c).evaluated).toBe(false);
  });
  it("rejects missing/foreign/hash-mismatched or clipped source bodies", () => {
    for (const edit of [(d: CorrectiveInput) => { d.receipt.payload.documents[0].institutionId = 9; },
      (d: CorrectiveInput) => { d.receipt.payload.documents[0].textHash = "0".repeat(64); },
      (d: CorrectiveInput) => { d.receipt.payload.documents[0].normalizedText = ""; },
      (d: CorrectiveInput) => { d.receipt.payload.documents[0].normalizedText += "x".repeat(200_001); }]) {
      const d = context(); edit(d); expect(replayCorrective(d).evaluated).toBe(false);
    }
  });
  it("checks Unicode codepoints, actual escaped byte length and full own body, without clipping", () => {
    const d = context("😀".repeat(199_950) + "\nStop Payment Fee | $35.00");
    expect(validCorrectiveReceipt(d.receipt)).toBe(true);
    const over = context('"\\'.repeat(100_000) + "\nStop Payment Fee | $35.00");
    expect(validCorrectiveReceipt(over.receipt)).toBe(false);
    expect(encodedBytes("\ud800")).toBe(8);
  });
  it("rejects spoofed actor/origin and preserves unsupported dimensions as unavailable", () => {
    const fake = context(); (fake.receipt.payload.origin.run as Record<string, unknown>).triggered_by = "user:99";
    expect(replayCorrective(fake).evaluated).toBe(false);
    const rate = context(); rate.receipt.payload.feeContext.amount_kind = "percentage";
    expect(replayCorrective(rate)).toMatchObject({ evaluated: false, verdict: "unsupported_context" });
  });
  it("packs bounded actual whole cases; deterministic artifacts are not a CI delivery claim", () => {
    const c = context("x".repeat(199_900) + "\nStop Payment Fee | $35.00");
    const cases = Array.from({ length: 60 }, (_, i) => ({ caseId: i + 1, input: c, outcome: replayCorrective(c) }));
    const a = fixtureArtifact(cases);
    expect(a.complete).toBe(false); expect(a.caseCount).toBeGreaterThan(1); expect(a.bytes).toBeLessThanOrEqual(SOURCE_PHASE_BYTE_CAP);
    expect(a.chunks.every((chunk) => encodedBytes(chunk) <= 2 * CASE_BYTE_CAP)).toBe(true);
    expect(fixtureArtifact(cases)).toEqual(a);
  });
});
