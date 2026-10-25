/**
 * Deming's regression step replays fee-fields cases by their check name (#2064), in real
 * PostgreSQL, loopback only, against the production schema: old category-guard takedowns frozen as
 * `unreplayable`. A fresh audit miss is never replayed (#1119). Only this suite's own cases are asserted.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { runDemingRegression } from "./regression";

const connection = process.env.E2E_DATABASE_URL;
const INST = 20640001;
// Fee ids no published row has, so no case's fee is live.
const FEE = 20640100;
type Db = NonNullable<Parameters<typeof runDemingRegression>[0]["db"]>;

describe.skipIf(!connection)("regression replay of fee-fields cases (#2064)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;

  async function seed(key: string, dataset: string, check: string, input: Record<string, unknown>, fee: number, status = "candidate") {
    await raw`INSERT INTO eval_cases (case_key, dataset, status, agent, check_name, error_class, severity, institution_id, fee_published_id, input, expected, label_provenance)
              VALUES (${key}, ${dataset}, ${status}, 'hamilton', ${check}, 'test', 'major', ${INST}, ${fee}, ${raw.json(input as never)},
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
});
