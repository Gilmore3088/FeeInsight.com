/**
 * H07-T02 (#982): deterministic database fixtures for the Hamilton journeys.
 *
 * Seeds a synthetic Pro account, a linked home institution, a second Pro account with no home,
 * an admin, twelve similarly sized peers plus three that must be left out, and fees through the
 * three tiers (raw -> verified -> published) so `published_fee_catalog` and
 * `published_fee_rate_catalog` show them exactly as production would. The fee set covers a $0
 * fee (stated as no charge), a fee stated as a rate, a fee whose source is over a year old, a
 * peer with no fee of the compared type, and a peer too thin to reach the catalog.
 *
 * Every row is synthetic and lives in a reserved id range (9_701_000 to 9_709_999), so setup is
 * re-runnable and teardown removes only these rows. It refuses any database that is not on this
 * machine: the fixtures are for `tests/e2e/production-schema.sql` loaded into a throwaway local
 * database, never for production.
 */
import postgres from "postgres";

export type FixtureDb = ReturnType<typeof postgres>;

/** Lowest and highest ids the fixtures use, for every table they touch. */
export const FIXTURE_ID_MIN = 9_701_000;
export const FIXTURE_ID_MAX = 9_709_999;
/** Marks the provider stop the fixtures switch on, so teardown only lifts its own stop. */
export const FIXTURE_STOP_REASON = "hamilton-e2e fixtures: provider calls off on this local database";
const EVENT = "00000000-0000-4000-8000-000009701000";

/** Synthetic password for every fixture login. It works only on the local fixture database. */
export const FIXTURE_PASSWORD = "hamilton-e2e-fixture-only";

export const FIXTURE_USERS = {
  /** Pro subscriber whose account is linked (owner membership) to the home institution. */
  pro: { id: 9_701_101, email: "pro.e2e@fixture.test", name: "Pat Fixture", role: "premium" as const },
  /** Second Pro subscriber with no linked institution: the absent-home and denial variants. */
  proNoHome: { id: 9_701_102, email: "pro2.e2e@fixture.test", name: "Sam Fixture", role: "premium" as const },
  /** Operator who may hold, correct and reverse fees. */
  admin: { id: 9_701_103, email: "admin.e2e@fixture.test", name: "Alex Fixture Admin", role: "admin" as const },
  /** Signed-in account without a subscription: Hamilton must refuse it. */
  viewer: { id: 9_701_104, email: "viewer.e2e@fixture.test", name: "Vic Fixture", role: "viewer" as const },
};

export interface FixtureInstitution {
  id: number;
  name: string;
  charter: "credit_union" | "bank";
  city: string;
  state: string;
  /** Total assets in USD thousands, as the FDIC and NCUA importers store them; null is unknown. */
  assetsThousands: number | null;
}

export const HOME: FixtureInstitution = {
  id: 9_701_001, name: "Space Coast Test Credit Union", charter: "credit_union", city: "Melbourne", state: "FL", assetsThousands: 9_000_000,
};

/** Twelve credit unions within half to double the home's assets: the "ten similarly sized" pool. */
export const PEERS: FixtureInstitution[] = [
  { id: 9_701_002, name: "Indian River Test CU", charter: "credit_union", city: "Vero Beach", state: "FL", assetsThousands: 8_800_000 },
  { id: 9_701_003, name: "Gulf Breeze Test CU", charter: "credit_union", city: "Pensacola", state: "FL", assetsThousands: 9_400_000 },
  { id: 9_701_004, name: "Suncoast Harbor Test CU", charter: "credit_union", city: "Tampa", state: "FL", assetsThousands: 8_100_000 },
  { id: 9_701_005, name: "Palmetto Grove Test CU", charter: "credit_union", city: "Orlando", state: "FL", assetsThousands: 10_200_000 },
  { id: 9_701_006, name: "Keystone Bay Test CU", charter: "credit_union", city: "Jacksonville", state: "FL", assetsThousands: 7_300_000 },
  { id: 9_701_007, name: "Lantana Test CU", charter: "credit_union", city: "Miami", state: "FL", assetsThousands: 11_500_000 },
  { id: 9_701_008, name: "Coquina Test CU", charter: "credit_union", city: "Daytona Beach", state: "FL", assetsThousands: 6_200_000 },
  { id: 9_701_009, name: "Peachtree Test CU", charter: "credit_union", city: "Atlanta", state: "GA", assetsThousands: 9_900_000 },
  { id: 9_701_010, name: "Chattahoochee Test CU", charter: "credit_union", city: "Columbus", state: "GA", assetsThousands: 8_600_000 },
  { id: 9_701_011, name: "Savannah Marsh Test CU", charter: "credit_union", city: "Savannah", state: "GA", assetsThousands: 12_800_000 },
  { id: 9_701_012, name: "Mobile Bay Test CU", charter: "credit_union", city: "Mobile", state: "AL", assetsThousands: 5_400_000 },
  { id: 9_701_013, name: "Tennessee Valley Test CU", charter: "credit_union", city: "Huntsville", state: "AL", assetsThousands: 15_000_000 },
];

/** Must never appear in the similarly sized list: unknown assets, a bank, and one far too small. */
export const EXCLUDED: FixtureInstitution[] = [
  { id: 9_701_014, name: "Unknown Assets Test CU", charter: "credit_union", city: "Tampa", state: "FL", assetsThousands: null },
  { id: 9_701_015, name: "Seminole Test Bank", charter: "bank", city: "Orlando", state: "FL", assetsThousands: 9_100_000 },
  { id: 9_701_016, name: "Tiny Lagoon Test CU", charter: "credit_union", city: "Cocoa", state: "FL", assetsThousands: 300_000 },
];

export const ALL_INSTITUTIONS = [HOME, ...PEERS, ...EXCLUDED];

export interface FixtureFee {
  institutionId: number;
  key: string;
  name: string;
  /** Dollars; 0 is a stated "no charge". Null with a rate is a fee stated as a percentage. */
  amount: number | null;
  ratePercent?: number;
  /** ISO date the fee was published; an old date makes the source over a year old. */
  publishedAt?: string;
}

/** A stale source: published well over a year before any run of this suite. */
export const STALE_DATE = "2024-05-01T00:00:00Z";

/** Fee lines the journeys check. Peers not named here carry three ordinary lines (see below). */
export const NAMED_FEES = {
  homeNsf: { institutionId: HOME.id, key: "nsf", name: "NSF Fee", amount: 27 },
  /** The fee the admin journey holds, corrects and reverses (wrong amount: the schedule says $30). */
  homeStopPayment: { institutionId: HOME.id, key: "stop_payment", name: "Stop Payment Fee", amount: 25 },
  homeOverdraft: { institutionId: HOME.id, key: "overdraft", name: "Overdraft Fee", amount: 27 },
  homeForeign: { institutionId: HOME.id, key: "card_foreign_txn", name: "Foreign Transaction Fee", amount: null, ratePercent: 1.1 },
  /** $0: stated as no charge, shown as $0.00, never as missing. */
  zeroNsf: { institutionId: 9_701_003, key: "nsf", name: "NSF Fee", amount: 0 },
  /** Source over a year old. */
  staleNsf: { institutionId: 9_701_004, key: "nsf", name: "Returned Item (NSF) Fee", amount: 25, publishedAt: STALE_DATE },
  /** Fee stated as a rate: listed as a percentage, never as dollars. */
  rateForeign: { institutionId: 9_701_002, key: "card_foreign_txn", name: "International Transaction Fee", amount: null, ratePercent: 1 },
} satisfies Record<string, FixtureFee>;

/** Peer 9_701_005 has no NSF line at all: "No published consumer NSF fee on file". */
export const PEER_WITHOUT_NSF = 9_701_005;
/** Peer 9_701_008 has only two fee types, too thin for the catalog: "No published fees on file". */
export const THIN_PEER = 9_701_008;

export function fixtureFees(): FixtureFee[] {
  const named = Object.values(NAMED_FEES) as FixtureFee[];
  const fees: FixtureFee[] = [...named];
  const has = (id: number, key: string) => fees.some((f) => f.institutionId === id && f.key === key);
  const add = (fee: FixtureFee) => { if (!has(fee.institutionId, fee.key)) fees.push(fee); };
  [...PEERS, ...EXCLUDED].forEach((inst, i) => {
    if (inst.id === THIN_PEER) {
      add({ institutionId: inst.id, key: "overdraft", name: "Overdraft Fee", amount: 32 });
      add({ institutionId: inst.id, key: "stop_payment", name: "Stop Payment Fee", amount: 30 });
      return;
    }
    if (inst.id !== PEER_WITHOUT_NSF) add({ institutionId: inst.id, key: "nsf", name: "NSF Fee", amount: 26 + (i % 6) });
    add({ institutionId: inst.id, key: "overdraft", name: "Overdraft Fee", amount: 28 + (i % 5) });
    add({ institutionId: inst.id, key: "stop_payment", name: "Stop Payment Fee", amount: 30 + (i % 4) });
    add({ institutionId: inst.id, key: "monthly_maintenance", name: "Monthly Maintenance Fee", amount: 5 + (i % 3) });
  });
  return fees;
}

/** The home's stored schedule text: the admin correction's source check reads it. */
export const HOME_SCHEDULE_TEXT = [
  "SPACE COAST TEST CREDIT UNION FEE SCHEDULE (SYNTHETIC)",
  "OTHER SERVICES",
  "NSF Fee | $27.00 per item",
  "Overdraft Fee | $27.00 per item",
  "Stop Payment Fee | $30.00",
  "Foreign Transaction Fee | 1.1% of the transaction",
].join("\n");

const docId = (institutionId: number) => institutionId + 200;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Throws unless the URL names a database on this machine. */
export function assertLoopbackDatabase(url: string | undefined): string {
  if (!url) throw new Error("Set E2E_DATABASE_URL to a local database loaded from tests/e2e/production-schema.sql.");
  let host: string;
  try { host = new URL(url).hostname; } catch { throw new Error("E2E_DATABASE_URL is not a valid URL."); }
  if (!LOOPBACK.has(host)) throw new Error(`Hamilton fixtures run only on a local database; refused host ${host}.`);
  return url;
}

export function connectFixtureDb(url = process.env.E2E_DATABASE_URL): FixtureDb {
  return postgres(assertLoopbackDatabase(url), { max: 1, ssl: process.env.E2E_DATABASE_SSL === "disable" ? false : "require", onnotice: () => {} });
}

/** Tables with a user or institution column, so teardown also finds rows a journey wrote. */
async function scopedTables(db: FixtureDb, column: string): Promise<string[]> {
  const rows = await db<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = ${column} AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name`;
  return rows.map((r) => r.table_name);
}

/**
 * Removes every fixture row and every row a journey wrote for a fixture user or institution.
 * Rows outside the reserved range are never touched. Safe to run on a clean database.
 */
export async function teardownHamiltonFixtures(db: FixtureDb): Promise<void> {
  const ids = Array.from({ length: FIXTURE_ID_MAX - FIXTURE_ID_MIN + 1 }, (_, i) => String(FIXTURE_ID_MIN + i));
  // Runs (and their index rows) written by an admin hold or correction of a fixture fee.
  const runIds: string[] = [];
  for (const table of ["published_fee_corrections", "pipeline_feedback"]) {
    if (!(await tableExists(db, table))) continue;
    const rows = await db.unsafe(
      `SELECT DISTINCT agent_run_id::text AS id FROM public.${table} WHERE institution_id BETWEEN $1 AND $2 AND agent_run_id IS NOT NULL`,
      [FIXTURE_ID_MIN, FIXTURE_ID_MAX],
    ) as Array<{ id: string }>;
    runIds.push(...rows.map((r) => r.id));
  }
  const pending = [
    ...(await scopedTables(db, "user_id")).map((table) => ({ table, column: "user_id" })),
    ...(await scopedTables(db, "institution_id")).map((table) => ({ table, column: "institution_id" })),
    { table: "users", column: "id" },
    { table: "institution_sources", column: "id" },
  ];
  // Foreign keys decide the order; retry what a dependent row still blocks.
  for (let pass = 0; pass < 6 && pending.length; pass += 1) {
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const { table, column } = pending[i];
      try {
        await db.unsafe(`DELETE FROM public.${table} WHERE ${column}::text = ANY($1::text[])`, [ids]);
        pending.splice(i, 1);
      } catch (error) {
        if (pass === 5) throw error;
      }
    }
  }
  if (runIds.length) {
    const unique = [...new Set(runIds)];
    await db`DELETE FROM fee_index_cache WHERE agent_run_id::text = ANY(${unique})`;
    // Events and steps go with the run (ON DELETE CASCADE).
    await db`DELETE FROM agent_runs WHERE id::text = ANY(${unique})`;
  }
  await db`UPDATE automation_control SET enabled = true, reason = NULL, changed_by = 'hamilton-e2e', changed_at = NOW(), revision = revision + 1
            WHERE control_key = 'global' AND reason = ${FIXTURE_STOP_REASON}`;
}

async function tableExists(db: FixtureDb, table: string): Promise<boolean> {
  const [row] = await db<{ ok: boolean }[]>`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS ok`;
  return Boolean(row?.ok);
}

/** Seeds the fixtures from scratch (teardown first), and returns the published fee id of each named fee. */
export async function seedHamiltonFixtures(db: FixtureDb): Promise<Record<keyof typeof NAMED_FEES, number>> {
  await teardownHamiltonFixtures(db);
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash(FIXTURE_PASSWORD, 4);

  for (const u of Object.values(FIXTURE_USERS)) {
    const active = u.role === "premium";
    await db`INSERT INTO users (id, username, email, password_hash, display_name, role, is_active, subscription_status, institution_name, state_code)
             VALUES (${u.id}, ${u.email}, ${u.email}, ${hash}, ${u.name}, ${u.role}, true, ${active ? "active" : "none"},
                     ${u.id === FIXTURE_USERS.pro.id ? HOME.name : null}, ${u.id === FIXTURE_USERS.pro.id ? HOME.state : null})`;
  }

  for (const inst of ALL_INSTITUTIONS) {
    await db`INSERT INTO institution_sources (id, institution_name, charter_type, source, city, state, state_code, fed_district, status, website_url)
             VALUES (${inst.id}, ${inst.name}, ${inst.charter}, ${inst.charter === "bank" ? "fdic" : "ncua"}, ${inst.city}, ${inst.state}, ${inst.state},
                     ${6}, 'active', ${`https://fixture.test/${inst.id}`})`;
    await db`INSERT INTO institution_financial_records (id, institution_id, report_date, source, total_assets, source_url, fetched_at)
             VALUES (${inst.id + 100}, ${inst.id}, '2026-06-30', ${inst.charter === "bank" ? "fdic" : "ncua"}, ${inst.assetsThousands},
                     ${inst.charter === "bank" ? "https://api.fdic.gov/fixture" : "https://ncua.gov/fixture"}, '2026-08-01T00:00:00Z')`;
    await db`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
             VALUES (${docId(inst.id)}, ${inst.id}, 'success', ${`https://fixture.test/${inst.id}/fees.pdf`}, ${`fixture-${inst.id}`}, '2026-09-01T00:00:00Z')`;
  }
  await db`INSERT INTO agent_source_texts (source_document_id, institution_id, status, normalized_text)
           VALUES (${docId(HOME.id)}, ${HOME.id}, 'completed', ${HOME_SCHEDULE_TEXT})`;

  // The Pro account's linked home: an owner membership, which also gives it a workspace seat.
  await db`INSERT INTO institution_workspace_memberships (id, institution_id, user_id, membership_role, membership_status, source, notes)
           VALUES (${FIXTURE_ID_MIN + 501}, ${HOME.id}, ${FIXTURE_USERS.pro.id}, 'owner', 'active', 'manual_admin', 'hamilton-e2e synthetic link')`;

  const published: Partial<Record<keyof typeof NAMED_FEES, number>> = {};
  let rawId = FIXTURE_ID_MIN + 2000;
  for (const fee of fixtureFees()) {
    rawId += 1;
    const isRate = fee.amount === null && fee.ratePercent !== undefined;
    const publishedAt = fee.publishedAt ?? new Date(Date.now() - 20 * 86_400_000).toISOString();
    const treatment = isRate ? "charged" : fee.amount === 0 ? "no_charge" : "charged";
    // Audience and treatment are set on the raw read; the verified and published rows inherit them.
    await db`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source, source_url,
                     amount_kind, rate_percent, rate_basis, fee_audience, audience_evidence, fee_treatment)
             VALUES (${rawId}, ${fee.institutionId}, ${docId(fee.institutionId)}, ${EVENT}, ${fee.name}, ${fee.amount}, 'per_item', 'knox',
                     ${`https://fixture.test/${fee.institutionId}/fees.pdf`}, ${isRate ? "percent" : "flat"}, ${isRate ? fee.ratePercent! : null},
                     ${isRate ? "transaction" : null}, 'consumer', 'Synthetic consumer schedule', ${treatment})`;
    const [verified] = await db`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status, source_url,
                     amount_kind, rate_percent, rate_basis)
             VALUES (${rawId}, ${fee.institutionId}, ${fee.key}, ${EVENT}, ${fee.name}, ${fee.amount}, 'per_item', 'verified',
                     ${`https://fixture.test/${fee.institutionId}/fees.pdf`}, ${isRate ? "percent" : "flat"}, ${isRate ? fee.ratePercent! : null},
                     ${isRate ? "transaction" : null}) RETURNING fee_verified_id`;
    const [row] = await db`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount,
                     frequency, batch_id, source_url, published_at, amount_kind, rate_percent, rate_basis, fee_audience, audience_evidence, fee_treatment)
             VALUES (${verified.fee_verified_id}, ${fee.institutionId}, ${fee.key}, ${EVENT}, ${fee.name}, ${fee.amount}, 'per_item', 'hamilton-e2e-fixture',
                     ${`https://fixture.test/${fee.institutionId}/fees.pdf`}, ${publishedAt}, ${isRate ? "percent" : "flat"},
                     ${isRate ? fee.ratePercent! : null}, ${isRate ? "transaction" : null}, 'consumer', 'Synthetic consumer schedule', ${treatment})
             RETURNING fee_published_id`;
    const name = (Object.keys(NAMED_FEES) as Array<keyof typeof NAMED_FEES>).find((k) =>
      NAMED_FEES[k].institutionId === fee.institutionId && NAMED_FEES[k].key === fee.key);
    if (name) published[name] = Number(row.fee_published_id);
  }

  // A saved answer from before research subjects were recorded: it must reopen unscoped.
  await db`INSERT INTO hamilton_saved_analyses (id, user_id, institution_id, title, analysis_focus, prompt, response_json)
           VALUES ('00000000-0000-4000-8000-000009701301', ${String(FIXTURE_USERS.pro.id)}, '', 'Legacy fixture answer', 'pricing',
                   'What is the median NSF fee?', ${db.json({
                     title: "Legacy fixture answer", confidence: "medium",
                     hamiltonView: "A legacy synthetic answer saved without a research subject.",
                     whatThisMeans: "", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [],
                   })})`;

  // Paid calls stay off for the whole run, whatever keys the machine holds.
  await db`UPDATE automation_control SET enabled = false, reason = ${FIXTURE_STOP_REASON}, changed_by = 'hamilton-e2e', changed_at = NOW(), revision = revision + 1
            WHERE control_key = 'global'`;
  return published as Record<keyof typeof NAMED_FEES, number>;
}
