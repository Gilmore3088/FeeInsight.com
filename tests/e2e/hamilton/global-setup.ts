/**
 * Before the browser suite runs: brings the local database up to today's schema (#2170), then
 * seeds the Hamilton journey fixtures.
 */
import { connectFixtureDb, seedHamiltonFixtures } from "./fixtures";
import { applyPendingMigrations } from "./schema-catch-up";
import { seedResearchFixtures } from "./research-fixtures";

export default async function globalSetup(): Promise<void> {
  const db = connectFixtureDb();
  try {
    const applied = await applyPendingMigrations(db);
    if (applied.length) console.log(`Applied ${applied.length} migrations newer than the schema snapshot.`);
    if (process.env.HAMILTON_E2E_REPORT_STORE) await seedResearchFixtures(db);
    else await seedHamiltonFixtures(db);
  } finally {
    await db.end();
  }
}
