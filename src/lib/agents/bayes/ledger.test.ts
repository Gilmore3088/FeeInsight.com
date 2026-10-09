import { describe, expect, it } from "vitest";
import { replayStatus, summarizeBayesLedger, STUCK_AFTER_CHECKS, type BayesLedgerResult } from "./ledger";
import { changeKey, guardRunCount, loadManifests } from "./manifests";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { CATEGORY_GUARD_VERSION } from "@/lib/fee-category-guard";
import { FREQUENCY_FILL_VERSION } from "@/lib/agents/hamilton/frequency-fill";
import { REGISTRY_PARSER_VERSIONS } from "@/lib/agents/registry-scheduler";

const count = (done: number, queued: number, excluded = 0) => ({ affected: done + queued + excluded, done, queued, exclusions: (excluded ? { kept: excluded } : {}) as Record<string, number> });

describe("replayStatus", () => {
  it("reports a change it cannot count as not counted, never closed", () => {
    expect(replayStatus(null, [])).toBe("not_counted");
  });

  it("closes a change with nothing queued: done and excluded are terminal", () => {
    expect(replayStatus(count(10, 0, 5), [])).toBe("closed");
  });

  it("stays open while the queue moves", () => {
    expect(replayStatus(count(8, 2), [{ done: 5, queued: 5, excluded: 0 }, { done: 2, queued: 8, excluded: 0 }])).toBe("open");
  });

  it("is open until there is enough history to call it stuck", () => {
    expect(STUCK_AFTER_CHECKS).toBe(3);
    expect(replayStatus(count(2, 8), [{ done: 2, queued: 8, excluded: 0 }])).toBe("open");
  });

  it("is stuck when nothing settled across three checks", () => {
    expect(replayStatus(count(2, 8), [{ done: 2, queued: 8, excluded: 0 }, { done: 2, queued: 8, excluded: 0 }])).toBe("stuck");
  });

  it("counts a newly excluded record as progress", () => {
    expect(replayStatus(count(2, 7, 1), [{ done: 2, queued: 8, excluded: 0 }, { done: 2, queued: 8, excluded: 0 }])).toBe("open");
  });
});

describe("guardRunCount", () => {
  it("queues a version pair with no run yet", () => {
    expect(guardRunCount(null)).toMatchObject({ affected: 1, done: 0, queued: 1 });
  });
  it("marks a completed run done", () => {
    expect(guardRunCount({ id: 9, status: "completed" })).toMatchObject({ done: 1, queued: 0 });
  });
  it("names a failed run that blocks the re-run", () => {
    expect(guardRunCount({ id: 9, status: "failed" })).toMatchObject({ done: 0, queued: 0, exclusions: { failed_run_blocks_rerun: 1 } });
  });
  it("keeps a running run queued", () => {
    expect(guardRunCount({ id: 9, status: "running" })).toMatchObject({ queued: 1 });
  });
});

describe("manifests", () => {
  it("declares each versioned rerun at the version the code ships", async () => {
    const manifests = await loadManifests();
    const keys = manifests.map(changeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(`knox.rules@${KNOX_RULES_STRATEGY.version}`);
    expect(keys).toContain(`hamilton.guard_catch_up@g${CATEGORY_GUARD_VERSION}.f${FREQUENCY_FILL_VERSION}`);
    for (const [source, version] of Object.entries(REGISTRY_PARSER_VERSIONS)) {
      expect(keys).toContain(`magellan.registry.${source}@${version}`);
    }
  });

  it("says why a rerun is not counted", async () => {
    for (const manifest of await loadManifests()) {
      if (!manifest.count) expect(manifest.notCounted).toBeTruthy();
    }
  });
});

describe("summarizeBayesLedger", () => {
  const base: BayesLedgerResult = { schemaReady: true, dryRun: false, jobs: [], closed: 0, open: 0, stuck: 0, notCounted: 0, failed: 0, queuedRecords: 0 };
  it("names open, stuck and uncounted changes", () => {
    const jobs = Array.from({ length: 6 }, () => ({}) as BayesLedgerResult["jobs"][number]);
    expect(summarizeBayesLedger({ ...base, jobs, closed: 2, open: 1, stuck: 1, notCounted: 2, queuedRecords: 40 }))
      .toBe("Recorded 4 rule changes: 2 closed, 1 open with 40 records queued, 1 stuck (queue not moving). 2 not countable yet.");
  });
  it("says when the tables are missing", () => {
    expect(summarizeBayesLedger({ ...base, schemaReady: false })).toMatch(/not created yet/);
  });
});
