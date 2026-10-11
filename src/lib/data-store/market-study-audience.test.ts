import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ queries: [] as string[], replies: [] as unknown[][] }));
vi.mock("./connection", () => {
  const sql = Object.assign(vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    state.queries.push(parts.reduce((text, part, index) => text + part + (index < values.length ? String(values[index]) : ""), ""));
    return state.replies.shift() ?? [];
  }), { unsafe: vi.fn((text: string) => text) });
  return { sql, getSql: () => sql };
});
import { getMarketStudyData } from "./market-study";

function seed(fees: unknown[]) {
  state.replies.push(
    [{ id: 47, name: "Subject Bank", state_code: "TN" }],
    [{ year: 2026, deposits: 100 }],
    [{ institution_id: 50, cert: 123, name: "Test Peer", branch_name: "Main", city: "Nashville", latitude: null, longitude: null, deposits: 100 }],
    [], [], fees, [],
  );
}
beforeEach(() => { state.queries.length = 0; state.replies.length = 0; });

describe("market study audience boundary", () => {
  it("retains sourced consumer zero and the common overdraft tier contract", async () => {
    seed([{ institution_id: 47, fee_category: "nsf", amount: "0.00" }, { institution_id: 50, fee_category: "nsf", amount: 20 }]);
    const study = await getMarketStudyData(47, "47037");
    expect(study?.fees.find((fee) => fee.category === "nsf")).toEqual({ category: "nsf", subject: 0, competitors: [{ institution_id: 50, amount: 20 }] });
    const query = state.queries.find((text) => text.includes("FROM published_fee_catalog ef"));
    expect(query).toContain("ef.source_document_id IS NOT NULL");
    expect(query).toContain("ef.fee_audience IN ('consumer', 'both')");
    expect(query).toContain("THEN MAX(ef.amount)");
    expect(query).toContain("ef.amount >= 0");
    expect(query).not.toContain("ef.amount > 0");
  });

  it("keeps geographic/deposit coverage separate from missing consumer fee evidence", async () => {
    seed([]);
    const study = await getMarketStudyData(47, "47037");
    expect(study?.members).toHaveLength(1);
    expect(study?.members[0].deposits).toBe(100000);
    expect(study?.fees.every((fee) => fee.subject === null && fee.competitors.length === 0)).toBe(true);
  });
});
