// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ownAdditiveCondition } from "./own-additive-condition";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { candidateWriteFacts } from "@/lib/agents/knox/candidate-facts";
import { groundPaidRow } from "@/lib/agents/knox/paid-extract";
import { readerFeeConditions } from "@/lib/fee-conditions";

const name = "Replace Safe Deposit Box Key";
const clause = "$50.00 per key (Plus Locksmith Fee if unable to locate both keys)";
const source = `${name}\n• $50.00 per key (Plus Locksmith Fee if\nunable to locate both keys)\nResearch Fee\n• $50.00 per hour`;

describe("#2283 own additive charge conditions", () => {
  it("retains the complete literal qualification from the repaired official Oakwood source", () => {
    const actual = readFileSync(new URL("../agents/knox/__fixtures__/oakwood-repaired-source.txt", import.meta.url), "utf8");
    const read = runFreeSpecialists(actual).candidates.find(row => row.feeName === name && row.amount === 50)!;
    expect(read).toMatchObject({ amount: 50, canonicalHint: "safe_deposit_box", frequency: "per_item" });
    expect(read.ownUnit).toBeUndefined();
    expect(readerFeeConditions(candidateWriteFacts(read).sourceConditions)).toContain(clause);
    expect(read.ownCondition).not.toContain("Research Fee");
  });

  it.each([
    `${name} | ${clause}`,
    source,
  ])("preserves the source clause without assigning an unknown unit: %s", text => {
    expect(ownAdditiveCondition(text, name, 50)).toContain(clause);
  });

  it.each([
    `${name}\n• $50.00 per key (Plus Locksmith Fee if`,
    `${name}\n• $50.00 per key\nResearch Fee (Plus Locksmith Fee if unable to locate both keys)`,
    `${name} | $50.00 per key | Research Fee (Plus Locksmith Fee if unable to locate both keys)`,
    `Other service | ${name} $50.00 per key (Plus Locksmith Fee if unable to locate both keys)`,
    `${name} | $50.00 per key (Plus $20 Locksmith Fee)`,
    `${name} | $50.00 per key (Plus 5% Locksmith Fee)`,
    `${name} | $50.00 per key (Plus "Locksmith Fee" if needed)`,
    `${name} | $50.00 per key (Plus Locksmith Fee (if needed))`,
    `${name} | ${clause}\n${name} | $50.00 per key`,
    `${name} | ${clause}\n${name} | $60.00 per key (Plus Locksmith Fee if unable to locate both keys)`,
    `${name} | ${clause}\n${name}`,
    `${name}\n• $50.00 per key (Plus Locksmith Fee if\n\nunable to locate both keys)`,
    `${name} | $50.00 per key (Plus ${"long ".repeat(100)}Locksmith Fee)`,
  ])("does not annotate incomplete, neighboring, priced, conflicting or unbounded context: %s", text => {
    expect(ownAdditiveCondition(text, name, 50)).toBeNull();
  });

  it("does not invent an admitted price or trust model conditions", () => {
    expect(ownAdditiveCondition(source, name, 20)).toBeNull();
    const accepted = groundPaidRow({ fee_name: name, canonical_key: "safe_deposit_box", amount: 50,
      source_line: `${name} | $50.00 per key`, frequency: "per_item", conditions: "invented free locksmith" }, source);
    expect(typeof accepted).not.toBe("string");
    if (typeof accepted === "string") return;
    expect(accepted.ownUnit).toBeUndefined();
    expect(accepted.ownCondition).toContain(clause);
    expect(accepted.ownCondition).not.toContain("invented");
    expect(accepted.frequency).toBe("per_item");
  });
});
