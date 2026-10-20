/** Real PostgreSQL checks of Knox's re-read path (#1093) in a loopback-only, temporary-table connection. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { insertCandidate, retireRowsFromOlderText, type KnoxTextRow } from "./extract";
import type { FeeAudience } from "@/lib/fee-audience";
import { withOwnFeeUnit } from "@/lib/custom-report/own-fee-unit";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof insertCandidate>[0];
const firstText = "Schedule revision A\nOverdraft fee $35.00 per item";
const rereadText = "Schedule revision B\nOverdraft fee $35.00 per item";

const firstRead: KnoxTextRow = {
  document_text_id: 701,
  source_document_id: 501,
  institution_id: 42,
  source_url: "https://testbank.example/fees",
  normalized_text: firstText,
  text_hash: createHash("sha256").update(firstText).digest("hex"),
} as KnoxTextRow;
const reread: KnoxTextRow = { ...firstRead, document_text_id: 702, normalized_text: rereadText,
  text_hash: createHash("sha256").update(rereadText).digest("hex") } as KnoxTextRow;
const overdraft = {
  feeName: "Overdraft fee",
  amount: 35,
  canonicalHint: "overdraft",
  frequency: "per_item",
  confidence: 0.95,
  excerpt: "Overdraft fee $35.00 per item",
  waivable: false,
} as Parameters<typeof insertCandidate>[1]["candidate"];

describe.skipIf(!connection)("Knox re-read in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Knox re-read tests require a loopback E2E database; production connections are forbidden");
    }
    // The app's own type handling (connection.ts), so jsonb flags round-trip as they do in production.
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE raw_fee_observations (
      fee_raw_id bigserial PRIMARY KEY, institution_id bigint, source_document_id bigint, document_r2_key text,
      source_url text, extraction_confidence numeric, agent_event_id uuid, fee_name text, amount numeric,
      frequency text, conditions text, extraction_note text, outlier_flags jsonb, source text, product_name text,
      min_balance_to_avoid numeric, min_opening_deposit numeric, waiver_text text,
      fee_audience text NOT NULL DEFAULT 'unknown', audience_evidence text, fee_treatment text NOT NULL DEFAULT 'unknown',
      line_share text NOT NULL DEFAULT '')`;
    await db`CREATE UNIQUE INDEX ON raw_fee_observations
      (source_document_id, lower(fee_name), COALESCE(amount, '-1'::numeric), fee_audience, line_share)
      WHERE source = 'knox' AND source_document_id IS NOT NULL`;
    await db`CREATE TEMP TABLE verified_fee_observations (fee_verified_id bigserial PRIMARY KEY, fee_raw_id bigint)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => { await db`TRUNCATE raw_fee_observations, verified_fee_observations`; });

  const flagsOf = async () => (await db`SELECT outlier_flags, COALESCE(extraction_note, conditions) AS conditions FROM raw_fee_observations`)
    .map((row) => ({ flags: row.outlier_flags as string[], conditions: String(row.conditions) }));

  it("sends the same fee read again on a re-read back to Darwin instead of leaving it retired", async () => {
    expect(await insertCandidate(db as unknown as Db, { runId: 1, row: firstRead, candidate: overdraft })).toBe(true);
    expect(await retireRowsFromOlderText(db as unknown as Db, reread)).toBe(1);
    expect((await flagsOf())[0].flags).toContain("superseded_by_reread");

    expect(await insertCandidate(db as unknown as Db, { runId: 2, row: reread, candidate: overdraft })).toBe(true);
    const [row] = await flagsOf();
    expect(row.flags).toContain("needs_darwin_verification");
    expect(row.flags).toContain("knox_reread_took_over");
    expect(row.flags).not.toContain("superseded_by_reread");
    expect(row.conditions).toContain(`text_hash=${reread.text_hash};`);
  });

  it("files a re-read under today's category only, so Darwin does not judge it under the old one", async () => {
    // Peoples National Bank of Kewanee (document 4506): "NSF Return/Paid Item Fee for Chkg. & Sav | $25.00"
    // was read as nsf; today's rules read the same line as overdraft. Darwin reads the first
    // canonical_hint flag, so the old flag must not survive the take-over.
    const nsfLine = {
      ...overdraft,
      feeName: "NSF Return/Paid Item Fee for Chkg. & Sav",
      amount: 25,
      canonicalHint: "nsf",
      excerpt: "NSF Return/Paid Item Fee for Chkg. & Sav | $25.00",
    } as Parameters<typeof insertCandidate>[1]["candidate"];
    await insertCandidate(db as unknown as Db, { runId: 1, row: firstRead, candidate: nsfLine });
    await retireRowsFromOlderText(db as unknown as Db, reread);

    expect(await insertCandidate(db as unknown as Db, { runId: 2, row: reread, candidate: { ...nsfLine, canonicalHint: "overdraft" } })).toBe(true);
    const [row] = await flagsOf();
    expect(row.flags.filter((flag) => flag.startsWith("canonical_hint:"))).toEqual(["canonical_hint:overdraft"]);
    expect(row.flags).toContain("needs_darwin_verification");
    expect(row.flags).toContain("knox_reread_took_over");
    expect(row.conditions).toContain("canonical_hint=overdraft;");
    // #1295: the old category stays on the row as proof Darwin's earlier decision was under it.
    expect(row.flags).toContain("knox_takeover_from:nsf");
  });

  it("marks no category change when the take-over keeps the category (#1295)", async () => {
    await insertCandidate(db as unknown as Db, { runId: 1, row: firstRead, candidate: overdraft });
    await retireRowsFromOlderText(db as unknown as Db, reread);
    expect(await insertCandidate(db as unknown as Db, { runId: 2, row: reread, candidate: overdraft })).toBe(true);
    const [row] = await flagsOf();
    expect(row.flags).toContain("knox_reread_took_over");
    expect(row.flags.some((flag) => flag.startsWith("knox_takeover_from:"))).toBe(false);
  });

  it("leaves a retired row alone once Darwin has a verified row for it", async () => {
    await insertCandidate(db as unknown as Db, { runId: 1, row: firstRead, candidate: overdraft });
    await retireRowsFromOlderText(db as unknown as Db, reread);
    const [{ fee_raw_id: id }] = await db`SELECT fee_raw_id FROM raw_fee_observations`;
    await db`INSERT INTO verified_fee_observations (fee_raw_id) VALUES (${id})`;
    expect(await insertCandidate(db as unknown as Db, { runId: 2, row: reread, candidate: overdraft })).toBe(false);
    expect((await flagsOf())[0].flags).toContain("superseded_by_reread");
  });

  it("stores a combined Overdraft/NSF line's twin as its own row (v82)", async () => {
    // Inst 2254: "Overdraft/NSF Fee | $30" kept only the overdraft row; the NSF twin met the same key.
    const shared = { ...overdraft, feeName: "Overdraft/NSF Fee", amount: 30, excerpt: "Overdraft/NSF Fee | $30.00" };
    expect(await insertCandidate(db as unknown as Db, { runId: 1, row: firstRead, candidate: shared })).toBe(true);
    expect(await insertCandidate(db as unknown as Db, {
      runId: 1, row: firstRead, candidate: { ...shared, canonicalHint: "nsf", lineShare: "twin:nsf" },
    })).toBe(true);
    const rows = await db`SELECT line_share, COALESCE(extraction_note, conditions) AS conditions FROM raw_fee_observations ORDER BY fee_raw_id`;
    expect(rows.map((row) => row.line_share)).toEqual(["", "twin:nsf"]);
    expect(String(rows[1].conditions)).toContain("canonical_hint=nsf;");
    // Read again from the same text, neither row is added twice.
    expect(await insertCandidate(db as unknown as Db, {
      runId: 2, row: firstRead, candidate: { ...shared, canonicalHint: "nsf", lineShare: "twin:nsf" },
    })).toBe(false);
  });

  it("does not touch a live, unretired row read again from the same text", async () => {
    await insertCandidate(db as unknown as Db, { runId: 1, row: firstRead, candidate: overdraft });
    expect(await insertCandidate(db as unknown as Db, { runId: 2, row: firstRead, candidate: overdraft })).toBe(false);
    const [row] = await flagsOf();
    expect(row.flags).toContain("needs_darwin_verification");
    expect(row.flags).not.toContain("knox_reread_took_over");
  });

  it("#2283 cannot enrich ordinary, held or judged historical monthly rows through the separate lineup update", async () => {
    const text = "Everyday Checking\nMonthly Service Fee | $5.00 (Plus ATM charges)\nMinimum opening deposit $25\nWaived with a $500 minimum balance";
    const candidate = withOwnFeeUnit({ feeName: "Monthly Service Fee", amount: 5, canonicalHint: "monthly_maintenance",
      frequency: "monthly", confidence: .95, excerpt: "Monthly Service Fee | $5.00", waivable: false,
      lineup: { productName: "Everyday Checking", minBalanceToAvoid: 500, minOpeningDeposit: 25,
        waiverText: "Waived with a $500 minimum balance" } }, text);
    expect(candidate.ownCondition).toContain("Plus ATM charges");
    expect(candidate.ownUnit).toBeUndefined();
    for (const mode of ["ordinary", "held", "judged"]) {
      await db`TRUNCATE raw_fee_observations, verified_fee_observations`;
      const flags = mode === "held" ? ["knox_review:unclassified"] : [];
      const [{ fee_raw_id: id }] = await db`INSERT INTO raw_fee_observations
        (institution_id,source_document_id,source,fee_name,amount,frequency,conditions,extraction_note,outlier_flags,fee_audience)
        VALUES(42,501,'knox','Monthly Service Fee',5,NULL,'Retained historical condition','Retained historical note',
          ${JSON.stringify(flags)}::jsonb,'unknown') RETURNING fee_raw_id`;
      if (mode === "judged") await db`INSERT INTO verified_fee_observations(fee_raw_id) VALUES(${id})`;
      const [before] = await db`SELECT to_jsonb(fr)::text AS row FROM raw_fee_observations fr WHERE fee_raw_id=${id}`;
      expect(await insertCandidate(db as unknown as Db, { runId: 1,
        row: { ...firstRead, normalized_text: text, text_hash: createHash("sha256").update(text).digest("hex") }, candidate,
      })).toBe(false);
      expect((await db`SELECT to_jsonb(fr)::text AS row FROM raw_fee_observations fr WHERE fee_raw_id=${id}`)[0]).toEqual(before);
    }
  });

  it.each(["consumer", "business", "unknown", "both"] as const)("enriches only the %s sibling of a same-name, same-price fee (#2108)", async (audience) => {
    const excerpts: Record<FeeAudience, string> = {
      consumer: "Personal checking: Monthly Service Fee | $5.00",
      business: "Business checking: Monthly Service Fee | $5.00",
      unknown: "Monthly Service Fee | $5.00",
      both: "All accounts: Monthly Service Fee | $5.00",
    };
    const candidateFor = (feeAudience: FeeAudience) => ({
      ...overdraft, feeName: "Monthly Service Fee", amount: 5, canonicalHint: "monthly_maintenance",
      frequency: "monthly", excerpt: excerpts[feeAudience],
    });
    // The common monthly writer requires its own source witness (#2259). This
    // existing table fixture isolates audience-key enrichment, not account-owner
    // ambiguity; keep all four literal audience rows and the assigned facts in it.
    const monthlyText = ["Everyday Checking", ...Object.values(excerpts),
      "Minimum opening deposit: $25", "Waived with a $500 minimum balance"].join("\n");
    const monthlyRead: KnoxTextRow = { ...firstRead, normalized_text: monthlyText,
      text_hash: createHash("sha256").update(monthlyText).digest("hex") };
    // The unique key intentionally permits four rows with the same document, name and price.
    for (const sibling of Object.keys(excerpts) as FeeAudience[]) {
      expect(await insertCandidate(db as unknown as Db, { runId: 1, row: monthlyRead, candidate: candidateFor(sibling) })).toBe(true);
    }
    expect(await insertCandidate(db as unknown as Db, {
      runId: 2, row: monthlyRead,
      candidate: { ...candidateFor(audience), lineup: {
        productName: "Everyday Checking", minBalanceToAvoid: 500, minOpeningDeposit: 25,
        waiverText: "Waived with a $500 minimum balance",
      } },
    })).toBe(false);

    const rows = await db`SELECT fee_audience, product_name, min_balance_to_avoid, min_opening_deposit, waiver_text
                            FROM raw_fee_observations ORDER BY fee_audience`;
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row).toEqual({ fee_audience: row.fee_audience,
        product_name: row.fee_audience === audience ? "Everyday Checking" : null,
        min_balance_to_avoid: row.fee_audience === audience ? 500 : null,
        min_opening_deposit: row.fee_audience === audience ? 25 : null,
        waiver_text: row.fee_audience === audience ? "Waived with a $500 minimum balance" : null,
      });
    }
  });
});
