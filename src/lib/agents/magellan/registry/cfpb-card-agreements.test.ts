import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { cfpbCardAgreementsPartitions, runRegistryCfpbCardAgreements } from "./cfpb-card-agreements";
import type { RegistryDb } from "./partitions";

function createDb(options: { alreadyRead?: Array<{ record_key: string; file_sha256: string }> } = {}) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  let nextId = 1;
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("FROM institution_sources")) return Promise.resolve([{ id: 11, institution_name: "First Bank, N.A." }]);
    if (text.includes("SELECT record_key, file_sha256 FROM cfpb_card_agreements")) return Promise.resolve(options.alreadyRead ?? []);
    if (text.includes("cfpb_card_agreements AS t")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string) as Array<{ record_key: string }>;
      return Promise.resolve(payload.map((r) => ({ id: nextId++, record_key: r.record_key })));
    }
    if (text.includes("INSERT INTO cfpb_agreement_terms")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string) as unknown[];
      return Promise.resolve(payload.map(() => ({})));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partitionInsert = (statements: Array<{ text: string; values: unknown[] }>) =>
  statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
const partitionDetail = (statements: Array<{ text: string; values: unknown[] }>) =>
  JSON.parse(partitionInsert(statements).values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
const payloadOf = (statements: Array<{ text: string; values: unknown[] }>, marker: string) =>
  JSON.parse(statements.find((s) => s.text.includes(marker))!.values.find((v) => typeof v === "string" && v.startsWith("[")) as string);

const respond = (body: Uint8Array | string, status = 200) =>
  vi.fn(async () => new Response(body as unknown as BodyInit, { status })) as unknown as typeof fetch;

describe("cfpbCardAgreementsPartitions", () => {
  it("puts the prepaid snapshot first, then card quarters and TCCP halves newest first", () => {
    const parts = cfpbCardAgreementsPartitions(new Date("2026-10-17T00:00:00Z"));
    expect(parts[0]).toBe("prepaid-2026Q4");
    expect(parts.slice(1, 4)).toEqual(["card-2026Q2", "card-2026Q1", "tccp-2026H1"]);
    expect(parts).toContain("card-2018Q1");
    expect(parts).toContain("tccp-2021H1");
    expect(parts).not.toContain("tccp-2026H2");
  });
});

describe("registry cfpb-card-agreements: card zip", () => {
  const zip = zipSync({
    "Credit_Card_Agreements_2026_Q2/First Bank/Platinum.pdf": strToU8("PDF-A"),
    "Credit_Card_Agreements_2026_Q2/Other Lender/Gold.pdf": strToU8("PDF-B"),
  });
  const reader = vi.fn(async (bytes: Uint8Array) =>
    new TextDecoder().decode(bytes) === "PDF-A" ? "Annual Fee $95\n• Late Payment Up to $40" : null,
  );

  it("dry run matches issuers and writes nothing", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryCfpbCardAgreements({ partitionKey: "card-2026Q2", dryRun: true, db, fetchOptions: { fetchImpl: respond(zip) }, pdfReader: reader });
    expect(r).toMatchObject({ agreements: 2, issuers: 2, matchedIssuers: 1, unmatchedIssuers: 1, empty: false });
    expect(statements.some((s) => s.text.includes("INSERT"))).toBe(false);
  });

  it("writes agreements and terms, keeps unmatched issuers with a null institution", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryCfpbCardAgreements({ partitionKey: "card-2026Q2", db, fetchOptions: { fetchImpl: respond(zip) }, pdfReader: reader });
    expect(r).toMatchObject({ feeRead: 1, feeNoText: 1, terms: 2, writtenRows: 2 });
    const rows = payloadOf(statements, "INSERT INTO cfpb_card_agreements");
    expect(rows.find((x: { issuer_name: string }) => x.issuer_name === "First Bank")).toMatchObject({ institution_id: 11, match_method: "normalized_name" });
    expect(rows.find((x: { issuer_name: string }) => x.issuer_name === "Other Lender")).toMatchObject({ institution_id: null, fee_status: "no_text" });
    const terms = payloadOf(statements, "INSERT INTO cfpb_agreement_terms");
    expect(terms).toContainEqual(expect.objectContaining({ term_type: "late_fee", amount_usd: 40, amount_qualifier: "up_to" }));
    const detail = partitionDetail(statements);
    expect(detail.cleaning.unmatchedIssuers).toEqual([{ name: "Other Lender", reason: "no_match", candidates: 0 }]);
    expect(detail.layout_depths).toEqual({ "2": 2 });
  });

  it("leaves agreements past the per-run limit pending and comes back within the hour", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryCfpbCardAgreements({ partitionKey: "card-2026Q2", db, fetchOptions: { fetchImpl: respond(zip) }, pdfReader: reader, maxPdfs: 1 });
    expect(r.feePending).toBe(1);
    const values = partitionInsert(statements).values;
    expect(values).toContain(1); // next_attempt hours
  });

  it("records an empty partition on 404", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryCfpbCardAgreements({ partitionKey: "card-2026Q2", db, fetchOptions: { fetchImpl: respond("", 404), backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(partitionDetail(statements).reason).toMatch(/404/);
  });
});

describe("registry cfpb-card-agreements: TCCP", () => {
  it("refuses a file without an issuer column", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryCfpbCardAgreements({ partitionKey: "tccp-2026H1", db, fetchOptions: { fetchImpl: respond("Foo,Product Name\na,b\n") } });
    expect(r.empty).toBe(true);
    expect(partitionDetail(statements)).toMatchObject({ missing_headers: expect.arrayContaining(["issuer"]), unexpected_headers: ["Foo"] });
  });

  it("loads plans and their fee columns", async () => {
    const { db, statements } = createDb();
    const csv = "Institution Name,Product Name,Annual Fee,Cash Advance Fee\nFirst Bank,Gold,$95,Either $10 or 5%\n";
    const r = await runRegistryCfpbCardAgreements({ partitionKey: "tccp-2026H1", db, fetchOptions: { fetchImpl: respond(csv) } });
    expect(r).toMatchObject({ agreements: 1, matchedIssuers: 1, terms: 2 });
    const terms = payloadOf(statements, "INSERT INTO cfpb_agreement_terms");
    expect(terms).toContainEqual(expect.objectContaining({ term_type: "cash_advance_fee", amount_usd: null, ambiguous: true }));
  });
});
