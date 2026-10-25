/**
 * The morning brief's count of error rows no agent reads (#2062), in real PostgreSQL, loopback
 * only, against the production schema. Compares counts before and after seeding, so rows other
 * suites left behind do not matter.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { readUnreadFeedback, type UnreadFeedbackSummary } from "./unread-feedback";

const connection = process.env.E2E_DATABASE_URL;
const INST = 20620001;
type Db = Parameters<typeof readUnreadFeedback>[0];

describe.skipIf(!connection)("unread error rows in isolated PostgreSQL (#2062)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let n = 0;

  async function row(kind: string, stage: string, check: string, hoursAgo: number, extra: { weight?: number; dedupe?: string } = {}) {
    n += 1;
    await raw`INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, check_name, institution_id, weight, dedupe_key, created_at)
              VALUES (${stage}, 'wrong', ${kind}, 'hamilton', ${check}, ${INST}, ${extra.weight ?? 1}, ${extra.dedupe ?? `test2062:${n}`},
                      NOW() - make_interval(hours => ${hoursAgo}::int))`;
  }

  const count = (summary: UnreadFeedbackSummary, kind: string, stage: string) =>
    summary.byKind.find((item) => item.kind === kind && item.stage === stage)?.rows ?? 0;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Unread feedback DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ${INST}`;
  });

  afterAll(async () => {
    if (raw) {
      await raw`DELETE FROM pipeline_feedback WHERE institution_id = ${INST}`;
      await raw.end();
    }
  });

  it("counts unread, unregistered and partly read kinds older than two days, and nothing else", async () => {
    const before = await readUnreadFeedback(raw as unknown as Db);
    await row("search_miss", "discover", "magellan.search_miss", 72);
    await row("search_miss", "discover", "magellan.search_miss", 1); // too new to count
    await row("search_miss", "discover", "magellan.search_miss", 24 * 40); // older than the window
    await row("search_miss", "discover", "magellan.search_miss", 72, { weight: 0 }); // a record, no weight
    await row("audit_miss", "extract", "hamilton.source_check", 72);
    await row("audit_miss", "discover", "hamilton.other_bank_document", 72); // Magellan reads it
    await row("wrong_document", "discover", "hamilton.article_page", 72);
    await row("wrong_document", "discover", "magellan.link_yield", 72); // Magellan reads it
    await row("product_page", "verify", "hamilton.product_page", 72, { dedupe: "hamilton.takedown:pub:20620001:verify" });
    await row("product_page", "extract", "hamilton.product_page", 72, { dedupe: "hamilton.takedown:pub:20620001:extract" });
    await row("restored_after_takedown", "extract", "hamilton.restore", 72); // read
    await row("wrong_amount", "verify", "hamilton.source_check", 72, { dedupe: "hamilton.takedown:pub:20620002:verify" }); // only the extract row is read
    await row("wrong_amount", "extract", "hamilton.source_check", 72, { dedupe: "hamilton.takedown:pub:20620002:extract" });
    await row("wrong_category", "verify", "hamilton.category_guard", 72, { dedupe: "hamilton.takedown:pub:20620003:verify" }); // release review reads it
    await row("wrong_category", "verify", "hamilton.source_check", 72, { dedupe: "hamilton.takedown:pub:20620004:verify" });
    const after = await readUnreadFeedback(raw as unknown as Db);
    expect(after.total - before.total).toBe(6);
    expect(count(after, "wrong_amount", "verify") - count(before, "wrong_amount", "verify")).toBe(1);
    expect(count(after, "wrong_amount", "extract") - count(before, "wrong_amount", "extract")).toBe(0);
    expect(count(after, "wrong_category", "verify") - count(before, "wrong_category", "verify")).toBe(1);
    expect(count(after, "search_miss", "discover") - count(before, "search_miss", "discover")).toBe(1);
    expect(count(after, "audit_miss", "extract") - count(before, "audit_miss", "extract")).toBe(1);
    expect(count(after, "audit_miss", "discover") - count(before, "audit_miss", "discover")).toBe(0);
    expect(count(after, "wrong_document", "discover") - count(before, "wrong_document", "discover")).toBe(1);
    expect(count(after, "product_page", "verify") - count(before, "product_page", "verify")).toBe(1);
    expect(count(after, "product_page", "extract") - count(before, "product_page", "extract")).toBe(0);
  });
});
