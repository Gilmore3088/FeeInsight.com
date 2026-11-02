import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { vocabularyOnlyName } from "@/lib/agents/knox/held-vocabulary-read";
import { liveFeeOnLine, PUBLISH_VOCABULARY_LINE_REFUSE_REASON_PREFIX, sameLineExcerptSql, selectLiveFeeOnLine } from "./same-line-read";

/**
 * v157 (#1092, review of #2888): a read only Knox's held-name vocabulary names never publishes onto a
 * printed line a live fee already holds, in any category, so the vocabulary only admits.
 */
function dbReturning(rows: unknown[] | Error) {
  const unsafe = vi.fn((_query: string, _params: unknown[]) => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)));
  return { db: Object.assign(vi.fn(), { unsafe }) as unknown as Parameters<typeof selectLiveFeeOnLine>[0], unsafe };
}

describe("vocabularyOnlyName", () => {
  it("names a read only the vocabulary files", () => {
    for (const name of ["Skip-a-Loan payment", "Auto Title Fee", "Immigration letter", "Foreign check acceptance", "Mortgage Payoff Processing Fee"]) {
      expect(vocabularyOnlyName(name), name).toBe(true);
    }
  });

  it("leaves a name main's rules already file, and one nothing files", () => {
    for (const name of ["Skip-a-Pay Fee", "Stop Payment", "Vehicle Title Transfer", "Title Fee", "Wire Transfer", "", null]) {
      expect(vocabularyOnlyName(name), String(name)).toBe(false);
    }
  });
});

describe("liveFeeOnLine", () => {
  it("names the live fee of the same line printed once with the price once, whatever its category", () => {
    expect(liveFeeOnLine([{ fee_published_id: 77, excerpt: "skip-a-loan payment | $25 per request", line_prints: 1 }], 25)).toBe(77);
  });

  it("leaves a line printed twice, or one whose price prints twice (two fees at one price), publishable", () => {
    expect(liveFeeOnLine([{ fee_published_id: 77, excerpt: "skip-a-loan payment | $25 per request", line_prints: 2 }], 25)).toBeNull();
    // State key 8085: "Garnishment Processing fee | $ 250.00 | Reamortization schedule | $ 250.00" is two fees.
    expect(liveFeeOnLine([{ fee_published_id: 78, excerpt: "garnishment processing fee | $ 250.00 | reamortization schedule | $ 250.00", line_prints: 1 }], 250)).toBeNull();
    expect(liveFeeOnLine([], 25)).toBeNull();
  });
});

describe("selectLiveFeeOnLine", () => {
  it("reads live fees of the row's document at its amount in any category", async () => {
    const { db, unsafe } = dbReturning([{ fee_published_id: 77, excerpt: "skip-a-loan payment | $25 per request", line_prints: 1 }]);
    expect(await selectLiveFeeOnLine(db, { feeRawId: 9, amount: 25 })).toEqual({ state: "available", value: 77 });
    const [query, params] = unsafe.mock.calls[0];
    expect(query).toContain(sameLineExcerptSql("live_raw"));
    expect(query).not.toContain("canonical_fee_key");
    expect(params).toEqual([9, 25]);
  });

  it("stays unavailable when the read fails, so the row is left pending", async () => {
    expect(await selectLiveFeeOnLine(dbReturning(new Error("secret")).db, { feeRawId: 9, amount: 25 })).toEqual({ state: "unavailable", check: "same_line_read" });
  });

  it("is wired into publish for vocabulary-only reads, after the same-category line checks", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/agents/hamilton/publish.ts"), "utf8");
    expect(source).toContain("vocabularyOnlyName(row.fee_name)");
    expect(source).toContain("selectLiveFeeOnLine(db,");
    expect(source).toContain("PUBLISH_VOCABULARY_LINE_REFUSE_REASON_PREFIX}${vocabularyLineOf}");
    expect(PUBLISH_VOCABULARY_LINE_REFUSE_REASON_PREFIX).toMatch(/#$/);
  });
});
