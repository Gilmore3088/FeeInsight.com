// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ db: null as unknown, stripe: null as unknown }));
vi.mock("@/lib/data-store/connection", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data-store/connection")>();
  const tag = (...args: unknown[]) => (context.db as (...args: unknown[]) => unknown)(...args);
  return { ...original, sql: tag, withTransaction: (callback: (tx: unknown) => Promise<unknown>) =>
    (context.db as { begin: (fn: (tx: unknown) => Promise<unknown>) => unknown }).begin(callback) };
});
vi.mock("@/lib/stripe", () => ({ getStripe: () => context.stripe }));
import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";
import { createGuardedCheckout } from "./checkout";
import { withCheckoutLock } from "@/lib/data-store/checkout-intents";

const testUrl = process.env.BILLING_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
let db: ReturnType<typeof postgres>;
const sessions = new Map<string, Record<string, unknown>>();
const create = vi.fn();
const params = (id = 7) => ({ mode: "subscription" as const, customer: `cus_${id}`,
  line_items: [{ price: "price_test", quantity: 1 }], metadata: { user_id: String(id) },
  success_url: "https://example.invalid/success", cancel_url: "https://example.invalid/cancel" });

suite("checkout persistence in disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/feeinsight_billing_test")) {
      throw new Error("Refusing integration fixtures outside a local feeinsight_billing_test database");
    }
    db = postgres(testUrl!, { max: 16, prepare: false, types: { json: JSON_TEXT_PASSTHROUGH } });
    context.db = db;
    await db.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      END $$;`);
    await db.unsafe(`CREATE TABLE IF NOT EXISTS users (id bigint PRIMARY KEY);
      DROP TABLE IF EXISTS pro_checkout_intents;`);
    await db.unsafe(readFileSync(resolve("supabase/migrations/20270110000042_pro_checkout_intents.sql"), "utf8"));
  });
  beforeEach(async () => {
    await db`TRUNCATE pro_checkout_intents, users CASCADE`;
    await db`INSERT INTO users(id) VALUES (7), (8)`;
    sessions.clear(); create.mockReset();
    create.mockImplementation(async (body: Record<string, unknown>) => {
      await new Promise((done) => setTimeout(done, 10));
      const item = { id: `cs_${sessions.size + 1}`, mode: "subscription", status: "open", customer: body.customer,
        metadata: body.metadata, url: `https://checkout.stripe.invalid/${sessions.size + 1}` };
      sessions.set(item.id, item); return item;
    });
    context.stripe = { subscriptions: { list: async () => ({ data: [], has_more: false }) }, checkout: { sessions: {
      create,
      list: async ({ customer }: { customer: string }) => ({ data: [...sessions.values()].filter((x) => x.customer === customer && x.status === "open"), has_more: false }),
      retrieve: async (id: string) => sessions.get(id),
      expire: async (id: string) => { const item = sessions.get(id)!; item.status = "expired"; return item; },
    } } };
  });
  afterAll(async () => { if (db) await db.end(); });

  it("serializes sixteen real concurrent transactions into one checkout", async () => {
    const results = await Promise.all(Array.from({ length: 16 }, () => createGuardedCheckout(7, "cus_7", params())));
    expect(create).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    const rows = await db`SELECT * FROM pro_checkout_intents WHERE retired_at IS NULL`;
    expect(rows).toHaveLength(1); expect(rows[0].session_id).toBe("cs_1");
    expect(typeof rows[0].parameters).toBe("object");
  });
  it("retains a committed reservation after a lost Stripe response", async () => {
    const normal = create.getMockImplementation()!;
    create.mockImplementationOnce(async (...args: unknown[]) => { await normal(...args); throw new Error("response lost after creation"); });
    await expect(createGuardedCheckout(7, "cus_7", params())).rejects.toThrow("response lost");
    const [before] = await db`SELECT id, session_id FROM pro_checkout_intents`;
    expect(before.session_id).toBeNull(); expect(sessions.size).toBe(1);
    await createGuardedCheckout(7, "cus_7", params());
    const [after] = await db`SELECT id, session_id FROM pro_checkout_intents`;
    expect(after.id).toBe(before.id); expect(after.session_id).toBe("cs_1"); expect(create).toHaveBeenCalledTimes(1);
  });
  it("keeps customers independent while preventing each customer's duplicates", async () => {
    await Promise.all([7, 8, 7, 8, 7, 8].map((id) => createGuardedCheckout(id, `cus_${id}`, params(id))));
    expect(create).toHaveBeenCalledTimes(2);
    expect(await db`SELECT id FROM pro_checkout_intents`).toHaveLength(2);
  });
  it("rolls back receipt updates without losing the earlier committed reservation", async () => {
    create.mockRejectedValueOnce(new Error("offline"));
    await expect(createGuardedCheckout(7, "cus_7", params())).rejects.toThrow();
    await expect(withCheckoutLock(7, async (store) => {
      const intent = (await store.current())!; await store.session(intent.id, "cs_not_committed"); throw new Error("interruption");
    })).rejects.toThrow("interruption");
    const [row] = await db`SELECT state, session_id FROM pro_checkout_intents`;
    expect(row.state).toBe("pending"); expect(row.session_id).toBeNull();
  });
  it("enforces one active intent even outside the application lock", async () => {
    await createGuardedCheckout(7, "cus_7", params());
    await expect(db`INSERT INTO pro_checkout_intents(id,user_id,customer_id,fingerprint,parameters)
      VALUES ('00000000-0000-4000-8000-000000000001',7,'cus_7',${"a".repeat(64)},'{}')`).rejects.toMatchObject({ code: "23505" });
  });
  it("does not expose checkout parameters to anonymous or signed-in API roles", async () => {
    await createGuardedCheckout(7, "cus_7", params());
    for (const role of ["anon", "authenticated"]) {
      await expect(db.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx.unsafe("SELECT parameters FROM pro_checkout_intents");
      })).rejects.toMatchObject({ code: "42501" });
    }
    const [table] = await db`SELECT relrowsecurity FROM pg_class WHERE oid='public.pro_checkout_intents'::regclass`;
    expect(table.relrowsecurity).toBe(true);
  });
});
