import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HubStates, type HubTableRow } from "./district-hub-states";

const rows: HubTableRow[] = [
  { code: "AR", name: "Arkansas", cells: { institutions: { v: 120, t: "120" }, overdraft: { v: null, t: "-" } } },
  { code: "MO", name: "Missouri", cells: { institutions: { v: 300, t: "300" }, overdraft: { v: 32, t: "$32" } } },
];

function setup() {
  return render(
    <HubStates
      states={[
        { code: "AR", name: "Arkansas" },
        { code: "MO", name: "Missouri" },
      ]}
      map={
        <svg>
          <g data-state="AR">
            <path d="M0 0" data-testid="ar-shape" />
          </g>
        </svg>
      }
      panels={{ AR: <p>Arkansas panel</p>, MO: <p>Missouri panel</p> }}
      columns={[
        { key: "institutions", label: "Institutions" },
        { key: "overdraft", label: "Overdraft" },
      ]}
      rows={rows}
      initial="MO"
    />,
  );
}

describe("HubStates", () => {
  it("opens on the initial state and switches on a chip", () => {
    setup();
    expect(screen.getByText("Missouri panel")).toBeTruthy();
    const group = screen.getByRole("group", { name: "Pick a state" });
    fireEvent.click(within(group).getByRole("button", { name: "Arkansas" }));
    expect(screen.getByText("Arkansas panel")).toBeTruthy();
    expect(within(group).getByRole("button", { name: "Arkansas" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("switches on a tap on the map", () => {
    setup();
    fireEvent.click(screen.getByTestId("ar-shape"));
    expect(screen.getByText("Arkansas panel")).toBeTruthy();
  });

  it("sorts the table with unknown values last", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Overdraft/ }));
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
});
