import { describe, expect, it, vi } from "vitest";

import { stateExpertSummary } from "./state-expert-summary";
import { PEER_AUDIENCE_POLICY_VERSION } from "@/lib/agents/state-expert/memory";

type Db = NonNullable<Parameters<typeof stateExpertSummary>[1]>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

describe("Hamilton state expert summary", () => {
  it("returns the expert, the covered peer levels and the furthest outliers first", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("to_regclass('public.state_memory')")) return Promise.resolve([{ ready: true }]);
      if (text.includes("FROM state_memory")) {
        return Promise.resolve([{
          state_code: "VT",
          expert_name: "Justin S. Morrill",
          expert_bio: "Bio.",
          regulator: { agency: "Vermont Department of Financial Regulation", source: "roster" },
          platforms: [],
          strategies: {},
          peer_levels: [
            { canonicalFeeKey: "overdraft", tier: "all", p25: 30, median: 32, p75: 34, count: 12 , audiencePolicyVersion: PEER_AUDIENCE_POLICY_VERSION},
            { canonicalFeeKey: "nsf", tier: "all", p25: 28, median: 30, p75: 33, count: 4 , audiencePolicyVersion: PEER_AUDIENCE_POLICY_VERSION},
            { canonicalFeeKey: "overdraft", tier: "community_mid", p25: 30, median: 32, p75: 34, count: 9 , audiencePolicyVersion: PEER_AUDIENCE_POLICY_VERSION},
          ],
          institution_count: 20,
          published_fee_count: 150,
          refreshed_at: new Date("2026-10-01T00:00:00Z"),
        }]);
      }
      if (text.includes("FROM pipeline_attempts pa")) {
        return Promise.resolve([
          { institution_id: 1, institution_name: "A", canonical_fee_key: "overdraft", amount: "8", peer_low: "10", peer_high: "102", peer_median: "32", peer_count: 12, created_at: null },
          { institution_id: 2, institution_name: "B", canonical_fee_key: "overdraft", amount: "2", peer_low: "10", peer_high: "102", peer_median: "32", peer_count: 12, created_at: null },
        ]);
      }
      return Promise.resolve([]);
    });

    const summary = await stateExpertSummary("vt", db as unknown as Db);

    expect(summary).toMatchObject({
      stateCode: "VT",
      expertName: "Justin S. Morrill",
      regulator: "Vermont Department of Financial Regulation",
      source: "memory",
      publishedFeeCount: 150,
    });
    expect(summary?.peerLevels.map((entry) => entry.canonicalFeeKey)).toEqual(["overdraft"]);
    expect(summary?.notableOutliers.map((entry) => entry.institutionName)).toEqual(["B", "A"]);
  });

  it("returns null outside the 55 lanes", async () => {
    const db = vi.fn(() => Promise.resolve([])) as unknown as Db & { unsafe: unknown };
    (db as unknown as { unsafe: unknown }).unsafe = vi.fn(() => Promise.resolve([]));
    await expect(stateExpertSummary("ZZ", db)).resolves.toBeNull();
  });
});
