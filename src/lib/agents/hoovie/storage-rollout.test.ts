import { describe, expect, it } from "vitest";
import { STORAGE_ROLLOUT_SOURCE, storageRolloutAction, nextArchiveRolloutAction, storageRolloutTarget } from "./storage-rollout";
import { CALL_PERIOD_PRUNE_MANIFEST } from "./call-period-prune";
const run = { agent: "atlas", runKind: "workflow", triggerSource: "admin", params: { source: STORAGE_ROLLOUT_SOURCE, storageAction: "compact" } };
describe("approved storage rollout", () => {
  it("advances only the four reviewed periods through every required stage", () => {
    const states = CALL_PERIOD_PRUNE_MANIFEST.map((item) => ({ ...item, rowCount: item.archiveRows, sha256: "a".repeat(64), verified: true, rehearsed: true, pruned: true, accepted: true }));
    expect(nextArchiveRolloutAction([])).toEqual({ source: "ffiec", period: "2023-03-31", action: "export" });
    for (let index = 0; index < states.length; index++) {
      for (const [field, action] of [["rehearsed", "rehearse"], ["pruned", "prune"], ["accepted", "verify"]] as const) {
        const pending = states.map((state, at) => at === index ? { ...state, [field]: false } : state);
        expect(nextArchiveRolloutAction(pending)).toMatchObject({ source: states[index].source, period: states[index].period, action });
      }
    }
    expect(nextArchiveRolloutAction(states)).toBeNull();
    expect(() => nextArchiveRolloutAction([{ ...states[0], rowCount: states[0].rowCount + 1 }])).toThrow("manifest");
    expect(() => nextArchiveRolloutAction([{ ...states[0], verified: false }])).toThrow("verification");
  });
  it("pins runtime targets to the dated manifest rather than caller-supplied quarters", () => {
    expect(storageRolloutTarget({})).toBeUndefined();
    expect(storageRolloutTarget({ source: STORAGE_ROLLOUT_SOURCE, storageSource: "ffiec", storagePeriod: "2023-03-31" })).toEqual({ source: "ffiec", period: "2023-03-31" });
    expect(() => storageRolloutTarget({ source: STORAGE_ROLLOUT_SOURCE, storageSource: "ffiec", storagePeriod: "2023-09-30" })).toThrow("manifest");
    expect(() => storageRolloutTarget({ source: "atlas.scoreboard", storageSource: "ffiec", storagePeriod: "2023-03-31" })).toThrow("manifest");
  });
  it("leaves daily runs and dry runs outside live overrides", () => {
    expect(storageRolloutAction({ ...run, params: { source: "atlas.scoreboard", storageAction: "compact" } })).toBeNull();
    expect(() => storageRolloutAction({ ...run, runKind: "dry_run" })).toThrow();
  });
  it("allows only separately queued admin actions from the approved staged plan", () => {
    expect(storageRolloutAction(run)).toBe("compact");
    expect(storageRolloutAction(run,{storageAction:"rehearse"})).toBe("rehearse");
    expect(storageRolloutAction({...run,params:{source:"atlas.scoreboard"}},{storageAction:"prune"})).toBeNull();
    expect(storageRolloutAction({ ...run, params: { ...run.params, storageAction: "export" } })).toBe("export");
    for (const storageAction of ["rehearse", "prune", "verify"]) expect(storageRolloutAction({ ...run, params: { ...run.params, storageAction } })).toBe(storageAction);
    for (const storageAction of ["restore", "", true]) expect(() => storageRolloutAction({ ...run, params: { ...run.params, storageAction } })).toThrow();
    expect(() => storageRolloutAction({ ...run, triggerSource: "cron" })).toThrow();
    expect(() => storageRolloutAction({ ...run, agent: "magellan" })).toThrow();
  });
});
