/** Real persisted-history query, confined to a loopback database and a connection-local temp table. */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readAccuracyHistory } from "./accuracy-history";
import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";
import type { AccuracyDay } from "./accuracy-measure";

const connection = process.env.E2E_DATABASE_URL;

describe.skipIf(!connection)("persisted accuracy history in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ json: unknown }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Accuracy history tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { json: JSON_TEXT_PASSTHROUGH } });
    await db`CREATE TEMP TABLE pipeline_scoreboard_snapshots (snapshot_date date PRIMARY KEY, detail jsonb)`;
  });
  afterAll(async () => { if (db) await db.end(); });

  it("survives event retention, deduplicates rolling copies and preserves legacy and changed scorers", async () => {
    const day = (date: string, series: string, id: number): AccuracyDay => ({
      at: `${date}T01:00:00Z`, seed: date, series, right: 1, scorable: 1, accuracy: 1,
      amount: 0, category: 0, evidence: 0, notAFee: 0, name: 0, observations: [[id, "right"]],
    });
    const a = day("2026-10-18", "1.5.75.18.23", 1);
    const b = day("2026-10-19", "1.5.76.18.23", 2);
    await db`INSERT INTO pipeline_scoreboard_snapshots VALUES
      ('2026-10-16', ${db.json({ goal: { accuracy: { right: 1393, scorable: 1400, accuracy: 0.995 } } })}),
      ('2026-10-18', ${JSON.stringify({ goal: { accuracy: { daily: [a] } } })}),
      ('2026-10-19', ${JSON.stringify({ goal: { accuracy: { daily: [a, b] } } })})`;
    // No agent_run_events table is needed: only persisted snapshot receipts are queried.
    const history = await readAccuracyHistory(db as unknown as Parameters<typeof readAccuracyHistory>[0], new Date("2026-10-21T10:00:00Z"));
    const weeks = history.weeks.filter((week) => week.audits > 0);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toMatchObject({ weekStart: "2026-10-12", scorable: 1, audits: 1, series: "1.5.75.18.23" });
    expect(weeks[1]).toMatchObject({ weekStart: "2026-10-19", scorable: 1, scoringChanged: true, series: "1.5.76.18.23", status: "insufficient" });
    expect(history.legacySnapshots).toEqual([{ asOf: "2026-10-16", right: 1393, scorable: 1400, accuracy: 0.995 }]);
    expect(await db`SELECT COUNT(*)::int AS n FROM pipeline_scoreboard_snapshots`).toEqual([{ n: 3 }]);
  });
});
