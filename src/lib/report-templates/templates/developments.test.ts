import { describe, expect, it } from "vitest";
import { developmentsContent, feeChangesContent, stateDevelopmentsContent } from "./developments";
import type { DevelopmentsBlock, FeeChangesBlock } from "@/lib/report-assemblers/developments";
import type { StateNews } from "@/lib/data-store/state-news";

const block: DevelopmentsBlock = {
  window_start: "2026-07-08",
  window_end: "2026-10-06",
  window_days: 90,
  items: [
    { date: "2026-10-02", agencies: ["FED"], title: "Federal Reserve Board issues enforcement action with Ontario Bancorporation", link: "https://www.federalreserve.gov/a", kind: "enforcement" },
    { date: "2026-09-11", agencies: ["FDIC", "OCC"], title: "Agencies Seek Comment on Proposed Guidance", link: "javascript:alert(1)", kind: "rulemaking" },
  ],
  by_agency: [{ agency: "FDIC", count: 1 }, { agency: "FED", count: 1 }, { agency: "OCC", count: 1 }],
  last_fetched: "2026-10-05T16:07:21.000Z",
};

const changes: FeeChangesBlock = {
  window_start: "2026-07-08",
  window_days: 90,
  not_confirmed: 3,
  changes: [
    { institution_name: "First Bank", state_code: "TX", charter_type: "bank", fee_category: "overdraft", display_name: "Overdraft", fee_name: "Overdraft fee", old_amount: 30, new_amount: 35, direction: "up", changed_at: "2026-09-01", schedule_url: null },
  ],
};

describe("developmentsContent", () => {
  it("groups releases by kind, links only http(s), and names both agencies", () => {
    const html = developmentsContent(block, "2026-10-06");
    expect(html).toContain("Enforcement actions (1)");
    expect(html).toContain('href="https://www.federalreserve.gov/a"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("FDIC, OCC");
  });

  it("says the feed is stale when it stopped updating", () => {
    expect(developmentsContent(block, "2026-11-30")).toContain("last updated October 5, 2026");
  });

  it("says so when nothing is stored or the read failed", () => {
    expect(developmentsContent({ ...block, items: [], by_agency: [] }, "2026-10-06")).toContain("No Federal Reserve, FDIC, OCC or CFPB releases");
    expect(developmentsContent(null, "2026-10-06")).toContain("were not read");
  });
});

describe("stateDevelopmentsContent", () => {
  it("states plainly when no release names the state and names the regulator", () => {
    const html = stateDevelopmentsContent(block, "Tennessee", { agency_name: "Tennessee Department of Financial Institutions", website_url: "https://www.tn.gov/tdfi", credit_union_agency_name: null, credit_union_website_url: null }, "2026-10-06");
    expect(html).toContain("None of the 2 federal agency releases");
    expect(html).toContain("Tennessee Department of Financial Institutions");
    expect(html).toContain("do not yet collect state regulator bulletins");
  });

  const regulator = { agency_name: "New York State Department of Financial Services", website_url: null, credit_union_agency_name: null, credit_union_website_url: null };
  const news: StateNews = {
    regulator_posts: [{ state_code: "NY", title: "DFS proposes overdraft fee rule for banks", link: "https://www.dfs.ny.gov/a", published_at: "2026-09-20", fee_related: true }],
    bills: [{ state_code: "NY", identifier: "A 3428", title: "Limits overdraft fees", stage: "in_committee", stage_on: "2026-03-02", url: "https://openstates.org/ny/a3428" }],
    press: [{ state_code: "NY", headline: "Albany weighs cap on bank overdraft fees", publisher: "Times Union", link: "https://news.google.com/x", published_at: "2026-09-25" }],
  };

  it("lists the state's regulator posts, fee bills and press stories, each labelled", () => {
    const html = stateDevelopmentsContent(block, "New York", regulator, "2026-10-06", news);
    expect(html).not.toContain("do not yet collect");
    expect(html).toContain("New York regulator posts (1)");
    expect(html).toContain("New York fee bills (1)");
    expect(html).toContain("A 3428: Limits overdraft fees");
    expect(html).toContain("In committee");
    expect(html).toContain("In the news (1)");
    expect(html).toContain("Times Union");
    expect(html).toContain("not the regulator's");
  });

  it("says so when the state has nothing stored or the read failed", () => {
    expect(stateDevelopmentsContent(block, "New York", regulator, "2026-10-06", { regulator_posts: [], bills: [], press: [] })).toContain(
      "No New York regulator posts or press stories",
    );
    expect(stateDevelopmentsContent(block, "New York", null, "2026-10-06", null)).toContain("were not read for this report");
  });
});

describe("feeChangesContent", () => {
  it("lists confirmed changes and the count left out", () => {
    const html = feeChangesContent(changes, { label: "U.S." });
    expect(html).toContain("1 confirmed price change");
    expect(html).toContain("3 recorded changes were left out");
    expect(html).toContain("First Bank");
  });

  it("filters to a state and says so when it has none", () => {
    expect(feeChangesContent(changes, { stateCode: "TN", label: "Tennessee" })).toContain("No confirmed fee price change at Tennessee institutions");
  });
});
