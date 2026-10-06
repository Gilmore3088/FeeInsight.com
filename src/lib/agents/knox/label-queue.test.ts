import { describe, expect, it, vi } from "vitest";
import { labelDedupeKey, loadLabelQueue, NAME_LABEL_KIND, NO_CATEGORY_LABEL, recordNameLabel } from "@/lib/agents/knox/label-queue";

function mockDb(handler: (text: string, values: unknown[]) => unknown[]) {
  return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(handler(strings.join(" "), values))) as never;
}

describe("Knox weekly label queue", () => {
  it("lists contested names that have no label yet", async () => {
    const db = mockDb((text) => {
      if (text.includes("to_regclass")) return [{ ready: true }];
      if (text.includes("never_verified")) {
        expect(text).toContain("l.kind =");
        return [{ name: "zipper bags", example: "Zipper Bags", banks: "25", verdicts: [{ canonicalKey: "check_printing", wrongBanks: 25, rightBanks: 0 }], reason: "never_verified" }];
      }
      return [];
    });
    const queue = await loadLabelQueue(db);
    expect(queue).toEqual([
      { name: "zipper bags", example: "Zipper Bags", banks: 25, verdicts: [{ canonicalKey: "check_printing", wrongBanks: 25, rightBanks: 0 }], reason: "never_verified" },
    ]);
  });

  it("stores a label as one human judgement per name", async () => {
    const rows: unknown[] = [];
    const db = mockDb((text, values) => {
      if (text.includes("INSERT INTO pipeline_feedback")) {
        rows.push(...JSON.parse(String(values[0])));
        return [{ id: 1 }];
      }
      return [];
    });
    await recordNameLabel(db, { name: "Zipper Bags*", canonicalKey: "night_deposit", actor: "james" });
    await recordNameLabel(db, { name: "There is a", canonicalKey: NO_CATEGORY_LABEL, actor: "james" });
    expect(rows).toEqual([
      expect.objectContaining({ kind: NAME_LABEL_KIND, signal: "right", reported_by: "human", canonical_fee_key: "night_deposit", dedupe_key: "knox.name_label:zipper bags" }),
      expect.objectContaining({ kind: NAME_LABEL_KIND, signal: "wrong", canonical_fee_key: null, dedupe_key: labelDedupeKey("There is a") }),
    ]);
  });
});
