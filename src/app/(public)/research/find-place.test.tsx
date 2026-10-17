import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FindPlace } from "./find-place";

describe("FindPlace", () => {
  it("offers a state dropdown and links to all 12 district reports", () => {
    render(
      <FindPlace
        states={[{ code: "FL", name: "Florida", institutions: 412 }]}
        districts={Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `D${i + 1}` }))}
      />,
    );
    const select = screen.getByLabelText("State report") as HTMLSelectElement;
    expect(select.className).toContain("min-h-11");
    expect(select.getAttribute("name")).toBe("state");
    expect(select.closest("form")?.getAttribute("action")).toBe("/research/state");
    expect(screen.getByRole("option", { name: "Florida (412 institutions)" }).getAttribute("value")).toBe("FL");
    expect(screen.getByRole("button", { name: "Go" }).className).toContain("min-h-11");
    const links = screen.getByRole("list", { name: "Federal Reserve district report" }).querySelectorAll("a");
    expect(links).toHaveLength(12);
    expect(links[5].getAttribute("href")).toBe("/research/district/6");
  });
});
