import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
    expect(screen.getByRole("option", { name: "Florida (412 institutions)" }).getAttribute("value")).toBe("/research/state/FL");
    const links = screen.getByRole("list", { name: "Federal Reserve district report" }).querySelectorAll("a");
    expect(links).toHaveLength(12);
    expect(links[5].getAttribute("href")).toBe("/research/district/6");
  });
});
