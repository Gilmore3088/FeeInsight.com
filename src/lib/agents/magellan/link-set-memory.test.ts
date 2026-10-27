import { describe, expect, it } from "vitest";

import { linkSetAlreadyMissed, linkSetFingerprint } from "./discovery";
import { FINDERS } from "./finders";

describe("link-set memory for dead banks (fix plan step 5)", () => {
  it("fingerprints the homepage's distinct links, not their order or repeats", () => {
    const a = linkSetFingerprint([{ url: "https://bank.example/fees" }, { url: "https://bank.example/about" }]);
    const b = linkSetFingerprint([{ url: "https://bank.example/about" }, { url: "https://bank.example/fees" }, { url: "https://bank.example/fees" }]);
    expect(a).toBe(b);
    expect(linkSetFingerprint([{ url: "https://bank.example/about" }])).not.toBe(a);
    expect(linkSetFingerprint([])).toBeNull();
  });

  it("skips a finder that missed on the same link set within 90 days, at its own version", () => {
    const fingerprint = linkSetFingerprint([{ url: "https://bank.example/about" }])!;
    const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const playbook = (days: number, version: number = FINDERS.hubPages.version) => ({
      format: null, bestStrategy: {}, strategyStats: {}, expectedFeeCount: null, costToDateMicrousd: 0,
      doNotRetry: [{ stage: "discover" as const, strategy: FINDERS.hubPages.strategy, version, fingerprint, outcome: "no_candidates" as const, at: at(days) }],
    });
    expect(linkSetAlreadyMissed(playbook(10), "hubPages", fingerprint)).toBe(true);
    expect(linkSetAlreadyMissed(playbook(91), "hubPages", fingerprint)).toBe(false);
    expect(linkSetAlreadyMissed(playbook(10, FINDERS.hubPages.version + 1), "hubPages", fingerprint)).toBe(false);
    expect(linkSetAlreadyMissed(playbook(10), "sitemap", fingerprint)).toBe(false);
  });
});
