// @vitest-environment node
/**
 * V5 T6 data rights (#1872), on a real PostgreSQL loaded from tests/e2e/production-schema.sql:
 * rows from regulator sites struck for non-commercial terms (New York, North Carolina, Florida)
 * and from held Google News press (state-bill-news, "news:XX") are stored next to rows from a
 * state whose terms allow reuse (New Jersey). Hamilton's own readers (the Wire behind regulation
 * answers, the state posts panel, the Regulatory Wire and its state picker) return only New
 * Jersey's. The static sweep that every reader applies the filter is data-rights.test.ts.
 *
 * Loopback databases only. Synthetic rows keyed "t6-rights-" are removed before and after.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.E2E_DATABASE_URL;
  let loopback = false;
  try {
    loopback = Boolean(url) && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url as string).hostname);
  } catch {
    loopback = false;
  }
  process.env.DATABASE_URL = loopback ? (url as string) : "";
  return { url, loopback };
});

import { sql } from "@/lib/data-store/connection";
import { getStateNews, getStatesWithNews, getStateWire } from "@/lib/data-store/state-news";
import { loadStatePosts } from "./intelligence-data";
import { loadWire } from "./workspace/research";

const KEY = "t6-rights-";
const STATES = ["NY", "NC", "FL", "NJ"];
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString();

describe.skipIf(!env.url)("Hamilton data rights in isolated PostgreSQL (V5 T6, #1872)", () => {
  let db: ReturnType<typeof postgres>;

  const cleanup = async () => {
    await db`DELETE FROM reg_articles WHERE guid LIKE ${`${KEY}%`}`;
    await db`DELETE FROM institution_enforcement_actions WHERE source_key LIKE ${`${KEY}%`}`;
  };

  beforeAll(async () => {
    if (!env.loopback) throw new Error("Data rights tests require a loopback E2E database; production connections are forbidden");
    db = postgres(env.url as string, { max: 1, ssl: "require", onnotice: () => {} });
    for (const file of ["20270110000010_reg_tracker_items.sql", "20270110000011_reg_tracker_bill_stage.sql", "20270110000015_institution_enforcement_actions.sql"]) {
      await db.unsafe(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
    }
    await cleanup();
    for (const [i, state] of STATES.entries()) {
      await db`INSERT INTO reg_articles (guid, source, title, link, topic, published_at)
               VALUES (${`${KEY}post-${state}`}, ${`state:${state}`}, ${`${state} banking department bulletin on overdraft fees`},
                       ${`https://regulator.example.test/${state}/post`}, 'general', ${day(10 + i)})`;
      await db`INSERT INTO reg_articles (guid, source, title, link, topic, published_at)
               VALUES (${`${KEY}press-${state}`}, ${`news:${state}`}, ${`${state} lawmakers weigh bank overdraft fee bill`},
                       ${`https://news.example.test/${state}`}, 'general', ${day(5 + i)})`;
      await db`INSERT INTO institution_enforcement_actions (agency, source_key, party_name, party_state, action_type, subject, start_date, document_url)
               VALUES (${`STATE_${state}`}, ${`${KEY}order-${state}`}, ${`Synthetic ${state} Bank`}, ${state}, 'consent order',
                       'Unfair overdraft fees', ${day(30).slice(0, 10)}::date, ${`https://regulator.example.test/${state}/order.pdf`})`;
    }
  });

  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.end();
    }
    await sql.end({ timeout: 1 }).catch(() => {});
  });

  it("the Wire behind a regulation answer cites New Jersey's post and order, and no struck state's", async () => {
    for (const state of STATES) {
      const wire = await loadWire(state, null);
      const postUrls = wire.posts.map((p) => p.link);
      const orderUrls = wire.actions.map((a) => a.url);
      const allowed = state === "NJ";
      expect(postUrls.includes(`https://regulator.example.test/${state}/post`), `${state} post`).toBe(allowed);
      expect(orderUrls.includes(`https://regulator.example.test/${state}/order.pdf`), `${state} order`).toBe(allowed);
    }
  });

  it("the state posts panel shows New Jersey only", async () => {
    expect((await loadStatePosts("NJ"))?.map((p) => p.link)).toContain("https://regulator.example.test/NJ/post");
    for (const state of ["NY", "NC", "FL", "ny"]) expect(await loadStatePosts(state)).toEqual([]);
  });

  it("the Regulatory Wire and its state picker show no struck state's posts and no held press story", async () => {
    const news = await getStateNews({ limit: 200 });
    const links = news.regulator_posts.map((p) => p.link);
    expect(links).toContain("https://regulator.example.test/NJ/post");
    for (const state of ["NY", "NC", "FL"]) expect(links).not.toContain(`https://regulator.example.test/${state}/post`);
    expect(news.press).toEqual([]);
    const wire = await getStateWire({ stateCodes: STATES });
    const wireLinks = wire.items.map((item) => ("link" in item ? item.link : "url" in item ? item.url : null));
    expect(wireLinks).toContain("https://regulator.example.test/NJ/post");
    for (const state of STATES) expect(wireLinks).not.toContain(`https://news.example.test/${state}`);
    for (const state of ["NY", "NC", "FL"]) expect(wireLinks).not.toContain(`https://regulator.example.test/${state}/post`);
    const picker = await getStatesWithNews();
    expect(picker).toContain("NJ");
    for (const state of ["NY", "NC", "FL"]) expect(picker).not.toContain(state);
  });
});
