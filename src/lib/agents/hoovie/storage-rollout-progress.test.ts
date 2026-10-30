import { describe, expect, it, vi } from "vitest";
import { readArchiveRolloutProgress } from "./storage-rollout-progress";
import { CALL_PERIOD_PRUNE_MANIFEST } from "./call-period-prune";

describe("committed storage rollout progress", () => {
  it("requires the actual successful production canary before selecting an archive stage", async () => {
    const db = vi.fn().mockResolvedValue([{ ready: false }]);
    await expect(readArchiveRolloutProgress(db as unknown as Parameters<typeof readArchiveRolloutProgress>[0])).rejects.toThrow("canary");
    expect(db).toHaveBeenCalledTimes(1);
  });
  it("finishes only when all four exact manifests have restore and consumer receipts", async () => {
    const db = vi.fn().mockResolvedValueOnce([{ ready: true }]).mockResolvedValueOnce(CALL_PERIOD_PRUNE_MANIFEST.map((scope) => ({
      source: scope.source, period: scope.period, row_count: String(scope.archiveRows), sha256: "a".repeat(64), verified: true, rehearsed: true, pruned: true, accepted: true,
    })));
    expect(await readArchiveRolloutProgress(db as unknown as Parameters<typeof readArchiveRolloutProgress>[0])).toBeNull();
    const query = db.mock.calls[1][0].join(" ");
    expect(query).toContain("consumersVerified");
    expect(query).toContain("f.sha256");
    expect(query).toContain("step.finished");
  });
});
