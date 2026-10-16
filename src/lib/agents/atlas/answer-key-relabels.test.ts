import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { narrateStepFinished } from "@/lib/agents/narrate";
import { pauseScopeForStep } from "@/lib/agents/types";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { ANSWER_KEY_RELABELS, OUT_OF_SCOPE_KEY, planAnswerKeyRelabels, runAnswerKeyRelabels, summarizeAnswerKeyRelabels, type KeyFeeRow } from "./answer-key-relabels";

const asRow = (entry: (typeof ANSWER_KEY_RELABELS)[number]): KeyFeeRow => ({
  id: entry.feeId, institution_id: entry.institutionId, canonical_key: entry.fromKey, amount: entry.amount.toFixed(2), source_line: entry.sourceLine,
});

describe("Atlas answer-key relabels (James, Oct 16: night deposit is the service only)", () => {
  it("lists 34 bag and key purchase lines at 17 banks, all leaving scoring", () => {
    // 28 confirmed lines at 11 banks, and 6 prefilled ones at 6 more (#1550 review).
    expect(ANSWER_KEY_RELABELS).toHaveLength(34);
    expect(new Set(ANSWER_KEY_RELABELS.map((entry) => entry.institutionId)).size).toBe(17);
    expect(ANSWER_KEY_RELABELS.slice(28).map((entry) => entry.feeId)).toEqual([498, 675, 692, 834, 870, 957]);
    for (const entry of ANSWER_KEY_RELABELS) {
      expect(entry.fromKey).toBe("night_deposit");
      expect(entry.toKey).toBe(OUT_OF_SCOPE_KEY);
    }
    // Replacements and the service stay night deposit, as the v60 guard reads them.
    for (const name of ["Night Depository Key Replacement", "Bag Replacement", "Night Depository Annual Fee"]) {
      expect(checkFeeCategory("night_deposit", name).ok, name).toBe(true);
    }
    expect(ANSWER_KEY_RELABELS.map((entry) => entry.feeId)).not.toContain(918);
    expect(ANSWER_KEY_RELABELS.map((entry) => entry.feeId)).not.toContain(627);
  });

  it("relabels a line only while it reads as listed", () => {
    const rows = ANSWER_KEY_RELABELS.map(asRow);
    expect(planAnswerKeyRelabels(rows).changed).toHaveLength(34);
    const edited = [{ ...rows[0], canonical_key: "safe_deposit_box" }, { ...rows[1], amount: "9.00" }, { ...rows[2], canonical_key: OUT_OF_SCOPE_KEY }];
    expect(planAnswerKeyRelabels(edited, ANSWER_KEY_RELABELS.slice(0, 3)).skipped).toEqual([
      { feeId: 49, reason: "changed since listed" },
      { feeId: 70, reason: "changed since listed" },
      { feeId: 71, reason: "already relabelled" },
    ]);
  });

  it("writes each listed line with its guard, and nothing on a dry run", async () => {
    const writes: Array<{ text: string; values: unknown[] }> = [];
    const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("to_regclass")) return [{ ready: true }];
      if (text.includes("FROM answer_key_fees f")) return ANSWER_KEY_RELABELS.map(asRow);
      writes.push({ text, values });
      return [{ id: values[values.length - 1] }];
    });
    const result = await runAnswerKeyRelabels({ db: db as never });
    expect(result.changed).toHaveLength(34);
    expect(writes).toHaveLength(34);
    expect(writes[0].text).toContain("AND canonical_key = ?");
    expect(writes[0].text).toContain("AND COALESCE(source_line, '') = ?");
    expect(writes.every((write) => !/DELETE|published_fee|raw_fee|verified_fee/i.test(write.text))).toBe(true);
    expect(summarizeAnswerKeyRelabels(result)).toContain("relabelled 34 answer-key lines at 17 banks");

    writes.length = 0;
    const dry = await runAnswerKeyRelabels({ db: db as never, dryRun: true });
    expect(dry.changed).toHaveLength(34);
    expect(writes).toHaveLength(0);
    expect(summarizeAnswerKeyRelabels(dry)).toContain("would relabel 34 answer-key lines");
  });

  it("runs through a pipeline pause, so it never holds the scoreboard run it opens", () => {
    expect(pauseScopeForStep("answer-key-relabel")).toBe("none");
  });

  it("narrates a dry run as what it would change", () => {
    const changed = [{ answer_key_fee_id: 49 }];
    expect(narrateStepFinished("answer-key-relabel", { dry_run: true, changed })).toContain("would relabel 1 answer-key line");
    expect(narrateStepFinished("answer-key-relabel", { dry_run: true, changed })).not.toContain("relabelled");
    expect(narrateStepFinished("answer-key-relabel", { dry_run: false, changed })).toContain("relabelled 1 answer-key line");
  });
});
