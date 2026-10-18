import { describe, expect, it, vi } from "vitest";

import {
  bankMergerOrdersPartitions,
  buildPartyIndex,
  decisionRow,
  matchParty,
  runRegistryBankMergerOrders,
} from "./bank-merger-orders";
import type { RegistryDb } from "./partitions";

const INSTITUTIONS = [
  { id: 1, source: "fdic", cert_number: "111", rssd_id: "9001", institution_name: "Lakeside Bank", state_code: "OH", holding_company_rssd: "5001", holding_company_name: "LAKESIDE FINANCIAL CORP" },
  { id: 2, source: "fdic", cert_number: "222", rssd_id: "9002", institution_name: "Example Bank", state_code: "OH", holding_company_rssd: "5002", holding_company_name: "EXAMPLE BANCSHARES INC" },
  { id: 3, source: "fdic", cert_number: "333", rssd_id: "9003", institution_name: "Example Bank West", state_code: "IN", holding_company_rssd: "5002", holding_company_name: "EXAMPLE BANCSHARES INC" },
  { id: 4, source: "fdic", cert_number: "444", rssd_id: "9004", institution_name: "Twin Bank", state_code: "TX", holding_company_rssd: null, holding_company_name: null },
  { id: 5, source: "fdic", cert_number: "555", rssd_id: "9005", institution_name: "Twin Bank", state_code: "KS", holding_company_rssd: null, holding_company_name: null },
];

function createDb(known: string[] = []) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("FROM institution_sources")) return Promise.resolve(INSTITUTIONS);
    if (text.includes("SELECT event_key FROM institution_structure_events")) return Promise.resolve(known.map((event_key) => ({ event_key })));
    if (text.includes("INSERT INTO institution_structure_events")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
      return Promise.resolve(payload.map(() => ({})));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const FEED = [{ d: "10/16/2026 4:15:00 PM", t: "Federal Reserve Board announces approval of application by Example Bancshares, Inc.", l: "/newsevents/pressreleases/orders20261016a.htm", pt: "Orders on Banking Applications" }];
const RELEASE = `<p>The Federal Reserve Board on Friday announced its approval of the application by Example Bancshares, Incorporated, of Columbus, Ohio, to acquire Lakeside Bank, of Toledo, Ohio.</p>`;

describe("bank-merger-orders registry step", () => {
  it("lists the OCC partition and Fed years newest first", () => {
    const keys = bankMergerOrdersPartitions(new Date("2026-10-17T00:00:00Z"));
    expect(keys.slice(0, 3)).toEqual(["occ:current", "fed:2026", "fed:2025"]);
    expect(keys.at(-1)).toBe("fed:2015");
  });

  it("matches parties by exact name only", () => {
    const index = buildPartyIndex(INSTITUTIONS);
    expect(matchParty(index, "Lakeside Bank")).toMatchObject({ institutionId: 1, fdicCert: "111", method: "exact_bank_name" });
    expect(matchParty(index, "Example Bancshares, Incorporated")).toMatchObject({ institutionId: null, holdingCompanyRssd: "5002", method: "holding_company" });
    expect(matchParty(index, "Lakeside Financial Corporation")).toMatchObject({ institutionId: 1, holdingCompanyRssd: "5001", method: "holding_company_single_bank" });
    expect(matchParty(index, "Twin Bank")).toMatchObject({ institutionId: null, ambiguous: true });
    expect(matchParty(index, null).method).toBeNull();
  });

  it("writes each decision with applicant, target and the order's figures in raw", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("ne-press.json")) return new Response(JSON.stringify(FEED), { status: 200 });
      if (u.endsWith(".htm")) return new Response(RELEASE, { status: 200 });
      return new Response("nf", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await runRegistryBankMergerOrders({ partitionKey: "fed:2026", db, now: new Date("2026-10-17T00:00:00Z"), fetchOptions: { fetchImpl, backoffMs: 0, retries: 0 } });
    expect(r).toMatchObject({ rows: 1, writtenRows: 1, empty: false });
    const insert = statements.find((s) => s.text.includes("INSERT INTO institution_structure_events"))!;
    expect(insert.values[0]).toBe("fed-orders");
    const [row] = JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
    expect(row).toMatchObject({
      event_key: "frb:orders20261016a",
      effective_date: "2026-10-16",
      change_code: "approval",
      acquirer_name: "Example Bancshares, Incorporated",
      outgoing_name: "Lakeside Bank",
      outgoing_cert: "111",
      institution_id: null,
    });
    expect(row.raw_json).toMatchObject({ agency: "frb", pdf_status: "no_pdf", applicant_holding_company_rssd: "5002", target_institution_id: 1 });
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
    expect(partition.values[2]).toBe("succeeded");
  });

  it("records an empty year with its reason", async () => {
    const { db, statements } = createDb(["frb:orders20261016a"]);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(FEED), { status: 200 })) as unknown as typeof fetch;
    const r = await runRegistryBankMergerOrders({ partitionKey: "fed:2026", db, now: new Date("2026-10-17T00:00:00Z"), fetchOptions: { fetchImpl, backoffMs: 0, retries: 0 } });
    expect(r).toMatchObject({ empty: true, emptyReason: "every order for the year is already stored" });
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
    expect(partition.values[2]).toBe("empty");
  });

  it("keeps the raw decision fields beside the matches", () => {
    const row = decisionRow(
      { eventKey: "occ:cd.pdf", agency: "occ", decisionDate: null, kind: "other", title: null, applicant: null, target: null, partiesSentence: null, documentUrl: null, pageUrl: "p", pdfStatus: "read", competitive: [], raw: { link_text: "CD" } },
      buildPartyIndex([]),
    );
    expect(row).toMatchObject({ source_url: "p", institution_id: null, raw_json: { link_text: "CD", agency: "occ" } });
  });

  it("refuses an unknown partition", async () => {
    await expect(runRegistryBankMergerOrders({ partitionKey: "fdic:2026", db: createDb().db })).rejects.toThrow(/Unknown bank-merger-orders partition/);
  });
});
