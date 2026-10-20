import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ShowAll } from "./show-all";

describe("ShowAll", () => {
  it("says how many of the fees it shows", () => {
    const { container } = render(<ShowAll total={42} shown={10}><p>rows</p></ShowAll>);
    expect(container.textContent).toContain("Showing 10 of 42 fees.");
  });

  it("with Personal / Business tabs, says the total counts each fee once (#1592)", () => {
    const { container } = render(<ShowAll total={42} shown={10} tabbed><p>rows</p></ShowAll>);
    expect(container.textContent).toContain(
      "Showing the first 10 in each tab. 42 fees in all, each counted once; a fee for personal and business accounts is listed in both tabs.",
    );
    expect(container.textContent).toContain("Show all 42 fees");
  });
});
