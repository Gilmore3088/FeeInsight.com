import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/subscribe",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/components/hamilton/InstitutionPicker", () => ({ InstitutionPicker: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import { ProTierChooser } from "./pro-tier-chooser";

beforeEach(() => { nav.push.mockReset(); nav.search = "plan=annual"; });

describe("ProTierChooser with a saved choice (#1958)", () => {
  it("Change asks the page for the search instead of the saved institution", () => {
    render(<ProTierChooser chosenLabel="Capital City Bank, Tallahassee, FL" institutionId={2945} entry="direct" />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(nav.push).toHaveBeenCalledWith("/subscribe?plan=annual&change=1#pro-heading", { scroll: false });
  });

  it("keeps the saved institution, not in the URL, when a size band is picked", () => {
    render(
      <ProTierChooser
        chosenLabel="Capital City Bank"
        institutionId={2945}
        bandChoices={[{ key: "small", label: "Under $1B in assets" }]}
        entry="direct"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Under $1B in assets" }));
    expect(nav.push).toHaveBeenCalledWith("/subscribe?plan=annual&inst=2945&band=small#pro-heading", { scroll: false });
  });
});
