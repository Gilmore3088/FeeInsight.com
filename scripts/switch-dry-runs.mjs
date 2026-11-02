/**
 * Read-only audit (#1092): every production count an off-by-default switch waits on, in one run.
 *
 *   DATABASE_URL=<prod URL> npm run audit:switch-dry-runs
 *   DATABASE_URL=<prod URL> npm run audit:switch-dry-runs -- --json > switch-dry-runs.json
 *
 * Flags: --json (the whole report as JSON), --sample N (rows printed per list, default 20),
 * --row-cap N (most rows one read returns, default 50000), --max-documents N (dash list candidates
 * scanned, bounded before any text is read, default 3000), --scan-offset N (the next batch),
 * --accuracy-sample N (fees in the live accuracy sample, default 500), --institution ID[,ID]
 * (sections 1 to 5 for those institutions only).
 *
 * Run it off-peak (one snapshot holds back vacuum for the whole run), first scoped with --institution.
 *
 * One BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY transaction: one SET LOCAL statement_timeout,
 * one SHOW transaction_read_only, then SELECT reads. No provider calls, no network beyond the database. The TypeScript runs through jiti with the app's "@/" path alias.
 * Logic: src/lib/agents/deming/switch-dry-runs/.
 */
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": src } });

try {
  const { main } = await jiti.import("../src/lib/agents/deming/switch-dry-runs/cli.ts");
  await main(process.argv.slice(2));
} catch (error) {
  console.error("switch dry-run audit failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
