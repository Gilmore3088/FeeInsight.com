import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HamiltonClose } from "./hamilton-close";

describe("HamiltonClose", () => {
  it("names the competitor count and links to the Pro plans, returning to Monitor", () => {
    render(<HamiltonClose competitors={14} />);
    expect(screen.getByRole("heading", { name: "Track this market in Hamilton" })).toBeInTheDocument();
    expect(screen.getByText(/these 14 competitors/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See Hamilton plans" })).toHaveAttribute(
      "href",
      "/subscribe?from=%2Fpro%2Fmonitor",
    );
  });
});
