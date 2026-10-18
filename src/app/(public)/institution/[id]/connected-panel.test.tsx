import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ConnectedPanel } from "./connected-panel";
import type { CompareRow } from "./profile-view";

function row(key: string, label: string, amount: number, extra: Partial<CompareRow> = {}): CompareRow {
  return {
    key,
    label,
    amount,
    count: 1,
    low: amount,
    high: amount,
    sourceUrl: null,
    account: null,
    accountPrices: null,
    comparedAt: null,
    highestTier: false,
    excludedCdIra: 0,
    excludedCard: 0,
    waiver: null,
    state: { median: 7.5, institutions: 25 },
    district: null,
    us: null,
    missing: null,
    ...extra,
  };
}

describe("ConnectedPanel", () => {
  it("leads with the account prices and names the comparison price in the small line", () => {
    const fees = [
      row("monthly_maintenance", "Monthly Maintenance", 8.45, { count: 2, low: 7.95, high: 8.95 }),
      row("nsf", "NSF", 30, { state: { median: 30, institutions: 30 } }),
    ];
    const { container } = render(
      <ConnectedPanel institutionId={323} institutionName="Capital City Bank" incomeName="service-charge income" stateName="Florida" stateShort="FL" facts={[]} share={null} fees={fees} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Monthly maintenance $7.95 to $8.95 vs FL $7.50");
    expect(text).toContain("Compared at $8.45, the middle of its two prices: $0.95 above");
    expect(text).not.toContain("proxy");
    expect(text).toContain("NSF $30 vs FL $30 (about the same)");
  });

  it("names the highest price for a fee compared at its standard tier", () => {
    const fees = [row("overdraft", "Overdraft (OD)", 36, { count: 3, low: 10, high: 36, highestTier: true, state: { median: 32, institutions: 40 } })];
    const { container } = render(
      <ConnectedPanel institutionId={323} institutionName="Capital City Bank" incomeName="service-charge income" stateName="Florida" stateShort="FL" facts={[]} share={null} fees={fees} />,
    );
    expect(container.textContent).toContain("Overdraft $10 to $36 vs FL $32");
    expect(container.textContent).toContain("Compared at $36, the highest of its prices: $4 above");
  });

  it("sends a signed-out reader's Hamilton action to the Pro plans, not straight into Pro settings", () => {
    const { container } = render(
      <ConnectedPanel institutionId={323} institutionName="Capital City Bank" incomeName="service-charge income" stateName="Florida" stateShort="FL" facts={[]} share={null} fees={[row("nsf", "NSF", 30)]} />,
    );
    const link = [...container.querySelectorAll("a")].find((a) => a.textContent?.includes("in Hamilton"));
    expect(link?.getAttribute("href")).toBe("/subscribe?inst=323&from=%2Fpro%2Fsettings%3FinstId%3D323%23peer-sets#pro");
  });
});
