/** Read-only launch-evidence audit. It checks evidence integrity, not the truth of
 * the human assessment. No network, database mutation, payments, or email access. */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_CHECKS = Object.freeze([
  "source_backed_fee_review", "fee_category_and_unit_review", "institution_scope_isolation",
  "signup_checkout_access", "duplicate_checkout_and_webhooks", "payment_recovery_and_cancellation",
  "durable_report_delivery", "admin_fee_correction", "build_tests_and_security", "rollback_and_monitoring",
]);
const CATALOG_CHECKS = new Set([
  "source_backed_fee_review", "fee_category_and_unit_review", "institution_scope_isolation", "admin_fee_correction",
]);
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Evidence is fresh for 24 hours by this release policy, with five minutes of clock skew. */
function fresh(value, now) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return false;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) && stamp <= now + 300_000 && now - stamp <= MAX_AGE_MS;
}

export function auditLaunchReadiness(manifest, { commit, catalogSnapshot, root, now = Date.now() }) {
  const errors = [];
  if (!SHA.test(commit ?? "")) errors.push("Expected release commit must be a full lowercase Git SHA.");
  if (!nonempty(catalogSnapshot)) errors.push("An explicit expected catalog snapshot is required.");
  if (!object(manifest)) return { ready: false, errors: [...errors, "Manifest must be a JSON object."] };
  if (manifest.schemaVersion !== 1) errors.push("Unsupported evidence schema version.");
  if (manifest.releaseCommit !== commit) errors.push("Evidence does not match the expected release commit.");
  if (manifest.catalogSnapshotId !== catalogSnapshot) errors.push("Evidence does not match the expected catalog snapshot.");
  if (!fresh(manifest.evaluatedAt, now)) errors.push("Release evidence is missing, future-dated, or older than 24 hours.");
  let evidenceRoot;
  try { evidenceRoot = realpathSync(root); } catch { errors.push("Evidence directory is unavailable."); }
  const checks = object(manifest.checks) ? manifest.checks : {};
  for (const name of REQUIRED_CHECKS) {
    const check = checks[name];
    if (!object(check)) { errors.push(`${name}: missing check.`); continue; }
    if (check.status !== "passed") errors.push(`${name}: not passed.`);
    if (!nonempty(check.checkedBy)) errors.push(`${name}: reviewer is missing.`);
    if (!fresh(check.checkedAt, now)) errors.push(`${name}: check is not current.`);
    if (check.releaseCommit !== commit) errors.push(`${name}: check covers another commit.`);
    if (CATALOG_CHECKS.has(name) && check.catalogSnapshotId !== catalogSnapshot) errors.push(`${name}: check covers another catalog snapshot.`);
    if (check.blockingIssues !== 0) errors.push(`${name}: blocking issue count is missing or nonzero.`);
    if (!nonempty(check.evidenceFile) || !SHA256.test(check.evidenceSha256 ?? "")) {
      errors.push(`${name}: evidence path and SHA-256 digest are required.`); continue;
    }
    try {
      if (!evidenceRoot || isAbsolute(check.evidenceFile)) throw new Error("Evidence must be relative to the manifest directory.");
      const file = realpathSync(resolve(evidenceRoot, check.evidenceFile));
      const local = relative(evidenceRoot, file);
      if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error("Evidence escapes the manifest directory.");
      const stats = statSync(file);
      if (!stats.isFile() || stats.size === 0 || stats.size > 10 * 1024 * 1024) throw new Error("Evidence must be a nonempty file no larger than 10 MiB.");
      const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
      if (actual !== check.evidenceSha256) throw new Error("Evidence digest mismatch.");
    } catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : "Evidence could not be read."}`); }
  }
  const approval = manifest.approval;
  if (!object(approval) || !nonempty(approval.approvedBy) || approval.releaseCommit !== commit || !fresh(approval.approvedAt, now)) {
    errors.push("Current owner approval for this exact release is missing.");
  }
  return { ready: errors.length === 0, errors };
}

export function runAudit(args) {
  if (args.length !== 5 || args[1] !== "--commit" || args[3] !== "--catalog-snapshot") {
    console.error("Usage: node scripts/audit-launch-readiness.mjs <manifest.json> --commit <full-sha> --catalog-snapshot <snapshot-id>");
    return 2;
  }
  try {
    const file = resolve(args[0]);
    if (statSync(file).size > 1024 * 1024) throw new Error("Manifest exceeds 1 MiB.");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    const result = auditLaunchReadiness(manifest, { commit: args[2], catalogSnapshot: args[4], root: dirname(file) });
    console.log(JSON.stringify({ ...result, notice: "This verifies evidence completeness and integrity, not factual accuracy or production readiness by itself." }, null, 2));
    return result.ready ? 0 : 1;
  } catch (error) {
    console.error(`Launch evidence unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runAudit(process.argv.slice(2));
}
