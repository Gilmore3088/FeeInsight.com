import { getSql } from "@/lib/data-store/connection";
import { withReadOnlySwitchAudit } from "@/lib/data-store/switch-dry-runs";
import { parseSwitchAuditArgs } from "./args";
import { formatSwitchDryRuns } from "./format";
import { runSwitchDryRuns } from "./run";

/**
 * The audit's entry point, started by `scripts/switch-dry-runs.mjs` (`npm run audit:switch-dry-runs`).
 * One read-only, repeatable-read transaction; the report goes to stdout as text, or JSON with `--json`.
 */
export async function main(argv: readonly string[]): Promise<void> {
  const { json, options } = parseSwitchAuditArgs(argv);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (the audit only reads)");
  const client = getSql();
  try {
    const now = new Date();
    const report = await withReadOnlySwitchAudit(client, (reader) => runSwitchDryRuns(reader, options, now), { now });
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatSwitchDryRuns(report));
  } finally {
    await client.end({ timeout: 5 });
  }
}
