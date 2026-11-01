/**
 * Knox's learning reader in real PostgreSQL, loopback only, against the production schema: name
 * family lessons (#2068). Only this suite's own names are asserted.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { applyKnoxLesson, lessonFamily, loadKnoxLessons } from "./lessons";

const connection = process.env.E2E_DATABASE_URL;
const BANKS = [20680001, 20680002, 20680003, 20680004];
type Db = Parameters<typeof loadKnoxLessons>[0];

describe.skipIf(!connection)("Knox name family lessons in isolated PostgreSQL (#2068)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let n = 0;

  async function judged(kind: string, signal: string, institution: number, feeName: string, key: string) {
    n += 1;
    await raw`INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, check_name, institution_id, canonical_fee_key, weight, dedupe_key, evidence)
              VALUES ('extract', ${signal}, ${kind}, 'darwin', 'darwin.test_2068', ${institution}, ${key}, 1, ${`test2068:${n}`}, ${raw.json({ fee_name: feeName } as never)})`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Knox lesson DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ANY(${BANKS})`;
  });

  afterAll(async () => {
    if (raw) {
      await raw`DELETE FROM pipeline_feedback WHERE institution_id = ANY(${BANKS})`;
      await raw.end();
    }
  });

  it("learns a family from names no two banks print alike, and applies it to a third spelling", async () => {
    // Rejected under the network ATM fee at two banks, each spelling once; verified at two others.
    await judged("wrong_category", "wrong", BANKS[0], "Zorbex Balance Inquiries", "atm_non_network");
    await judged("wrong_category", "wrong", BANKS[1], "Zorbex Balance Inquiry Fee", "atm_non_network");
    await judged("darwin_verified", "right", BANKS[2], "Fee for Zorbex Balance Inquiry", "balance_inquiry");
    await judged("darwin_verified", "right", BANKS[3], "ZORBEX BALANCE INQUIRIES (each)", "balance_inquiry");

    const lessons = await loadKnoxLessons(raw as unknown as Db);
    const family = lessonFamily("Zorbex Balance Inquiries");
    expect(family).toBe("balance inquiry zorbex");
    expect([...lessons.values()].some((lesson) => lesson.name === `family:${family}` && lesson.wrongKey === "atm_non_network" && lesson.rightKey === "balance_inquiry")).toBe(true);
    // No exact name reached two banks, so only the family lesson can re-file a new spelling.
    expect([...lessons.values()].some((lesson) => lesson.name.includes("zorbex") && !lesson.name.startsWith("family:") && !lesson.institutionId)).toBe(false);
    const applied = applyKnoxLesson({ feeName: "Zorbex Balance Inquiry Charge", amount: 1, frequency: null, canonicalHint: "atm_non_network", confidence: 0.8, excerpt: "", waivable: false }, lessons);
    expect(applied.candidate.canonicalHint).toBe("balance_inquiry");
  });
});
