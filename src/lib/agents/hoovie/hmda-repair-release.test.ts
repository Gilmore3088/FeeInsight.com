import { describe, expect, it } from "vitest";
import { FDIC_IDENTITY_HOLD_WRITES_ENABLED, FDIC_OWN_LEI_WRITES_ENABLED, HMDA_ORDINARY_IDENTITY_WRITES_ENABLED, HMDA_REPAIR_WRITES_ENABLED } from "./hmda-repair-release";
import { FDIC_UNIVERSE_SCHEDULED_PARSER_VERSION } from "../magellan/registry/fdic-universe";
import { HMDA_SCHEDULED_PARSER_VERSION } from "../magellan/registry/hmda";

describe("HMDA production release boundary", () => {
  it("keeps ordinary identity rollout and repair mutation off until their reviewed releases", () => {
    expect(HMDA_ORDINARY_IDENTITY_WRITES_ENABLED).toBe(false);
    expect(FDIC_OWN_LEI_WRITES_ENABLED).toBe(false);
    expect(FDIC_IDENTITY_HOLD_WRITES_ENABLED).toBe(false);
    expect(HMDA_REPAIR_WRITES_ENABLED).toBe(false);
    expect(HMDA_SCHEDULED_PARSER_VERSION).toBe(2);
    expect(FDIC_UNIVERSE_SCHEDULED_PARSER_VERSION).toBe(2);
  });
});
