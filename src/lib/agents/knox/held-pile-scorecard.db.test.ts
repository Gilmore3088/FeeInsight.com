/**
 * Real PostgreSQL check of the goal scorecard's Knox held pile (#1102 item 4): held lines by
 * reason and age, and weekly exits read from the extract step's ledger detail. Loopback-only
 * temporary tables; nothing outside this session is touched.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { readKnoxHeldExitWeeks, readKnoxHeldPile } from "../goal-scorecard";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof readKnoxHeldPile>[0];

describe.skipIf(!connection)("Knox held pile on the scorecard, in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Held pile tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE raw_fee_observations (fee_raw_id bigint PRIMARY KEY, source text, fee_name text, amount numeric,
      outlier_flags jsonb, created_at timestamptz)`;
    await db`CREATE TEMP TABLE agent_run_steps (id bigint PRIMARY KEY, agent_run_id bigint, agent_name text, step_key text)`;
    await db`CREATE TEMP TABLE agent_run_events (id bigserial PRIMARY KEY, agent_run_id bigint, step_id bigint, event_type text, status text,
      detail jsonb, created_at timestamptz)`;
  });
  afterAll(async () => { if (db) await db.end(); });

  it("splits each held reason by age, a varies line included", async () => {
    const held = (id: number, flags: string[], daysAgo: number, amount: number | null = 5) =>
      db`INSERT INTO raw_fee_observations VALUES (${id}, 'knox', ${`Fee ${id}`}, ${amount}, ${JSON.stringify(flags)}::jsonb, NOW() - make_interval(days => ${daysAgo}))`;
    await held(1, ["knox_review:varies", "canonical_hint:check_printing"], 2, null);
    await held(2, ["knox_review:varies", "canonical_hint:check_printing"], 9, null);
    await held(3, ["knox_review:unclassified", "knox_set_aside"], 20);
    await held(4, ["knox_review:unclassified"], 45);
    // Not held: on its way to Darwin.
    await held(5, ["knox_review:zero", "needs_darwin_verification"], 1, 0);
    const pile = await readKnoxHeldPile(db as unknown as Db);
    expect(pile).toMatchObject({ query: "goal.knox_held_by_reason_age", total: 4, setAside: 1 });
    const byShape = Object.fromEntries(pile.byReason.map((row) => [row.shape, row]));
    expect(byShape.varies).toMatchObject({ count: 2, hasExit: false, ages: { under7: 1, days7to14: 1, days14to30: 0, over30: 0 } });
    expect(byShape.varies.owner).not.toBe("Nobody recorded");
    expect(byShape.unclassified).toMatchObject({ count: 2, setAside: 1, hasExit: true, ages: { under7: 0, days7to14: 0, days14to30: 1, over30: 1 } });
    expect(byShape.zero).toBeUndefined();
  });

  it("sums the extract steps' exits per UTC week, leaving out dry runs, failures and other steps", async () => {
    await db`INSERT INTO agent_run_steps VALUES (1, 1, 'knox', 'extract'), (2, 2, 'knox', 'extract-paid'), (3, 3, 'knox', 'extract')`;
    const detail = {
      dry_run: false,
      held_recheck: { dryRun: false, checked: 300, promoted: 12, setAside: 40, promotedByCategory: { nsf: 12 } },
      held_name_file: { dryRun: false, filed: 3, examples: [] },
      untraced_recheck: { dryRun: false, promoted: 2 },
      held_rate_recheck: { dryRun: false, promoted: 1 },
      range_band_set_aside: { dryRun: false, setAside: 5 },
      promotion_recheck: { dryRun: false, withdrawn: 4 },
      sample_results: [{ big: "x".repeat(2000) }],
    };
    const event = (step: number, at: string, eventType: string, status: string, body: unknown) =>
      db`INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, detail, created_at)
         VALUES (${step}, ${step}, ${eventType}, ${status}, ${JSON.stringify(body)}::jsonb, ${at}::timestamptz)`;
    await event(1, "2026-10-26T01:00:00Z", "step.finished", "completed", detail);
    await event(1, "2026-10-20T01:00:00Z", "step.finished", "completed", detail);
    await event(1, "2026-10-26T02:00:00Z", "step.finished", "completed", { ...detail, dry_run: true });
    await event(1, "2026-10-26T03:00:00Z", "step.started", "running", detail);
    await event(2, "2026-10-26T04:00:00Z", "step.finished", "completed", detail);
    await event(3, "2026-10-26T05:00:00Z", "step.finished", "failed", detail);
    const exits = await readKnoxHeldExitWeeks(db as unknown as Db, new Date("2026-10-26T18:00:00Z"));
    expect(exits.query).toBe("goal.knox_held_exits_weekly");
    expect(exits.weeks).toHaveLength(8);
    expect(exits.weeks.at(-1)).toMatchObject({ weekStart: "2026-10-26", steps: 1, toDarwin: 18, heldRecheck: 12, nameFiled: 3, untraced: 2, rates: 1, setAside: 45, backOnHold: 4, partial: true });
    expect(exits.weeks.at(-2)).toMatchObject({ weekStart: "2026-10-19", steps: 1, toDarwin: 18 });
    expect(exits.weeks[0]).toMatchObject({ weekStart: "2026-09-07", steps: 0 });
  });
});
