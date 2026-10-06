import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HamiltonLeftRail } from "./HamiltonLeftRail";

const navigationState = vi.hoisted(() => ({
  pathname: "/pro/reports",
  searchParams: new URLSearchParams("instId=2945"),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useSearchParams: () => navigationState.searchParams,
}));

describe("HamiltonLeftRail primary actions", () => {
  afterEach(() => {
    cleanup();
    navigationState.pathname = "/pro/reports";
    navigationState.searchParams = new URLSearchParams("instId=2945");
  });

  it("routes Reports & Briefs primary action to the report builder with institution context", () => {
    render(<HamiltonLeftRail selectedInstitutionId="2945" />);

    expect(screen.getByRole("link", { name: /generate brief/i })).toHaveAttribute(
      "href",
      "/pro/reports?intent=executive-briefing&instId=2945",
    );
  });

  it("routes This month's primary action to My fees with institution context", () => {
    navigationState.pathname = "/pro/hamilton";
    navigationState.searchParams = new URLSearchParams("");

    render(<HamiltonLeftRail selectedInstitutionId="8109" />);

    expect(screen.getByRole("link", { name: /look at my fees/i })).toHaveAttribute(
      "href",
      "/pro/research?instId=8109",
    );
  });
});
