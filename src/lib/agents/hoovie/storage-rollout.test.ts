import { describe, expect, it } from "vitest";
import { STORAGE_ROLLOUT_SOURCE, storageRolloutAction } from "./storage-rollout";
const run = { agent: "atlas", runKind: "workflow", triggerSource: "admin", params: { source: STORAGE_ROLLOUT_SOURCE, storageAction: "compact" } };
describe("approved storage rollout", () => {
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
