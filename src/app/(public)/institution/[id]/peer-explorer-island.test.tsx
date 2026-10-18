import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({ search: new URLSearchParams() }));
const action = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.search }));
vi.mock("./peer-explorer-actions", () => ({ loadPeerExplorerSection: action }));

import { PeerExplorerIsland } from "./peer-explorer-island";

function at(query: string) {
  nav.search = new URLSearchParams(query);
  window.history.replaceState(null, "", `/institution/323${query ? `?${query}` : ""}`);
}

afterEach(() => {
  action.mockReset();
  at("");
});

describe("PeerExplorerIsland (#1811: the cached page never reads ?peers=)", () => {
  it("shows the cached default explorer and asks nothing for a bare address", () => {
    at("");
    render(
      <PeerExplorerIsland institutionId={323} defaultSet="nearest">
        <p>default set</p>
      </PeerExplorerIsland>,
    );
    expect(screen.getByText("default set")).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  });

  it("asks for the set in ?peers= with the explorer state, and shows it", async () => {
    action.mockResolvedValue(<p>metro set</p>);
    at("fee=nsf&peers=metro&pfee=overdraft&pview=matrix&peer=12");
    render(
      <PeerExplorerIsland institutionId={323} defaultSet="nearest">
        <p>default set</p>
      </PeerExplorerIsland>,
    );
    expect(await screen.findByText("metro set")).toBeTruthy();
    expect(action).toHaveBeenCalledWith({
      institutionId: 323,
      peers: "metro",
      peer: "12",
      pfee: "overdraft",
      pview: "matrix",
      fee: "nsf",
    });
  });

  it("asks again when only the fee or view is in the address", async () => {
    action.mockResolvedValue(<p>default set, overdraft</p>);
    at("pfee=overdraft");
    render(
      <PeerExplorerIsland institutionId={323} defaultSet="nearest">
        <p>default set</p>
      </PeerExplorerIsland>,
    );
    expect(await screen.findByText("default set, overdraft")).toBeTruthy();
  });

  it.each([
    ["fails", () => action.mockRejectedValue(new Error("network"))],
    ["comes back empty", () => action.mockResolvedValue(null)],
  ])("falls back to the cached explorer, not busy, when the set's load %s", async (_label, arrange) => {
    arrange();
    at("peers=metro");
    const { container } = render(
      <PeerExplorerIsland institutionId={323} defaultSet="nearest">
        <p>default set</p>
      </PeerExplorerIsland>,
    );
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.getByText("default set")).toBeTruthy();
  });
});
