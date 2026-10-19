import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeLayer } from "@/lib/hamilton/research-layers";

const mocks = vi.hoisted(() => ({ user: vi.fn(), scenario: vi.fn(), workspace: vi.fn(), memory: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/hamilton/pro-tables", () => ({ getHamiltonScenarioById: mocks.scenario }));
vi.mock("@/lib/hamilton/fee-workspace-data", () => ({ loadFeeWorkspace: mocks.workspace, layerDates: () => [] }));
vi.mock("@/lib/data-store/hamilton-workspace", () => ({ getMemoryFacts: mocks.memory }));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
import ModelPage from "./page";

const saved = { id: "saved-a", institution_id: "101", fee_category: "nsf", current_value: 27, proposed_value: 20 };

beforeEach(() => {
  mocks.user.mockReset().mockResolvedValue({ id: 7, display_name: "Synthetic tester" });
  mocks.scenario.mockReset().mockResolvedValue(saved);
  mocks.memory.mockReset().mockResolvedValue([]);
  mocks.workspace.mockReset().mockImplementation(async ({ instId, fee }) => ({
    institution: { id: Number(instId ?? "303"), name: instId === "101" ? "Synthetic Bank A" : "Synthetic Bank B", charterType: "bank" },
    ownFees: [], fee: fee ?? "overdraft", feeName: fee === "nsf" ? "NSF" : "Overdraft",
    ownAmount: 27, ownSeveral: null, research: null, local: null, ownFeeRows: [], unavailable: [],
    layers: [summarizeLayer("national", "National", "Synthetic peers", [10, 20, 30], 27)],
  }));
});

describe("H01-T06 saved scenario institution identity", () => {
  it.each(["scenario", "scenario_id"] as const)("keeps saved A's institution and fee despite conflicting URL values (%s)", async (alias) => {
    const page = await ModelPage({ searchParams: Promise.resolve({ [alias]: saved.id, instId: "303", fee: "overdraft", category: "stop_payment" }) });
    expect(mocks.scenario).toHaveBeenCalledWith(saved.id, 7);
    expect(mocks.workspace).toHaveBeenCalledWith({ userId: 7, instId: "101", fee: "nsf", intent: "simulate" });
    expect(mocks.memory).toHaveBeenCalledWith(7, 101);
    const html = renderToStaticMarkup(page);
    expect(html).toContain("Synthetic Bank A");
    expect(html).not.toContain("Synthetic Bank B");
    expect(html).toContain('name="instId" value="101"');
    expect(html).toContain('name="prices"');
    expect(html).toContain('value="20"');
  });

  it("refuses a missing or another user's saved scenario before reading a workspace", async () => {
    mocks.scenario.mockResolvedValue(null);
    await expect(ModelPage({ searchParams: Promise.resolve({ scenario_id: "not-owned", instId: "303" }) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.memory).not.toHaveBeenCalled();
  });

  it("does not reinterpret a failed saved-scenario read as a new simulation", async () => {
    mocks.scenario.mockRejectedValue(new Error("Synthetic database failure"));
    await expect(ModelPage({ searchParams: Promise.resolve({ scenario: saved.id, instId: "303" }) })).rejects.toThrow("Synthetic database failure");
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it.each(["", "legacy-bank-name", "0"])("does not borrow URL or workspace context for a legacy scenario with subject %j", async (institution_id) => {
    mocks.scenario.mockResolvedValue({ ...saved, institution_id });
    const html = renderToStaticMarkup(await ModelPage({ searchParams: Promise.resolve({ scenario: saved.id, instId: "303" }) }));
    expect(html).toContain("No institution was recorded with this saved scenario");
    expect(html).not.toContain("Synthetic Bank B");
    expect(html).not.toContain("<form");
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.memory).not.toHaveBeenCalled();
  });

  it("does not model a saved price when its recorded institution is unavailable", async () => {
    const fixture = await mocks.workspace({ instId: "101", fee: "nsf" });
    mocks.workspace.mockClear().mockResolvedValue({ ...fixture, institution: null });
    const html = renderToStaticMarkup(await ModelPage({ searchParams: Promise.resolve({ scenario: saved.id, instId: "303" }) }));
    expect(html).toContain("The institution recorded with this saved scenario could not be loaded");
    expect(html).not.toContain("<form");
    expect(mocks.memory).not.toHaveBeenCalled();
  });

  it("refuses an unexpected resolved subject before reading that institution's private figures", async () => {
    const fixture = await mocks.workspace({ instId: "303", fee: "nsf" });
    mocks.workspace.mockClear().mockResolvedValue(fixture);
    const html = renderToStaticMarkup(await ModelPage({ searchParams: Promise.resolve({ scenario: saved.id }) }));
    expect(html).toContain("could not be loaded");
    expect(html).not.toContain("Synthetic Bank B");
    expect(mocks.memory).not.toHaveBeenCalled();
  });

  it("keeps URL institution and fee controls for a new simulation", async () => {
    await ModelPage({ searchParams: Promise.resolve({ instId: "303", fee: "overdraft", prices: "15,20" }) });
    expect(mocks.scenario).not.toHaveBeenCalled();
    expect(mocks.workspace).toHaveBeenCalledWith({ userId: 7, instId: "303", fee: "overdraft", intent: "simulate" });
  });

  it("checks sign-in before reading the saved scenario", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(ModelPage({ searchParams: Promise.resolve({ scenario: saved.id }) })).rejects.toThrow("REDIRECT:/");
    expect(mocks.scenario).not.toHaveBeenCalled();
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
});
