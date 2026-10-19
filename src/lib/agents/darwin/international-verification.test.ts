// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { internationalVerificationDecision } from "./international-verification";
import type { LockedSourceSnapshot } from "./locked-raw-source";

const fixture = JSON.parse(readFileSync(new URL("../knox/__fixtures__/family-international-wire-scope.json", import.meta.url), "utf8"));
const pdf = fixture.sources.find((source: { kind: string }) => source.kind === "consumer_pdf");
const html = fixture.sources.find((source: { kind: string }) => source.kind === "fresh_html");
function facts(text: string, name: string, amount: number | string | null) {
  const hash = createHash("sha256").update(text).digest("hex");
  const raw = { institution_id: 11, source_document_id: 12, fee_name: name, amount, outlier_flags: [], conditions: null,
    extraction_note: `Knox deterministic extraction from Rosetta artifact #13. canonical_hint=wire_intl_outgoing; text_hash=${hash}; excerpt="${name}"` };
  const source = { artifactId: 13, documentId: 12, institutionId: 11, textHash: hash, normalizedText: text } as LockedSourceSnapshot;
  return { raw, context: { kind: "bound" as const, currentRaw: raw, source } };
}

describe("final international verification uses held current source facts (#2278)", () => {
  it.each([["International Wire Incoming",35,"wire_intl_incoming"],
    ["International Wire Outgoing",45,"wire_intl_outgoing"]] as const)("keeps the exact full PDF %s after existing refile", (name, amount, category) => {
    const f = facts(pdf.normalizedText, name, amount);
    expect(internationalVerificationDecision(f.raw, category, category, f.context)).toEqual({ kind: "ready" });
  });
  it.each(["wire_intl_outgoing", "wire_domestic_outgoing", "minimum_balance"])("does not let stale %s bypass an unmarked current generic international row", finalCategory => {
    const f = facts(html.normalizedText, "International Wire Transfer Fee", 35);
    expect(internationalVerificationDecision(f.raw, finalCategory, "wire_intl_outgoing", f.context))
      .toEqual({ kind: "deferred", reason: "own_direction_unproven" });
  });
  it("does not use a wrong final incoming key for the source's own outgoing45", () => {
    const f = facts(pdf.normalizedText, "International Wire Outgoing", 45);
    expect(internationalVerificationDecision(f.raw, "wire_intl_incoming", "wire_intl_outgoing", f.context).kind).toBe("deferred");
  });
  it.each([{ flags: [] }, { flags: ["knox_review:eligibility"] }])("detects own international scope even with a stale ordinary raw hint $flags", ({ flags }) => {
    const f = facts(pdf.normalizedText, "International Wire Outgoing", 45);
    f.raw.outlier_flags = flags as never[];
    expect(internationalVerificationDecision(f.raw, "wire_domestic_outgoing", "wire_domestic_outgoing", f.context).kind).toBe("deferred");
  });
  it.each([{ flags: ["knox_eligibility:international_wire"] }, { flags: '["knox_eligibility:international_wire"]' }])("respects the current private hold with stale unrelated key $flags", ({ flags }) => {
    const f = facts(html.normalizedText, "International Wire Transfer Fee", 35);
    const held = { ...f.raw, outlier_flags: flags };
    expect(internationalVerificationDecision(f.raw, "minimum_balance", null, { ...f.context, currentRaw: held }))
      .toEqual({ kind: "deferred", reason: "private_eligibility_hold" });
  });
  it.each(["busy", "changed", "unavailable"] as const)("declines affected Intl but preserves ordinary domestic unavailable behavior: %s", kind => {
    const f = facts(pdf.normalizedText, "Domestic Wire Outgoing", 20);
    expect(internationalVerificationDecision(f.raw, "wire_intl_outgoing", null, { kind })).toEqual({ kind: "deferred", reason: "source_unavailable" });
    expect(internationalVerificationDecision(f.raw, "wire_domestic_outgoing", "wire_domestic_outgoing", { kind })).toEqual({ kind: "not_applicable" });
  });
  it.each(["missing", "wrong_artifact", "wrong_hash", "wrong_owner"])("refuses %s original binding while preserving actual scope facts", mode => {
    const f = facts(pdf.normalizedText, "International Wire Outgoing", 45);
    if (mode === "missing") f.raw.extraction_note = "untrusted model source claim";
    if (mode === "wrong_artifact") f.raw.extraction_note = f.raw.extraction_note.replace("artifact #13", "artifact #14");
    if (mode === "wrong_hash") f.raw.extraction_note = f.raw.extraction_note.replace(f.context.source.textHash, "f".repeat(64));
    if (mode === "wrong_owner") f.raw.institution_id = 99;
    expect(internationalVerificationDecision(f.raw, "wire_intl_outgoing", "wire_intl_outgoing", f.context))
      .toEqual({ kind: "deferred", reason: "original_unavailable" });
  });
  it.each([null, "", "not numeric"])("does not turn missing/nonprice %s into a zero witness", amount => {
    const f = facts("International Wire Outgoing | FREE", "International Wire Outgoing", amount);
    expect(internationalVerificationDecision(f.raw, "wire_intl_outgoing", null, f.context).kind).toBe("deferred");
  });
  it("uses FREE solely for an already-admitted exact zero and leaves ordinary nonwire rows unaffected", () => {
    const f = facts("International Wire Incoming | FREE", "International Wire Incoming", 0);
    expect(internationalVerificationDecision(f.raw, "wire_intl_incoming", "wire_intl_incoming", f.context)).toEqual({ kind: "ready" });
    expect(internationalVerificationDecision(f.raw, "money_order", "money_order", { kind: "unavailable" })).toEqual({ kind: "not_applicable" });
  });
});
