import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SearchModal } from "./search-modal";
import { openSearch } from "./search-events";
import { SearchTrigger } from "@/components/search-trigger";

describe("SearchModal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
  });

  it("opens from openSearch() without a synthetic keypress", () => {
    render(<SearchModal />);
    expect(screen.queryByRole("textbox")).toBeNull();
    act(() => openSearch());
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("still toggles with Ctrl+K and closes on Escape", () => {
    render(<SearchModal />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("is reachable from the header button at any width", () => {
    render(
      <>
        <SearchTrigger />
        <SearchModal />
      </>,
    );
    const trigger = screen.getByRole("button", { name: /Search banks, credit unions, fees and guides/ });
    expect(trigger.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    fireEvent.click(trigger);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("is a modal dialog whose combobox points at the selected option", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify([{ id: 3, institution_name: "First Bank", city: "Austin", state_code: "TX", charter_type: "bank" }]), {
          status: 200,
        }),
      ),
    );
    render(<SearchModal />);
    act(() => openSearch());
    expect(screen.getByRole("dialog", { name: "Search" })).toHaveAttribute("aria-modal", "true");
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-controls", "search-results");
    expect(input).toHaveAttribute("aria-autocomplete", "list");

    fireEvent.change(input, { target: { value: "overdraft" } });
    const listbox = await screen.findByRole("listbox", { name: "Search results" });
    const options = within(listbox).getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(within(listbox).getAllByRole("group").length).toBeGreaterThan(0);
  });

  it("returns focus to the opener on close", async () => {
    render(
      <>
        <SearchTrigger />
        <SearchModal />
      </>,
    );
    const trigger = screen.getByRole("button", { name: /Search banks/ });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
