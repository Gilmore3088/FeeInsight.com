import { describe, expect, it, vi } from "vitest";

import { assetSizeTier } from "@/lib/regulatory/fdic";
import { STATE_NAMES } from "@/lib/us-states";

import {
  hintsFromMemory,
  institutionTier,
  isPeerOutlier,
  orderByHints,
  peerLevelFor,
  peerRange,
  rankStrategies,
  refreshStateMemory,
  type PeerLevel,
  type StateMemory,
} from "./memory";
import { STATE_EXPERTS, stateExpertFor } from "./roster";
import { runStateExpertStep } from "./step";
import { peerCheck, secondSourceCheck } from "../darwin/peer-checks";

type Db = Parameters<typeof refreshStateMemory>[0];

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const level = (overrides: Partial<PeerLevel>): PeerLevel => ({
  canonicalFeeKey: "overdraft",
  tier: "all",
  p25: 30,
  median: 32,
  p75: 34,
  count: 10,
  ...overrides,
});

describe("state expert roster", () => {
  it("has exactly one expert for every state, DC and territory lane", () => {
    const codes = STATE_EXPERTS.map((expert) => expert.stateCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.sort()).toEqual(Object.keys(STATE_NAMES).sort());
    expect(codes).toHaveLength(55);
  });

  it("gives every expert a name, a one-line bio and a source, and never reuses Hamilton", () => {
    for (const expert of STATE_EXPERTS) {
      expect(expert.name.trim()).not.toBe("");
      expect(expert.bio.length).toBeLessThanOrEqual(140);
      expect(expert.bio).not.toContain("\n");
      expect(expert.source.trim()).not.toBe("");
      expect(expert.name).not.toMatch(/hamilton/i);
    }
    expect(new Set(STATE_EXPERTS.map((expert) => expert.name)).size).toBe(STATE_EXPERTS.length);
    expect(stateExpertFor("ny")?.name).toBe("Albert Gallatin");
    expect(stateExpertFor("ZZ")).toBeNull();
  });
});

describe("state memory", () => {
  it("matches the registry's asset-size tiers", () => {
    for (const assets of [100_000, 500_000, 5_000_000, 20_000_000, 100_000_000, 900_000_000]) {
      expect(institutionTier(null, assets)).toBe(assetSizeTier(assets));
    }
    expect(institutionTier("regional", 100)).toBe("regional");
    expect(institutionTier(null, null)).toBe("unknown");
  });

  it("uses the tier level when it has eight peers, else the state level, else nothing", () => {
    const levels = [
      level({ tier: "community_mid", count: 8, p25: 20 }),
      level({ tier: "community_small", count: 3 }),
      level({ tier: "all", count: 12 }),
    ];
    expect(peerLevelFor(levels, "overdraft", "community_mid")?.p25).toBe(20);
    expect(peerLevelFor(levels, "overdraft", "community_small")?.tier).toBe("all");
    expect(peerLevelFor([level({ count: 7 })], "overdraft", "all")).toBeNull();
    expect(peerLevelFor(levels, "nsf", "community_mid")).toBeNull();
  });

  it("flags only amounts below p25/3 or above p75*3", () => {
    const peers = level({});
    expect(peerRange(peers)).toEqual({ low: 10, high: 102 });
    expect(isPeerOutlier(9.99, peers)).toBe(true);
    expect(isPeerOutlier(10, peers)).toBe(false);
    expect(isPeerOutlier(102, peers)).toBe(false);
    expect(isPeerOutlier(102.01, peers)).toBe(true);
    expect(peerCheck([peers], "overdraft", "community_mid", 0)).toBeNull();
    expect(peerCheck([peers], "overdraft", "community_mid", 5)).toMatchObject({ outlier: true, levelTier: "all", peerCount: 10 });
  });

  it("ranks finder and reader strategies by success, then cost, then yield", () => {
    const ranks = rankStrategies([
      { stage: "read", strategy: "read.html_dom", outcome: "ok", attempts: 9, yield_sum: 90, cost_sum: 0 },
      { stage: "read", strategy: "read.html_dom", outcome: "parse_error", attempts: 1, yield_sum: 0, cost_sum: 0 },
      { stage: "read", strategy: "read.pdf_layout", outcome: "ok", attempts: 5, yield_sum: 40, cost_sum: 0 },
      { stage: "discover", strategy: "discover.search", outcome: "http_404", attempts: 6, yield_sum: 0, cost_sum: 0 },
      { stage: "discover", strategy: "discover.homepage_links", outcome: "ok", attempts: 4, yield_sum: 4, cost_sum: 0 },
      { stage: "fetch", strategy: "fetch.http", outcome: "ok", attempts: 4, yield_sum: 4, cost_sum: 0 },
    ]);
    expect(ranks.reader.map((rank) => rank.strategy)).toEqual(["read.pdf_layout", "read.html_dom"]);
    expect(ranks.reader[1]).toMatchObject({ attempts: 10, successes: 9, successRate: 0.9 });
    expect(ranks.finder.map((rank) => rank.strategy)).toEqual(["discover.homepage_links", "discover.search"]);

    const memory = {
      stateCode: "VT",
      expertName: "Justin S. Morrill",
      strategies: ranks,
      platforms: [{ platform: "wordpress", institutions: 3 }],
    } as unknown as StateMemory;
    const hints = hintsFromMemory("vt", memory);
    expect(hints).toMatchObject({
      stateCode: "VT",
      finderOrder: ["discover.homepage_links"],
      readerOrder: ["read.pdf_layout", "read.html_dom"],
      avoid: ["discover.search"],
      platforms: ["wordpress"],
      source: "memory",
    });
    expect(hintsFromMemory("VT", null)).toMatchObject({ expertName: "Justin S. Morrill", finderOrder: [], source: "none" });
    expect(orderByHints(["a", "b", "c", "d"], ["c", "a"], ["b"])).toEqual(["c", "a", "d", "b"]);
  });

  it("refreshes and stores a state's memory with its expert, regulator and peer levels", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("to_regclass('public.state_memory')")) return Promise.resolve([{ ready: true }]);
      if (text.includes("FROM state_regulators")) return Promise.resolve([]);
      if (text.includes("AS published_fees")) return Promise.resolve([{ institutions: 12, published_fees: 90 }]);
      return Promise.resolve([]);
    }) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    db.unsafe = vi.fn((query: string) => {
      if (query.includes("published_fee_catalog")) {
        return Promise.resolve([{ canonical_fee_key: "overdraft", tier: "all", p25: 30, median: 32, p75: 34, institutions: 9 }]);
      }
      if (query.includes("platform")) return Promise.resolve([{ platform: "wordpress", institutions: 4 }]);
      return Promise.resolve([]);
    });

    const step = await runStateExpertStep({ db: db as unknown as Db, runId: 9, stateCode: "VT" });

    expect(step.status).toBe("completed");
    expect(step.summary).toContain("Justin S. Morrill refreshed the VT memory");
    expect(step.detail).toMatchObject({
      expert_name: "Justin S. Morrill",
      regulator: "Vermont Department of Financial Regulation",
      regulator_source: "roster",
      institutions: 12,
      published_fees: 90,
      top_platform: "wordpress",
      fee_categories_with_peers: 1,
      memory_stored: true,
      provider_call_queued: false,
    });
    const upsert = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO state_memory"));
    expect(upsert).toBeDefined();
    expect(upsert).toEqual(expect.arrayContaining(["VT", "Justin S. Morrill", 9]));
  });

  it("does not store memory before the migration or on a dry run", async () => {
    const db = vi.fn(() => Promise.resolve([])) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    db.unsafe = vi.fn(() => Promise.resolve([]));

    const result = await refreshStateMemory(db as unknown as Db, "VT", { runId: 1 });

    expect(result.stored).toBe(false);
    expect(result.memory?.expertName).toBe("Justin S. Morrill");
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("INSERT INTO state_memory"))).toBe(false);
  });

  it("skips the step for runs without a state", async () => {
    const db = vi.fn() as unknown as Db;
    await expect(runStateExpertStep({ db, runId: 1 })).resolves.toMatchObject({ status: "skipped" });
  });
});

describe("second-source check", () => {
  const row = { feeRawId: 1, institutionId: 42, sourceDocumentId: 10, canonicalFeeKey: "nsf", amount: 30 };

  it("needs another document of the same bank with the same fee", () => {
    expect(secondSourceCheck(row, [])).toBeNull();
    expect(secondSourceCheck(row, [{ feeRawId: 2, institutionId: 42, sourceDocumentId: 10, canonicalFeeKey: "nsf", amount: 30 }])).toBeNull();
    expect(secondSourceCheck(row, [{ feeRawId: 3, institutionId: 43, sourceDocumentId: 11, canonicalFeeKey: "nsf", amount: 30 }])).toBeNull();
    expect(secondSourceCheck({ ...row, sourceDocumentId: null }, [])).toBeNull();
  });

  it("agrees when any other document shows the same amount", () => {
    expect(secondSourceCheck(row, [
      { feeRawId: 4, institutionId: 42, sourceDocumentId: 8, canonicalFeeKey: "nsf", amount: 30 },
      { feeRawId: 5, institutionId: 42, sourceDocumentId: 9, canonicalFeeKey: "nsf", amount: 25 },
    ])).toEqual({ verdict: "agrees", agreeingDocumentIds: [8], disagreeing: [{ sourceDocumentId: 9, amount: 25 }] });
    expect(secondSourceCheck(row, [
      { feeRawId: 5, institutionId: 42, sourceDocumentId: 9, canonicalFeeKey: "nsf", amount: 25 },
    ])?.verdict).toBe("disagrees");
  });
});
