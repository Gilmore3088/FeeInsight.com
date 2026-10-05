import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { toMarketReadiness } from "@/lib/data-store/market-readiness";
import { bestMarket, StateReportGrid } from "./state-report-grid";

const NY_CU = toMarketReadiness({ state_code: "NY", charter_type: "credit_union", institutions: 40, rich: 11 });
const NY_BANK = toMarketReadiness({ state_code: "NY", charter_type: "bank", institutions: 90, rich: 4 });

describe("StateReportGrid", () => {
  it("labels each state with its best market's progress toward a full comparison", () => {
    render(<StateReportGrid states={[]} readiness={[NY_CU, NY_BANK]} />);
    const ny = screen.getByRole("link", { name: /New York fee report/ });
    expect(ny.textContent).toContain("11/15");
    expect(ny.getAttribute("aria-label")).toContain("credit unions 11 of 15 needed");
    expect(ny.getAttribute("aria-label")).toContain("banks 4 of 15 needed");
    expect(screen.getByRole("link", { name: /Ohio fee report/ }).textContent).toContain("—");
  });

  it("falls back to verified-institution counts without readiness", () => {
    render(<StateReportGrid states={[{ state_code: "OH", institution_count: 120, fee_count: 900 }]} />);
    expect(screen.getByRole("link", { name: /Ohio fee report/ }).textContent).toContain("120");
  });

  it("picks the market with the most complete schedules", () => {
    expect(bestMarket([NY_BANK, NY_CU])).toBe(NY_CU);
    expect(bestMarket([])).toBeNull();
  });
});
