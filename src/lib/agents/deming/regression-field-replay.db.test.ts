/**
 * Deming's regression step replays fee-fields cases by their check name (#2064), in real
 * PostgreSQL, loopback only, against the production schema: old category-guard takedowns frozen as
 * `unreplayable`. A fresh audit miss is never replayed (#1119). Only this suite's own cases are asserted.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { BUSINESS_DOC_SQL, BUSINESS_NAME_SQL, readsAsBusinessSchedule } from "@/lib/agents/hamilton/business-schedule";
import { runDemingRegression } from "./regression";

const connection = process.env.E2E_DATABASE_URL;
const INST = 20640001;
// Fee ids no published row has, so no case's fee is live.
const FEE = 20640100;
type Db = NonNullable<Parameters<typeof runDemingRegression>[0]["db"]>;

describe.skipIf(!connection)("regression replay of fee-fields cases (#2064)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;

  async function seed(key: string, dataset: string, check: string, input: Record<string, unknown>, fee: number, status = "candidate", sourceUrl: string | null = null) {
    await raw`INSERT INTO eval_cases (case_key, dataset, status, agent, check_name, error_class, severity, institution_id, fee_published_id, source_url, input, expected, label_provenance)
              VALUES (${key}, ${dataset}, ${status}, 'hamilton', ${check}, 'test', 'major', ${INST}, ${fee}, ${sourceUrl}, ${raw.json(input as never)},
                      ${raw.json({ publishable: false })}, ${dataset === "regression" ? "takedown_confirmed" : "human"})`;
  }

  const row = async (key: string) => (await raw`SELECT status, last_caught, last_verdict, last_checked_at FROM eval_cases WHERE case_key = ${key}`)[0];

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Regression replay DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await raw`DELETE FROM eval_cases WHERE institution_id = ${INST}`;
  });

  afterAll(async () => {
    if (raw) {
      await raw`DELETE FROM eval_cases WHERE institution_id = ${INST}`;
      await raw.end();
    }
  });

  it("replays old category takedowns by check name, and leaves an audit miss and a check with no replayer alone", async () => {
    const takedown = { kind: "unreplayable", canonical_fee_key: "stop_payment", fee_name: "Stop payment of Home Equity Line checks", amount: 25, conditions: null };
    await seed("test2064:category", "regression", "hamilton.category_guard", takedown, FEE);
    // Caught only with the schedule's NSF price, which the snapshot lacks: replayed, not caught, stays a candidate.
    await seed("test2064:nsf", "regression", "hamilton.category_guard", { ...takedown, canonical_fee_key: "nsf", fee_name: "Return Item Fee", amount: 10 }, FEE + 1);
    await seed("test2064:name", "fresh_audit", "deming.name_quality", { kind: "fresh_audit", canonical_fee_key: "atm", fee_name: "ATM A fee of", amount: 2 }, FEE + 2);
    await seed("test2064:product", "regression", "hamilton.product_page", takedown, FEE + 3);
    // An active case the guard no longer catches is a regression.
    await seed("test2064:regressed", "regression", "hamilton.category_guard", { ...takedown, fee_name: "Stop Payment Fee" }, FEE + 4, "active");

    const result = await runDemingRegression({ runId: null, db: raw as unknown as Db, promoteLimit: 0, replayLimit: 0 });

    expect(await row("test2064:category")).toMatchObject({ status: "active", last_caught: true, last_verdict: "name_contradicts" });
    expect(await row("test2064:nsf")).toMatchObject({ status: "candidate", last_caught: false, last_verdict: "passes_category_guard" });
    expect(await row("test2064:name")).toMatchObject({ status: "candidate", last_caught: null, last_checked_at: null });
    expect(await row("test2064:product")).toMatchObject({ status: "candidate", last_caught: null, last_checked_at: null });
    expect(await row("test2064:regressed")).toMatchObject({ status: "active", last_caught: false });
    expect(result.regressions.some((miss) => miss.checkName === "hamilton.category_guard" && miss.verdict === "passes_category_guard")).toBe(true);
  });

  it("replays confirmed audience takedowns, old and new, against today's audience rules", async () => {
    const old = { kind: "unreplayable", canonical_fee_key: "overdraft", fee_name: "Balancing Checkbook", amount: 15, conditions: null };
    // An old snapshot: the address comes from the case, not the frozen input.
    await seed("test2064:audience-old", "regression", "hamilton.business_schedule", old, FEE + 10, "candidate", "https://www.apgfcu.com/business-service-charges-and-fees-list.html");
    await seed("test2064:audience-new", "regression", "hamilton.business_schedule",
      { kind: "audience", canonical_fee_key: "wire_domestic_outgoing", fee_name: "Outgoing Wire", amount: 30, conditions: null, document_url: "https://bank.test/treasury/fees.pdf" }, FEE + 11);
    // A business-only footnote needs the page: replayed, not caught, stays a candidate.
    await seed("test2064:audience-footnote", "regression", "hamilton.business_schedule", { ...old, fee_name: "Overdraft - Insufficient Funds / Uncollected" }, FEE + 12, "candidate", "https://bank.test/Miscellaneous-Bank-Fees.pdf");
    // An active case today's rules would let through (Darwin reads its name as personal) is a regression.
    await seed("test2064:audience-regressed", "regression", "hamilton.business_schedule",
      { kind: "audience", canonical_fee_key: "overdraft", fee_name: "Personal Overdraft Fee", amount: 35, conditions: null, document_url: "https://bank.test/business/fees.pdf" }, FEE + 13, "active");

    const result = await runDemingRegression({ runId: null, db: raw as unknown as Db, promoteLimit: 0, replayLimit: 0 });

    expect(await row("test2064:audience-old")).toMatchObject({ status: "active", last_caught: true, last_verdict: "darwin_reads_business" });
    expect(await row("test2064:audience-new")).toMatchObject({ status: "active", last_caught: true, last_verdict: "business_schedule_read" });
    expect(await row("test2064:audience-footnote")).toMatchObject({ status: "candidate", last_caught: false, last_verdict: "passes_audience_rules" });
    expect(await row("test2064:audience-regressed")).toMatchObject({ status: "active", last_caught: false, last_verdict: "darwin_reads_consumer" });
    expect(result.regressions.some((miss) => miss.checkName === "hamilton.business_schedule" && miss.verdict === "darwin_reads_consumer")).toBe(true);
  });

  it("reads business the same way as the business-schedule SQL", async () => {
    const samples: Array<[string, string]> = [
      ["Business ATM/Debit Transactions, off premises", "https://bank.test/fees.pdf"],
      ["Commercial NSF Fee per item", "https://bank.test/personal/fees.pdf"],
      ["Business Days to process", "https://bank.test/fees.pdf"],
      ["BUSINESS CHECKING ACCOUNT FEES | Skip-a-Pay", "https://bank.test/fees.pdf"],
      ["Monthly Service Charge", "https://bank.test/Commercial-Fee-Schedule.pdf"],
      ["Monthly Service Charge", "https://business.bank.test/fees.pdf"],
      ["Monthly Service Charge", "https://bank.test/business-and-personal-fees.pdf"],
      ["Wire", "https://bank.test/treasury/fees?type=Retail"],
      ["Overdraft Fee", "https://bank.test/fees.pdf"],
    ];
    for (const [name, url] of samples) {
      const [sqlRow] = await raw.unsafe(`SELECT (${BUSINESS_NAME_SQL("$1::text")} OR ${BUSINESS_DOC_SQL("$2::text")}) AS business`, [name, url]);
      expect([name, url, readsAsBusinessSchedule(name, url)]).toEqual([name, url, sqlRow.business]);
    }
  });
});
