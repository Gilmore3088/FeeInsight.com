/** Seeds the Hamilton journey fixtures into the local database before the browser suite runs. */
import { connectFixtureDb, seedHamiltonFixtures } from "./fixtures";

export default async function globalSetup(): Promise<void> {
  const db = connectFixtureDb();
  try {
    await seedHamiltonFixtures(db);
  } finally {
    await db.end();
  }
}
