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

  it("names the researched institution in public archetype badges", () => {
    const item: StoryExhibit = { id: "archetype", actionTitle: "Published pricing models", exhibit: { kind: "archetype_map", title: "Models", ownKey: "mid", archetypes: [{ key: "mid", label: "Middle", rule: "Published fee", count: 4, names: [] }], sources: [] } };
    const html = renderToStaticMarkup(<StoryExhibitView item={item} number={1} researchInstitutionName="Space Coast Credit Union" />);
    expect(html.match(/Space Coast Credit Union/g)).toHaveLength(2);
    expect(html).not.toContain(">You<");
    expect(html).not.toContain(" · You");
  });
});
