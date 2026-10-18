import { describe, expect, it, vi } from "vitest";

import {
  checkMergerDecisions,
  companyNameKey,
  competitiveFigures,
  decisionKind,
  fedEventKey,
  fedFeedDate,
  fetchFedOrders,
  fetchOccMergerDecisions,
  occDecisionDate,
  orderPdfLink,
  parseFedFeed,
  partyName,
  readParties,
  type MergerDecision,
} from "./bank-merger-orders";

const FEED = [
  { d: "10/16/2026 4:15:00 PM", t: "Federal Reserve Board announces approval of application by Example Bancshares, Inc.", l: "/newsevents/pressreleases/orders20261016a.htm", pt: "Orders on Banking Applications" },
  { d: "10/15/2026 2:00:00 PM", t: "Federal Reserve issues FOMC statement", l: "/newsevents/pressreleases/monetary20261015a.htm", pt: "Monetary Policy" },
  { d: "3/2/2025 4:15:00 PM", t: "Federal Reserve Board announces denial of application by Sample Corporation", l: "/newsevents/pressreleases/orders20250302a.htm", pt: "Orders on Banking Applications" },
];

const RELEASE = `<html><body><h3>Federal Reserve Board announces approval of application by Example Bancshares, Inc.</h3>
<p>The Federal Reserve Board on Friday announced its approval of the application by Example Bancshares, Inc., of Columbus, Ohio, to acquire Lakeside Financial Corporation, of Toledo, Ohio, and thereby indirectly acquire Lakeside Bank.</p>
<p><a href="/newsevents/pressreleases/files/orders20261016a1.pdf">Board order (PDF)</a></p></body></html>`;

const ORDER_TEXT = `Competitive Considerations. Example Bank and Lakeside Bank compete directly in the Toledo, Ohio banking market. On consummation of the proposal, the HHI in the Toledo market would increase by 152 points to 1,874, and the combined organization would control approximately 18.4 percent of the total deposits of insured depository institutions in the market. The number of competitors would remain large.12 In the Lima banking market, Example Bank would become the largest depository organization, controlling 22.1 percent of deposits.`;

describe("merger decision parsing", () => {
  it("reads applicant and target from the release sentence", () => {
    const p = readParties(RELEASE.replace(/<[^>]+>/g, " "));
    expect(p.applicant).toBe("Example Bancshares, Inc");
    expect(p.target).toBe("Lakeside Financial Corporation");
    expect(p.sentence).toMatch(/^The Federal Reserve Board on Friday/);
  });

  it("reads an OCC 'with and into' merger with the survivor as applicant", () => {
    const p = readParties("This letter grants approval of the application to merge Small Town Bank, N.A., Dayton, Ohio with and into Big River Bank, National Association, Cincinnati, Ohio.");
    expect(p).toMatchObject({ applicant: "Big River Bank", target: "Small Town Bank" });
  });

  it("leaves parties null when no sentence names them", () => {
    expect(readParties("The Board approved a notice.")).toEqual({ applicant: null, target: null, sentence: null });
  });

  it("strips locations and share wording from party names", () => {
    expect(partyName("all of the voting shares of Lakeside Bank, of Toledo, Ohio")).toBe("Lakeside Bank");
    expect(partyName("X")).toBeNull();
  });

  it("takes HHI and deposit-share figures only from sentences that state them, kept verbatim", () => {
    const figs = competitiveFigures(ORDER_TEXT);
    expect(figs).toHaveLength(2);
    expect(figs[0]).toMatchObject({ market: "Toledo", hhi_change: 152, hhi_post: 1874, deposit_shares: [18.4] });
    expect(figs[0].sentence).toMatch(/^On consummation of the proposal, the HHI in the Toledo market would increase by 152 points to 1,874/);
    expect(figs[1]).toMatchObject({ market: "Lima", hhi_change: null, hhi_post: null, deposit_shares: [22.1] });
    expect(competitiveFigures("The proposal is consistent with approval.")).toEqual([]);
  });

  it("reads a decrease as a negative change", () => {
    expect(competitiveFigures("The HHI would decrease by 15 points to 990.")[0]).toMatchObject({ hhi_change: -15, hhi_post: 990 });
  });

  it("classifies decisions by their wording", () => {
    expect(decisionKind("announces approval of application")).toBe("approval");
    expect(decisionKind("Conditional Approval #1234")).toBe("conditional_approval");
    expect(decisionKind("announces denial of application")).toBe("denial");
    expect(decisionKind("Statement")).toBe("other");
  });

  it("reads the feed, keeps only orders and reports missing fields", () => {
    const out = parseFedFeed(FEED);
    expect(out.entries.map((e) => e.date)).toEqual(["2026-10-16", "2025-03-02"]);
    expect(out.missingFields).toEqual([]);
    expect(parseFedFeed([{ date: "x", title: "y" }]).missingFields).toEqual(["d", "t", "l", "pt"]);
    expect(fedFeedDate("10/16/2026 4:15:00 PM")).toBe("2026-10-16");
    expect(fedEventKey("https://www.federalreserve.gov/newsevents/pressreleases/orders20261016a.htm")).toBe("frb:orders20261016a");
  });

  it("finds the order PDF on a release page", () => {
    expect(orderPdfLink(RELEASE, "https://www.federalreserve.gov/newsevents/pressreleases/orders20261016a.htm")).toBe(
      "https://www.federalreserve.gov/newsevents/pressreleases/files/orders20261016a1.pdf",
    );
  });

  it("abbreviates legal-form words only", () => {
    expect(companyNameKey("Huntington Bancshares Incorporated")).toBe(companyNameKey("HUNTINGTON BANCSHARES INC"));
    expect(companyNameKey("First Example Corporation")).toBe("first example corp");
  });

  it("dates an OCC decision from its link, else its opening", () => {
    expect(occDecisionDate("Corporate Decision 2026-07, September 3, 2026", "")).toBe("2026-09-03");
    expect(occDecisionDate("CD 2026-07", "Comptroller of the Currency\nAugust 28, 2026\nRe: Application to merge")).toBe("2026-08-28");
    expect(occDecisionDate("CD", "no date")).toBeNull();
  });
});

describe("checkMergerDecisions", () => {
  const base: MergerDecision = {
    eventKey: "frb:a", agency: "frb", decisionDate: "2026-10-16", kind: "approval", title: "t", applicant: "A", target: "B",
    partiesSentence: null, documentUrl: "u", pageUrl: "p", pdfStatus: "read", competitive: [], raw: {},
  };
  it("reports gaps and impossible figures without changing anything", () => {
    const rows: MergerDecision[] = [
      base,
      { ...base, eventKey: "frb:a", target: null, decisionDate: "2030-01-01" },
      { ...base, eventKey: "frb:c", pdfStatus: "fetch_failed", competitive: [{ sentence: "s", market: null, hhi_change: 10, hhi_post: 12_000, deposit_shares: [140] }] },
    ];
    const out = checkMergerDecisions(rows, new Date("2026-10-17T00:00:00Z"));
    expect(out).toMatchObject({ rows: 3, duplicateKeys: 1, missingByField: { target: 1 }, withCompetitiveFigures: 1, pdfStatus: { read: 2, fetch_failed: 1 } });
    expect(out.impossibleDates).toEqual(["frb:a:2030-01-01"]);
    expect(out.impossibleFigures.map((f) => f.field)).toEqual(["hhi_post", "deposit_share"]);
    expect(rows[2].competitive[0].hhi_post).toBe(12_000);
  });
});

describe("fetchers", () => {
  const options = { backoffMs: 0, retries: 0 };

  it("lists a year's orders, reads the release, and marks an unreadable PDF as failed", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("ne-press.json")) return new Response(`﻿${JSON.stringify(FEED)}`, { status: 200 });
      if (u.endsWith("orders20261016a.htm")) return new Response(RELEASE, { status: 200 });
      if (u.endsWith(".pdf")) return new Response("not a pdf", { status: 200 });
      return new Response("nf", { status: 404 });
    }) as unknown as typeof fetch;
    const out = await fetchFedOrders(2026, { ...options, fetchImpl });
    expect(out.reason).toBeNull();
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]).toMatchObject({
      eventKey: "frb:orders20261016a",
      decisionDate: "2026-10-16",
      kind: "approval",
      applicant: "Example Bancshares, Inc",
      target: "Lakeside Financial Corporation",
      pdfStatus: "fetch_failed",
      documentUrl: "https://www.federalreserve.gov/newsevents/pressreleases/files/orders20261016a1.pdf",
    });
    expect(out.extra).toMatchObject({ orders_in_year: 1, already_stored: 0 });
  });

  it("skips orders already stored and defers past the document budget", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(FEED), { status: 200 })) as unknown as typeof fetch;
    const stored = await fetchFedOrders(2026, { ...options, fetchImpl, known: new Set(["frb:orders20261016a"]) });
    expect(stored).toMatchObject({ decisions: [], reason: "every order for the year is already stored" });
    const none = await fetchFedOrders(2026, { ...options, fetchImpl, maxDocuments: 0 });
    expect(none).toMatchObject({ decisions: [], deferred: 1 });
  });

  it("reports an OCC page that does not answer", async () => {
    const fetchImpl = vi.fn(async () => new Response("nf", { status: 404 })) as unknown as typeof fetch;
    const out = await fetchOccMergerDecisions({ ...options, fetchImpl });
    expect(out.decisions).toEqual([]);
    expect(out.reason).toMatch(/no OCC decision page answered \(http_404\)/);
  });
});
