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

  it("keeps a typed question when the bar is closed, and Escape hands focus back to the button", () => {
    render(<HamiltonAskDock selectedInstitutionId="7" />);
    fireEvent.click(screen.getByRole("button", { name: /Ask Hamilton/ }));
    fireEvent.change(screen.getByLabelText("Ask Hamilton", { selector: "input" }), { target: { value: "What about wires?" } });
    fireEvent.keyDown(screen.getByRole("search"), { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Ask Hamilton/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ask Hamilton/ }));
    expect((screen.getByLabelText("Ask Hamilton", { selector: "input" }) as HTMLInputElement).value).toBe("What about wires?");
  });

  it("submits the resolved context and waits while the new canonical subject is unresolved", () => {
    const view = render(<HamiltonAskDock selectedInstitutionId="8109" navigationContext={{ institutionId: "8109", research: null, artifact: true, invalid: false }} />);
    fireEvent.click(screen.getByRole("button", { name: /Ask Hamilton/ }));
    expect(screen.getByRole("search").querySelector('input[name="instId"]')).toHaveAttribute("value", "8109");
    view.rerender(<HamiltonAskDock selectedInstitutionId={null} navigationContext={{ institutionId: null, research: null, artifact: false, invalid: false, unresolved: true }} />);
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("button", { name: /Ask Hamilton/ })).toBeNull();
    view.rerender(<HamiltonAskDock selectedInstitutionId="1535" navigationContext={{ institutionId: "1535", research: null, artifact: false, invalid: false }} />);
    expect(screen.getByRole("search").querySelector('input[name="instId"]')).toHaveAttribute("value", "1535");
  });

  it("does not submit a contextless reference-route question into an unrelated saved default", () => {
    render(<HamiltonAskDock selectedInstitutionId={null} navigationContext={{ institutionId: null, research: null, artifact: false, invalid: false }} />);
    expect(screen.queryByRole("button", { name: /Ask Hamilton/ })).toBeNull();
    expect(screen.queryByRole("search")).toBeNull();
  });
});
