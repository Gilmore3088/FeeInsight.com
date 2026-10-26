/**
 * Real PostgreSQL check of the paid pass's selection on the production schema (#1101): each
 * selected text carries the bank's name and website platform, so a paid find can be filed by
 * platform. Everything is written inside one transaction that is rolled back.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { selectPaidTexts } from "./paid-extract";
import { KNOX_RULES_STRATEGY } from "./specialists";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof selectPaidTexts>[0];
const ROLLBACK = new Error("rollback");

const denseText = Array.from({ length: 18 }, (_, index) => `Service number ${index + 1} is offered to members for $${index + 2}.00 when requested.`).join("\n");

describe.skipIf(!connection)("Knox paid selection carries the bank's platform, in PostgreSQL", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(() => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Paid selection tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
  });
  afterAll(async () => { if (db) await db.end(); });

  async function selectedWith(profilePlatform: string | null, cmsPlatform: string | null) {
    let rows: Awaited<ReturnType<typeof selectPaidTexts>> = [];
    await db.begin(async (scope) => {
      const tx = scope as unknown as Db;
      await tx`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code, cms_platform, status)
               VALUES (990101, 'Paid Teach Bank', 'bank', 'test', 'ZZ', ${cmsPlatform}, 'active')`;
      await tx`INSERT INTO institution_source_profiles (institution_id, state_code, platform) VALUES (990101, 'ZZ', ${profilePlatform})`;
      await tx`INSERT INTO source_documents (id, institution_id, status, document_url)
               VALUES (990201, 990101, 'completed', 'https://www.paidteach.example/fees')`;
      await tx`INSERT INTO agent_source_texts (id, source_document_id, institution_id, source_url, normalized_text, text_hash, status, char_count)
               VALUES (990301, 990201, 990101, 'https://www.paidteach.example/fees', ${denseText}, 'paid-teach-hash', 'completed', ${denseText.length})`;
      await tx`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome, yield_count)
               VALUES (990101, 990201, 'extract', ${KNOX_RULES_STRATEGY.strategy}, ${KNOX_RULES_STRATEGY.version}, 'paid-teach-hash', 'low_yield', 1)`;
      rows = await selectPaidTexts(tx, 5, "ZZ");
      throw ROLLBACK;
    }).catch((error) => { if (error !== ROLLBACK) throw error; });
    return rows;
  }

  it("takes the profile's platform first, then the source's", async () => {
    const [profile] = await selectedWith(" Q2 ", "wordpress");
    expect(Number(profile.document_text_id)).toBe(990301);
    expect(profile).toMatchObject({ institution_name: "Paid Teach Bank", platform: "Q2" });
    const [fallback] = await selectedWith("", "wordpress");
    expect(fallback).toMatchObject({ platform: "wordpress" });
    const [none] = await selectedWith(null, null);
    expect(none).toMatchObject({ platform: null });
  });
});
