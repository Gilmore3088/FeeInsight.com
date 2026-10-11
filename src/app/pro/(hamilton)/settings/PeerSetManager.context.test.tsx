// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ create: vi.fn(), edit: vi.fn(), remove: vi.fn(), defaults: vi.fn() }));
vi.mock("./actions", () => ({ createPeerSet: actions.create, editPeerSet: actions.edit, removePeerSet: actions.remove, setPeerSetForAllCharts: actions.defaults }));
vi.mock("@/components/hamilton/InstitutionPicker", () => ({ InstitutionPicker: () => null }));
import { PeerSetManager, type PeerSetRow } from "./PeerSetManager";

const personal: PeerSetRow = { id: 900, name: "Florida research", tiers: "community_large", districts: null, charter_type: null, created_by: "25", created_at: "2026-10-10", institution_ids: null, states: ["FL"], institution_id: null, is_default: false };
beforeEach(() => { vi.resetAllMocks(); actions.create.mockResolvedValue({ success: true, id: 8 }); actions.edit.mockResolvedValue({ success: true, id: 900 }); });
afterEach(cleanup);

describe("peer group form research identity", () => {
  it("submits the displayed subject on creation without changing chart defaults", async () => {
    render(<PeerSetManager initialPeerSets={[]} currentUserId="25" researchInstitutionId={8629} minPeers={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a peer group" }));
    const form = screen.getByRole("button", { name: "Save peer group" }).closest("form")!;
    fireEvent.change(form.querySelector<HTMLInputElement>('input[name="name"]')!, { target: { value: "Florida research" } });
    fireEvent.click(screen.getByRole("button", { name: "Save peer group" }));
    await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(1));
    expect((actions.create.mock.calls[0][0] as FormData).get("research_institution_id")).toBe("8629");
    expect(actions.defaults).not.toHaveBeenCalled();
  });

  it("carries the same subject on an edit while keeping the saved group's ID", async () => {
    render(<PeerSetManager initialPeerSets={[personal]} currentUserId="25" researchInstitutionId={8629} minPeers={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(actions.edit).toHaveBeenCalledTimes(1));
    expect(actions.edit.mock.calls[0][0]).toBe(900);
    expect((actions.edit.mock.calls[0][1] as FormData).get("research_institution_id")).toBe("8629");
  });

  it("submits explicit personal scope when no research institution is selected", async () => {
    render(<PeerSetManager initialPeerSets={[]} currentUserId="25" researchInstitutionId={null} minPeers={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a peer group" }));
    const form = screen.getByRole("button", { name: "Save peer group" }).closest("form")!;
    fireEvent.change(form.querySelector<HTMLInputElement>('input[name="name"]')!, { target: { value: "Personal research" } });
    fireEvent.click(screen.getByRole("button", { name: "Save peer group" }));
    await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(1));
    expect((actions.create.mock.calls[0][0] as FormData).get("research_institution_id")).toBe("");
  });
});
