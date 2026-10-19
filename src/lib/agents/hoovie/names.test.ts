import { describe, expect, it } from "vitest";

import { CRON_OWNER } from "@/lib/agents/atlas/registry";
import { crewMember } from "@/lib/agents/crew-members";
import { ledgerAgent } from "@/lib/agents/gutenberg/names";
import { REGISTRY_SOURCES, REGISTRY_STEP_PREFIX } from "@/lib/agents/magellan/registry";
import { STEP_OWNER } from "@/lib/agents/narrate";
import {
  HOOVIE_AGENT,
  isRegistryStep,
  REGISTRY_AGENT_NAMES,
  REGISTRY_STEP_KEY_PREFIX,
  registryLedgerAgent,
  registryLedgerNames,
} from "./names";

describe("Hoovie's names (#1865)", () => {
  it("uses the registry's own step prefix", () => {
    expect(REGISTRY_STEP_KEY_PREFIX).toBe(REGISTRY_STEP_PREFIX);
    expect(REGISTRY_SOURCES.every((source) => isRegistryStep(source.stepKey))).toBe(true);
    expect(isRegistryStep("fetch")).toBe(false);
    expect(isRegistryStep(null)).toBe(false);
  });

  it("files a pre-switch registry step under Hoovie and leaves Magellan's fee-schedule work alone", () => {
    expect(registryLedgerAgent("magellan", "registry-fdic-financials")).toBe(HOOVIE_AGENT);
    expect(registryLedgerAgent("hoovie", "registry-fdic-financials")).toBe(HOOVIE_AGENT);
    expect(registryLedgerAgent("magellan", "discover")).toBe("magellan");
    expect(registryLedgerAgent("magellan", null)).toBe("magellan");
    expect(registryLedgerAgent("darwin", "registry-cfpb")).toBe("darwin");
    // The shared ledger owner applies both switches.
    expect(ledgerAgent("magellan", "registry-cfpb")).toBe(HOOVIE_AGENT);
    expect(ledgerAgent("hamilton", "publish")).toBe("gutenberg");
  });

  it("reads both names for Hoovie and only its own for every other agent", () => {
    expect(REGISTRY_AGENT_NAMES).toEqual(["magellan", "hoovie"]);
    expect(registryLedgerNames(HOOVIE_AGENT)).toEqual(["magellan", "hoovie"]);
    expect(registryLedgerNames("magellan")).toEqual(["magellan"]);
  });

  it("owns every registry step, the registry tick and a crew row; Magellan keeps the rest", () => {
    const registrySteps = Object.keys(STEP_OWNER).filter(isRegistryStep);
    expect(registrySteps.length).toBeGreaterThan(0);
    expect(registrySteps.filter((step) => STEP_OWNER[step] !== HOOVIE_AGENT)).toEqual([]);
    expect(Object.entries(STEP_OWNER).filter(([step, owner]) => owner === "magellan" && isRegistryStep(step))).toEqual([]);
    expect(STEP_OWNER.discover).toBe("magellan");
    expect(CRON_OWNER["/api/admin/registry/tick"]).toBe(HOOVIE_AGENT);
    expect(crewMember(HOOVIE_AGENT)?.name).toBe("Hoovie");
  });
});
