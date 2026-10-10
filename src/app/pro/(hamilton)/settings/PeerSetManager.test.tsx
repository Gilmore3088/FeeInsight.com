// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ create: vi.fn(), edit: vi.fn(), remove: vi.fn(), defaults: vi.fn() }));
vi.mock("./actions", () => ({ createPeerSet: actions.create, editPeerSet: actions.edit, removePeerSet: actions.remove, setPeerSetForAllCharts: actions.defaults }));
vi.mock("@/components/hamilton/InstitutionPicker", () => ({ InstitutionPicker: () => null }));
import { PeerSetManager } from "./PeerSetManager";

beforeEach(() => { vi.resetAllMocks(); actions.create.mockResolvedValue({ success: true, id: 8 }); });
afterEach(cleanup);

function floridaAssetGroup() {
  render(<PeerSetManager initialPeerSets={[]} currentUserId="7" minPeers={5} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a peer group" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Add a state" }), { target: { value: "FL" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "$1B to $10B" }));
  return screen.getByRole("button", { name: "Save peer group" }).closest("form")!;
}

describe("peer group filter workflow", () => {
  it("allows Florida and an asset band without requiring a name or district", async () => {
    const form = floridaAssetGroup();
    expect(form.checkValidity()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save peer group" }));
    await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(1));
    const submitted = actions.create.mock.calls[0][0] as FormData;
    expect(submitted.getAll("states")).toEqual(["FL"]);
    expect(submitted.getAll("asset_tiers")).toEqual(["community_large"]);
    expect(submitted.getAll("fed_districts")).toEqual([]);
    expect(submitted.get("name")).toBe("Florida · $1B to $10B · Institutions");
    expect(actions.defaults).not.toHaveBeenCalled();
  });

  it("already accepts an omitted district when a name is provided", () => {
    const form = floridaAssetGroup();
    fireEvent.change(form.querySelector<HTMLInputElement>('input[name="name"]')!, { target: { value: "Florida research" } });
    expect(form.checkValidity()).toBe(true);
    for (const checkbox of form.querySelectorAll<HTMLInputElement>('input[name="fed_districts"]')) {
      expect(checkbox.required).toBe(false);
      expect(checkbox.checked).toBe(false);
    }
  });

  it("places the optional districts behind an advanced filter", () => {
    floridaAssetGroup();
    const summary = screen.getByText("Advanced filters: Federal Reserve districts (optional)");
    expect(summary.closest("details")?.open).toBe(false);
    expect(screen.getByText("Leave districts blank to include every district.")).toBeTruthy();
  });

  it("keeps a Space Coast Viewer from adding or editing someone else's shared groups", () => {
    render(<PeerSetManager initialPeerSets={[{
      id: 900, name: "Space Coast team peers", tiers: null, districts: null, charter_type: null,
      created_by: "7", created_at: "2026-10-10", institution_ids: [11, 12, 13], states: null,
      institution_id: 8109, is_default: true,
    }]} workspaceName="Space Coast" canEditWorkspaceSets={false} currentUserId="25" minPeers={5} />);
    expect(screen.getByText("Your team's owner or admin picks the peer group charts use.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a peer group" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(actions.create).not.toHaveBeenCalled();
    expect(actions.edit).not.toHaveBeenCalled();
    expect(actions.defaults).not.toHaveBeenCalled();
  });
});
