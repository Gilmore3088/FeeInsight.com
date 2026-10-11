/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LandingResearchResults } from "./LandingResearchResults";
import type { LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";

const selected: LandingResearchHandoff = {
  version: 1,
  task: "compare",
  scope: { kind: "state", stateCode: "DC" },
  charter: "credit_union",
  categories: ["paper_statement", "money_order"],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(selection: LandingResearchHandoff) {
  await act(async () => { root.render(createElement(LandingResearchResults, { selection })); });
}

async function clickRun() {
  const button = [...host.querySelectorAll("button")].find(el => el.textContent?.includes("Run comparison"));
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}

describe("landing research confirmation and explicit scope", () => {
  it("does not execute from the URL alone, and sends the exact state/charter/category scope only once on click", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        scope: { kind: "state", stateCode: "DC" },
        charter: "credit_union",
        categories: ["paper_statement", "money_order"],
        comparisons: [{
          category: "paper_statement",
          selected: { median: 2, institutions: 8, lastUpdated: "2026-10-10", status: "available" },
          national: { median: 3, institutions: 20, lastUpdated: "2026-10-10", status: "available" },
        }, {
          category: "money_order",
          selected: { median: 0, institutions: 8, lastUpdated: "2026-10-10", status: "available" },
          national: { median: 2, institutions: 20, lastUpdated: "2026-10-10", status: "available" },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await render(selected);
    expect(fetchMock).not.toHaveBeenCalled();
    await clickRun();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/hamilton/ask/market");
    expect(options.method).toBe("POST");
    expect(JSON.parse(String(options.body))).toEqual({ research: selected });
    const reportLink = [...host.querySelectorAll("a")].find(link => link.textContent?.includes("Prepare board report"));
    expect(reportLink).toBeDefined();
    const reportUrl = new URL(reportLink!.href);
    expect(reportUrl.pathname).toBe("/pro/reports");
    expect(JSON.parse(reportUrl.searchParams.get("research")!)).toEqual({ ...JSON.parse(String(options.body)).research, task: "board_report" });
    expect(host.textContent).toContain("$0.00");
    expect(host.textContent).toContain("2026-10-10");
  });

  it("removes a previous market's evidence on scope change rather than displaying it under the next selection", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        scope: { kind: "state", stateCode: "DC" },
        charter: "credit_union",
        categories: ["paper_statement", "money_order"],
        comparisons: [{
          category: "paper_statement",
          selected: { median: null, institutions: 0, lastUpdated: "2026-10-10", status: "not_observed" },
          national: null,
        }, {
          category: "money_order",
          selected: { median: 4, institutions: 7, lastUpdated: "2026-10-10", status: "available" },
          national: null,
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await render(selected);
    await clickRun();
    expect(host.textContent).toContain("$4.00");
    await render({ ...selected, scope: { kind: "state", stateCode: "WA" } });
    expect(host.textContent).toContain("WA fee comparison");
    expect(host.textContent).not.toContain("$4.00");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects evidence from another charter or state instead of showing wrong comparison", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        scope: { kind: "state", stateCode: "WA" },
        charter: "bank",
        categories: ["paper_statement", "money_order"],
        comparisons: selected.categories.map(category => ({
          category, selected: { median: 90, institutions: 20, status: "available" }, national: null,
        })),
      }),
    }));
    await render(selected);
    await clickRun();
    expect(host.textContent).toContain("did not match the selected research");
    expect(host.textContent).not.toContain("$90.00");
  });

  it("shows named local peers and requested fees without reporting missing values as zero", async () => {
    const local: LandingResearchHandoff = {
      ...selected, scope: { kind: "local", institutionId: 101 }, charter: "all",
      categories: ["paper_statement", "money_order"],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        institutionId: 101,
        charter: "all",
        institutionName: "Example Credit Union",
        market: { label: "Example County", basis: "branch_counties", sodYear: 2025, countyCount: 1 },
        you: { branches: 1, branchesInMarket: 1, fees: { paper_statement: 0 }, cities: [] },
        competitors: [{ institutionId: 102, name: "Peer Bank", charterType: "bank", branches: 2, deposits: null, fees: { money_order: 5 } }],
        categories: ["paper_statement", "money_order"],
        sources: [{ label: "FDIC Summary of Deposits", asOf: "2025-06-30" }],
        map: null,
        network: null,
        unmapped: 0,
        colours: {},
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await render(local);
    await clickRun();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      research: local,
    });
    expect(host.textContent).toContain("Peer Bank");
    expect(host.textContent).toContain("$0.00");
    expect(host.textContent).toContain("$5.00");
    expect(host.textContent).toContain("Not on file");
    expect(host.textContent).toContain("2025-06-30");
  });
});
