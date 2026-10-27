/** Real PostgreSQL check that `documentOpeningKindSql` and `creditTermsOpeningSql` say what their JS twins say (#1944). */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { creditTermsOpening, creditTermsOpeningSql, documentOpeningKind, documentOpeningKindSql } from "./non-deposit-document";
import { CREDIT_TERMS_FIXTURES, OPENING_FIXTURES } from "./non-deposit-document.fixtures";

const connection = process.env.E2E_DATABASE_URL;

describe.skipIf(!connection)("document opening kind: JS and PostgreSQL agree", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(() => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Opening parity tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
  });
  afterAll(async () => { await db?.end(); });

  it("gives every opening fixture the same kind in both", async () => {
    const texts = OPENING_FIXTURES.map((fixture) => fixture.text);
    const rows = await db.unsafe<{ n: number; kind: string | null }[]>(
      `SELECT t.n::int AS n, ${documentOpeningKindSql("t.x")} AS kind FROM unnest($1::text[]) WITH ORDINALITY AS t(x, n) ORDER BY t.n`,
      [texts],
    );
    expect(rows.map((row) => row.kind)).toEqual(texts.map((text) => documentOpeningKind(text)));
  });

  it("gives every rate-table fixture the same answer in both", async () => {
    const texts = CREDIT_TERMS_FIXTURES.map((fixture) => fixture.text);
    const rows = await db.unsafe<{ n: number; match: boolean }[]>(
      `SELECT t.n::int AS n, ${creditTermsOpeningSql("t.x")} AS match FROM unnest($1::text[]) WITH ORDINALITY AS t(x, n) ORDER BY t.n`,
      [texts],
    );
    expect(rows.map((row) => row.match)).toEqual(texts.map((text) => creditTermsOpening(text)));
    expect(rows.map((row) => row.match)).toEqual(CREDIT_TERMS_FIXTURES.map((fixture) => fixture.match));
  });
});
