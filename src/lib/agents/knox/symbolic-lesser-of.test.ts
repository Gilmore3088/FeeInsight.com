// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/data-store/connection", () => ({ sql: () => { throw new Error("Symbolic formula pure tests forbid database access"); } }));
import { runFreeSpecialists } from "./specialists";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { mayHaveSymbolicLesserFee, symbolicLesserOfReview } from "./symbolic-lesser-of";

const own = "Late Payment Fee | $10.00 each billing period or amount of minimum payment, whichever is less";
const text = readFileSync(new URL("./__fixtures__/woodlawn-symbolic-lesser-source.txt", import.meta.url), "utf8");

describe("#2335 symbolic lesser-of admission", () => {
  it("keeps the actual complete Woodlawn formula out of flat-price admission", () => {
    expect(createHash("sha256").update(text).digest("hex"))
      .toBe("45f5bd42895b89ea2ca8094823266e397ad826e9516b2b7df8f87f84f30f9c47");
    expect(text).toContain(own);
    // The printed dollar bound remains source-supported; this is not a price refusal.
    expect(checkFeeAgainstSource(text, "Late Payment Fee", 10, ".", "late_payment").ok).toBe(true);
    const found = runFreeSpecialists(text, { institutionName: "Greater Woodlawn Federal Credit Union" });
    expect(found.candidates.filter(row => row.canonicalHint === "late_payment")).toEqual([]);
    expect(found.held).toContainEqual(expect.objectContaining({ shape: "eligibility", feeName: "Late Payment Fee",
      amount: 10, excerpt: own, ownedPolicy: true }));
  });

  it("leaves a literal flat late-payment fee admitted", () => {
    const found = runFreeSpecialists("Late Payment Fee | $10.00 each billing period");
    expect(found.candidates).toContainEqual(expect.objectContaining({ feeName: "Late Payment Fee", amount: 10, canonicalHint: "late_payment" }));
    expect(found.held.filter(row => row.shape === "eligibility")).toEqual([]);
  });

  it("does not borrow another row's minimum-payment wording", () => {
    const found = runFreeSpecialists("Late Payment Fee | $10.00\nMinimum payment | amount of minimum payment, whichever is less");
    expect(found.candidates).toContainEqual(expect.objectContaining({ feeName: "Late Payment Fee", amount: 10, canonicalHint: "late_payment" }));
  });

  it.each([
    own,
    "| Late Payment Fee | $10.00 each billing period or amount of minimum payment, whichever is less |",
    "Late Payment Fee ... $10 or the minimum payment, whichever is lower.",
  ])("retains only a complete own physical clause: %s", source => {
    expect(symbolicLesserOfReview(source, "late payment fee:", 10))
      .toEqual({ kind: "hold", ownText: source });
  });

  it.each([
    ["Other Fee | $10 or minimum payment, whichever is less", "Late Payment Fee", 10],
    [own, "Late Payment Fee", 20],
    ["Late Payment Fee | $10\nOther Fee | amount of minimum payment, whichever is less", "Late Payment Fee", 10],
    ["The late payment fee is capped at $10 or minimum payment, whichever is less", "Late Payment Fee", 10],
    ["Late Payment Fee | $10 or 5% of minimum payment, whichever is less", "Late Payment Fee", 10],
    [own, "Late Payment Fee", 0],
  ] as const)("does not invent a physical formula witness", (source, name, amount) => {
    expect(symbolicLesserOfReview(source, name, amount)).toBeNull();
  });

  it.each([
    "Late Payment Fee | $10 or $5 or amount of minimum payment, whichever is less",
    "Late Payment Fee | $5–$10 or amount of minimum payment, whichever is less",
    "Late Payment Fee | $10 or amount of minimum payment, whichever is less for the first month",
    "Late Payment Fee | $10 or lesser of amount of minimum payment",
  ])("declines an unsupported own formula instead of interpreting it: %s", source => {
    expect(symbolicLesserOfReview(source, "Late Payment Fee", 10))
      .toMatchObject({ kind: "decline", reason: "symbolic_formula_unsupported", ownText: source });
  });

  it.each([
    `${own}\nLate Payment Fee | $10`,
    `Late Payment Fee | $10\n${own}`,
    `${own}\n${own}`,
    `${own}\nLate Payment Fee\n• $10 per item`,
  ])("declines an indistinguishable own same-price occurrence", source => {
    expect(symbolicLesserOfReview(source, "Late Payment Fee", 10))
      .toMatchObject({ kind: "decline", reason: "symbolic_owner_ambiguous" });
    expect(runFreeSpecialists(source).candidates.filter(row => row.canonicalHint === "late_payment")).toEqual([]);
  });

  it("keeps an ordinary different price outside the target identity", () => {
    expect(symbolicLesserOfReview(`${own}\nLate Payment Fee | $20`, "Late Payment Fee", 10)).toMatchObject({ kind: "hold" });
    expect(symbolicLesserOfReview(`${own}\nLate Payment Fee | $20`, "Late Payment Fee", 20)).toBeNull();
  });

  it("bounds the new missing-source contract to the named/category late-payment family", () => {
    expect(mayHaveSymbolicLesserFee("Late Payment Fee", "other_lending")).toBe(true);
    expect(mayHaveSymbolicLesserFee("Payment Fee", "late_payment")).toBe(true);
    expect(mayHaveSymbolicLesserFee("Stop Payment Fee", "stop_payment")).toBe(false);
    expect(mayHaveSymbolicLesserFee("NSF Fee", "nsf")).toBe(false);
  });
});
