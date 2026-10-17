import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HubStates, type HubTableRow } from "./district-hub-states";

const rows: HubTableRow[] = [
  { code: "AR", name: "Arkansas", cells: { institutions: { v: 120, t: "120" }, overdraft: { v: null, t: "-" } } },
  { code: "MO", name: "Missouri", cells: { institutions: { v: 300, t: "300" }, overdraft: { v: 32, t: "$32" } } },
];

function setup(extra: { code: string; name: string }[] = []) {
  return render(
    <HubStates
      states={[
        { code: "AR", name: "Arkansas" },
        { code: "MO", name: "Missouri" },
        ...extra,
      ]}
      shapes={{ AR: { d: "M0 0h1v1z", viewBox: "0 0 1 1" } }}
      fees={[
        { key: "overdraft", label: "Overdraft", district: 30, byState: { AR: null, MO: 32 } },
        { key: "nsf", label: "NSF", district: 28, byState: { AR: 25, MO: 29 } },
      ]}
      districtName="St. Louis district"
      panels={{ AR: <p>Arkansas panel</p>, MO: <p>Missouri panel</p> }}
      columns={[
        { key: "institutions", label: "Institutions", phone: true },
        { key: "overdraft", label: "Overdraft" },
      ]}
      rows={rows}
      initial="MO"
    />,
  );
}

describe("HubStates", () => {
  it("opens on the initial state and switches on a state card", () => {
    setup();
    expect(screen.getByText("Missouri panel")).toBeTruthy();
    const group = screen.getByRole("group", { name: "Pick a state" });
    fireEvent.click(within(group).getByRole("button", { name: /^Arkansas/ }));
    expect(screen.getByText("Arkansas panel")).toBeTruthy();
    expect(within(group).getByRole("button", { name: /^Arkansas/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows every state's median for the picked fee, and says when a state has too few", () => {
    setup();
    const group = screen.getByRole("group", { name: "Pick a state" });
    expect(within(group).getByRole("button", { name: "Missouri: Overdraft median $32" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "Arkansas: Overdraft median not available yet" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("group", { name: "Pick a fee" })).getByRole("button", { name: "NSF" }));
    expect(within(group).getByRole("button", { name: "Arkansas: NSF median $25" })).toBeTruthy();
    expect(screen.getByText("St. Louis district median, $28")).toBeTruthy();
  });

  it("sorts the table with unknown values last", () => {
    setup();
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Overdraft" }));
    const names = screen.getAllByRole("row").slice(1).map((r) => within(r).getByRole("rowheader").textContent);
    expect(names).toEqual(["Missouri", "Arkansas"]);
    fireEvent.click(screen.getByRole("button", { name: /Institutions/ }));
    fireEvent.click(screen.getByRole("button", { name: /Institutions/ }));
    const ascending = screen.getAllByRole("row").slice(1).map((r) => within(r).getByRole("rowheader").textContent);
    expect(ascending).toEqual(["Arkansas", "Missouri"]);
  });

  it("picks a state from its table row", () => {
    setup();
    const table = screen.getByRole("table");
    fireEvent.click(within(table).getByRole("button", { name: "Arkansas" }));
    expect(screen.getByText("Arkansas panel")).toBeTruthy();
  });

  it("keeps the full table behind a disclosure named for the state count", () => {
    setup();
    expect(screen.getByText("Compare both states").closest("details")?.open).toBe(false);
  });

  it("names territories in the disclosure when the list holds one", () => {
    setup([{ code: "GU", name: "Guam" }]);
    expect(screen.getByText("Compare all states and territories")).toBeTruthy();
  });

  it("hides the columns a phone has no room for", () => {
    setup();
    const header = within(screen.getByRole("table")).getByRole("button", { name: "Overdraft" }).closest("th");
    expect(header?.className).toContain("hidden sm:table-cell");
    expect(screen.getByRole("button", { name: /Institutions/ }).closest("th")?.className).not.toContain("hidden");
  });
});
