import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExploreMarket } from "./explore-market";

describe("ExploreMarket", () => {
  it("offers State, Fed district and National as one tab set, State first", () => {
    render(<ExploreMarket state={<p>State panel</p>} district={<p>District panel</p>} national={<p>National panel</p>} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["State", "Fed district", "National"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("District panel").closest("[role=tabpanel]")?.hasAttribute("hidden")).toBe(true);
    fireEvent.click(tabs[1]);
    expect(screen.getByText("District panel").closest("[role=tabpanel]")?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByText("State panel").closest("[role=tabpanel]")?.hasAttribute("hidden")).toBe(true);
    fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the /districts anchor on the page", () => {
    const { container } = render(<ExploreMarket state={null} district={null} national={null} />);
    expect(container.querySelector("#districts")).toBeTruthy();
  });
});
