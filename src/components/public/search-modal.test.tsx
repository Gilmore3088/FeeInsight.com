import { act, fireEvent, render, screen } from "@testing-library/react";
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
});
