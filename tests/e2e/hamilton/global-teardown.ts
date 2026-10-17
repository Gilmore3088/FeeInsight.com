/**
 * Removes the fixtures and every row the journeys wrote for them. HAMILTON_E2E_KEEP=1 keeps them,
 * so a person can sign in by hand afterwards and look at the same data.
 */
import { connectFixtureDb, teardownHamiltonFixtures } from "./fixtures";

export default async function globalTeardown(): Promise<void> {
  if (process.env.HAMILTON_E2E_KEEP === "1") return;
  const db = connectFixtureDb();
  try {
    await teardownHamiltonFixtures(db);
  } finally {
    await db.end();
  }
}
