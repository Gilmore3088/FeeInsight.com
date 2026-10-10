// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerListResponse, PeerListRow } from "@/lib/hamilton/peer-list";

const actions = vi.hoisted(() => ({ create: vi.fn(), defaults: vi.fn() }));
vi.mock("@/app/pro/(hamilton)/settings/actions", () => ({ createPeerSet: actions.create, setPeerSetForAllCharts: actions.defaults }));
import { PeerListView } from "./PeerListView";

const peer = (id: number, name: string): PeerListRow => ({ institutionId: id, name, charterType: "credit_union", city: "Orlando", stateCode: "FL", totalAssetsUsd: id * 1_000_000, reportDate: "2026-06-30", source: "ncua", sourceUrl: null, recordId: id, feeCoverage: "not_found", inclusionReason: "Matches the requested criteria." });
const fixture: PeerListResponse = { kind: "peer_list", shortAnswer: "4 matching institutions for Test CU.", peerList: { version: 1, status: "ready", subject: peer(101, "Test CU"), criteria: null, rows: [peer(202, "Alpha CU"), peer(203, "Beta CU"), peer(204, "Gamma CU"), peer(205, "Delta CU")], totalMatches: 4, queriedAt: "2026-10-10T00:00:00Z", notes: [] } };
beforeEach(() => { vi.resetAllMocks(); actions.create.mockResolvedValue({ success: true, id: 8 }); });
afterEach(cleanup);

function selectThree() {
  for (const name of ["Alpha CU", "Gamma CU", "Beta CU"]) fireEvent.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
}

describe("save a chosen peer group", () => {
  it("requires a selection and lets the user give the saved group a name", async () => {
    render(<PeerListView response={fixture} />);
    expect(screen.queryByRole("button", { name: /Save .* as a peer group/ })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha CU" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Group name (optional)" }), { target: { value: "  Florida alternatives  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 as a peer group" }));
    await screen.findByRole("status");
    const body = actions.create.mock.calls[0][0] as FormData;
    expect(body.get("name")).toBe("Florida alternatives");
    expect(body.getAll("institution_ids")).toEqual(["202"]);
    expect(screen.getByRole("button", { name: "Save 1 as a peer group" })).toBeDisabled();
  });

  it("selects three displayed institutions, preserves selection through sorting, and saves exact IDs", async () => {
    render(<PeerListView response={fixture} />);
    selectThree();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "assets_desc" } });
    expect(screen.getByRole("checkbox", { name: "Select Alpha CU" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save 3 as a peer group" }));
    await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(1));
    const body = actions.create.mock.calls[0][0] as FormData;
    expect(body.get("mode")).toBe("institutions");
    expect(body.getAll("institution_ids")).toEqual(["202", "203", "204"]);
    expect(body.get("research_institution_id")).toBe("101");
    expect(body.get("name")).toBe("3 selected institutions for Test CU");
    expect(body.getAll("fed_districts")).toEqual([]);
    expect(body.get("created_by")).toBeNull();
    expect(actions.defaults).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Saved 3 selected institutions");
    expect(screen.getByRole("link", { name: "Manage peer groups" })).toHaveAttribute("href", "/pro/settings?instId=101#peer-sets");
  });

  it("keeps selected rows after a failed save and allows an explicit retry", async () => {
    actions.create.mockResolvedValueOnce({ success: false, error: "Viewers can use the team's peer groups but not add them." });
    render(<PeerListView response={fixture} />); selectThree();
    fireEvent.click(screen.getByRole("button", { name: "Save 3 as a peer group" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Viewers can use the team's peer groups but not add them.");
    expect(screen.getByRole("checkbox", { name: "Select Gamma CU" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save 3 as a peer group" }));
    await screen.findByRole("status");
    expect(actions.create).toHaveBeenCalledTimes(2);
    for (const [body] of actions.create.mock.calls) {
      expect((body as FormData).getAll("institution_ids")).toEqual(["202", "203", "204"]);
      expect((body as FormData).get("research_institution_id")).toBe("101");
    }
  });

  it("prevents duplicate saves and does not show a late save in another research context", async () => {
    let finish: (value: { success: boolean; id: number }) => void = () => {};
    actions.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<PeerListView response={fixture} />); selectThree();
    const button = screen.getByRole("button", { name: "Save 3 as a peer group" });
    fireEvent.click(button); fireEvent.click(button);
    expect(actions.create).toHaveBeenCalledTimes(1);
    view.rerender(<PeerListView response={{ ...fixture, shortAnswer: "New subject", peerList: { ...fixture.peerList, subject: peer(999, "Other CU"), queriedAt: "2026-10-10T01:00:00Z" } }} />);
    await act(async () => finish({ success: true, id: 8 }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select Alpha CU" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Save 3 as a peer group" })).toBeNull();
  });

  it("limits selections to 50 displayed institutions without selecting unknown IDs", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => peer(i + 201, `Peer ${i + 1}`));
    render(<PeerListView response={{ ...fixture, peerList: { ...fixture.peerList, rows, totalMatches: 51 } }} />);
    const displayedCheckboxes = screen.getAllByRole("checkbox");
    for (const checkbox of displayedCheckboxes.slice(0, 50)) fireEvent.click(checkbox);
    expect(displayedCheckboxes[50]).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save 50 as a peer group" }));
    await screen.findByRole("status");
    expect((actions.create.mock.calls[0][0] as FormData).getAll("institution_ids")).toEqual(rows.slice(0, 50).map(row => String(row.institutionId)));
  });

  it("preserves the selection when the server action throws", async () => {
    actions.create.mockRejectedValueOnce(new Error("network unavailable"));
    render(<PeerListView response={fixture} />); selectThree();
    fireEvent.click(screen.getByRole("button", { name: "Save 3 as a peer group" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the peer group. Try again.");
    expect(screen.getByRole("checkbox", { name: "Select Alpha CU" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Save 3 as a peer group" })).toBeEnabled();
  });
});
