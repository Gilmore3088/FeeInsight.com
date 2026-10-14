import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));

import { isConfirmedMovement, loadConfirmedMovementPairs, markConfirmedMovements, withConfirmedMovements } from "./fee-movement-check";

const signal = (movements: unknown[], signal_type = "hamilton_fee_movement_detected") => ({
  signal_type,
  source_json: { batch_id: "b1", movements },
});
const move = (previous: number | null, next: number | null) => ({
  canonical_fee_key: "overdraft",
  previous_fee_published_id: previous,
  new_fee_published_id: next,
  previous_amount: 30,
  new_amount: 35,
});

describe("markConfirmedMovements", () => {
  it("marks each movement by its previous:new pair and keeps the rest of the JSON", () => {
    const [row] = markConfirmedMovements([signal([move(1, 2), move(3, 4), move(null, 5)])], new Set(["1:2"]));
    const json = row.source_json as { batch_id: string; movements: Array<{ confirmed: boolean }> };
    expect(json.batch_id).toBe("b1");
    expect(json.movements.map((m) => m.confirmed)).toEqual([true, false, false]);
  });

  it("leaves publication signals alone and reads JSON stored as a string", () => {
    const publication = { signal_type: "hamilton_publication_completed", source_json: { canonical_fee_keys: ["nsf"] } };
    expect(markConfirmedMovements([publication], new Set())[0]).toBe(publication);
    const [row] = markConfirmedMovements(
      [{ signal_type: "hamilton_fee_movement_detected", source_json: JSON.stringify({ movements: [move(1, 2)] }) }],
      new Set(["1:2"]),
    );
    expect((row.source_json as unknown as { movements: Array<{ confirmed: boolean }> }).movements[0].confirmed).toBe(true);
  });
});

describe("isConfirmedMovement", () => {
  it("is false only for a movement the check marked false", () => {
    expect(isConfirmedMovement({ confirmed: false })).toBe(false);
    expect(isConfirmedMovement({ confirmed: true })).toBe(true);
    expect(isConfirmedMovement({})).toBe(true);
  });
});

describe("loadConfirmedMovementPairs", () => {
  const candidate = (overrides: Record<string, unknown> = {}) => ({
    previous_id: "1",
    new_id: 2,
    institution_name: "First Bank",
    state_code: "TX",
    charter_type: "bank",
    fee_key: "overdraft",
    fee_name: "Overdraft fee",
    old_fee_name: "Overdraft fee",
    old_amount: "30.00",
    new_amount: "35.00",
    changed_at: "2026-10-06T00:00:00Z",
    source_url: "https://firstbank.example/fees",
    old_document_text: "Overdraft fee $30.00\nStop payment $25.00",
    new_document_text: "Overdraft fee $35.00\nStop payment $25.00",
    ...overrides,
  });

  it("asks once for every pair and skips the query when there are none", async () => {
    mocks.sql.mockReset();
    mocks.sql.mockResolvedValue([candidate()]);
    expect(await loadConfirmedMovementPairs([signal([])])).toEqual(new Set());
    expect(mocks.sql).not.toHaveBeenCalled();
    const pairs = await loadConfirmedMovementPairs([signal([move(1, 2)]), signal([move(3, 4)])]);
    expect(pairs).toEqual(new Set(["1:2"]));
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const text = (mocks.sql.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(text).toContain("document_url");
    expect(text).toContain("vo.fee_audience = vn.fee_audience");
    expect(text).toContain("vo.fee_audience IS DISTINCT FROM 'unknown'");
  });

  it("requires the same known audience before a pair can be a price change", async () => {
    mocks.sql.mockReset();
    mocks.sql.mockResolvedValue([candidate()]);
    await loadConfirmedMovementPairs([signal([move(1, 2)])]);
    const text = (mocks.sql.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(text).toContain("vo.fee_audience = vn.fee_audience");
    expect(text).toContain("vo.fee_audience IS DISTINCT FROM 'unknown'");
  });

  it("applies confirmFeeChange: a reread of the same edition or a renamed line is not a change", async () => {
    mocks.sql.mockReset();
    mocks.sql.mockResolvedValue([
      candidate({ new_document_text: "Overdraft fee $30.00\nStop payment $25.00" }),
      candidate({ previous_id: 3, new_id: 4, old_fee_name: "Paid item fee" }),
    ]);
    expect(await loadConfirmedMovementPairs([signal([move(1, 2), move(3, 4)])])).toEqual(new Set());
  });

  it("confirms nothing when the check fails", async () => {
    mocks.sql.mockReset();
    mocks.sql.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [row] = await withConfirmedMovements([signal([move(1, 2)])]);
    expect((row.source_json as { movements: Array<{ confirmed: boolean }> }).movements[0].confirmed).toBe(false);
    spy.mockRestore();
  });
});
