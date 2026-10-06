import { describe, expect, it } from "vitest";
import { developmentsContent, feeChangesContent, stateDevelopmentsContent } from "./developments";
import type { DevelopmentsBlock, FeeChangesBlock } from "@/lib/report-assemblers/developments";

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
