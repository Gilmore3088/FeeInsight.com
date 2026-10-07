import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StorylineView } from "./StorylineView";
import { optionPrice, peerStanding } from "./option-compare";
import { sampleStoryline } from "./test-fixture";
import { FeeScorecard } from "@/components/hamilton/benchmark/FeeScorecard";
import type { Storyline } from "./types";

const src = {
  label: "Bank Fee Index, published fee schedules",
  table: "published_fee_catalog",
  asOf: "2026-10-01",
};

/** The sample storyline with a peer band and local competitors, as a price test carries them. Figures are made up. */
function pricedStory(): Storyline {
  const story = sampleStoryline();
  return {
    ...story,
    kind: "price_test",
    exhibits: [
      {
        id: "pos",
        number: 1,
        actionTitle: "Your $32 sits above the peer median",
        exhibit: {
          kind: "fee_position",
          title: "t",
          unit: "dollars",
          own: 32,
          ownLabel: "Example Bank",
          band: {
            label: "Banks $10B and up",
            p25: 25,
            median: 29,
            p75: 31,
            n: 40,
          },
          markers: [],
          sources: [src],
        },
      },
      {
        id: "local",
        number: 2,
        actionTitle: "Local competitors",
        exhibit: {
          kind: "competitor_range",
          title: "t",
          unit: "dollars",
          own: 32,
          ownLabel: "Example Bank",
          items: [
            { name: "Alpha Bank", amount: 35, url: null },
            { name: "Beta Bank", amount: 30, url: null },
            { name: "Gamma Bank", amount: 0, url: null },
          ],
          sources: [src],
        },
      },
    ],
    options: [
      {
        label: "Hold at $32",
        consequences: [{ text: "No change to income.", source: src }],
      },
      {
        label: "Peer median, $29",
        consequences: [{ text: "About $90,000 less a year.", source: src }],
      },
      {
        label: "Remove the overdraft fee",
        consequences: [{ text: "About $900,000 less a year.", source: src }],
      },
    ],
  };
}

describe("options side by side", () => {
  it("reads each option's price from the engine's labels", () => {
    expect(optionPrice({ label: "Hold at $32", consequences: [] })).toBe(32);
    expect(optionPrice({ label: "Test $1,250.50", consequences: [] })).toBe(
      1250.5,
    );
    expect(
      optionPrice({ label: "Remove the overdraft fee", consequences: [] }),
    ).toBe(0);
    expect(
      optionPrice({ label: "Add a daily cap", consequences: [] }),
    ).toBeNull();
    expect(
      optionPrice({
        label: "Hold at $32",
        consequences: [],
        price: 31,
      } as never),
    ).toBe(31);
  });

  it("says lower, in line or higher against the peer middle half", () => {
    const band = { p25: 25, p75: 31 };
    expect(peerStanding(20, band)).toBe("lower");
    expect(peerStanding(25, band)).toBe("in_line");
    expect(peerStanding(31, band)).toBe("in_line");
    expect(peerStanding(32, band)).toBe("higher");
  });

  it("letters the options, puts them on one scale and labels where each would sit", () => {
    const html = renderToStaticMarkup(<StorylineView story={pricedStory()} />);
    expect(html).toContain("Where each option would put you");
    expect(html).toContain("Peer median $29");
    expect(html).toContain("Higher than most peers");
    expect(html).toContain("In line with peers");
    expect(html).toContain("Lower than most peers");
    expect(html).toContain("2 of 3 local competitors charge less");
    expect(html).toContain("0 of 3 local competitors charge less");
    expect(html).not.toMatch(/recommend|cheapest|best option/i);
  });

  it("draws no scale without a peer band", () => {
    const html = renderToStaticMarkup(
      <StorylineView story={sampleStoryline()} />,
    );
    expect(html).not.toContain("Where each option would put you");
    expect(html).toContain("Options and what each would mean");
  });
});

describe("FeeScorecard", () => {
  const rows = [
    {
      feeCategory: "overdraft",
      current: 35,
      band: { p25: 25, median: 29, p75: 32, n: 40 },
      peerLabel: "Banks $10B and up",
    },
    {
      feeCategory: "nsf",
      current: 20,
      band: { p25: 25, median: 29, p75: 32, n: 38 },
      peerLabel: "Banks $10B and up",
    },
    {
      feeCategory: "wire_domestic_outgoing",
      current: 25,
      band: { p25: 20, median: 25, p75: 30, n: 30 },
      peerLabel: "Banks $10B and up",
    },
    {
      feeCategory: "stop_payment",
      current: 30,
      band: null,
      peerLabel: "Banks $10B and up",
    },
  ];

  it("counts and labels every compared fee, and says how many were too thin", () => {
    const html = renderToStaticMarkup(
      <FeeScorecard rows={rows} institutionId="7" />,
    );
    expect(html).toContain("1 lower · 1 in line · 1 higher");
    expect(html).toContain("Higher than most peers");
    expect(html).toContain(
      "1 more fee has too few peers publishing to compare.",
    );
    expect(html).toContain("/pro/analyze?q=");
  });

  it("renders nothing when no fee has a peer range", () => {
    expect(
      renderToStaticMarkup(
        <FeeScorecard rows={[rows[3]]} institutionId={null} />,
      ),
    ).toBe("");
  });
});
