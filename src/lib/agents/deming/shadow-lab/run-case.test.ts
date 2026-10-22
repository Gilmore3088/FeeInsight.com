// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runCase } from "./run-case";
import type { PipelineVariant, ShadowCase, StageFee } from "./types";

const line = (name: string, cents: number): StageFee => ({
  canonicalFeeKey: "nsf",
  feeName: name,
  amountCents: cents,
  frequency: null,
  excerpt: `${name} | $${cents / 100}`,
  reason: null,
});

/** Reads three fees; verify refuses "Limit"; the gate refuses a second fee at a price already live. */
const stub: PipelineVariant = {
  id: "stub",
  description: "test stub",
  documentGate: (c) => (c.document.url?.includes("product") ? { accepted: false, reason: "product_page" } : { accepted: true, reason: null }),
  extract: () => ({ passed: [line("NSF", 3000), line("NSF again", 3000), line("Limit", 60000)], dropped: [{ ...line("Range", 0), reason: "held:range" }] }),
  verify: (fee) => (fee.feeName === "Limit" ? { ok: false, reason: "limit_guard:x" } : { ok: true, fee }),
  publishGate: (fee, _text, live) =>
    live.some((prior) => prior.amountCents === fee.amountCents) ? { publish: false, reason: "prior:identical" } : { publish: true, reason: null },
};

const textCase: ShadowCase = {
  caseKey: "duplicate_lines:t",
  scenario: "duplicate_lines",
  provenance: { fixture: "f", fixtureCaseKey: "t", textHash: "h", issue: "i" },
  document: { url: null, text: "NSF | $30.00" },
  expected: { publish: [], forbid: [] },
  status: "ok",
};

describe("shadow lab case runner", () => {
  it("should_record_the_drop_reason_at_the_stage_that_dropped_it", () => {
    const trace = runCase(stub, textCase);
    expect(trace.stages.extract.dropped.map((fee) => fee.reason)).toEqual(["held:range"]);
    expect(trace.stages.verify.dropped.map((fee) => [fee.feeName, fee.reason])).toEqual([["Limit", "limit_guard:x"]]);
    expect(trace.stages.publish_gate.dropped.map((fee) => [fee.feeName, fee.reason])).toEqual([["NSF again", "prior:identical"]]);
    expect(trace.published.map((fee) => fee.feeName)).toEqual(["NSF"]);
  });

  it("should_attribute_a_published_fee_to_its_source_line", () => {
    const [published] = runCase(stub, textCase).published;
    expect(published.attributed).toBe(true);
    expect(published.sourceLine).toContain("NSF");
  });

  it("should_stop_at_the_document_gate", () => {
    const trace = runCase(stub, { ...textCase, document: { url: "https://bank.example/product", text: "NSF | $30.00" } });
    expect(trace.documentAccepted).toBe(false);
    expect(trace.stages.extract.passed).toEqual([]);
    expect(trace.published).toEqual([]);
  });

  it("should_skip_cases_that_are_not_ok", () => {
    const trace = runCase(stub, { ...textCase, status: "corrupt" });
    expect(trace.documentAccepted).toBeNull();
    expect(trace.published).toEqual([]);
  });
});
