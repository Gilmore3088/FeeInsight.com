import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HubFindings } from "./hub-findings";
import type { Finding } from "./findings";

const finding = (key: string, fee_category?: string): Finding => ({
  key,
  figure: "$5",
  headline: `${key} headline`,
  detail: `${key} detail`,
  about: `${key} about`,
  exhibit: "benchmarks",
  fee_category,
});

describe("HubFindings", () => {
  it("shows three findings, each with a dated source and a link to its evidence", () => {
    const { container } = render(
      <HubFindings findings={[finding("a"), finding("b", "nsf"), finding("c", "overdraft"), finding("d")]} asOf="Oct 18, 2026" />,
    );
    const items = screen.getByRole("list", { name: "Key findings" }).querySelectorAll(":scope > li");
    expect(items).toHaveLength(3);
    expect(items[0].querySelector("a")?.getAttribute("href")).toBe("#benchmarks");
    expect(items[1].querySelector("a")?.getAttribute("href")).toBe("/fees/nsf");
    expect(container.textContent).toContain("Data as of Oct 18, 2026.");
    expect(screen.queryByText("d headline")).toBeNull();
  });

  it("renders nothing without findings", () => {
    const { container } = render(<HubFindings findings={[]} asOf={null} />);
    expect(container.textContent).toBe("");
  });
});
