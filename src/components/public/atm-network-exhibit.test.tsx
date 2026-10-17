import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AtmNetworkExhibit } from "./atm-network-exhibit";
import type { NetworkMentions } from "@/lib/guides/atm-networks";

const inst = (id: number, state: string) => ({
  institutionId: id,
  name: `CU ${id}`,
  state,
  lines: [{ feeName: "Non-CO-OP ATM Fee", amount: 1, namedIn: null, documentUrl: `https://example.org/${id}.pdf` }],
});

const NETWORKS: NetworkMentions[] = [
  { id: "allpoint", name: "Allpoint", institutions: [inst(1, "AL")] },
  { id: "coop", name: "CO-OP", institutions: Array.from({ length: 20 }, (_, i) => inst(100 + i, i < 3 ? "MI" : "TX")) },
];

describe("AtmNetworkExhibit", () => {
  it("shows one tab per network with its count, and the chosen network's lines verbatim", () => {
    render(<AtmNetworkExhibit title="Networks named in fee schedules" caption="This list is a floor." networks={NETWORKS} />);
    expect(screen.getByRole("tab", { name: "Allpoint 1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Allpoint: named by 1 institution's fee schedule")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CU 1" })).toHaveAttribute("href", "/institution/1");
    expect(screen.getByText("“Non-CO-OP ATM Fee”")).toBeInTheDocument();
    expect(screen.getByText("$1.00")).toBeInTheDocument();
    expect(screen.getByText("This list is a floor.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "CO-OP 20" }));
    expect(screen.getByText("CO-OP: named by 20 institutions' fee schedules")).toBeInTheDocument();
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getAllByRole("link", { name: /^CU \d+$/ })).toHaveLength(15);
    fireEvent.click(screen.getByRole("button", { name: "Show all 20" }));
    expect(within(panel).getAllByRole("link", { name: /^CU \d+$/ })).toHaveLength(20);
  });

  it("filters a long list by state", () => {
    render(<AtmNetworkExhibit title="t" caption="c" networks={NETWORKS} />);
    fireEvent.click(screen.getByRole("tab", { name: "CO-OP 20" }));
    fireEvent.change(screen.getByRole("combobox", { name: "State" }), { target: { value: "MI" } });
    expect(within(screen.getByRole("tabpanel")).getAllByRole("link", { name: /^CU \d+$/ })).toHaveLength(3);
  });
});
