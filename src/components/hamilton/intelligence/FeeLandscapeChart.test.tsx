import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeeLandscapeChart, landscapeScaleMax } from "./IntelligenceCharts";

const m = (median: number, p25: number, p75: number, institutions: number) => ({ median, p25, p75, institutions });

describe("FeeLandscapeChart (#1890)", () => {
  const rows = [
    { fee: "Overdraft (OD)", selected: m(35, 28.75, 35, 16), national: m(35, 30, 35, 900) },
    { fee: "Non-Network ATM", selected: m(2.5, 1, 3, 17), national: m(2.5, 2, 3, 1645) },
    { fee: "Wire Transfer (Domestic Out)", selected: null, national: m(25, 20, 30, 2504) },
  ];

  it("gives each fee its own dollar scale instead of one shared axis", () => {
    const html = renderToStaticMarkup(<FeeLandscapeChart rows={rows} state="Florida" />);
    // Overdraft's $35 runs to $50; the ATM fee's $3 runs to $5 on its own row.
    expect(html).toContain("Scale $0 to $50.00");
    expect(html).toContain("Scale $0 to $5.00");
    // The ATM median sits halfway along its own strip, not as a sliver next to $35.
    expect(html).toMatch(/left:\s*50%/);
    expect(html).toContain("Each fee has its own dollar scale");
    expect(html).not.toContain("recharts");
  });

  it("names the state median, its middle half, the institutions and the U.S. median on every strip", () => {
    const html = renderToStaticMarkup(<FeeLandscapeChart rows={rows} state="Florida" />);
    expect(html).toContain("Overdraft (OD): Florida median $35.00, middle half $28.75 to $35.00, 16 institutions; U.S. median $35.00.");
    expect(html).toContain("U.S. median $2.50");
    expect(html).toContain("Florida middle half");
  });

  it("draws no strip for a fee with too few institutions; missing is never $0", () => {
    const html = renderToStaticMarkup(<FeeLandscapeChart rows={rows} state="Florida" />);
    expect(html).not.toContain("Wire Transfer (Domestic Out):");
  });

  it("national research shows no separate U.S. tick", () => {
    const html = renderToStaticMarkup(<FeeLandscapeChart rows={[{ fee: "Overdraft (OD)", selected: m(35, 30, 35, 900), national: null }]} state={null} />);
    expect(html).toContain("U.S. median $35.00");
    expect(html).toContain("U.S. middle half");
    expect(html).not.toContain("bg-[var(--fi-brick)]");
  });

  it("rounds each scale up to a readable top", () => {
    expect(landscapeScaleMax([35])).toBe(50);
    expect(landscapeScaleMax([3])).toBe(5);
    expect(landscapeScaleMax([8.95, 15])).toBe(20);
    expect(landscapeScaleMax([0])).toBe(1);
  });
});
