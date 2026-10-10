import { describe, expect, it, vi } from "vitest";
import type { sql } from "@/lib/data-store/connection";
import {
  computeStatePeerLevels,
  currentAudiencePeerLevels,
  PEER_AUDIENCE_POLICY_VERSION,
} from "./memory";
import { computeWiderPeerLevels } from "@/lib/agents/darwin/peer-checks";

describe("source-bound consumer peer baselines", () => {
  it("never reuses legacy persisted mixed-audience levels", () => {
    const prior = { canonicalFeeKey: "overdraft", tier: "all", p25: 30, median: 32, p75: 35, count: 20 };
    expect(currentAudiencePeerLevels([prior])).toBe(false);
    expect(currentAudiencePeerLevels([{ ...prior, audiencePolicyVersion: PEER_AUDIENCE_POLICY_VERSION }])).toBe(true);
    expect(currentAudiencePeerLevels([])).toBe(false);
    expect(currentAudiencePeerLevels([prior, { ...prior, audiencePolicyVersion: PEER_AUDIENCE_POLICY_VERSION }])).toBe(false);
  });

  it("builds state peers from sourced consumer rows and uses the highest overdraft tier", async () => {
    const unsafe = vi.fn().mockResolvedValue([{
      canonical_fee_key: "nsf", tier: "all", p25: "0", median: "0", p75: "30", institutions: "8",
    }]);
    const db = { unsafe } as unknown as typeof sql;
    const levels = await computeStatePeerLevels(db, "TN");
    const [query, params] = unsafe.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(["TN"]);
    expect(query).toContain("c.source_document_id IS NOT NULL");
    expect(query).toContain("c.fee_audience IN ('consumer', 'both')");
    expect(query).toContain("c.canonical_fee_key = 'overdraft' THEN MAX(c.amount)");
    expect(query).toContain("AND c.amount >= 0");
    expect(levels).toEqual([{
      canonicalFeeKey: "nsf", tier: "all", p25: 0, median: 0, p75: 30, count: 8,
      audiencePolicyVersion: PEER_AUDIENCE_POLICY_VERSION,
    }]);
    expect(currentAudiencePeerLevels(levels)).toBe(true);
  });

  it("uses the identical source/audience rule in district and national peers", async () => {
    const unsafe = vi.fn().mockResolvedValue([]);
    const db = { unsafe } as unknown as typeof sql;
    const result = await computeWiderPeerLevels(db);
    const query = String(unsafe.mock.calls[0][0]);
    expect(query).toContain("c.source_document_id IS NOT NULL");
    expect(query).toContain("c.fee_audience IN ('consumer', 'both')");
    expect(query).toContain("c.canonical_fee_key = 'overdraft' THEN MAX(c.amount)");
    expect(query).toContain("AND c.amount >= 0");
    expect(result.national).toEqual([]);
    expect(result.district.size).toBe(0);
  });
});
