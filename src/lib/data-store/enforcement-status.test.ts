import { describe, expect, it } from "vitest";
import { isOpenAction, isPenaltyOnly } from "./registry-profile";

describe("enforcement action status", () => {
  const today = new Date("2026-10-07T00:00:00Z");

  it("treats a penalty alone as done, and an order with a penalty as an order", () => {
    expect(isPenaltyOnly("Civil Money Penalty (CMP)")).toBe(true);
    expect(isPenaltyOnly("Cease and Desist Order, Civil Money Penalty")).toBe(false);
    expect(isPenaltyOnly("Written Agreement")).toBe(false);
  });

  it("counts only recent orders with no end date on file as open", () => {
    const order = { action_type: "Written Agreement", termination_date: null };
    expect(isOpenAction({ ...order, start_date: "2024-05-01" }, today)).toBe(true);
    expect(isOpenAction({ ...order, start_date: "1992-05-01" }, today)).toBe(false);
    expect(isOpenAction({ ...order, start_date: "2024-05-01", termination_date: "2025-01-01" }, today)).toBe(false);
    expect(isOpenAction({ action_type: "Civil Money Penalty", termination_date: null, start_date: "2025-01-01" }, today)).toBe(false);
  });
});
