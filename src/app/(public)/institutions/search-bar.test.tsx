import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
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

describe("InstitutionSearchBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    push.mockReset();
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

  it("offers to send a fee schedule when no institution matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => [] })));
    render(<InstitutionSearchBar />);
    await typeAndWait(screen.getByRole("combobox"), "Nowhere Savings");
    expect(screen.getByText(/No institutions found/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Send its fee schedule" }).getAttribute("href")).toBe("/submit-fees");
  });
});
