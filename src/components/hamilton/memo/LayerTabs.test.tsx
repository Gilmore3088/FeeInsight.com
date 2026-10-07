import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LayerTabs } from "./LayerTabs";

afterEach(cleanup);

describe("LayerTabs", () => {
  it("switches layers at once and keeps the address in step", () => {
    const tabs = [
      { key: "local", label: "Your market", meta: "$35", href: "/pro/research?fee=overdraft&layer=local", panel: <p>Local panel</p> },
      { key: "state", label: "Florida", meta: "$30", href: "/pro/research?fee=overdraft&layer=state", panel: <p>State panel</p> },
    ];
    render(<LayerTabs tabs={tabs} initial="local" label="Market layer" />);
    expect(screen.getByText("Local panel").closest("[role=tabpanel]")?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByText("State panel").closest("[role=tabpanel]")?.hasAttribute("hidden")).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: /Florida/ }));
    expect(screen.getByText("State panel").closest("[role=tabpanel]")?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByRole("tab", { name: /Florida/ }).getAttribute("aria-selected")).toBe("true");
    expect(window.location.search).toBe("?fee=overdraft&layer=state");
  });
});
