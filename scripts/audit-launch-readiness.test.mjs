// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLaunchReadiness, REQUIRED_CHECKS, runAudit } from "./audit-launch-readiness.mjs";

const commit = "a".repeat(40);
const now = Date.parse("2026-10-10T10:00:00Z");
const checkedAt = new Date(now).toISOString();
let root, manifest, options;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "feeinsight-launch-test-"));
  const content = "Synthetic test fixture only. This is NOT a real launch acceptance record.\n";
  writeFileSync(join(root, "fixture.txt"), content);
  const check = { status: "passed", checkedBy: "test reviewer", checkedAt, releaseCommit: commit, catalogSnapshotId: "test-catalog", blockingIssues: 0, evidenceFile: "fixture.txt", evidenceSha256: createHash("sha256").update(content).digest("hex") };
  manifest = { schemaVersion: 1, releaseCommit: commit, catalogSnapshotId: "test-catalog", evaluatedAt: checkedAt, checks: Object.fromEntries(REQUIRED_CHECKS.map((name) => [name, { ...check }])), approval: { approvedBy: "test owner", approvedAt: checkedAt, releaseCommit: commit } };
  options = { commit, catalogSnapshot: "test-catalog", root, now };
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
describe("read-only launch evidence guard", () => {
  it("accepts a complete current synthetic fixture", () => expect(auditLaunchReadiness(manifest, options)).toEqual({ ready: true, errors: [] }));
  it("does not treat missing or pending checks as a pass", () => {
    delete manifest.checks.durable_report_delivery;
    manifest.checks.signup_checkout_access.status = "pending";
    expect(auditLaunchReadiness(manifest, options).errors).toEqual(expect.arrayContaining(["durable_report_delivery: missing check.", "signup_checkout_access: not passed."]));
  });
  it("rejects stale and future-dated evidence", () => {
    for (const offset of [-25 * 3600000, 3600000]) {
      manifest.checks.source_backed_fee_review.checkedAt = new Date(now + offset).toISOString();
      expect(auditLaunchReadiness(manifest, options).ready).toBe(false);
    }
  });
  it("rejects another release and another data snapshot", () => {
    expect(auditLaunchReadiness(manifest, { ...options, commit: "b".repeat(40) }).ready).toBe(false);
    expect(auditLaunchReadiness(manifest, { ...options, catalogSnapshot: "other-catalog" }).ready).toBe(false);
  });
  it("checks every check's commit and catalog scope", () => {
    manifest.checks.admin_fee_correction.catalogSnapshotId = "old-catalog";
    manifest.checks.duplicate_checkout_and_webhooks.releaseCommit = "b".repeat(40);
    expect(auditLaunchReadiness(manifest, options).errors).toHaveLength(2);
  });
  it("rejects altered evidence", () => {
    writeFileSync(join(root, "fixture.txt"), "tampered");
    expect(auditLaunchReadiness(manifest, options).errors.every((error) => error.includes("digest mismatch"))).toBe(true);
    expect(auditLaunchReadiness(manifest, options).ready).toBe(false);
  });
  it("rejects evidence outside the manifest directory, including symlinks", () => {
    const outside = mkdtempSync(join(tmpdir(), "feeinsight-outside-test-"));
    try {
      writeFileSync(join(outside, "external.txt"), "outside");
      symlinkSync(join(outside, "external.txt"), join(root, "link.txt"));
      manifest.checks.source_backed_fee_review.evidenceFile = "link.txt";
      expect(auditLaunchReadiness(manifest, options).errors.join(" ")).toContain("escapes");
      manifest.checks.source_backed_fee_review.evidenceFile = join(outside, "external.txt");
      expect(auditLaunchReadiness(manifest, options).ready).toBe(false);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });
  it("rejects empty files and missing hashes", () => {
    writeFileSync(join(root, "fixture.txt"), "");
    expect(auditLaunchReadiness(manifest, options).ready).toBe(false);
    delete manifest.checks.signup_checkout_access.evidenceSha256;
    expect(auditLaunchReadiness(manifest, options).errors.join(" ")).toContain("digest are required");
  });
  it("requires explicit owner approval and zero blockers", () => {
    manifest.approval = null;
    manifest.checks.rollback_and_monitoring.blockingIssues = 1;
    expect(auditLaunchReadiness(manifest, options).errors).toHaveLength(2);
  });
  it("fails closed on invalid input and missing expected identifiers", () => {
    expect(auditLaunchReadiness(null, options).ready).toBe(false);
    expect(auditLaunchReadiness(manifest, { ...options, commit: "main" }).ready).toBe(false);
    expect(auditLaunchReadiness(manifest, { ...options, catalogSnapshot: "" }).ready).toBe(false);
  });
  it("returns a distinct CLI error for missing inputs instead of successful validation", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runAudit([])).toBe(2);
    expect(runAudit([join(root, "missing.json"), "--commit", commit, "--catalog-snapshot", "test-catalog"])).toBe(2);
  });
});
