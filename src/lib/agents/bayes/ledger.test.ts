import { describe, expect, it } from "vitest";
import { closeSupersededJobs, currentChangeKeys, replayStatus, summarizeBayesLedger, supersededNote, STUCK_AFTER_CHECKS, type BayesLedgerResult } from "./ledger";
import { changeKey, currentCopyCount, guardRunCount, loadManifests, peerRangeCount, retidyCount } from "./manifests";
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
    // One current version per manifest key, so an older key of the same manifest is superseded.
    expect(new Set(manifests.map((manifest) => manifest.key)).size).toBe(manifests.length);
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

describe("current copy and retidy counts", () => {
  it("counts pairs it cannot read as excluded, not queued", () => {
    expect(currentCopyCount({ pairs: 801, done: 744, queued: 57, noText: 0 })).toMatchObject({ affected: 801, done: 744, queued: 57, exclusions: {} });
    expect(currentCopyCount({ pairs: 10, done: 5, queued: 3, noText: 2 }).exclusions).toEqual({ no_completed_text: 2 });
  });

  it("counts an institution due again after a new fee once, as queued", () => {
    expect(retidyCount({ due: [1, 2, 3], doneCurrent: [3, 4] })).toEqual({ affected: 4, done: 1, queued: 3, exclusions: {} });
    expect(retidyCount({ due: [], doneCurrent: [] })).toEqual({ affected: 0, done: 0, queued: 0, exclusions: {} });
  });

  it("counts the graded peer holds v5 re-decides and keeps the ungraded ones as an exclusion (#1112, #1694)", () => {
    expect(peerRangeCount({ affected: 242, done: 0, queued: 242, ungraded: 2350 })).toEqual({ affected: 242, done: 0, queued: 242, exclusions: { ungraded_peer_version: 2350 } });
    expect(peerRangeCount({ affected: 0, done: 0, queued: 0, ungraded: 0 })).toEqual({ affected: 0, done: 0, queued: 0, exclusions: {} });
  });

  it("counts every change except those whose owner's selection is not shared yet (#1120)", async () => {
    const manifests = await loadManifests();
    const uncounted = manifests.filter((manifest) => !manifest.count).map((manifest) => manifest.key);
    expect(uncounted).toEqual([
      // rosetta.read counts its replay lane (#2069).
      "rosetta.pdf_layout", "rosetta.ocr", "rosetta.js_fallback", "rosetta.table_rows",
      "darwin.verify_rules", "darwin.envelopes",
    ]);
    // An uncounted change always says why, so it reads as not_counted, never as finished.
    expect(manifests.filter((manifest) => !manifest.count).every((manifest) => Boolean(manifest.notCounted))).toBe(true);
  });
});

describe("superseded rows", () => {
  const manifest = (key: string, version: number, versionLabel?: string) =>
    ({ key, version, versionLabel, owner: "knox", stage: null, strategy: null, unit: "text", affects: "x", count: null }) as const;

  it("maps each declared manifest to its current change key", () => {
    const current = currentChangeKeys([manifest("knox.rules", 163), manifest("hamilton.guard_catch_up", 100, "g100.f2")]);
    expect([...current.entries()]).toEqual([["knox.rules", "knox.rules@163"], ["hamilton.guard_catch_up", "hamilton.guard_catch_up@g100.f2"]]);
    expect(supersededNote("knox.rules@163")).toBe("superseded by knox.rules@163");
  });

  it("dry run lists the open and stuck older rows the SQL returns and writes nothing", async () => {
    const queries: string[] = [];
    const db = ((strings: TemplateStringsArray) => {
      queries.push(strings.join("?"));
      return Promise.resolve([
        { id: 1, change_key: "knox.rules@147", manifest_key: "knox.rules", status: "open", queued: "8340" },
        { id: 2, change_key: "magellan.registry.cra@1", manifest_key: "magellan.registry.cra", status: "stuck", queued: 1 },
      ]);
    }) as never;
    const closed = await closeSupersededJobs(db, new Map([["knox.rules", "knox.rules@163"], ["magellan.registry.cra", "magellan.registry.cra@3"]]), { runId: null, dryRun: true });
    expect(closed).toEqual([
      { changeKey: "knox.rules@147", manifestKey: "knox.rules", supersededBy: "knox.rules@163", previousStatus: "open", lastQueued: 8340 },
      { changeKey: "magellan.registry.cra@1", manifestKey: "magellan.registry.cra", supersededBy: "magellan.registry.cra@3", previousStatus: "stuck", lastQueued: 1 },
    ]);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/status IN \('open', 'stuck'\)/);
    expect(queries[0]).not.toMatch(/UPDATE|INSERT/);
  });

  it("reads nothing when no manifest is declared", async () => {
    const db = (() => { throw new Error("no query expected"); }) as never;
    expect(await closeSupersededJobs(db, new Map(), { runId: 1, dryRun: false })).toEqual([]);
  });
});

describe("summarizeBayesLedger", () => {
  const base: BayesLedgerResult = { schemaReady: true, dryRun: false, jobs: [], superseded: [], closed: 0, open: 0, stuck: 0, notCounted: 0, failed: 0, queuedRecords: 0 };
  it("names open, stuck and uncounted changes", () => {
    const jobs = Array.from({ length: 6 }, () => ({}) as BayesLedgerResult["jobs"][number]);
    expect(summarizeBayesLedger({ ...base, jobs, closed: 2, open: 1, stuck: 1, notCounted: 2, queuedRecords: 40 }))
      .toBe("Recorded 4 rule changes: 2 closed, 1 open with 40 records queued, 1 stuck (queue not moving). 2 not countable yet.");
  });
  it("names the superseded rows it closed and their stale queue apart from the real queue", () => {
    const superseded = [
      { changeKey: "knox.rules@147", manifestKey: "knox.rules", supersededBy: "knox.rules@163", previousStatus: "open", lastQueued: 8340 },
      { changeKey: "knox.rules@145", manifestKey: "knox.rules", supersededBy: "knox.rules@163", previousStatus: "open", lastQueued: 8100 },
    ];
    const jobs = [{}] as BayesLedgerResult["jobs"];
    expect(summarizeBayesLedger({ ...base, jobs, open: 1, queuedRecords: 40, superseded }))
      .toBe("Recorded 1 rule changes: 0 closed, 1 open with 40 records queued. Closed 2 superseded older-version rows (16440 stale queued, not in the queue).");
    expect(summarizeBayesLedger({ ...base, dryRun: true, superseded: superseded.slice(0, 1) })).toMatch(/Would close 1 superseded older-version row \(8340/);
  });

  it("says when closing superseded rows failed", () => {
    expect(summarizeBayesLedger({ ...base, supersededError: "boom" })).toMatch(/closing superseded rows failed \(boom\)/);
  });

  it("says when the tables are missing", () => {
    expect(summarizeBayesLedger({ ...base, schemaReady: false })).toMatch(/not created yet/);
  });
});
