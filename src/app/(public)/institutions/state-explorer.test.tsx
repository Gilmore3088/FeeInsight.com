import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import { StateExplorer } from "./state-explorer";

function row(state_code: string, verified: number, total: number): InstitutionStateDirectorySummary {
  return {
    state_code,
    institution_count: total,
    verified_institution_count: verified,
    provisional_institution_count: 0,
    under_review_institution_count: 0,
    source_needed_institution_count: total - verified,
    verified_fee_count: 0,
    provisional_fee_count: 0,
  };
}

const ROWS = [row("CA", 120, 400), row("NY", 80, 200)];

describe("StateExplorer", () => {
  it("opens on every state added up, with no state link yet", () => {
    render(<StateExplorer summaries={ROWS} />);
    const panel = screen.getByRole("complementary", { name: "State detail" });
    expect(panel.textContent).toContain("All states");
    expect(panel.textContent).toContain("200");
    expect(panel.textContent).toContain("of 600");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("tapping a state shows its split and links to its institutions, keeping the filters", () => {
    render(<StateExplorer summaries={ROWS} query="Navy" charter="credit_union" fee="overdraft" />);
    const ny = screen.getByRole("button", { name: /^New York: 80 of 200/ });
    fireEvent.click(ny);
    expect(ny.getAttribute("aria-pressed")).toBe("true");
    const panel = screen.getByRole("complementary", { name: "State detail" });
    expect(panel.textContent).toContain("New York");
    expect(panel.textContent).toContain("40% of credit unions have published fees");
    expect(panel.querySelector("[aria-live]")?.textContent).toBe("New York: 80 of 200 credit unions have published fees");
    expect(screen.getByRole("link", { name: /See Navy in New York/ }).getAttribute("href")).toBe(
      "/institutions?q=Navy&state=NY&charter=credit_union&fee=overdraft",
    );
  });

  it("works from the keyboard and from the state list", () => {
    render(<StateExplorer summaries={ROWS} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /^California/ }), { key: "Enter" });
    expect(screen.getByRole("link", { name: /See California institutions/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Choose a state"), { target: { value: "NY" } });
    expect(screen.getByRole("link", { name: /See New York institutions/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Choose a state"), { target: { value: "" } });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("puts the list and panel before the map, so keyboard users reach them first", () => {
    const { container } = render(<StateExplorer summaries={ROWS} />);
    const select = container.querySelector("select")!;
    const map = container.querySelector("svg")!;
    expect(select.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("states with no summary are drawn but not tappable", () => {
    render(<StateExplorer summaries={ROWS} />);
    expect(screen.queryByRole("button", { name: /^Texas/ })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
