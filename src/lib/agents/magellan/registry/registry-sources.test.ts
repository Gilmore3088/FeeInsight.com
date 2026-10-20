import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { runRegistryCfpb } from "./cfpb";
import { runRegistryFdicSod, latestSodYear } from "./fdic-sod";
import { beigeEmptyRetryHours, expectedLatestPeriod, FED_INDICATORS_PARSER_VERSION, frbPackageDue, runRegistryBeigeBook, runRegistryFomcMinutes, runRegistryFred } from "./fed";
import { STRUCK_FRED_SERIES } from "@/lib/data-store/struck-sources";
import { sdmxPackage } from "@/lib/regulatory/fed-board-fixtures";
import { PUBLISHER_INDICATORS } from "@/lib/regulatory/federal-indicators";
import { applyIdentityDecision, identityCandidatesFor, matchCompany, upsertIdentityLinks, type IdentityIndex } from "./identity";
import { REGISTRY_SOURCES, runRegistryStep } from "./index";
import { runRegistryNcuaFinancials } from "./ncua-financials";
import type { RegistryDb } from "./partitions";
import { cikBatch, runRegistrySecLinks } from "./sec";
import { runRegistryRegNews } from "./reg-news";
import { runRegistryFederalRegister } from "./federal-register";
import { runRegistryStateRegulators } from "./state-regulators";
import { runRegistryStateBills, runRegistryStateBillsBatch, STATE_BILLS_TAGGING_VERSION } from "./state-bills";
import { runRegistryFederalBills } from "./federal-bills";
import { runRegistryFedPublications } from "./fed-publications";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDb(handlers: Array<[string, (values: unknown[]) => unknown[]]>) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = templateText(strings);
    statements.push({ text, values });
    for (const [needle, handler] of handlers) if (text.includes(needle)) return Promise.resolve(handler(values));
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function payloadOf(values: unknown[]): Array<Record<string, unknown>> {
  return JSON.parse(String(values.find((v) => typeof v === "string" && v.startsWith("["))));
}

function index(entries: Array<[string, Array<{ id: number; hc: string | null; assets: number }>]>): IdentityIndex {
  return {
    byName: new Map(
      entries.map(([key, list]) => [
        key,
        list.map((c) => ({ id: c.id, name: key, holdingCompanyRssd: c.hc, assetSize: c.assets, via: "institution_name" as const })),
      ]),
    ),
  };
}

describe("identity matching", () => {
  it("accepts a unique name and a single parent's largest bank, and holds shared names for review", () => {
    const idx = index([
      ["JPMORGAN CHASE", [{ id: 1, hc: "1039502", assets: 4_000_000_000 }]],
      ["CAPITAL ONE", [{ id: 2, hc: "2277860", assets: 400_000_000 }, { id: 3, hc: "2277860", assets: 30_000_000 }]],
      ["FIRST STATE", [{ id: 4, hc: null, assets: 100_000 }, { id: 5, hc: "999", assets: 200_000 }]],
    ]);
    expect(matchCompany("JPMORGAN CHASE & CO.", idx)).toMatchObject({ institutionId: 1, status: "accepted", method: "exact_name" });
    expect(matchCompany("CAPITAL ONE FINANCIAL CORPORATION", idx)).toMatchObject({
      institutionId: 2,
      status: "accepted",
      method: "holding_company_largest_bank",
    });
    expect(matchCompany("First State Bank", idx)).toMatchObject({ institutionId: 5, status: "needs_review", method: "ambiguous_name" });
    expect(matchCompany("Unknown Lender LLC", idx)).toBeNull();
  });

  it("accepts a short name only for one large parent", () => {
    const idx = index([
      ["PNC", [{ id: 8, hc: "1069778", assets: 609_771_726 }]],
      ["TD", [{ id: 12, hc: "1238565", assets: 342_803_746 }, { id: 13, hc: "1238565", assets: 50_000_000 }]],
      ["DMB", [{ id: 20, hc: null, assets: 835_042 }]],
    ]);
    expect(matchCompany("PNC Bank N.A.", idx)).toMatchObject({ institutionId: 8, status: "accepted", method: "short_name_large_bank" });
    expect(matchCompany("TD BANK US HOLDING COMPANY", idx)).toMatchObject({ institutionId: 12, status: "accepted" });
    // A small bank sharing a short name with a debt-relief firm stays for review.
    expect(matchCompany("DMB Financial, LLC", idx)).toMatchObject({ status: "needs_review", method: "short_name" });
  });

  it("matches a full holding-company name before the loose name", () => {
    const bank = (id: number, hc: string, assets: number) => ({ id, name: "", holdingCompanyRssd: hc, assetSize: assets, via: "holding_company_name" as const });
    const idx: IdentityIndex = {
      ...index([["CITIZENS", [{ id: 18, hc: "1132449", assets: 232_517_438 }, { id: 300, hc: "777", assets: 2_000_000 }, { id: 301, hc: "778", assets: 1_500_000 }]]]),
      byHoldingName: new Map([
        ["CITIZENS FINANCIAL GROUP", [bank(18, "1132449", 232_517_438)]],
        ["FIRST CITIZENS BANCSHARES", [bank(17, "1075612", 236_317_000), bank(400, "555", 2_500_000)]],
        ["INDEPENDENT BANK", [bank(50, "1", 24_968_842), bank(51, "2", 5_000_000)]],
      ]),
    };
    expect(matchCompany("CITIZENS FINANCIAL GROUP, INC.", idx)).toMatchObject({ institutionId: 18, status: "accepted", method: "holding_company_full_name" });
    // Two parents share the name; the far larger one takes it.
    expect(matchCompany("FIRST CITIZENS BANCSHARES, INC.", idx)).toMatchObject({ institutionId: 17, method: "holding_company_dominant_parent" });
    // Comparable parents: no full-name match, and the loose name has no candidates.
    expect(matchCompany("INDEPENDENT BANK CORP.", idx)).toBeNull();
  });

  it("accepts a bank's own full name only when that bank dwarfs every other bank of the same name", () => {
    const bank = (id: number, name: string, hc: string | null, assets: number) => ({ id, name, holdingCompanyRssd: hc, assetSize: assets, via: "institution_name" as const });
    const idx: IdentityIndex = {
      byName: new Map([
        ["COMMERCE", [bank(70, "Commerce Bank", "1", 35_017_320), bank(71, "Commerce Bank", null, 762_489), bank(72, "Commerce Bank of Texas", null, 2_344_611)]],
        ["UNITED COMMUNITY", [bank(75, "United Community Bank", "2", 28_987_812), bank(76, "United Community Bank", "3", 4_129_042)]],
        ["WEST", [bank(80, "Bank of the West", null, 829_755), bank(81, "Bank of the West", null, 192_365), bank(82, "West Bank", "4", 4_029_129)]],
        ["FMS", [bank(90, "FMS Bank", null, 324_823), bank(91, "FMS Bank", null, 1_000)]],
      ]),
    };
    // Commerce Bank of Texas is a different full name, so only the two "Commerce Bank" charters compete.
    expect(matchCompany("COMMERCE BANK", idx)).toMatchObject({ institutionId: 70, status: "accepted", method: "exact_bank_name_dominant" });
    // Comparable banks of the same name, or a bank under $10B, stay for review.
    expect(matchCompany("UNITED COMMUNITY BANK", idx)).toMatchObject({ status: "needs_review", method: "ambiguous_name" });
    expect(matchCompany("BANK OF THE WEST", idx)).toMatchObject({ status: "needs_review", method: "ambiguous_name" });
    // A firm whose name is not a bank's full name never matches this way.
    expect(matchCompany("FMS Inc.", idx)).toMatchObject({ status: "needs_review" });
  });

  it("records a CFPB name with no bank word as not a match instead of waiting for review", () => {
    const bank = (id: number, name: string, assets: number) => ({ id, name, holdingCompanyRssd: null, assetSize: assets, via: "institution_name" as const });
    const idx: IdentityIndex = {
      byName: new Map([
        ["FMS", [bank(90, "FMS Bank", 324_823)]],
        ["FIDELITY", [bank(91, "The Fidelity Bank", 4_662_244), bank(92, "Fidelity Bank", 3_298_672)]],
        ["WEST", [bank(80, "Bank of the West", 829_755), bank(82, "West Bank", 4_029_129)]],
        ["STERLING", [bank(93, "Sterling Bank", 1_563_784), bank(94, "Sterling Bank", 461_880)]],
      ]),
    };
    const cfpb = { rejectNonBankNames: true };
    expect(matchCompany("FMS Inc.", idx, cfpb)).toMatchObject({ status: "rejected", method: "non_bank_name" });
    expect(matchCompany("Fidelity National Financial, Inc", idx, cfpb)).toMatchObject({ status: "rejected" });
    // A name with a bank word still waits for a person.
    expect(matchCompany("BANK OF THE WEST", idx, cfpb)).toMatchObject({ status: "needs_review" });
    expect(matchCompany("STERLING BANCORP", idx, cfpb)).toMatchObject({ status: "needs_review" });
    // SEC filers are banks by SIC code, so the SEC matcher never rejects this way.
    expect(matchCompany("FMS Inc.", idx)).toMatchObject({ status: "needs_review" });
  });

  it("sends a non-bank company that matched a small bank, or matched only after its generic words were stripped, to review (v5)", () => {
    const bank = (id: number, name: string, assets: number, via: "institution_name" | "holding_company_name" = "institution_name") =>
      ({ id, name, holdingCompanyRssd: null, assetSize: assets, via });
    const idx: IdentityIndex = {
      byName: new Map([
        ["PROGRESSIVE", [bank(3580, "Progressive National Bank", 300_000)]],
        ["NELNET", [bank(500, "Nelnet Bank", 1_500_000)]],
        ["AMERICA", [bank(1, "Bank of America, National Association", 2_500_000_000)]],
        ["SANTANDER", [bank(2, "Santander Bank, N.A.", 100_000_000)]],
        ["FIFTH THIRD", [bank(3, "Fifth Third Bank, National Association", 200_000_000)]],
        ["GOLDMAN SACHS", [bank(4, "Goldman Sachs Bank USA", 500_000_000)]],
      ]),
      byHoldingName: new Map([
        ["BERKSHIRE FINANCIAL SERVICES", [bank(1630, "Lee Bank", 591_159, "holding_company_name")]],
        ["SYNCHRONY FINANCIAL", [bank(29, "Synchrony Bank", 115_217_000, "holding_company_name")]],
      ]),
    };
    const cfpb = { rejectNonBankNames: true };
    for (const name of ["Progressive Financial Services, Inc.", "Nelnet, Inc.", "Financial Services of America", "Berkshire Financial Services, LLC"]) {
      expect(matchCompany(name, idx, cfpb)).toMatchObject({ status: "needs_review", method: "non_bank_name_review" });
    }
    // A $10B bank whose name leads the company's name, or whose parent's full name it is, keeps its complaints.
    expect(matchCompany("SANTANDER HOLDINGS USA, INC.", idx, cfpb)).toMatchObject({ institutionId: 2, status: "accepted" });
    expect(matchCompany("FIFTH THIRD FINANCIAL CORPORATION", idx, cfpb)).toMatchObject({ institutionId: 3, status: "accepted" });
    expect(matchCompany("SYNCHRONY FINANCIAL", idx, cfpb)).toMatchObject({ institutionId: 29, status: "accepted", method: "holding_company_full_name" });
    // A bank word keeps the old rule; the SEC matcher never downgrades this way.
    expect(matchCompany("GOLDMAN SACHS BANK USA", idx, cfpb)).toMatchObject({ institutionId: 4, status: "accepted" });
    expect(matchCompany("Progressive Financial Services, Inc.", idx)).toMatchObject({ status: "accepted" });
  });

  it("lists every candidate a name could belong to, by short name and by parent's full name, largest first", () => {
    const bank = (id: number, name: string, assets: number, via: "institution_name" | "holding_company_name" = "institution_name") =>
      ({ id, name, holdingCompanyRssd: null, assetSize: assets, via });
    const idx: IdentityIndex = {
      byName: new Map([["COMMERCE", [bank(1, "Commerce Bank", 30_000_000), bank(2, "Commerce Bank of Oregon", 500_000)]]]),
      byHoldingName: new Map([["COMMERCE BANCSHARES", [bank(1, "Commerce Bank", 30_000_000, "holding_company_name"), bank(3, "Commerce Trust", 900_000, "holding_company_name")]]]),
    };
    expect(identityCandidatesFor("Commerce Bank", idx).map((c) => c.id)).toEqual([1, 2]);
    expect(identityCandidatesFor("COMMERCE BANCSHARES", idx).map((c) => c.id)).toEqual(expect.arrayContaining([1, 3]));
    expect(identityCandidatesFor("Nobody Federal", idx)).toEqual([]);
  });
});

describe("identity link review decisions", () => {
  const reviewer = { id: 7, username: "james" };
  const linkRow = (overrides: Record<string, unknown> = {}) => ({ id: 41, link_type: "cfpb_company", external_key: "COMMERCE BANK", institution_id: 1, status: "needs_review", ...overrides });
  const reviewDb = (row: Record<string, unknown> | null, institutionExists = true) =>
    createDb([
      ["FROM institution_identity_links", () => (row ? [row] : [])],
      ["SELECT id FROM institution_sources", () => (institutionExists ? [{ id: 1 }] : [])],
    ]);
  const auditOf = (statements: Array<{ text: string; values: unknown[] }>) => {
    const insert = statements.find((s) => s.text.includes("INSERT INTO agent_events"));
    return insert ? { action: insert.values[0], entityId: insert.values[1], payload: JSON.parse(String(insert.values[2])) } : null;
  };

  it("never lets a matcher run overwrite a link a person decided", async () => {
    const { db, statements } = createDb([]);
    await upsertIdentityLinks(db, "cfpb_company", [{ externalKey: "X", externalName: "X", match: { institutionId: 1, confidence: 0.5, method: "ambiguous_name", status: "needs_review", candidates: 2 } }], 9);
    expect(statements[0].text).toContain("ON CONFLICT (link_type, external_key) DO UPDATE");
    expect(statements[0].text).toMatch(/WHERE institution_identity_links\.verified_by IS NULL\s*$/);
  });

  it("accepts a CFPB link re-pointed by hand, re-queues past years, and audits before and after", async () => {
    const { db, statements } = reviewDb(linkRow());
    const result = await applyIdentityDecision(db, { linkId: 41, decision: "accept", institutionId: 5, note: "Missouri parent", reviewer });
    expect(result).toEqual({
      linkId: 41,
      linkType: "cfpb_company",
      externalKey: "COMMERCE BANK",
      before: { institutionId: 1, status: "needs_review" },
      after: { institutionId: 5, status: "accepted" },
    });
    expect(statements[0].text).toContain("FOR UPDATE");
    const update = statements.find((s) => s.text.includes("UPDATE institution_identity_links"))!;
    expect(update.text).toContain("method = 'manual'");
    expect(update.text).toContain("confidence = 1");
    expect(update.values.slice(0, 2)).toEqual([5, "james"]);
    expect(JSON.parse(String(update.values[2]))).toMatchObject({ review_note: "Missouri parent", review_decision: "accept" });
    expect(statements.find((s) => s.text.includes("UPDATE registry_ingest_partitions"))?.values).toEqual(["cfpb"]);
    expect(statements.some((s) => s.text.includes("sec_cik"))).toBe(false);
    expect(auditOf(statements)).toMatchObject({
      action: "identity_link_accept",
      entityId: "41",
      payload: { reviewer_id: 7, reviewer: "james", before: { institutionId: 1, status: "needs_review" }, after: { institutionId: 5, status: "accepted" }, note: "Missouri parent" },
    });
  });

  it("moves sec_cik with an accepted SEC link and takes it off on reject", async () => {
    const accept = reviewDb(linkRow({ link_type: "sec_cik", external_key: "0000123" }));
    await applyIdentityDecision(accept.db, { linkId: 41, decision: "accept", reviewer });
    const secWrites = accept.statements.filter((s) => s.text.includes("sec_cik"));
    expect(secWrites[0]).toMatchObject({ text: expect.stringContaining("SET sec_cik = NULL WHERE sec_cik ="), values: ["0000123"] });
    expect(secWrites[1].text).toContain("holding_company_rssd = anchor.holding_company_rssd");
    expect(secWrites[1].values).toEqual(["0000123", 1]);

    const reject = reviewDb(linkRow({ link_type: "sec_cik", external_key: "0000123", status: "accepted" }));
    await applyIdentityDecision(reject.db, { linkId: 41, decision: "reject", note: "Different bank", reviewer });
    expect(reject.statements.filter((s) => s.text.includes("sec_cik"))).toHaveLength(1);
    expect(reject.statements.some((s) => s.text.includes("registry_ingest_partitions"))).toBe(false);
    expect(auditOf(reject.statements)?.payload).toMatchObject({ before: { status: "accepted" }, after: { institutionId: 1, status: "rejected" }, note: "Different bank" });
  });

  it("resets a decided link back to the matcher by clearing verified_by", async () => {
    const { db, statements } = reviewDb(linkRow({ status: "rejected" }));
    await applyIdentityDecision(db, { linkId: 41, decision: "reset", reviewer });
    const update = statements.find((s) => s.text.includes("UPDATE institution_identity_links"))!;
    expect(update.values.slice(0, 2)).toEqual(["needs_review", null]);
    expect(auditOf(statements)?.action).toBe("identity_link_reset");
  });

  it("writes nothing for a missing link, and refuses an accept with no institution to point at", async () => {
    const missing = reviewDb(null);
    await expect(applyIdentityDecision(missing.db, { linkId: 99, decision: "reject", reviewer })).resolves.toBeNull();
    expect(missing.statements).toHaveLength(1);

    const noTarget = reviewDb(linkRow({ institution_id: null }));
    await expect(applyIdentityDecision(noTarget.db, { linkId: 41, decision: "accept", reviewer })).rejects.toThrow(/Choose an institution/);
    const gone = reviewDb(linkRow(), false);
    await expect(applyIdentityDecision(gone.db, { linkId: 41, decision: "accept", institutionId: 404, reviewer })).rejects.toThrow(/not found/);
    expect(gone.statements.some((s) => /\bSET\b|INSERT/.test(s.text))).toBe(false);
  });
});

describe("registry CFPB worker", () => {
  it("links companies, sums breakdowns per institution, and replaces the year", async () => {
    const { db, statements } = createDb([
      [
        "FROM institution_sources\n     WHERE regulatory_status",
        () => [{ id: 7, institution_name: "JPMorgan Chase Bank, National Association", holding_company_name: "JPMORGAN CHASE&CO", holding_company_rssd: "1039502", asset_size: 4_000_000_000 }],
      ],
      ["FROM institution_identity_links", () => [{ external_key: "JPMORGAN CHASE & CO.", institution_id: 7 }]],
      ["INSERT INTO institution_complaint_records", (values) => payloadOf(values).map(() => ({}))],
    ]);
    const fetchImpl = vi.fn().mockImplementation(async (input: unknown) => {
      const url = new URL(String(input));
      if (!url.searchParams.get("company")) {
        return json({ aggregations: { company: { company: { buckets: [{ key: "JPMORGAN CHASE & CO.", doc_count: 24458 }, { key: "EQUIFAX, INC.", doc_count: 1 }] } } } });
      }
      if (url.searchParams.getAll("product").length > 0) {
        return json({
          hits: { total: { value: 14888 } },
          aggregations: {
            issue: {
              issue: {
                buckets: [
                  { key: "Managing an account", doc_count: 4000, "sub_issue.raw": { buckets: [{ key: "Fee problem", doc_count: 700 }, { key: "Banking errors", doc_count: 900 }] } },
                  { key: "Problem caused by your funds being low", doc_count: 1200 },
                ],
              },
            },
          },
        });
      }
      return json({
        hits: { total: { value: 24458 } },
        aggregations: {
          product: { product: { buckets: [{ key: "Checking or savings account", doc_count: 8937 }, { key: "Credit card", doc_count: 5951 }] } },
          issue: { issue: { buckets: [{ key: "Managing an account", doc_count: 4957 }] } },
        },
      });
    });

    const result = await runRegistryCfpb({ runId: 3, partitionKey: "2025", db, fetchOptions: { fetchImpl, backoffMs: 0 }, now: new Date("2026-10-03T00:00:00Z") });

    expect(result).toMatchObject({ companies: 2, acceptedCompanies: 1, institutions: 1, complaints: 24458, feeProductComplaints: 14888, subIssuesLoaded: true, rowsWritten: 7 });
    const feeCall = fetchImpl.mock.calls.map((c) => new URL(String(c[0]))).find((u) => u.searchParams.getAll("product").length > 0);
    expect(feeCall!.searchParams.getAll("product")).toContain("Checking or savings account");
    const link = statements.find((s) => s.text.includes("INSERT INTO institution_identity_links"));
    expect(payloadOf(link!.values)[0]).toMatchObject({ institution_id: 7, external_key: "JPMORGAN CHASE & CO.", status: "accepted" });
    // The whole year is replaced, not only the institutions touched.
    const del = statements.find((s) => s.text.includes("DELETE FROM institution_complaint_records"));
    expect(del!.text).not.toContain("institution_id IN");
    const insert = statements.find((s) => s.text.includes("INSERT INTO institution_complaint_records"));
    expect(payloadOf(insert!.values)).toEqual([
      { institution_id: 7, product: "Checking or savings account", issue: "_total", complaint_count: 8937 },
      { institution_id: 7, product: "Credit card", issue: "_total", complaint_count: 5951 },
      { institution_id: 7, product: "_all", issue: "Managing an account", complaint_count: 4957 },
      { institution_id: 7, product: "_fee_products", issue: "Managing an account", complaint_count: 4000 },
      { institution_id: 7, product: "_fee_products", issue: "Problem caused by your funds being low", complaint_count: 1200 },
      { institution_id: 7, product: "_fee_products_sub", issue: "Managing an account :: Fee problem", complaint_count: 700 },
      { institution_id: 7, product: "_fee_products_sub", issue: "Managing an account :: Banking errors", complaint_count: 900 },
    ]);
  });

  it("rejects a year outside the CFPB database", async () => {
    const { db } = createDb([]);
    await expect(runRegistryCfpb({ partitionKey: "2009", db })).rejects.toThrow("Invalid CFPB year");
  });
});

function ncuaZip(creditUnions: number) {
  const foicu = ["CU_NUMBER,CU_NAME,CITY,STATE,CU_TYPE"];
  const fs = ["CU_NUMBER,ACCT_010,ACCT_018,ACCT_025B,ACCT_661A"];
  for (let i = 1; i <= creditUnions; i += 1) {
    foicu.push(`${i},CU ${i},Town,TX,${i % 2 ? 1 : 2}`);
    fs.push(`${i},1000000,800000,600000,5000`);
  }
  return zipSync({ "FOICU.txt": strToU8(foicu.join("\n")), "FS220.txt": strToU8(fs.join("\n")) });
}

describe("registry NCUA worker", () => {
  it("upserts a historical quarter without touching the universe", async () => {
    const { db, statements } = createDb([["jsonb_to_recordset", () => [{ matched: 2, unmatched: 1 }]]]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(ncuaZip(3)));

    const result = await runRegistryNcuaFinancials({ runId: 9, partitionKey: "2018Q4", db, fetchOptions: { fetchImpl, backoffMs: 0 }, now: new Date("2026-10-03T00:00:00Z") });

    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://ncua.gov/files/publications/analysis/call-report-data-2018-12.zip");
    expect(result).toMatchObject({ parsedRows: 3, matchedRows: 2, unmatchedRows: 1, universeSynced: false });
    expect(statements.some((s) => s.text.includes("INSERT INTO institution_sources"))).toBe(false);
    const upsert = statements.find((s) => s.text.includes("INSERT INTO institution_financial_records"));
    expect(payloadOf(upsert!.values)[0]).toMatchObject({ cert: "1", total_assets: 1000, net_income: 5, agent_run_id: 9 });
  });

  it("never deactivates credit unions from a suspiciously small FOICU list", async () => {
    const { db, statements } = createDb([["jsonb_to_recordset", () => [{ matched: 3, unmatched: 0 }]]]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(ncuaZip(3)));

    const result = await runRegistryNcuaFinancials({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl, backoffMs: 0 }, now: new Date("2026-10-03T00:00:00Z") });

    expect(result.universeSynced).toBe(false);
    expect(statements.some((s) => s.text.includes("regulatory_status = 'inactive'"))).toBe(false);
  });

  it("records an unpublished quarter as empty", async () => {
    const { db, statements } = createDb([]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));

    const result = await runRegistryNcuaFinancials({ partitionKey: "2026Q3", db, fetchOptions: { fetchImpl, backoffMs: 0 } });

    expect(result.empty).toBe(true);
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    expect(partition?.values).toEqual(expect.arrayContaining(["ncua-financials", "2026Q3", "empty"]));
  });
});

describe("registry SOD worker", () => {
  it("upserts one year of branches", async () => {
    const { db, statements } = createDb([["INSERT INTO institution_branch_deposits", (values) => payloadOf(values).map(() => ({ matched: true }))]]);
    const fetchImpl = vi.fn().mockResolvedValue(
      json({ meta: { total: 2 }, data: [{ data: { CERT: 628, YEAR: 2025, BRNUM: 0, BKMO: 1, DEPSUMBR: 0 } }, { data: { CERT: 628, YEAR: 2025, BRNUM: 1003, DEPSUMBR: 267588 } }] }),
    );

    const result = await runRegistryFdicSod({ runId: 4, partitionKey: "2025", db, fetchOptions: { fetchImpl, backoffMs: 0 } });

    const sodUrl = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(sodUrl.searchParams.get("filters")).toBe("YEAR:2025");
    // The SOD index cannot sort on ID (HTTP 400); UNINUMBR is unique per branch, so paging is stable.
    expect(sodUrl.searchParams.get("sort_by")).toBe("UNINUMBR");
    expect(result).toMatchObject({ branches: 2, institutions: 1, upsertedBranches: 2, matchedBranches: 2, totalDeposits: 267588 });
    expect(statements.find((s) => s.text.includes("ON CONFLICT (cert, year, branch_number)"))).toBeDefined();
  });

  it("knows when the latest Summary of Deposits is published", () => {
    expect(latestSodYear(new Date("2026-08-15T00:00:00Z"))).toBe(2025);
    expect(latestSodYear(new Date("2026-10-03T00:00:00Z"))).toBe(2026);
  });
});

describe("registry SEC links worker", () => {
  it("links only filers whose SIC code is a bank", async () => {
    const { db, statements } = createDb([
      [
        "FROM institution_sources\n     WHERE regulatory_status",
        () => [{ id: 7, institution_name: "JPMorgan Chase Bank, National Association", holding_company_name: "JPMORGAN CHASE&CO", holding_company_rssd: "1039502", asset_size: 4_000_000_000 }],
      ],
      ["FROM institution_identity_links", () => [{ external_key: "19617", institution_id: 7 }]],
      ["UPDATE institution_sources s SET sec_cik", () => [{ id: 7 }, { id: 8 }]],
    ]);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("company_tickers_exchange")) {
        return json({ fields: ["cik", "name", "ticker", "exchange"], data: [[19617, "JPMORGAN CHASE & CO", "JPM", "NYSE"], [1, "Chase Industries", "CHI", "OTC"]] });
      }
      return json({ cik: "19617", name: "JPMORGAN CHASE & CO", sic: "6021", filings: { recent: {} } });
    });

    const result = await runRegistrySecLinks({ db, fetchOptions: { fetchImpl: fetchImpl as unknown as typeof fetch, backoffMs: 0 }, pauseMs: 0 });

    expect(result).toMatchObject({ listedFilers: 2, nameMatches: 1, bankFilers: 1, acceptedLinks: 1, institutionsTagged: 2 });
    const link = statements.find((s) => s.text.includes("INSERT INTO institution_identity_links"));
    expect(payloadOf(link!.values)[0]).toMatchObject({ external_key: "19617", institution_id: 7, detail: { ticker: "JPM", exchange: "NYSE", sic: "6021" } });
    expect(cikBatch("19617")).toBe(19617 % 8);
  });
});

describe("registry Federal Reserve workers", () => {
  it("records a month with no Beige Book after a single request", async () => {
    const { db, statements } = createDb([]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));

    const result = await runRegistryBeigeBook({ partitionKey: "202606", db, fetchOptions: { fetchImpl, backoffMs: 0 }, now: new Date("2026-10-03T00:00:00Z") });

    expect(result.empty).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    expect(partition?.values).toEqual(expect.arrayContaining(["beige-book", "202606", "empty"]));
    expect(beigeEmptyRetryHours("202606", new Date("2026-10-03T00:00:00Z"))).toBe(24 * 365);
    expect(beigeEmptyRetryHours("202610", new Date("2026-10-03T00:00:00Z"))).toBe(24 * 3);
  });

  it("refreshes indicators from their original publishers, never from FRED", async () => {
    vi.stubEnv("BEA_API_KEY", "bea-key");
    vi.stubEnv("BLS_API_KEY", "");
    const { db, statements } = createDb([
      [
        "FROM fed_economic_indicators",
        () => [
          { series_id: "UNRATE", series_title: "Unemployment", fed_district: null, units: "%" },
          { series_id: "NYFED_SOFR", series_title: "SOFR", fed_district: null, units: "%" },
          { series_id: "CUUR0100SEMC", series_title: "CPI: Professional Services, Northeast", fed_district: null, units: null },
          { series_id: "T10YIE", series_title: "Breakeven inflation", fed_district: null, units: "Percent" },
        ],
      ],
      ["publisher_cutover_at", () => []],
      ["SELECT NOW() AS now", () => [{ now: new Date("2026-10-18T12:00:00Z") }]],
    ]);
    const blsAsked: string[][] = [];
    const h15 = sdmxPackage("H15_H15", [{ name: "RIFSPFF_N.M", unitMult: "1", obs: [["2026-08", "4.33"], ["2026-09", "4.08"]] }]);
    const bea = {
      BEAAPI: {
        Results: {
          Data: [
            { TableName: "T10104", LineNumber: "1", LineDescription: "Gross domestic product", TimePeriod: "2026Q2", UNIT_MULT: "0", DataValue: "128.412" },
            { TableName: "T10104", LineNumber: "2", LineDescription: "Personal consumption expenditures", TimePeriod: "2026Q2", UNIT_MULT: "0", DataValue: "127.1" },
          ],
        },
      },
    };
    const fetchImpl = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("api.bls.gov")) {
        const ids = JSON.parse(String(init?.body)).seriesid as string[];
        blsAsked.push(ids);
        return json({ status: "REQUEST_SUCCEEDED", Results: { series: ids.map((id) => ({ seriesID: id, data: [{ year: "2026", period: "M08", value: "4.2" }, { year: "2025", period: "M13", value: "4.0" }] })) } });
      }
      if (u.endsWith("FRB_h15_xml.zip")) return new Response(Buffer.from(h15));
      if (u.startsWith("https://apps.bea.gov/api/data") && u.includes("TableName=T10104")) return json(bea);
      if (u.startsWith("https://apps.bea.gov/api/data")) return json({ BEAAPI: { Results: { Error: { APIErrorDescription: "Unknown table" } } } });
      return new Response("not found", { status: 404 });
    });

    const result = await runRegistryFred({ db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    vi.unstubAllEnvs();

    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => /stlouisfed|fredgraph/.test(u))).toBe(false);
    // Keyless BLS takes 25 series a request; every catalogue BLS id is asked once.
    expect(blsAsked.every((batch) => batch.length <= 25)).toBe(true);
    const askedIds = blsAsked.flat();
    expect(new Set(askedIds).size).toBe(askedIds.length);
    expect(askedIds).toEqual(expect.arrayContaining(["LNS14000000", "CUSR0000SA0", "LASST480000000000003", "SMS48000000000000001", "CUUR0100SEMC"]));
    // A FRED-only series stored earlier (T10YIE) and other loaders' series (NYFED_) are not fetched.
    const inserts = statements.filter((s) => s.text.includes("INSERT INTO fed_economic_indicators"));
    const inserted = inserts.map((s) => s.values[0]);
    expect(inserted).not.toContain("T10YIE");
    expect(inserted).not.toContain("NYFED_SOFR");
    expect(inserted).toEqual(expect.arrayContaining(["UNRATE", "CPIAUCSL", "TXUR", "TXNA", "FEDFUNDS", "GDPCTPI", "CUUR0100SEMC"]));
    expect(payloadOf(inserts.find((s) => s.values[0] === "FEDFUNDS")!.values)).toEqual([
      { observation_date: "2026-08-01", value: 4.33 },
      { observation_date: "2026-09-01", value: 4.08 },
    ]);
    expect(payloadOf(inserts.find((s) => s.values[0] === "GDPCTPI")!.values)).toEqual([{ observation_date: "2026-04-01", value: 128.412 }]);
    expect(payloadOf(inserts.find((s) => s.values[0] === "UNRATE")!.values)).toEqual([{ observation_date: "2026-08-01", value: 4.2 }]);
    // A stored medical series keeps refreshing but under its real name, older rows relabelled too.
    expect(inserts.find((s) => s.values[0] === "CUUR0100SEMC")!.values[1]).toBe("CPI: Medical Professional Services, Northeast");
    const relabel = statements.find((s) => s.text.includes("UPDATE fed_economic_indicators") && s.values.includes("CUUR0100SEMC"));
    expect(relabel?.values).toContain("CPI: Medical Professional Services, Northeast");
    // GDPC1 and PSAVERT: BEA answered with an error for their tables; named, not substituted.
    expect(result.missingSeries).toEqual(expect.arrayContaining([expect.stringMatching(/^GDPC1 \(bea: Unknown table\)$/), expect.stringMatching(/^PSAVERT \(bea: /)]));
    expect(result.refreshedSeries).toBe(result.series - result.missingSeries.length);
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
    const detail = JSON.parse(String(partition.values.find((v) => typeof v === "string" && v.startsWith("{"))));
    expect(detail).toMatchObject({ parser_version: FED_INDICATORS_PARSER_VERSION, publisher_cutover_at: "2026-10-18T12:00:00.000Z" });
    expect(detail.publishers.frb).toEqual({ series: 1, refreshed: 1 });
  });

  it("keeps the first cutover on later runs and reports missing BEA keys by name", async () => {
    vi.stubEnv("BEA_API_KEY", "");
    const { db, statements } = createDb([
      ["FROM fed_economic_indicators", () => []],
      ["publisher_cutover_at", () => [{ cutover: "2026-10-18T12:00:00.000Z" }]],
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response("down", { status: 404 }));
    const result = await runRegistryFred({ db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    vi.unstubAllEnvs();
    expect(statements.some((s) => s.text.includes("SELECT NOW()"))).toBe(false);
    expect(result.refreshedSeries).toBe(0);
    expect(result.missingSeries).toContain("GDPCTPI (bea: BEA_API_KEY is not set)");
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
    expect(String(partition.values.find((v) => typeof v === "string" && v.startsWith("{")))).toContain('"publisher_cutover_at":"2026-10-18T12:00:00.000Z"');
  });

  it("skips a recent H.15 download and names series still on FRED-era values", async () => {
    vi.stubEnv("BEA_API_KEY", "");
    const now = new Date("2026-10-20T12:00:00Z");
    const { db, statements } = createDb([
      ["publisher_cutover_at", () => [{ cutover: "2026-10-18T12:00:00.000Z", frb_fetched: { h15: "2026-10-20T06:00:00.000Z" } }]],
      // Rows written by a publisher since the cutover: FEDFUNDS (H.15) and UNRATE (BLS).
      ["GROUP BY series_id", () => [{ series_id: "FEDFUNDS", latest: "2026-09-01" }, { series_id: "UNRATE", latest: "2026-09-01" }]],
      [
        "FROM fed_economic_indicators",
        () => ["UNRATE", "FEDFUNDS", "GDPC1", "TXUR", "T10YIE"].map((id) => ({ series_id: id, series_title: id, fed_district: null, units: null })),
      ],
    ]);
    // Every request fails, so no BLS or BEA series gets a publisher row this run.
    const fetchImpl = vi.fn().mockImplementation(async () => new Response("down", { status: 404 }));
    const result = await runRegistryFred({ db, now, fetchOptions: { fetchImpl, backoffMs: 0 } });
    vi.unstubAllEnvs();

    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes("FRB_h15_xml.zip"))).toBe(false);
    expect(result.skippedPackages).toEqual(["H15 (downloaded within the last day)"]);
    expect(result.missingSeries.some((m) => m.startsWith("FEDFUNDS"))).toBe(false);
    // Stored, publisher-loaded, no publisher row yet: still served from FRED-era rows, and named.
    expect(result.stillOnFredEra).toEqual(["GDPC1", "TXUR"]);
    // UNRATE has a publisher row from an earlier run (its FRED-era rows are hidden); T10YIE is loaded by no publisher.
    expect(result.stillOnFredEra).not.toContain("UNRATE");
    expect(result.stillOnFredEra).not.toContain("T10YIE");
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
    const detail = JSON.parse(String(partition.values.find((v) => typeof v === "string" && v.startsWith("{"))));
    expect(detail.still_on_fred_era_values).toEqual(["GDPC1", "TXUR"]);
    expect(detail.frb_package_fetched_at).toEqual({ h15: "2026-10-20T06:00:00.000Z" });
    expect(detail.publisher_series).toEqual(expect.arrayContaining(["UNRATE", "FEDFUNDS", "GDPC1", "TXUR"]));
    expect(detail.publisher_series).not.toContain("T10YIE");
    expect(detail.publisher_series.some((id: string) => STRUCK_FRED_SERIES.includes(id))).toBe(false);
  });

  it("downloads a Fed Board package at most daily, daily while a new period is due, and otherwise weekly", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    expect(expectedLatestPeriod("monthly", now)).toBe("2026-10-01");
    expect(expectedLatestPeriod("quarterly", now)).toBe("2026-07-01");
    expect(expectedLatestPeriod("monthly", new Date("2026-01-15T00:00:00Z"))).toBe("2025-12-01");
    expect(frbPackageDue(null, [], now)).toEqual({ due: true, reason: "never downloaded" });
    // Within a day: never, even when October's FEDFUNDS is not in yet.
    expect(frbPackageDue("2026-11-03T01:00:00Z", [{ latest: "2026-09-01", frequency: "monthly" }], now).due).toBe(false);
    // Over a day and October is missing: fetch.
    expect(frbPackageDue("2026-11-02T06:00:00Z", [{ latest: "2026-09-01", frequency: "monthly" }], now)).toEqual({ due: true, reason: "a new period is due" });
    expect(frbPackageDue("2026-11-02T06:00:00Z", [{ latest: null, frequency: "monthly" }], now).due).toBe(true);
    // Up to date: wait for the weekly refresh.
    expect(frbPackageDue("2026-11-02T06:00:00Z", [{ latest: "2026-10-01", frequency: "monthly" }], now).due).toBe(false);
    expect(frbPackageDue("2026-10-27T06:00:00Z", [{ latest: "2026-10-01", frequency: "monthly" }], now)).toEqual({ due: true, reason: "weekly refresh" });
  });

  it("writes nothing on a dry run", async () => {
    const { db, statements } = createDb([["FROM fed_economic_indicators", () => []]]);
    const fetchImpl = vi.fn();
    const result = await runRegistryFred({ db, dryRun: true, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(result).toMatchObject({ dryRun: true, series: PUBLISHER_INDICATORS.length });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(statements.filter((s) => !s.text.includes("FROM fed_economic_indicators"))).toEqual([]);
  });
});

describe("publisher indicator catalogue", () => {
  it("covers unemployment and payroll jobs for the 50 states and DC from BLS, tagged with their Fed district", () => {
    const ids = PUBLISHER_INDICATORS.map((s) => s.series_id);
    expect(ids).toEqual(expect.arrayContaining(["GDPCTPI", "UNRATE", "FEDFUNDS", "CPIAUCSL", "CUUR0000SS68021"]));
    expect(ids.filter((id) => /^[A-Z]{2}UR$/.test(id))).toHaveLength(51);
    expect(ids.filter((id) => /^[A-Z]{2}NA$/.test(id))).toHaveLength(51);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PUBLISHER_INDICATORS.find((s) => s.series_id === "WYUR")).toMatchObject({ fed_district: 10, units: "Percent", publisher: "bls", publisher_id: "LASST560000000000003" });
    expect(PUBLISHER_INDICATORS.find((s) => s.series_id === "DCNA")).toMatchObject({
      series_title: "All Employees: Total Nonfarm in the District of Columbia",
      publisher_id: "SMS11000000000000001",
    });
    for (const s of PUBLISHER_INDICATORS) {
      if (s.publisher === "bls") expect(s.publisher_id).toMatch(/^(LNS|CES|CU[US]R|LASST|SMS)[0-9A-Z]+$/);
      expect(s.publisher_id.length).toBeGreaterThan(0);
    }
    expect(PUBLISHER_INDICATORS.filter((s) => STRUCK_FRED_SERIES.includes(s.series_id))).toEqual([]);
  });
});

describe("registry regulator news worker", () => {
  const rss = `<rss><channel>
    <item><title>Agencies issue final rule on overdraft fee disclosures</title><link>https://example.gov/a</link><guid>a-1</guid><pubDate>Mon, 05 Oct 2026 14:00:00 GMT</pubDate></item>
    <item><title><![CDATA[Board announces meeting]]></title><link>https://example.gov/b</link></item>
  </channel></rss>`;

  it("stores new press releases with a topic and records the partition", async () => {
    const { db, statements } = createDb([["INSERT INTO reg_articles", () => [{ guid: "a-1" }]]]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(rss));

    const result = await runRegistryRegNews({ db, feeds: { FED: "https://example.gov/feed" }, fetchOptions: { fetchImpl, backoffMs: 0 } });

    expect(result).toMatchObject({ fetched: 2, inserted: 1, failedFeeds: [] });
    const rows = payloadOf(statements.find((s) => s.text.includes("INSERT INTO reg_articles"))!.values);
    expect(rows[0]).toMatchObject({ guid: "a-1", source: "FED", topic: "overdraft", published_at: "2026-10-05T14:00:00.000Z" });
    expect(rows[1]).toMatchObject({ guid: "https://example.gov/b", title: "Board announces meeting", published_at: null });
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    expect(partition?.values).toEqual(expect.arrayContaining(["reg-news", "current", "succeeded"]));
  });

  it("fails the step when every feed fails", async () => {
    const { db } = createDb([]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response("gone", { status: 404 }));
    await expect(
      runRegistryRegNews({ db, feeds: { OCC: "https://example.gov/occ" }, fetchOptions: { fetchImpl, backoffMs: 0 } }),
    ).rejects.toThrow("Every regulator feed failed");
  });
});

describe("registry Federal Register worker", () => {
  const page = {
    count: 2,
    next_page_url: null,
    results: [
      {
        document_number: "2026-01234",
        title: "Overdraft fees at large institutions",
        type: "Proposed Rule",
        agencies: [{ slug: "consumer-financial-protection-bureau", name: "Consumer Financial Protection Bureau" }],
        publication_date: "2026-09-01",
        comments_close_on: "2026-11-01",
        html_url: "https://www.federalregister.gov/d/2026-01234",
        cfr_references: [{ title: 12, part: 1005 }],
      },
      {
        document_number: "2026-05678",
        title: "Assessments",
        type: "Rule",
        agencies: [{ slug: "federal-deposit-insurance-corporation", name: "Federal Deposit Insurance Corporation" }],
        publication_date: "2026-08-01",
        effective_on: "2027-01-01",
        html_url: "https://www.federalregister.gov/d/2026-05678",
      },
    ],
  };
  const now = new Date("2026-10-07T03:00:00Z");

  it("counts stages but stores nothing in shadow mode", async () => {
    const { db, statements } = createDb([]);
    const fetchImpl = vi.fn().mockResolvedValue(json(page));
    const result = await runRegistryFederalRegister({ db, now, live: false, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(result).toMatchObject({ fetched: 2, stored: 0, shadow: true, fee_related: 1, since: "2025-09-02" });
    expect(result.stages).toEqual({ comment_open: 1, comment_closed: 0, final_not_yet_effective: 1, in_effect: 0 });
    expect(result.agencies).toEqual({ CFPB: 1, FDIC: 1 });
    expect(statements.some((s) => s.text.includes("INSERT INTO reg_tracker_items"))).toBe(false);
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    expect(partition?.values).toEqual(expect.arrayContaining(["federal-register", "current", "succeeded"]));
  });

  it("upserts the rules when live", async () => {
    const { db, statements } = createDb([["INSERT INTO reg_tracker_items", (values) => payloadOf(values).map((r) => ({ external_id: r.document_number }))]]);
    const fetchImpl = vi.fn().mockResolvedValue(json(page));
    const result = await runRegistryFederalRegister({ db, now, live: true, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(result.stored).toBe(2);
    const rows = payloadOf(statements.find((s) => s.text.includes("INSERT INTO reg_tracker_items"))!.values);
    expect(rows[0]).toMatchObject({ document_number: "2026-01234", kind: "proposed_rule", agencies: ["CFPB"], cfr_parts: ["12 CFR 1005"] });
  });
});

describe("registry FOMC minutes worker", () => {
  const calendar = '<a href="/monetarypolicy/fomcminutes20260729.htm">Minutes</a> <a href="/monetarypolicy/fomcminutes20260617.htm">Minutes</a>';
  const minutes = `<div id="article"><h3>Minutes of the Federal Open Market Committee</h3><p>${"Participants discussed. ".repeat(400)}</p></div><h6>footer</h6>`;

  it("pulls minutes it does not have yet and skips pages that don't parse", async () => {
    const { db, statements } = createDb([
      ["FROM fed_fomc_minutes", () => [{ meeting_date: "2026-06-17" }]],
      ["INSERT INTO fed_fomc_minutes", (values) => payloadOf(values).map((r) => ({ meeting_date: r.meeting_date }))],
    ]);
    const fetchImpl = vi.fn().mockImplementation(async (url: string) =>
      new Response(url.endsWith("fomccalendars.htm") ? calendar : minutes, { status: 200 }),
    );
    const result = await runRegistryFomcMinutes({ db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(result).toMatchObject({ linked: 2, alreadyStored: 1, fetched: 1, stored: 1, remaining: 0, tooShort: [] });
    expect(fetchImpl).toHaveBeenCalledWith("https://www.federalreserve.gov/monetarypolicy/fomcminutes20260729.htm", expect.anything());
    const rows = payloadOf(statements.find((s) => s.text.includes("INSERT INTO fed_fomc_minutes"))!.values);
    expect(rows[0]).toMatchObject({ meeting_date: "2026-07-29", title: "Minutes of the Federal Open Market Committee" });
    expect(String(rows[0].content_text)).not.toContain("footer");
  });
});

describe("registry regional Fed publications worker", () => {
  const index = `<ul>
    <li><a href="/rss/frbatl">Federal Reserve Bank of Atlanta</a></li>
    <li><a href="https://fedinprint.org/rss/frbchi.rss">Federal Reserve Bank of Chicago</a></li>
    <li><a href="/series/frbatl">Atlanta series (not a feed)</a></li>
  </ul>`;
  const rss = (bank: string) => `<rss><channel>
    <item><title>${bank} research note</title><link>https://example.org/${bank}/1</link><pubDate>Mon, 05 Oct 2026 12:00:00 GMT</pubDate></item>
    <item><title>${bank} regional report</title><link>https://example.org/${bank}/2</link></item>
  </channel></rss>`;

  it("reads the feeds the Fed in Print page links, falls back to a bank's own feed, and reports banks with none", async () => {
    const { db, statements } = createDb([
      ["INSERT INTO fed_publications", (values) => payloadOf(values).map((r) => ({ link: r.link }))],
    ]);
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (url === "https://fedinprint.org/rss") return new Response(index, { status: 200 });
      if (url === "https://fedinprint.org/rss/frbatl") return new Response(rss("atl"), { status: 200 });
      if (url === "https://fedinprint.org/rss/frbchi.rss") return new Response(rss("chi"), { status: 200 });
      if (url === "https://www.dallasfed.org/rss/speeches") return new Response(rss("dal"), { status: 200 });
      return new Response("gone", { status: 404 });
    });
    const result = await runRegistryFedPublications({ db, fetchOptions: { fetchImpl, backoffMs: 0, retries: 0 } });
    expect(result).toMatchObject({ indexReachable: true, fetched: 6, inserted: 6 });
    expect(result.byBank).toMatchObject({ Atlanta: 2, Chicago: 2, Dallas: 2, Boston: 0 });
    expect(result.banksWithoutItems).toContain("Philadelphia (no feed found)");
    expect(result.banksWithoutItems).toContain("Boston");
    expect(fetchImpl).not.toHaveBeenCalledWith("https://www.atlantafed.org/rss/speechindex", expect.anything());
    const rows = payloadOf(statements.find((s) => s.text.includes("INSERT INTO fed_publications"))!.values);
    expect(rows.find((r) => r.link === "https://example.org/atl/1")).toMatchObject({ district: 6, bank: "Atlanta", feed_url: "https://fedinprint.org/rss/frbatl" });
  });

  it("fails the step when no feed at all can be read", async () => {
    const { db } = createDb([]);
    const fetchImpl = vi.fn().mockImplementation(async () => new Response("down", { status: 503 }));
    await expect(runRegistryFedPublications({ db, fetchOptions: { fetchImpl, backoffMs: 0, retries: 0 } })).rejects.toThrow(/No Reserve Bank feed/);
  });
});

describe("registry federal bills worker", () => {
  const now = new Date("2026-10-07T03:00:00Z");
  const page = {
    pagination: { count: 2 },
    bills: [
      { congress: 119, number: "1234", type: "HR", title: "Overdraft Protection Act of 2025", latestAction: { actionDate: "2025-03-01", text: "Referred to the House Committee on Financial Services." } },
      { congress: 119, number: "9", type: "S", title: "Farm credit modernization", latestAction: { actionDate: "2025-04-01", text: "Passed Senate." } },
    ],
  };

  it("skips without a key", async () => {
    const { db, statements } = createDb([]);
    const fetchImpl = vi.fn();
    const result = await runRegistryFederalBills({ db, now, apiKey: null, fetchOptions: { fetchImpl } });
    expect(result.missingKey).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))?.values).toEqual(
      expect.arrayContaining(["federal-bills", "current", "empty"]),
    );
  });

  it("keeps bank fee bills, sends the key as a header, and stores nothing in shadow mode", async () => {
    const { db, statements } = createDb([]);
    const fetchImpl = vi.fn().mockImplementation(async () => json(page));
    const result = await runRegistryFederalBills({ db, now, apiKey: "k", live: false, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(result).toMatchObject({ congress: 119, scanned: 2, fetched: 1, stored: 0, requests: 1, shadow: true });
    expect(result.stages.in_committee).toBe(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.congress.gov/v3/bill/119?format=json&limit=250&offset=0");
    expect((init as RequestInit).headers).toMatchObject({ "X-Api-Key": "k" });
    expect(statements.some((s) => s.text.includes("INSERT INTO reg_tracker_items"))).toBe(false);
  });

  it("upserts bills when live", async () => {
    const { db, statements } = createDb([["INSERT INTO reg_tracker_items", (values) => payloadOf(values).map((r) => ({ external_id: r.id }))]]);
    const fetchImpl = vi.fn().mockImplementation(async () => json(page));
    const result = await runRegistryFederalBills({ db, now, apiKey: "k", live: true, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(result.stored).toBe(1);
    const rows = payloadOf(statements.find((s) => s.text.includes("INSERT INTO reg_tracker_items"))!.values);
    expect(rows[0]).toMatchObject({
      id: "119-hr-1234",
      identifier: "H.R. 1234",
      url: "https://www.congress.gov/bill/119th-congress/house-bill/1234",
      stage: "in_committee",
    });
  });
});

describe("registry state bills worker", () => {
  const now = new Date("2026-10-07T03:00:00Z");
  const bill = {
    id: "ocd-bill/1",
    session: "2025-2026",
    identifier: "AB 1",
    title: "Overdraft and insufficient funds fees",
    openstates_url: "https://openstates.org/ca/bills/20252026/AB1/",
    first_action_date: "2026-01-05",
    latest_action_date: "2026-05-01",
    actions: [
      { date: "2026-01-05", classification: ["introduction"], organization: { classification: "lower" } },
      { date: "2026-02-01", classification: ["referral-committee"], organization: { classification: "lower" } },
      { date: "2026-05-01", classification: ["passage"], organization: { classification: "lower" } },
    ],
  };
  const hotel = { ...bill, id: "ocd-bill/2", identifier: "SB 2", title: "Hotel junk fees", actions: [] };
  const page = { results: [bill, hotel], pagination: { max_page: 1 } };

  it("records a missing key without fetching", async () => {
    const { db, statements } = createDb([]);
    const fetchImpl = vi.fn();
    const result = await runRegistryStateBills({ partitionKey: "ca", db, now, apiKey: "", requestIntervalMs: 0, fetchOptions: { fetchImpl } });
    expect(result).toMatchObject({ missingKey: true, fetched: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    expect(partition?.values).toEqual(expect.arrayContaining(["state-bills", "CA", "empty"]));
  });

  it("sends the key as a header, keeps bank fee bills only, and stores nothing in shadow mode", async () => {
    const { db, statements } = createDb([]);
    const fetchImpl = vi.fn().mockImplementation(async () => json(page));
    const result = await runRegistryStateBills({ partitionKey: "CA", db, now, apiKey: "k", live: false, requestIntervalMs: 0, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(result).toMatchObject({ fetched: 1, stored: 0, shadow: true, requests: 3 });
    expect(result.stages.passed_chamber).toBe(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).not.toContain("k&");
    expect(String(url)).toContain("state%3Aca");
    expect((init as RequestInit).headers).toMatchObject({ "X-API-KEY": "k" });
    expect(statements.some((s) => s.text.includes("INSERT INTO reg_tracker_items"))).toBe(false);
  });

  it("probes a state with no search hits and records no source data when Open States holds no bill text (#1427)", async () => {
    for (const [textHits, coverage] of [
      [0, "no_source_data"],
      [140, "no_fee_bills"],
    ] as const) {
      const { db, statements } = createDb([]);
      const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
        const q = new URL(String(url)).searchParams.get("q");
        if (q === "act or ley") return json({ results: [], pagination: { max_page: 1, total_items: textHits } });
        return json(String(url).includes("action_since") ? { results: [], pagination: { max_page: 1 } } : { results: [], pagination: { max_page: 1, total_items: 11 } });
      });
      const result = await runRegistryStateBills({ partitionKey: "VA", db, now, apiKey: "k", live: true, requestIntervalMs: 0, fetchOptions: { fetchImpl, backoffMs: 0 } });
      expect(result).toMatchObject({ searched: 0, fetched: 0, requests: 5, coverage });
      const anyDateUrl = String(fetchImpl.mock.calls[3][0]);
      expect(anyDateUrl).not.toContain("action_since");
      expect(anyDateUrl).toContain("q=overdraft");
      // The text probe covers the same window as the fee searches.
      expect(new URL(String(fetchImpl.mock.calls[4][0])).searchParams.get("action_since")).toBe(result.since);
      const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
      const detail = JSON.parse(partition?.values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
      expect(detail).toMatchObject({ searched: 0, any_date_overdraft_hits: 11, searchable_text_hits: textHits, coverage });
      expect(Boolean(detail.no_source_data)).toBe(coverage === "no_source_data");
    }
  });

  it("searches Puerto Rico in Spanish and keeps a Spanish overdraft fee bill (#1427)", async () => {
    const { db } = createDb([]);
    const pr = {
      ...bill,
      id: "ocd-bill/pr1",
      identifier: "PC 100",
      title: "Para prohibir a los bancos y cooperativas cobrar cargos por sobregiro en cuentas de depósito",
    };
    const fetchImpl = vi.fn().mockImplementation(async () => json({ results: [pr], pagination: { max_page: 1 } }));
    const result = await runRegistryStateBills({ partitionKey: "PR", db, now, apiKey: "k", live: false, requestIntervalMs: 0, fetchOptions: { fetchImpl, backoffMs: 0 } });
    const queries = fetchImpl.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("q"));
    expect(queries).toEqual(["sobregiro", "fondos insuficientes", "cargos bancarios"]);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("territory%3Apr");
    expect(result).toMatchObject({ fetched: 1, coverage: "fee_hits" });
  });

  it("skips the extra request when the searches found bills", async () => {
    const { db, statements } = createDb([]);
    const fetchImpl = vi.fn().mockImplementation(async () => json(page));
    await runRegistryStateBills({ partitionKey: "CA", db, now, apiKey: "k", live: false, requestIntervalMs: 0, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    const detail = partition?.values.find((v) => typeof v === "string" && v.startsWith("{")) as string;
    expect(JSON.parse(detail)).not.toHaveProperty("any_date_overdraft_hits");
  });

  it("upserts bills with their stage when live", async () => {
    const { db, statements } = createDb([["INSERT INTO reg_tracker_items", (values) => payloadOf(values).map((r) => ({ external_id: r.id }))]]);
    const fetchImpl = vi.fn().mockImplementation(async () => json(page));
    const result = await runRegistryStateBills({ partitionKey: "CA", db, now, apiKey: "k", live: true, requestIntervalMs: 0, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(result.stored).toBe(1);
    const rows = payloadOf(statements.find((s) => s.text.includes("INSERT INTO reg_tracker_items"))!.values);
    expect(rows[0]).toMatchObject({ id: "ocd-bill/1", state_code: "CA", stage: "passed_chamber", stage_date: "2026-05-01" });
  });

  it("clears the topics of a stored bill the bank fee test now rejects, without deleting it", async () => {
    const { db, statements } = createDb([
      ["INSERT INTO reg_tracker_items", (values) => payloadOf(values).map((r) => ({ external_id: r.id }))],
      ["UPDATE reg_tracker_items", () => [{ external_id: "ocd-bill/9" }]],
    ]);
    const water = { ...bill, id: "ocd-bill/9", identifier: "AB 1520", title: "Public resources: conservation.", abstracts: [{ abstract: "Critically overdrafted basins." }] };
    const fetchImpl = vi.fn().mockImplementation(async () => json({ results: [bill, water], pagination: { max_page: 1 } }));
    const result = await runRegistryStateBills({ partitionKey: "CA", db, now, apiKey: "k", live: true, requestIntervalMs: 0, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(result).toMatchObject({ fetched: 1, stored: 1, untagged: 1 });
    const update = statements.find((s) => s.text.includes("UPDATE reg_tracker_items"));
    expect(update?.text).toContain("topics = '{}'");
    expect(update?.values).toEqual(expect.arrayContaining(["CA", ["ocd-bill/9"]]));
    expect(statements.some((s) => /DELETE/i.test(s.text))).toBe(false);
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    const detail = partition?.values.find((v) => typeof v === "string" && v.startsWith("{")) as string;
    expect(JSON.parse(detail)).toMatchObject({
      tagging_version: STATE_BILLS_TAGGING_VERSION,
      untagged: 1,
      rejected_sample: { "AB 1520": "Public resources: conservation." },
    });
  });

  it("re-reads states whose stored bills were tagged under older rules", async () => {
    const { db, statements } = createDb([["FROM registry_ingest_partitions", () => []]]);
    const fetchImpl = vi.fn().mockImplementation(async () => json(page));
    await runRegistryStateBillsBatch({ db, now, apiKey: "k", live: true, statesPerRun: 1, requestIntervalMs: 0, fetchOptions: { fetchImpl, backoffMs: 0, retries: 0 } });
    const dueQuery = statements.find((s) => s.text.includes("FROM registry_ingest_partitions") && s.text.includes("next_attempt_after > NOW()"));
    expect(dueQuery?.text).toContain("detail->>'tagging_version'");
    expect(dueQuery?.values).toContain(STATE_BILLS_TAGGING_VERSION);
  });

  it("reads the next states that are due in one run and records each state plus the batch", async () => {
    const { db, statements } = createDb([["FROM registry_ingest_partitions", () => [{ partition_key: "AK" }, { partition_key: "AL" }]]]);
    const fetchImpl = vi.fn().mockImplementation(async (url: string) =>
      String(url).includes("state%3Aaz") ? new Response("nope", { status: 400 }) : json(page),
    );
    const result = await runRegistryStateBillsBatch({ db, now, apiKey: "k", live: false, statesPerRun: 3, requestIntervalMs: 0, fetchOptions: { fetchImpl, backoffMs: 0, retries: 0 } });
    expect(result.states).toEqual(["AR", "AZ", "CA"]);
    expect(result.failedStates).toEqual(["AZ"]);
    expect(result).toMatchObject({ fetched: 2, remaining: 52 - 2 - 3 });
    const partitions = statements.filter((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    expect(partitions.map((s) => s.values[1])).toEqual(["AR", "AZ", "CA", "current"]);
    expect(partitions[1].values).toEqual(expect.arrayContaining(["state-bills", "AZ", "failed"]));
  });

  it("treats states last read in shadow mode as due once the tracker is live", async () => {
    for (const live of [true, false]) {
      const { db, statements } = createDb([["FROM registry_ingest_partitions", () => []]]);
      const fetchImpl = vi.fn().mockImplementation(async () => json(page));
      await runRegistryStateBillsBatch({ db, now, apiKey: "k", live, statesPerRun: 1, requestIntervalMs: 0, fetchOptions: { fetchImpl, backoffMs: 0, retries: 0 } });
      const dueQuery = statements.find((s) => s.text.includes("FROM registry_ingest_partitions") && s.text.includes("next_attempt_after > NOW()"));
      expect(dueQuery?.text).toContain("detail->>'shadow'");
      // The run's own shadow flag decides whether shadow-only reads still count as fresh.
      expect(dueQuery?.values).toContain(!live);
    }
  });

  it("stops at a 429 and leaves that state due instead of failing it", async () => {
    const { db, statements } = createDb([["FROM registry_ingest_partitions", () => []]]);
    const fetchImpl = vi.fn().mockImplementation(async (url: string) =>
      String(url).includes("state%3Aal") ? new Response("slow down", { status: 429 }) : json(page),
    );
    const result = await runRegistryStateBillsBatch({ db, now, apiKey: "k", live: false, statesPerRun: 4, requestIntervalMs: 0, fetchOptions: { fetchImpl, backoffMs: 0, retries: 0 } });
    expect(result).toMatchObject({ states: ["AK"], failedStates: [], rateLimited: true, remaining: 51 });
    const partitions = statements.filter((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    expect(partitions.map((s) => s.values[1])).toEqual(["AK", "current"]);
  });

  it("starts no new state after the time cutoff", async () => {
    const { db } = createDb([["FROM registry_ingest_partitions", () => []]]);
    const fetchImpl = vi.fn().mockImplementation(async () => json(page));
    let t = 0;
    const clock = () => (t += 40_000);
    const result = await runRegistryStateBillsBatch({ db, now, apiKey: "k", live: false, startCutoffMs: 60_000, clock, requestIntervalMs: 0, fetchOptions: { fetchImpl, backoffMs: 0, retries: 0 } });
    expect(result.states).toEqual(["AK", "AL"]);
    expect(result.remaining).toBe(50);
  });

  it("fails the run when every state in it fails", async () => {
    const { db } = createDb([]);
    const fetchImpl = vi.fn().mockImplementation(async () => new Response("bad key", { status: 401 }));
    await expect(
      runRegistryStateBillsBatch({ db, now, apiKey: "k", statesPerRun: 2, requestIntervalMs: 0, fetchOptions: { fetchImpl, backoffMs: 0, retries: 0 } }),
    ).rejects.toThrow(/Every state in this run failed/);
  });
});

describe("registry state regulators worker", () => {
  it("upserts all 51 agencies and tags credit unions", async () => {
    const { db, statements } = createDb([["UPDATE institution_sources", () => [{ id: 1 }]]]);
    const result = await runRegistryStateRegulators({ db });
    expect(result).toMatchObject({ agencies: 51, creditUnionsTagged: 1 });
    expect(payloadOf(statements.find((s) => s.text.includes("INSERT INTO state_regulators"))!.values)).toHaveLength(51);
  });
});

describe("registry dispatch", () => {
  it("defines one unique registry-* step per source", () => {
    const keys = REGISTRY_SOURCES.map((s) => s.stepKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => key.startsWith("registry-"))).toBe(true);
    expect(REGISTRY_SOURCES.map((s) => s.source)).toEqual([
      "fdic-universe",
      "fdic-financials",
      "ncua-financials",
      "ffiec-overdraft",
      "ffiec-call-detail",
      "ncua-extras",
      "fdic-history",
      "cfpb-card-agreements",
      "ubpr-peer-groups",
      "fr-y9c",
      "nic-structure",
      "cra",
      "designation-lists",
      "hmda",
      "hmda-apor",
      "payment-networks",
      "industry-events",
      "fdic-sod",
      "ncua-branches",
      "ncua-branch-geocode",
      "cfpb",
      "census-acs",
      "irs-zip-income",
      "usda-rucc",
      "ffiec-census-tracts",
      "branch-census-tracts",
      "urban-rural-fill",
      "bls-qcew",
      "census-cbp",
      "census-saipe",
      "bea-personal-income",
      "fhfa-hpi",
      "fdic-household-survey",
      "fed-shed",
      "fdic-industry-totals",
      "fdic-national-rates",
      "world-bank-remittance-prices",
      "hud-zip-county",
      "census-permits",
      "census-popest",
      "irs-migration",
      "census-bfs",
      "bls-laus",
      "census-lehd",
      "fed-payments",
      "national-series",
      "nyfed-household-debt",
      "nyfed-sce-credit",
      "cfpb-credit-trends",
      "uscourts-bankruptcy",
      "usda-farm",
      "bls-oews",
      "bank-merger-orders",
      "cfpb-making-ends-meet",
      "state-payday-reports",
      "urban-debt-in-america",
      "alltheplaces",
      "gleif",
      "state-nonbank-lenders",
      "state-public-depositories",
      "sec-market-value",
      "sec-links",
      "sec-filings",
      "beige-book",
      "fred",
      "fomc-minutes",
      "fed-publications",
      "reg-news",
      "federal-register",
      "federal-bills",
      "state-bills",
      "state-reg-news",
      "state-bill-news",
      "state-regulators",
      "enforcement",
      "state-enforcement",
      "wire-research",
      "bank-zelle",
    ]);
  });

  it("uses a fixed partition when the step has none and skips unknown steps", async () => {
    const { db } = createDb([["UPDATE institution_sources", () => []]]);
    const outcome = await runRegistryStep({ stepKey: "registry-state-regulators", runId: 1, dryRun: false, db });
    expect(outcome).toMatchObject({ status: "completed", detail: { registry_source: "state-regulators", partition_key: "current" } });
    await expect(runRegistryStep({ stepKey: "registry-nope", runId: 1, dryRun: false, db })).resolves.toMatchObject({ status: "skipped" });
    await expect(runRegistryStep({ stepKey: "registry-cfpb", runId: 1, dryRun: false, db })).resolves.toMatchObject({
      status: "skipped",
      detail: { missing_partition: true },
    });
  });

  it("shows a Census vintage skipped for a missing key as a skipped step, not a completed one", async () => {
    const { db } = createDb([]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Missing Key</html>", { status: 200 })));
    try {
      const outcome = await runRegistryStep({ stepKey: "registry-census-acs", runId: 1, partitionKey: "2024", dryRun: false, db });
      expect(outcome).toMatchObject({ status: "skipped", detail: { skipped_no_key: true } });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
