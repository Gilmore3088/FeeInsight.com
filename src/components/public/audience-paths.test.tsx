import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AudiencePaths } from "./audience-paths";

describe("AudiencePaths", () => {
  it("offers a start for consumers, researchers and institutions", () => {
    render(<AudiencePaths />);
    const nav = screen.getByRole("navigation", { name: "Where to start" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/guides", "/research/national-fee-index", "/for-institutions#report"]);
  });

  it("does not promise API access", () => {
    const { container } = render(<AudiencePaths />);
    expect(container.textContent).not.toMatch(/\bAPI\b/);
  });
});
