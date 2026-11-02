/**
 * A real-figures fixture for the Command center screenshots (Hamilton redesign, Nov 2026):
 * Capital City Bank (id 323, Tallahassee FL) with its live published fees, its last 12 FDIC
 * quarters, its five Florida peers (330, 458, 540, 154, 115), ten more Florida banks and credit
 * unions so the state medians reach the 10-institution minimum, and the FDIC Summary of Deposits
 * rows that put Seacoast and First Federal in its local market.
 *
 * Every value in ccb-fixture.data.json was copied read-only from production on 2026-11-02 (see its
 * `about`). Nothing is made up: production has no like-for-like fee change confirmed in Florida in
 * the last 180 days, so the fixture has none either and What changed says so.
 *
 * These rows keep their production ids, outside the synthetic range the base fixtures use, so
 * this file removes exactly what it seeded (by institution id) and refuses a database where any of
 * these institutions already holds fee rows it did not write. Local databases only (connectFixtureDb).
 */
import data from "./ccb-fixture.data.json";
import { ALL_INSTITUTIONS, FIXTURE_USERS, HOME, type FixtureDb } from "./fixtures";

export const CCB_ID = 323;
export const CCB_NAME = "Capital City Bank";
export const CCB_PEER_IDS = [330, 458, 540, 154, 115];
const BATCH = "hamilton-e2e-ccb-fixture";
const EVENT = "00000000-0000-4000-8000-000009720000";
/** Ids for rows production numbers by sequence: kept clear of the base fixtures' 9_701_000 range. */
const RAW_ID_BASE = 9_720_000;
const FILING_ID_BASE = 9_721_000;
const BRANCH_ID_BASE = 9_722_000;

/** [id, name, charter, city, FDIC cert or NCUA charter, total assets ($000), asset tier, website] */
type InstitutionRow = [number, string, "bank" | "credit_union", string, string, number, string, string];
/** [institution, quarter end, assets, deposits, loans, service charges, NIM, efficiency, ROA, ROE, tier 1, branches, net income, equity] ($000 and %) */
type FilingRow = [number, string, number, number, number, number, number, number, number, number, number | null, number, number, number];
/** [institution, cert, county FIPS, city, branches, deposits ($000), holds the main office] (2026 Summary of Deposits, summed per county) */
type BranchRow = [number, number, number, string, number, number, boolean];
/** [source document id, institution, address] */
type DocumentRow = [number, number, string];
/** [document, fee type, fee name, amount, frequency, audience, treatment, published MM-DD (2026), product?] */
type FeeRow = [number, string, string, number, string | null, "c" | "b" | "u" | "x", "c" | "u" | "n", string, string?];

const INSTITUTIONS = data.institutions as InstitutionRow[];
const FILINGS = data.filings as FilingRow[];
const BRANCHES = data.branchDeposits as BranchRow[];
const DOCUMENTS = data.documents as DocumentRow[];
const FEES = data.fees as FeeRow[];

export const CCB_INSTITUTION_IDS = INSTITUTIONS.map((r) => r[0]);

const AUDIENCE = { c: "consumer", b: "both", u: "unknown", x: "business" } as const;
const TREATMENT = { c: "charged", u: "unknown", n: "no_charge" } as const;

async function scopedTables(db: FixtureDb): Promise<string[]> {
  const rows = await db<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'institution_id' AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name`;
  return rows.map((r) => r.table_name);
}

/** Removes every row held by these institutions; safe on a clean database. */
export async function teardownCcbFixture(db: FixtureDb): Promise<void> {
  const ids = CCB_INSTITUTION_IDS.map(String);
  const pending = [...(await scopedTables(db)).map((table) => ({ table, column: "institution_id" })), { table: "institution_sources", column: "id" }];
  // Foreign keys decide the order; a table with none of these rows gets no DELETE (append-only tables refuse one).
  for (let pass = 0; pass < 6 && pending.length; pass += 1) {
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const { table, column } = pending[i];
      try {
        const held = await db.unsafe(`SELECT 1 FROM public.${table} WHERE ${column}::text = ANY($1::text[]) LIMIT 1`, [ids]);
        if (held.length) await db.unsafe(`DELETE FROM public.${table} WHERE ${column}::text = ANY($1::text[])`, [ids]);
        pending.splice(i, 1);
      } catch (error) {
        if (pass === 5) throw error;
      }
    }
  }
}

/** Seeds the fixture from scratch (teardown first). */
export async function seedCcbFixture(db: FixtureDb): Promise<void> {
  const [foreign] = await db<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM published_fee_records
     WHERE institution_id = ANY(${CCB_INSTITUTION_IDS}) AND batch_id IS DISTINCT FROM ${BATCH}`;
  if (foreign.n > 0) throw new Error("These institutions already hold fee rows this fixture did not write; refusing to replace them.");
  // A run kept with HAMILTON_E2E_KEEP=1 left the account lent: hand it back before teardown deletes the link.
  await returnFixtureAccount(db);
  await teardownCcbFixture(db);

  for (const [id, name, charter, city, cert, assets, tier, website] of INSTITUTIONS) {
    await db`INSERT INTO institution_sources (id, institution_name, charter_type, source, city, state, state_code, fed_district, cert_number, asset_size, asset_size_tier, status, website_url)
             VALUES (${id}, ${name}, ${charter}, ${charter === "bank" ? "fdic" : "ncua"}, ${city}, 'Florida', 'FL', 6, ${cert}, ${assets}, ${tier}, 'active', ${website})`;
  }

  let filingId = FILING_ID_BASE;
  for (const [id, date, assets, deposits, loans, sc, nim, eff, roa, roe, tier1, branches, netIncome, equity] of FILINGS) {
    filingId += 1;
    const cert = INSTITUTIONS.find((r) => r[0] === id)?.[4] ?? null;
    await db`INSERT INTO institution_financial_records (id, institution_id, report_date, source, source_cert_number, total_assets, total_deposits, total_loans,
                     service_charge_income, net_interest_margin, efficiency_ratio, roa, roe, tier1_capital_ratio, branch_count, net_income, total_equity, source_url, fetched_at)
             VALUES (${filingId}, ${id}, ${date}, 'fdic', ${cert}, ${assets}, ${deposits}, ${loans}, ${sc}, ${nim}, ${eff}, ${roa}, ${roe}, ${tier1}, ${branches},
                     ${netIncome}, ${equity}, ${`https://api.fdic.gov/banks/financials?filters=REPDTE%3A${date.replace(/-/g, "")}`}, ${`${date}T00:00:00Z`}::timestamptz + INTERVAL '45 days')`;
  }

  let branchId = BRANCH_ID_BASE;
  for (const [id, cert, county, city, , deposits, main] of BRANCHES) {
    branchId += 1;
    await db`INSERT INTO institution_branch_deposits (id, cert, institution_id, year, branch_number, is_main_office, deposits, state, city, county_fips, fed_district)
             VALUES (${branchId}, ${cert}, ${id}, 2026, ${branchId - BRANCH_ID_BASE}, ${main}, ${deposits}, 'FL', ${city}, ${county}, 6)`;
  }

  for (const [docId, id, url] of DOCUMENTS) {
    await db`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
             VALUES (${docId}, ${id}, 'success', ${url}, ${`ccb-fixture-${docId}`}, '2026-10-01T00:00:00Z')`;
  }

  const docInstitution = new Map(DOCUMENTS.map(([docId, id, url]) => [docId, { id, url }]));
  let rawId = RAW_ID_BASE;
  for (const [docId, key, name, amount, frequency, audienceCode, treatmentCode, published, product] of FEES) {
    const doc = docInstitution.get(docId);
    if (!doc) throw new Error(`Fee "${name}" names document ${docId}, which the fixture does not hold.`);
    rawId += 1;
    // One printed line can carry two fee types (an NSF/overdraft line): line_share keeps their raw reads apart, as production does.
    const audience = AUDIENCE[audienceCode];
    const treatment = TREATMENT[treatmentCode];
    await db`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source, source_url,
                     amount_kind, fee_audience, audience_evidence, fee_treatment, product_name, line_share)
             VALUES (${rawId}, ${doc.id}, ${docId}, ${EVENT}, ${name}, ${amount}, ${frequency}, 'knox', ${doc.url}, 'flat', ${audience}, 'Copied from production', ${treatment},
                     ${product ?? null}, ${`${key}:${rawId}`})`;
    const [verified] = await db`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status, source_url, amount_kind)
             VALUES (${rawId}, ${doc.id}, ${key}, ${EVENT}, ${name}, ${amount}, ${frequency}, 'verified', ${doc.url}, 'flat') RETURNING fee_verified_id`;
    await db`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount,
                     frequency, batch_id, source_url, published_at, amount_kind, fee_audience, audience_evidence, fee_treatment)
             VALUES (${verified.fee_verified_id}, ${doc.id}, ${key}, ${EVENT}, ${name}, ${amount}, ${frequency}, ${BATCH}, ${doc.url},
                     ${`2026-${published}T12:00:00Z`}, 'flat', ${audience}, 'Copied from production', ${treatment})`;
  }
}

/**
 * For the screenshots, the Pro fixture account is linked to Capital City Bank in place of its
 * synthetic home, and the synthetic fixture institutions step out of Florida and its Federal
 * Reserve district, so every name and median on the page is a real one. `returnFixtureAccount`
 * puts all of it back; call it before teardownCcbFixture, which would otherwise delete the link.
 */
export async function lendFixtureAccount(db: FixtureDb): Promise<void> {
  await db`UPDATE institution_workspace_memberships SET institution_id = ${CCB_ID} WHERE user_id = ${FIXTURE_USERS.pro.id} AND institution_id = ${HOME.id}`;
  await db`UPDATE users SET institution_name = ${CCB_NAME} WHERE id = ${FIXTURE_USERS.pro.id}`;
  await db`INSERT INTO hamilton_workspace_contexts (user_id, selected_institution_id, selected_source)
           VALUES (${FIXTURE_USERS.pro.id}, ${CCB_ID}, 'manual')
           ON CONFLICT (user_id) DO UPDATE SET selected_institution_id = EXCLUDED.selected_institution_id`;
  await db`UPDATE institution_sources SET state = NULL, state_code = NULL, fed_district = NULL WHERE id = ANY(${ALL_INSTITUTIONS.map((i) => i.id)})`;
}

export async function returnFixtureAccount(db: FixtureDb): Promise<void> {
  await db`UPDATE institution_workspace_memberships SET institution_id = ${HOME.id} WHERE user_id = ${FIXTURE_USERS.pro.id} AND institution_id = ${CCB_ID}`;
  await db`UPDATE users SET institution_name = ${HOME.name} WHERE id = ${FIXTURE_USERS.pro.id}`;
  await db`DELETE FROM hamilton_workspace_contexts WHERE user_id = ${FIXTURE_USERS.pro.id} AND selected_institution_id = ${CCB_ID}`;
  for (const inst of ALL_INSTITUTIONS) {
    await db`UPDATE institution_sources SET state = ${inst.state}, state_code = ${inst.state}, fed_district = 6 WHERE id = ${inst.id}`;
  }
}
