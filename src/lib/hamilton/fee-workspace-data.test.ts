import { beforeEach, describe, expect, it, vi } from "vitest";

const getFeeResearch = vi.fn();
vi.mock("@/lib/data-store/fee-index", () => ({ getInstitutionFeeValues: vi.fn(async () => new Map([["wire_domestic_outgoing", 35]])) }));
vi.mock("./workspace-context", () => ({ resolveHamiltonInstitutionContext: vi.fn(async () => ({ institution: { id: 323, name: "Capital City Bank" } })) }));
vi.mock("./workspace/research", () => ({ getFeeResearch: (...args: unknown[]) => getFeeResearch(...args) }));

import { feeName, loadFeeWorkspace } from "./fee-workspace-data";

describe("fee workspace", () => {
  beforeEach(() => getFeeResearch.mockReset());

  it("names the researched bank, so nobody viewing it reads 'your'", async () => {
    getFeeResearch.mockResolvedValue({ institutionName: "CAPITAL CITY BANK", ownRows: [], layers: [], localMarket: null, localCompetitors: [] });
    const ws = await loadFeeWorkspace({ userId: 1, instId: "323", fee: "wire_domestic_outgoing", intent: "research" });
    expect(ws.research?.subjectName).toBe("Capital City Bank");
  });

  it("keeps a wire's direction in its name", () => {
    expect(feeName("wire_domestic_outgoing")).toBe("Outgoing Domestic Wire");
    expect(feeName("overdraft")).not.toMatch(/\(/);
  });
});
