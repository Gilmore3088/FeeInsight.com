// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runFreeSpecialists } from "./specialists";
import { classifyFeeText } from "./rules";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

vi.mock("@/lib/data-store/connection", () => ({
  sql: () => { throw new Error("CAUSAL_SQL_FORBIDDEN"); },
}));

const fullCascade = readFileSync(new URL("./fixtures/cascade-paid-returned-13277.txt", import.meta.url), "utf8");
const ownLiteral = "NSF Paid/Returned | $29.00 per presentment";
const consumer = ["Account Fee Schedule", "Consumer Checking Fees", ownLiteral].join("\n");
const eventReads = (text: string) => runFreeSpecialists(text).candidates
  .filter(row => row.canonicalHint === "nsf" || row.canonicalHint === "overdraft")
  .map(row => [row.feeName, row.amount, row.canonicalHint]);

describe("old-source projected event guard spike: must all pass before runtime edits", () => {
  it.each([
    ["NSF - Paid", "overdraft"],
    ["NSF - Returned", "nsf"],
  ])("unchanged guards trace projected %s to the complete literal row", (name, key) => {
    // Name is a presentation projection, never itself positive admission proof.
    expect(checkFeeCategory(key, name, { amount: 29 })).toEqual({ ok: true });
    expect(checkFeeAgainstSource(fullCascade, name, 29, ".", key)).toMatchObject({ ok: true });
    expect(checkFeeAgainstSource(consumer, name, 29, ".", key)).toMatchObject({ ok: true });
    expect(checkFeeAgainstSource(consumer, name, 37, ".", key).ok).toBe(false);
  });
});

describe("causal prospective omissions on unchanged runtime", () => {
  it("complete actual Cascade recognizes both event observations but holds mixed applicability", () => {
    expect(createHash("sha256").update(fullCascade).digest("hex"))
      .toBe("6f72e9caaeebf46e62aad1ff66f50b582e78b8c8af2a07a38f50d76f8c95b396");
    expect(fullCascade).toContain("Pathfinder & Business Checking Fees");
    expect(fullCascade).toContain(ownLiteral);
    const result = runFreeSpecialists(fullCascade);
    const held = result.held.filter(row => row.amount === 29 && (row.canonicalHint === "nsf" || row.canonicalHint === "overdraft"));
    expect(held.map(row => [row.feeName, row.amount, row.canonicalHint, row.shape]))
      .toEqual([["NSF - Paid", 29, "overdraft", "eligibility"], ["NSF - Returned", 29, "nsf", "eligibility"]]);
    expect(held.every(row => row.excerpt.includes(ownLiteral))).toBe(true);
    expect(held.every(row => row.linkedConditions?.includes("Pathfinder & Business Checking Fees"))).toBe(true);
    expect(result.candidates.filter(row => row.amount === 29 && /NSF Paid\/Returned|^NSF - (Paid|Returned)$/.test(row.feeName)))
      .toEqual([]);
  });

  it("unambiguous controlled consumer source emits two separately source-owned event prices", () => {
    expect(eventReads(consumer)).toEqual([["NSF - Paid", 29, "overdraft"], ["NSF - Returned", 29, "nsf"]]);
  });
});

describe("existing separate-price Kewanee policy remains a negative", () => {
  it("retains the documented NSF-led classification", () => {
    expect(classifyFeeText("NSF Return/Paid Item Fee for Chkg. & Sav")).toBe("nsf");
  });
  it.each([25, 37])("does not infer a second paid price beside separate OD %s", (odPrice) => {
    // Controlled two-row reproduction of retained #1291 policy, not a newly fetched full source.
    const lines = ["NSF Return/Paid Item Fee for Chkg. & Sav | $25.00", `Overdraft Fee | $${odPrice}.00`];
    for (const source of [lines, [...lines].reverse()]) {
      const overdrafts = eventReads(source.join("\n")).filter(row => row[2] === "overdraft");
      expect(overdrafts).toEqual([["Overdraft Fee", odPrice, "overdraft"]]);
    }
  });
});
