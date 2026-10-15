import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let currentParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => currentParams,
}));

import { InstitutionSearchBar } from "./search-bar";

const BANKS = [
  { id: 11, institution_name: "Aspen Bank", city: "Aspen", state_code: "CO", charter_type: "bank", fee_count: 4 },
  { id: 12, institution_name: "Aspen Valley CU", city: "Basalt", state_code: "CO", charter_type: "credit_union", fee_count: 0 },
];

async function typeAndWait(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
  await act(async () => {});
}

// The audit (Oct 8): ArrowDown left focus in the input without reaching a suggestion, and the
// input exposed no combobox state.
describe("InstitutionSearchBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    push.mockReset();
    currentParams = new URLSearchParams();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("works as a combobox: arrows move through suggestions, Enter picks one, Escape closes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => BANKS })));
    render(<InstitutionSearchBar />);
    const input = screen.getByRole("combobox", { name: "Search institutions" });
    await typeAndWait(input, "Aspen");

    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("option")).toHaveLength(2);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const second = screen.getAllByRole("option")[1];
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(second.id);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/institution/12");

    await typeAndWait(input, "Aspe");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("Enter with nothing highlighted still runs the full search", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => BANKS })));
    render(<InstitutionSearchBar />);
    const input = screen.getByRole("combobox");
    await typeAndWait(input, "Aspen");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/institutions?q=Aspen");
  });

  it("a new search keeps the state and institution type already picked", async () => {
    currentParams = new URLSearchParams("state=NY&charter=bank&fee=overdraft&page=3");
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => BANKS })));
    render(<InstitutionSearchBar />);
    const input = screen.getByRole("combobox");
    await typeAndWait(input, "M&T");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/institutions?q=M%26T&state=NY&charter=bank&fee=overdraft");
  });

  it("offers to send a fee schedule, with the searched name, when nothing matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => [] })));
    render(<InstitutionSearchBar />);
    await typeAndWait(screen.getByRole("combobox"), "Nowhere Savings");
    expect(screen.getByText(/No institutions found/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Send its fee schedule/ }).getAttribute("href"),
    ).toBe("/submit-fees?institutionName=Nowhere+Savings");
  });
});
