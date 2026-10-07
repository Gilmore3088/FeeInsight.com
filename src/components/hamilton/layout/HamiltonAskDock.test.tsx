import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/pro/simulate", useSearchParams: () => new URLSearchParams("fee=overdraft") }));

import { HamiltonAskDock } from "./HamiltonAskDock";

describe("HamiltonAskDock", () => {
  it("stays a small corner button until tapped, so it never covers a chart", () => {
    render(<HamiltonAskDock selectedInstitutionId="7" />);
    expect(screen.queryByRole("search")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ask Hamilton/ }));
    expect(screen.getByRole("search", { name: "Ask Hamilton" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close Ask Hamilton" }));
    expect(screen.queryByRole("search")).toBeNull();
  });
});
