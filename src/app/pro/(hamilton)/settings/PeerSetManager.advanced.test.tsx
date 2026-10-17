// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ create: vi.fn(), edit: vi.fn(), remove: vi.fn(), defaults: vi.fn() }));
vi.mock("./actions", () => ({ createPeerSet: actions.create, editPeerSet: actions.edit, removePeerSet: actions.remove, setPeerSetForAllCharts: actions.defaults }));
vi.mock("@/components/hamilton/InstitutionPicker", () => ({ InstitutionPicker: () => null }));
import { PeerSetManager, type PeerSetRow } from "./PeerSetManager";

beforeEach(() => { vi.resetAllMocks(); actions.create.mockResolvedValue({ success: true, id: 8 }); });
afterEach(cleanup);

const markets = [{ code: 45220, name: "Tallahassee, FL" }, { code: 33100, name: "Miami-Fort Lauderdale-West Palm Beach, FL" }];
const subject = { name: "Capital City Bank", holdingCompanyRssd: "1234", hasAssets: true };

function openForm(props: Partial<Parameters<typeof PeerSetManager>[0]> = {}) {
  render(<PeerSetManager initialPeerSets={[]} currentUserId="7" minPeers={5} marketOptions={markets}
    homeMarket={markets[0]} subject={subject} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a peer group" }));
  return screen.getByRole("button", { name: "Save peer group" }).closest("form")!;
}

describe("more ways to define peers", () => {
  it("offers every wider dimension with a label, behind a closed group", () => {
    openForm();
    expect(screen.getByText("More ways to define peers (optional)").closest("details")?.open).toBe(false);
    expect(screen.getByRole("textbox", { name: "Lowest, in $ millions" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Highest, in $ millions" })).toBeTruthy();
    for (const name of ["OCC", "FDIC", "Federal Reserve", "NCUA"]) expect(screen.getByRole("checkbox", { name })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Federal charter" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Only institutions in the same holding company as Capital City Bank" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Keep only the closest in total assets" })).toBeTruthy();
    const metro = screen.getByRole("combobox", { name: "Metro market" }) as HTMLSelectElement;
    expect([...metro.options].map((o) => o.textContent)).toEqual([
      "Any metro", "My home market: Tallahassee, FL", "Miami-Fort Lauderdale-West Palm Beach, FL",
    ]);
  });

  it("sends the wider dimensions and leaves the name for the server to write", async () => {
    const form = openForm();
    fireEvent.change(screen.getByRole("textbox", { name: "Lowest, in $ millions" }), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "OCC" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Metro market" }), { target: { value: "45220" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Keep only the closest in total assets" }), { target: { value: "10" } });
    expect(form.checkValidity()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save peer group" }));
    await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(1));
    const sent = actions.create.mock.calls[0][0] as FormData;
    expect(sent.get("asset_min_m")).toBe("500");
    expect(sent.getAll("regulators")).toEqual(["occ"]);
    expect(sent.get("market_code")).toBe("45220");
    expect(sent.get("nearest")).toBe("10");
    expect(sent.get("holding_company_rssd")).toBeNull();
    expect(sent.get("name")).toBe("");
  });

  it("says None found where the research institution lacks a holding company or assets", () => {
    openForm({ subject: { name: "Navy Federal Credit Union", holdingCompanyRssd: null, hasAssets: false }, homeMarket: null, marketOptions: [] });
    expect(screen.getByText("None found: no holding company is on record for Navy Federal Credit Union.")).toBeTruthy();
    expect((screen.getByRole("spinbutton", { name: "Keep only the closest in total assets" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/None found: the metro list is not available right now/)).toBeTruthy();
  });

  it("shows a saved group's wider dimensions and why it has no peers", () => {
    const row: PeerSetRow = {
      id: 3, name: "Tallahassee banks", tiers: null, districts: null, charter_type: "bank", created_by: "7",
      created_at: "2026-10-17", institution_ids: null, states: null, institution_id: null, is_default: false,
      advanced: { asset_min: 500_000_000, market_code: 45220, regulators: ["occ"] },
    };
    render(<PeerSetManager initialPeerSets={[row]} currentUserId="7" minPeers={5} marketNames={{ 45220: "Tallahassee, FL" }}
      initialNotes={{ 3: "None found: no institution meets every part of this peer group." }} />);
    expect(screen.getByText("Total assets at least $500M")).toBeTruthy();
    expect(screen.getByText("Regulator: OCC")).toBeTruthy();
    expect(screen.getByText("Branches in the Tallahassee, FL metro")).toBeTruthy();
    expect(screen.getByText("None found: no institution meets every part of this peer group.")).toBeTruthy();
  });

  it("opens the group and keeps the saved values when editing", () => {
    const row: PeerSetRow = {
      id: 4, name: "Federal CUs", tiers: null, districts: null, charter_type: "credit_union", created_by: "7",
      created_at: "2026-10-17", institution_ids: null, states: null, institution_id: null, is_default: false,
      advanced: { cu_charter: "federal", asset_max: 2_000_000_000, nearest: 15 },
    };
    render(<PeerSetManager initialPeerSets={[row]} currentUserId="7" minPeers={5} subject={subject} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("More ways to define peers (optional)").closest("details")?.open).toBe(true);
    expect((screen.getByRole("radio", { name: "Federal charter" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("textbox", { name: "Highest, in $ millions" }) as HTMLInputElement).value).toBe("2000");
    expect((screen.getByRole("spinbutton", { name: "Keep only the closest in total assets" }) as HTMLInputElement).value).toBe("15");
  });
});
