// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerSetPrefill } from "@/lib/hamilton/peer-set-prefill";

const actions = vi.hoisted(() => ({ create: vi.fn(), edit: vi.fn(), remove: vi.fn(), defaults: vi.fn() }));
vi.mock("./actions", () => ({ createPeerSet: actions.create, editPeerSet: actions.edit, removePeerSet: actions.remove, setPeerSetForAllCharts: actions.defaults }));
vi.mock("@/components/hamilton/InstitutionPicker", () => ({ InstitutionPicker: () => null }));
import { PeerSetManager } from "./PeerSetManager";

const prefill: PeerSetPrefill = {
  peers: [{ id: 10, name: "First Bank" }, { id: 11, name: "Second Credit Union" }],
  name: "Home metro",
  fee: { key: "overdraft", label: "Overdraft" },
  asOf: "2026-10-17",
  tooLarge: false,
};

const saved = {
  id: 8, name: "Home metro", tiers: null, districts: null, charter_type: null, created_by: "7",
  created_at: "2026-10-18", institution_ids: [10, 11], states: null, institution_id: null, is_default: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  actions.create.mockResolvedValue({ success: true, id: 8, peerSet: saved, institutionNames: { 10: "First Bank", 11: "Second Credit Union" } });
});
afterEach(cleanup);

const nameInput = () => document.querySelector<HTMLInputElement>('input[name="name"]');

describe("peer group handed over by a link (#1981)", () => {
  it("opens the form filled in, shows where the set came from, and saves nothing until confirmed", async () => {
    render(<PeerSetManager initialPeerSets={[]} currentUserId="7" minPeers={5} researchInstitutionId={323} prefill={prefill} />);
    expect(screen.getByText("Peers from the link you followed. Nothing is saved until you choose Save this set.")).toBeTruthy();
    expect(screen.getByText("Fee: Overdraft. Data as of October 17, 2026.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Choose institutions by name" })).toHaveProperty("checked", true);
    expect(nameInput()).toHaveProperty("value", "Home metro");
    expect(screen.getByText("First Bank")).toBeTruthy();
    expect(screen.getByText("Second Credit Union")).toBeTruthy();
    expect(screen.getByText("2 of 50 chosen.")).toBeTruthy();
    expect(actions.create).not.toHaveBeenCalled();
    expect(actions.defaults).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save this set" }));
    await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(1));
    const submitted = actions.create.mock.calls[0][0] as FormData;
    expect(submitted.get("mode")).toBe("institutions");
    expect(submitted.getAll("institution_ids")).toEqual(["10", "11"]);
    expect(submitted.get("name")).toBe("Home metro");
    expect(submitted.get("research_institution_id")).toBe("323");
    expect(actions.defaults).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save this set" })).toBeNull());
    expect(screen.getByText("Home metro")).toBeTruthy();
    expect(screen.queryByText(/Peers from the link you followed/)).toBeNull();
  });

  it("lets the user drop a peer before saving", async () => {
    render(<PeerSetManager initialPeerSets={[]} currentUserId="7" minPeers={5} prefill={prefill} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove First Bank" }));
    fireEvent.click(screen.getByRole("button", { name: "Save this set" }));
    await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(1));
    expect((actions.create.mock.calls[0][0] as FormData).getAll("institution_ids")).toEqual(["11"]);
  });

  it("discards the handed-over set on Cancel without saving", () => {
    render(<PeerSetManager initialPeerSets={[]} currentUserId="7" minPeers={5} prefill={prefill} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("First Bank")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a peer group" }));
    expect(screen.getByRole("button", { name: "Save peer group" })).toBeTruthy();
    expect(screen.queryByText(/Peers from the link you followed/)).toBeNull();
    expect(actions.create).not.toHaveBeenCalled();
  });

  it("omits the context line when the link carried no fee or date, and leaves the name blank without one", () => {
    render(<PeerSetManager initialPeerSets={[]} currentUserId="7" minPeers={5} prefill={{ ...prefill, name: null, fee: null, asOf: null }} />);
    expect(screen.queryByText(/^Fee:/)).toBeNull();
    expect(screen.queryByText(/Data as of/)).toBeNull();
    expect(nameInput()).toHaveProperty("value", "");
  });

  it("shows the fee alone or the date alone", () => {
    const view = render(<PeerSetManager initialPeerSets={[]} currentUserId="7" minPeers={5} prefill={{ ...prefill, asOf: null }} />);
    expect(screen.getByText("Fee: Overdraft.")).toBeTruthy();
    view.unmount();
    render(<PeerSetManager initialPeerSets={[]} currentUserId="7" minPeers={5} prefill={{ ...prefill, fee: null }} />);
    expect(screen.getByText("Data as of October 17, 2026.")).toBeTruthy();
  });

  it("renders a hostile-looking name as text, never as markup", () => {
    const { container } = render(
      <PeerSetManager initialPeerSets={[]} currentUserId="7" minPeers={5} prefill={{ ...prefill, name: '"><img src=x onerror=alert(1)>' }} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(nameInput()).toHaveProperty("value", '"><img src=x onerror=alert(1)>');
  });

  it("does not open the form for a team Viewer, who cannot add groups", () => {
    render(<PeerSetManager initialPeerSets={[]} workspaceName="Space Coast" canEditWorkspaceSets={false} currentUserId="25" minPeers={5} prefill={prefill} />);
    expect(screen.queryByRole("button", { name: "Save this set" })).toBeNull();
    expect(screen.queryByText("First Bank")).toBeNull();
  });

  it("tells a team Viewer who followed a link why nothing opened (#1997)", () => {
    render(<PeerSetManager initialPeerSets={[]} workspaceName="Space Coast" canEditWorkspaceSets={false} currentUserId="25" minPeers={5} prefill={prefill} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Viewers can't save peer groups. An owner, admin or analyst on Space Coast's team can save this one.",
    );
  });

  it("says nothing to a Viewer who came without a link", () => {
    render(<PeerSetManager initialPeerSets={[]} workspaceName="Space Coast" canEditWorkspaceSets={false} currentUserId="25" minPeers={5} />);
    expect(screen.queryByText(/Viewers can't save/)).toBeNull();
  });
});

describe("a set too large to copy (#1997)", () => {
  const large: PeerSetPrefill = { peers: [], name: "Banks in Florida", fee: { key: "overdraft", label: "Overdraft" }, asOf: null, tooLarge: true };

  it("opens the form by charter, state and size and says in one line why no peers were filled in", () => {
    render(<PeerSetManager initialPeerSets={[]} currentUserId="7" minPeers={5} prefill={large} />);
    expect(
      screen.getByText(
        "Banks in Florida is too large to copy as a peer group, so its institutions aren't filled in. Set up a group like it by charter, state and size, or choose up to 50 institutions by name.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Fee: Overdraft.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "By charter, state and size" })).toHaveProperty("checked", true);
    // The set's label describes peers the form does not hold, so it is not put in the name field.
    expect(nameInput()).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "Save peer group" })).toBeTruthy();
    expect(screen.queryByText(/Peers from the link you followed/)).toBeNull();
    expect(actions.create).not.toHaveBeenCalled();
  });

  it("names the link when the set had no usable name", () => {
    render(<PeerSetManager initialPeerSets={[]} currentUserId="7" minPeers={5} prefill={{ ...large, name: null }} />);
    expect(screen.getByText(/^The set from the link you followed is too large to copy as a peer group/)).toBeTruthy();
  });
});
