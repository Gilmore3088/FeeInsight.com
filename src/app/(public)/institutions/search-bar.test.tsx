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

// The audit (Oct 8): ArrowDown left focus in the input without reaching a suggestion, and the
// input exposed no combobox state.
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

  it("on /check, a pick and an Enter search both answer on /check", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => BANKS })));
    render(<InstitutionSearchBar resultPath="/check" />);
    const input = screen.getByRole("combobox");
    await typeAndWait(input, "Aspen");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/check?q=Aspen");
    await typeAndWait(input, "Aspe");
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(push).toHaveBeenCalledWith("/check?id=11");
  });

  it("announces suggestions politely, jumps with Home/End and closes on Tab", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => BANKS })));
    render(<InstitutionSearchBar />);
    const input = screen.getByRole("combobox", { name: "Search institutions" });
    expect(input.getAttribute("inputmode")).toBe("search");
    await typeAndWait(input, "Aspen");
    expect(screen.getByRole("status").textContent).toBe("2 suggestions");
    fireEvent.keyDown(input, { key: "End" });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Home" });
    expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("on /check, Enter with one match opens that institution's answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => [BANKS[0]] })));
    render(<InstitutionSearchBar resultPath="/check" />);
    const input = screen.getByRole("combobox");
    await typeAndWait(input, "Aspen Bank");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/check?id=11");
  });

  it("searches the new text when Enter is pressed before its lookup starts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => [BANKS[0]] })));
    render(<InstitutionSearchBar resultPath="/check" />);
    const input = screen.getByRole("combobox");
    await typeAndWait(input, "Aspen Bank");
    fireEvent.keyDown(input, { key: "ArrowDown" });

    fireEvent.change(input, { target: { value: "Capital City Bank" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(push).toHaveBeenCalledExactlyOnceWith("/check?q=Capital+City+Bank");
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("ignores an older lookup that finishes after the current query", async () => {
    let finishOldLookup!: (value: { json: () => Promise<typeof BANKS> }) => void;
    const oldLookup = new Promise<{ json: () => Promise<typeof BANKS> }>((resolve) => {
      finishOldLookup = resolve;
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(oldLookup)
      .mockResolvedValueOnce({ json: async () => [BANKS[1]] }));
    render(<InstitutionSearchBar resultPath="/check" />);
    const input = screen.getByRole("combobox");
    await typeAndWait(input, "Aspen Bank");
    await typeAndWait(input, "Aspen Valley CU");

    await act(async () => {
      finishOldLookup({ json: async () => [BANKS[0]] });
    });

    expect(screen.getByRole("option").textContent).toContain("Aspen Valley CU");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledExactlyOnceWith("/check?id=12");
  });

  it("keeps a cleared query empty when its old lookup finishes", async () => {
    let finishLookup!: (value: { json: () => Promise<typeof BANKS> }) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finishLookup = resolve; })));
    render(<InstitutionSearchBar />);
    const input = screen.getByRole("combobox");
    await typeAndWait(input, "Aspen Bank");
    fireEvent.change(input, { target: { value: "" } });
    await act(async () => {
      finishLookup({ json: async () => [BANKS[0]] });
    });

    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).not.toHaveBeenCalled();
  });

  it("offers to send a fee schedule, with the searched name, when nothing matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => [] })));
    render(<InstitutionSearchBar />);
    await typeAndWait(screen.getByRole("combobox"), "Nowhere Savings");
    expect(screen.getByText(/No institutions found for/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("No institutions found");
    expect(
      screen.getByRole("link", { name: /Send its fee schedule/ }).getAttribute("href"),
    ).toBe("/submit-fees?institutionName=Nowhere+Savings");
  });
});
