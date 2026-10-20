import { describe, expect, it, vi } from "vitest";
import { labelDedupeKey, loadLabelQueue, NAME_LABEL_KIND, NO_CATEGORY_LABEL, recordNameLabel } from "@/lib/agents/knox/label-queue";

function mockDb(handler: (text: string, values: unknown[]) => unknown[]) {
  return Object.assign(vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(handler(strings.join(" "), values))), { unsafe: vi.fn(() => []) }) as never;
}

describe("Knox weekly label queue", () => {
  it("lists contested names and names held at several banks that have no label yet, most banks first", async () => {
    const db = mockDb((text) => {
      if (text.includes("to_regclass")) return [{ ready: true }];
      if (text.includes("never_verified")) {
        expect(text).toContain("l.kind =");
        return [{ name: "zipper bags", example: "Zipper Bags", banks: "25", verdicts: [{ canonicalKey: "check_printing", wrongBanks: 25, rightBanks: 0 }], reason: "never_verified" }];
      }
      // #1102: held unclassified names, 15 Oct 2026; a sentence fragment or a bare word is never listed.
      if (text.includes("knox_review:unclassified")) {
        return [
          { name: "membership fee", example: "Membership Fee", banks: 123 },
          { name: "fee", example: "Fee", banks: 123 },
          { name: "we will charge", example: "We will charge", banks: 25 },
          { name: "lost passbook fee", example: "Lost Passbook Fee", banks: 21 },
        ];
      }
      return [];
    });
    const queue = await loadLabelQueue(db);
    expect(queue).toEqual([
      { name: "membership fee", example: "Membership Fee", banks: 123, verdicts: [], reason: "held_unclassified" },
      { name: "zipper bags", example: "Zipper Bags", banks: 25, verdicts: [{ canonicalKey: "check_printing", wrongBanks: 25, rightBanks: 0 }], reason: "never_verified" },
      { name: "lost passbook fee", example: "Lost Passbook Fee", banks: 21, verdicts: [], reason: "held_unclassified" },
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
