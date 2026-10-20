import { describe, expect, it, vi } from "vitest";
import { narrateStepFinished } from "../narrate";
import { recheckReceiptNote, verifiedRecheckReceipt } from "./verified-recheck-receipt";

const context = { learning: true, dryRun: false };
function packet() {
  return {
    checked: 7, passed: 2, rejected: [{ feeVerifiedId: 11, code: "tier_perk_zero" }], restored: [12],
    cleared: 1, flagged: 2, waiting: 1, takenDown: [13], secondLookOtherCode: 1,
    olderLive: { read: 3, wouldFail: { tier_perk_zero: 2 }, samples: [{
      feePublishedId: 20, feeVerifiedId: 11, institutionId: 4, canonicalFeeKey: "overdraft",
      amount: 0, code: "tier_perk_zero", feeName: "private fee name", source: "private source",
    }] },
    dueSecondLooks: { due: 2, wouldConfirm: { conditional_zero: 1 }, wouldClear: 1, samples: [{
      feePublishedId: 21, institutionId: 4, canonicalFeeKey: "overdraft", amount: 0,
      code: "conditional_zero", feeName: "private fee name",
    }] },
  };
}
const zero = { checked: 0, passed: 0, rejected: [], restored: [], cleared: 0, flagged: 0, waiting: 0, takenDown: [] };

describe("Darwin verified recheck receipt", () => {
  it("keeps producer-reported outcomes separate from assessment-only shadow counters", () => {
    const result = verifiedRecheckReceipt(packet(), context);
    expect(result).toMatchObject({
      state: "reported", assessmentCompleteness: "unknown", outcomeBasis: "producer_reported_not_affected_rows",
      checked: 7, passed: 2, cleared: 1, flagged: 2, waiting: 1, secondLookOtherCode: 1,
      rejected: { reportedCount: 1, samples: [{ feeVerifiedId: 11, code: "tier_perk_zero" }], omittedCount: 0 },
      restored: { reportedCount: 1, samples: [{ feeVerifiedId: 12 }] },
      takenDown: { reportedCount: 1, samples: [{ feeVerifiedId: 13 }] },
      olderLive: { state: "reported", read: 3, wouldFail: { tier_perk_zero: 2 }, hasError: false, scope: "producer_assessed_in_selected_batch" },
      dueSecondLooks: { state: "reported", due: 2, wouldConfirm: { conditional_zero: 1 }, wouldClear: 1 },
      invalidFields: [],
    });
    expect(result.olderLive.sample.samples[0]).toEqual({ feePublishedId: 20, feeVerifiedId: 11, institutionId: 4, canonicalFeeKey: "overdraft", amount: 0, code: "tier_perk_zero" });
    expect(JSON.stringify(result)).not.toMatch(/private|feeName|source|stack/);
  });

  it("reports zero without claiming an empty backlog or successful complete assessment", () => {
    const result = verifiedRecheckReceipt(zero, context);
    expect(result).toMatchObject({ state: "reported", checked: 0, assessmentCompleteness: "unknown", secondLookOtherCode: null,
      olderLive: { state: "not_reported", hasError: null }, dueSecondLooks: { state: "not_reported", hasError: null } });
    const note = recheckReceiptNote(result);
    expect(note).toContain("0 checked");
    expect(note).toContain("Assessment completeness unknown");
    expect(note).not.toMatch(/complete assessment|backlog|more work|exhaust|at.cap/i);
  });

  it.each([
    [null, { learning: false, dryRun: true }, "not_run", "dry_run"],
    [undefined, { learning: false, dryRun: false }, "not_run", "learning_unavailable"],
    [null, context, "unavailable", "missing_report"],
    [undefined, { learning: undefined, dryRun: false }, "unavailable", "missing_report"],
    [false, context, "invalid", "invalid_report"],
    [[], context, "invalid", "invalid_report"],
  ])("distinguishes absence/context/malformed input %j", (input, ctx, state, reasonCode) => {
    expect(verifiedRecheckReceipt(input, ctx)).toMatchObject({ state, reasonCode, checked: null, assessmentCompleteness: "unknown" });
  });

  it("preserves partial counters and only a fixed error code, never an invented complement", () => {
    const input = packet();
    Object.assign(input.dueSecondLooks, { due: 5, wouldClear: undefined, error: "SECRET bank/source/stack/private fee name" });
    const result = verifiedRecheckReceipt(input, context);
    expect(result.dueSecondLooks).toMatchObject({ state: "invalid", due: 5, wouldConfirm: { conditional_zero: 1 }, wouldClear: null, hasError: true, errorCode: "shadow_assessment_error" });
    expect(result.invalidFields).toContain("dueSecondLooks.wouldClear");
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(recheckReceiptNote(result)).toContain("5 assessed in the selected batch; assessment error reported");
    expect(result.dueSecondLooks).not.toHaveProperty("passed");
  });

  it.each(["7", -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, undefined, true])("does not coerce or clamp invalid counter %j to zero", value => {
    const result = verifiedRecheckReceipt({ ...zero, checked: value }, context);
    expect(result).toMatchObject({ state: "invalid", checked: null });
    expect(result.invalidFields).toContain("checked");
    expect(result.passed).toBe(0);
  });

  it("bounds samples without changing producer entry counts or refilling from an unsafe tail", () => {
    const restored = Array.from({ length: 10_000 }, (_, i) => i + 1);
    restored[0] = 0;
    Object.defineProperty(restored, "20", { get() { throw new Error("unbounded read"); } });
    const result = verifiedRecheckReceipt({ ...zero, restored }, context);
    expect(result.restored).toMatchObject({ reportedCount: 10_000, sampleLimit: 20, invalidSampleCount: 1, omittedCount: 9_981 });
    expect(result.restored.samples).toHaveLength(19);
    expect(result.invalidFields).toContain("restored.sample");
    expect(JSON.stringify(result).length).toBeLessThan(8_000);
  });

  it("rejects unsafe IDs, categories, reasons and sample fields without including raw values", () => {
    const input = packet();
    Object.assign(input, { rejected: [{ feeVerifiedId: "11", code: "tier_perk_zero" }, { feeVerifiedId: 12, code: "SECRET" }], takenDown: [0, 1.5, true] });
    input.olderLive.samples[0].canonicalFeeKey = "SECRET";
    const result = verifiedRecheckReceipt(input, context);
    expect(result.rejected).toMatchObject({ reportedCount: 2, samples: [], invalidSampleCount: 2, omittedCount: 2 });
    expect(result.takenDown.samples).toEqual([]);
    expect(result.olderLive.sample.samples).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("reads only fixed map codes and marks the map as an incomplete allowlist projection", () => {
    const map = Object.create(null);
    map.tier_perk_zero = 2;
    map.conditional_zero = "2";
    for (let i = 0; i < 10_000; i++) map[`SECRET-${i}`] = 1;
    Object.defineProperty(map, "private", { get() { throw new Error("never called"); } });
    const result = verifiedRecheckReceipt({ ...zero, olderLive: { read: 2, wouldFail: map, samples: [] } }, context);
    expect(result.olderLive).toMatchObject({ wouldFail: { tier_perk_zero: 2, conditional_zero: null }, reasonMapScope: "allowlisted_codes_only", reasonMapCompleteness: "unknown" });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("never invokes value getters/toJSON/toString and does not mutate a frozen cyclic input", () => {
    const getter = vi.fn(() => { throw new Error("SECRET"); });
    const input = { ...zero, self: null as unknown, toJSON: getter, toString: getter };
    input.self = input;
    Object.defineProperty(input, "checked", { get: getter });
    Object.freeze(input);
    const result = verifiedRecheckReceipt(input, context);
    expect(result).toMatchObject({ state: "invalid", checked: null });
    expect(getter).not.toHaveBeenCalled();
    expect(input.self).toBe(input);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("fails safely for proxy traps and error accessors without rolling back the caller", () => {
    expect(verifiedRecheckReceipt(new Proxy({}, { getPrototypeOf() { throw new Error("SECRET"); } }), context)).toMatchObject({ state: "invalid", reasonCode: "invalid_report" });
    const input = packet();
    const getter = vi.fn(() => "SECRET");
    Object.defineProperty(input.olderLive, "error", { get: getter });
    const result = verifiedRecheckReceipt(input, context);
    expect(getter).not.toHaveBeenCalled();
    expect(result.olderLive).toMatchObject({ state: "invalid", hasError: null, errorCode: "invalid_error_field" });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("does not narrate legacy raw packets or interpolate malformed stored strings", () => {
    expect(recheckReceiptNote(packet())).toBe("");
    expect(recheckReceiptNote({ protocol: "darwin.recheck.receipt.v1", state: "SECRET" })).toBe(" Recheck report invalid; assessment completeness unknown.");
    expect(recheckReceiptNote({ protocol: "darwin.recheck.receipt.v1", state: "not_run", reasonCode: "SECRET" })).toBe(" Recheck report invalid; assessment completeness unknown.");
    expect(recheckReceiptNote(new Proxy({}, { getPrototypeOf() { throw new Error("SECRET"); } }))).not.toContain("SECRET");
  });
});


describe("attested selected-batch receipt v2",()=>{
  const ctx={learning:true,dryRun:false,runId:101,stepId:9};
  const execution=(changes:Record<string,unknown>={})=>({protocol:"darwin.recheck.execution.v1",scope:"selected_batch",state:"complete",runId:101,stepId:9,eventId:77,batchKey:"fixed",selected:1,assessed:1,settled:1,unresolved:0,
    phases:{primary:"complete",due:"complete",source:"complete",olderShadow:"cadence_skip",dueShadow:"reported_unknown"},reasonCode:null,samples:[],...changes});
  const input=(changes:Record<string,unknown>={})=>({...zero,secondLookOtherCode:0,checked:1,restored:[12],execution:execution(),...changes});
  it("references a persisted producer event rather than remeasuring its row effects",()=>{
    const receipt=verifiedRecheckReceipt(input(),ctx);
    expect(receipt).toMatchObject({protocol:"darwin.recheck.receipt.v2",state:"referenced",scope:"selected_batch",producerEventId:77,assessmentCompleteness:"complete",effects:{restored:1},outcomeBasis:"producer_transaction_event_reference"});
    expect(recheckReceiptNote(receipt)).toContain("not a new measurement or policy decision");
    expect(recheckReceiptNote(receipt)).toContain("whole backlog unknown");
  });
  it("keeps successful zero distinct from missing producer proof and legacy zero",()=>{
    const empty=verifiedRecheckReceipt({...zero,secondLookOtherCode:0,execution:execution({selected:0,assessed:0,settled:0})},ctx);
    expect(empty).toMatchObject({state:"referenced",assessmentCompleteness:"complete",selected:0,effects:{restored:0}});
    expect(verifiedRecheckReceipt({...zero,execution:execution({eventId:null,state:"unavailable",selected:null,assessed:0,settled:0,reasonCode:"producer_witness_failed"})},ctx)).toMatchObject({state:"unavailable",assessmentCompleteness:"unavailable",effects:{restored:null}});
    expect(verifiedRecheckReceipt(zero,ctx)).toMatchObject({protocol:"darwin.recheck.receipt.v1",assessmentCompleteness:"unknown"});
  });
  it.each([{runId:102},{stepId:10},{selected:null},{settled:2},{phases:{primary:"unavailable"}}])("rejects mismatched or incomplete attested shape %j",changes=>{
    expect(verifiedRecheckReceipt(input({execution:execution(changes)}),ctx)).toMatchObject({state:"invalid",producerEventId:null,assessmentCompleteness:"unavailable"});
  });
  it("retains bounded fixed unresolved codes without error/source text or arbitrary objects",()=>{
    const samples=Array.from({length:40},(_,i)=>({feeVerifiedId:i+1,code:"settlement_failed",error:"SECRET",stack:"SECRET",source:"SECRET"}));
    const receipt=verifiedRecheckReceipt(input({checked:0,restored:[],execution:execution({state:"partial",selected:40,assessed:0,settled:0,unresolved:40,samples,error:"SECRET"})}),ctx);
    expect(receipt).toMatchObject({state:"referenced",assessmentCompleteness:"partial",unresolved:40,unresolvedSamples:expect.any(Array)});
    expect("unresolvedSamples" in receipt && receipt.unresolvedSamples).toHaveLength(20);expect(JSON.stringify(receipt)).not.toContain("SECRET");
  });
  it("narrates pending/waiting/other-code assessments without implying final fee decisions",()=>{
    const receipt=verifiedRecheckReceipt(input({checked:2,restored:[],flagged:1,waiting:1,secondLookOtherCode:1,execution:execution({selected:3,assessed:3,settled:2})}),ctx);
    expect(recheckReceiptNote(receipt)).toContain("1 flagged/pending, 1 waiting, 1 other-code pending");
    expect(recheckReceiptNote(receipt)).toContain("do not finalize a fee decision");
    expect(recheckReceiptNote(receipt)).toContain("not a new measurement or policy decision");
  });

  it.each(["classify","verify"])("retains actual %s narration of v2 pending states with no new raw",alias=>{
    const receipt=verifiedRecheckReceipt(input({checked:2,restored:[],flagged:1,waiting:1,secondLookOtherCode:1,execution:execution({selected:3,assessed:3,settled:2})}),ctx);
    const note=narrateStepFinished(alias,{processed_raw_fees:0,recheck:receipt});
    expect(note).toContain("witness #77");expect(note).toContain("1 flagged/pending, 1 waiting, 1 other-code pending");
    expect(note).toContain("do not finalize a fee decision");
    expect(note).toContain("whole backlog unknown");expect(note).toContain("not a new measurement or policy decision");
  });

});
