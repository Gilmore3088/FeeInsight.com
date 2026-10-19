import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StoryExhibit } from "./types";
import { StoryExhibitView } from "./story-exhibits";
import { StorylineView } from "./StorylineView";
import { sampleStoryline } from "./test-fixture";

const publicIncome: StoryExhibit = {
  id: "money",
  actionTitle: "Space Coast Credit Union's published fee income",
  exhibit: {
    kind: "money_at_stake",
    title: "Fee income",
    rows: [
      { label: "Overdraft income", low: 100_000, high: 100_000, evidenceLevel: "institution" },
      { label: "All fee income", low: 200_000, high: 200_000, evidenceLevel: "institution" },
    ],
    sources: [{ label: "NCUA 5300", table: "institution_financial_records", url: "https://example.test/our-report" }],
  },
};

describe("money exhibit evidence identity", () => {
  it("names frozen research A's public filings independently of the account institution", () => {
    const html = renderToStaticMarkup(
      <StorylineView
        story={{ ...sampleStoryline(), exhibits: [publicIncome] }}
        identityContext={{ version: 1, researchInstitutionId: 1, researchInstitutionName: "Space Coast Credit Union", accountInstitutionId: 2, accountInstitutionName: "Account Bank", accountStatus: "identified" }}
      />,
    );
    expect(html.match(/Published figures: Space Coast Credit Union/g)).toHaveLength(2);
    expect(html).not.toContain("Your own figures");
    expect(html).not.toContain("Published figures: Account Bank");
    expect(html).toContain('href="https://example.test/our-report"');
  });

  it("uses a neutral public label for a legacy artifact with no frozen institution name", () => {
    const html = renderToStaticMarkup(<StoryExhibitView item={publicIncome} number={1} />);
    expect(html.match(/Published institution figures/g)).toHaveLength(2);
    expect(html).not.toContain("Your own figures");
  });

  it("keeps actual user-supplied figures labelled as the user's figures", () => {
    const item: StoryExhibit = { ...publicIncome, exhibit: { ...publicIncome.exhibit, sources: [{ label: "Figures you give Hamilton", table: "bank_memory" }] } };
    const html = renderToStaticMarkup(<StoryExhibitView item={item} number={1} researchInstitutionName="Space Coast Credit Union" />);
    expect(html.match(/Your own figures/g)).toHaveLength(2);
    expect(html).not.toContain("Published figures:");
  });

  it("shows filed income as amounts, without a plus sign", () => {
    const html = renderToStaticMarkup(<StoryExhibitView item={publicIncome} number={1} />);
    expect(html).toContain("$100,000");
    expect(html).toContain("$200,000");
    expect(html).not.toMatch(/\+\$/);
  });

  it("keeps the sign on modelled changes", () => {
    const item: StoryExhibit = {
      ...publicIncome,
      exhibit: {
        kind: "money_at_stake",
        title: "Fee income",
        rows: [
          { label: "At $30", low: 50_000, high: 50_000, evidenceLevel: "working_estimate" },
          { label: "At $25", low: -40_000, high: -20_000, evidenceLevel: "working_estimate" },
        ],
        sources: [{ label: "NCUA 5300", table: "institution_financial_records" }],
      },
    };
    const html = renderToStaticMarkup(<StoryExhibitView item={item} number={1} />);
    expect(html).toMatch(/\+\$50,000/);
  });

  it("names the researched institution in public archetype badges", () => {
    const item: StoryExhibit = { id: "archetype", actionTitle: "Published pricing models", exhibit: { kind: "archetype_map", title: "Models", ownKey: "mid", archetypes: [{ key: "mid", label: "Middle", rule: "Published fee", count: 4, names: [] }], sources: [] } };
    const html = renderToStaticMarkup(<StoryExhibitView item={item} number={1} researchInstitutionName="Space Coast Credit Union" />);
    expect(html.match(/Space Coast Credit Union/g)).toHaveLength(2);
    expect(html).not.toContain(">You<");
    expect(html).not.toContain(" · You");
  });
});

describe("peer list (#2033)", () => {
  // Invented institutions and fees for tests only.
  const list: StoryExhibit = {
    id: "list-peerList",
    actionTitle: "Overdraft fees of 3 peers, largest institutions first",
    exhibit: {
      kind: "peer_list",
      title: "Overdraft fees of 3 peers, largest institutions first",
      feeLabel: "Overdraft fee",
      rows: [
        { institutionId: 1, institutionName: "Example Valley Credit Union", stateCode: null, totalAssets: null, amount: 32, status: "published", documentUrl: "https://example.test/own.pdf", publishedAt: "2026-09-12", own: true },
        { institutionId: 2, institutionName: "Peer Two Credit Union", stateCode: "TN", totalAssets: 1_500_000, amount: 30, status: "published", documentUrl: "https://example.test/two.pdf", publishedAt: "2026-08-01" },
        { institutionId: 3, institutionName: "Peer Three Credit Union", stateCode: "TN", totalAssets: 900_000, amount: null, status: "not_on_schedule", documentUrl: null, publishedAt: null },
        { institutionId: 4, institutionName: "Peer Four Credit Union", stateCode: "TN", totalAssets: null, amount: null, status: "no_schedule", documentUrl: null, publishedAt: null },
      ],
      unlisted: 2,
      sources: [{ label: "Bank Fee Index, published fee schedules", table: "published_fee_catalog" }],
      note: "Peer group picked by Hamilton: Credit unions, Tennessee.",
    },
  };

  it("names every institution with its fee and source, or why it has none", () => {
    const html = renderToStaticMarkup(<StoryExhibitView item={list} number={1} />);
    for (const name of ["Peer Two Credit Union", "Peer Three Credit Union", "Peer Four Credit Union"]) expect(html).toContain(name);
    expect(html).toContain("$30");
    expect(html).toContain("$1.5B");
    expect(html).toContain('href="https://example.test/two.pdf"');
    expect(html).toContain("Not found on its schedule");
    expect(html).toContain("No schedule on file");
    expect(html).toContain("2 more peers in this group are not shown.");
    expect(html).toContain("Peer group picked by Hamilton");
  });

  it("leaves the readings section off a list answer", () => {
    const html = renderToStaticMarkup(<StorylineView story={{ ...sampleStoryline(), kind: "list", exhibits: [list], situation: [], complication: [], lenses: { finance: [], market: [] }, watch: [], options: undefined }} />);
    expect(html).not.toContain("What it means for you");
    expect(html).toContain("Peer Three Credit Union");
  });
});
