import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProLock } from "./pro-lock";

describe("ProLock", () => {
  it("tells screen readers the link needs Pro", () => {
    render(<a href="/research/fee-revenue-analysis">Fee-to-Revenue Analysis <ProLock /></a>);
    expect(screen.getByRole("link")).toHaveAccessibleName(/requires Fee Insight Pro/);
  });
});
