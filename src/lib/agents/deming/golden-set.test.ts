// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * The golden set (#2533 step 3): append-only, frozen, and measured with no model calls.
 * `GOLDEN_SET_APPEND=1` (with optional `GOLDEN_SET_BANKS=<file of BankEntry[]>`) appends a new
 * version from today's fixtures; then copy the printed version line into `GOLDEN_SET_VERSIONS`.
 */

const provider = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/ai-provider", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(real).map(([name, value]) => [name, typeof value === "function"
    ? () => { provider.calls += 1; throw new Error(`golden set: paid provider call refused (${name})`); }
    : value]));
});

const golden = await import("./golden-set");
const { loadScenarios } = await import("./shadow-lab/scenarios");
const regressionFixture = JSON.parse(readFileSync(join(process.cwd(), "src/lib/agents/deming/__fixtures__/regression-cases.json"), "utf8")) as {
  cases: import("./golden-set").RegressionFixtureCase[];
};

const TIMEOUT_MS = 180_000;

describe.runIf(process.env.GOLDEN_SET_APPEND === "1")("golden set append", () => {
  it("appends today's cases as a new version without touching existing members", () => {
    const manifest = golden.readGoldenManifest();
    const banks = process.env.GOLDEN_SET_BANKS ? JSON.parse(readFileSync(process.env.GOLDEN_SET_BANKS, "utf8")) : [];
    const next = golden.appendGoldenSet(manifest, {
      frozenAt: new Date().toISOString().slice(0, 10), scenarios: loadScenarios(), regression: regressionFixture.cases, banks,
    });
    writeFileSync(join(process.cwd(), golden.GOLDEN_SET_PATH), golden.serializeGoldenManifest(next));
    console.log("GOLDEN_SET_VERSIONS:", JSON.stringify(next.versions));
    expect(next.members.slice(0, manifest.members.length)).toEqual(manifest.members);
  });
});

describe.skipIf(process.env.GOLDEN_SET_APPEND === "1")("golden set", () => {
  const manifest = golden.readGoldenManifest();

  it("is append-only: every version still hashes to its member prefix", () => {
    expect(golden.GOLDEN_SET_VERSIONS.length).toBeGreaterThan(0);
    expect(golden.appendOnlyViolations(manifest)).toEqual([]);
  });

  it("fails when an existing member is edited, removed or reordered", () => {
    const edited = structuredClone(manifest);
    edited.members[0].since += 1;
    expect(golden.appendOnlyViolations(edited).join(" ")).toMatch(/edited, reordered or removed/);
    const removed = { ...manifest, members: manifest.members.slice(1) };
    expect(golden.appendOnlyViolations(removed).length).toBeGreaterThan(0);
    const reordered = { ...manifest, members: [manifest.members[1], manifest.members[0], ...manifest.members.slice(2)] };
    expect(golden.appendOnlyViolations(reordered).join(" ")).toMatch(/edited, reordered or removed/);
    const unversioned = { ...manifest, members: [...manifest.members, { ...manifest.members[0], id: "shadow:new" }] };
    expect(golden.appendOnlyViolations(unversioned)).toContain("members were added without a version");
  });

  it("appending keeps every existing member byte for byte", () => {
    const next = golden.appendGoldenSet(manifest, { frozenAt: "2099-01-01", scenarios: loadScenarios(), regression: regressionFixture.cases, banks: [] });
    expect(next.members.slice(0, manifest.members.length)).toEqual(manifest.members);
    expect(golden.appendOnlyViolations(next, next.versions)).toEqual([]);
  });

  it("references the four committed fixtures, the regression cases and the eligible banks, and every input still matches its hash", () => {
    const set = golden.loadGoldenSet();
    expect(set.problems).toEqual([]);
    const fixtures = new Set(manifest.members.flatMap((m) => (m.kind === "shadow_case" ? [m.fixture] : [])));
    for (const path of [
      "src/lib/agents/deming/__fixtures__/live-audit-2026-w43.json",
      "src/lib/agents/deming/__fixtures__/adversarial-documents.json",
      "src/lib/agents/deming/__fixtures__/hard-documents.json",
    ]) expect(fixtures).toContain(path);
    const kinds = manifest.members.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.kind]: (acc[m.kind] ?? 0) + 1 }), {});
    expect(kinds.regression_case).toBe(regressionFixture.cases.length);
    expect(kinds.answer_key_bank).toBeGreaterThan(0);
    // Offline, bank texts are not loaded: counted, never scored as zero.
    expect(set.notLoaded.length).toBe(kinds.answer_key_bank);
  });

  it("measures recall and precision deterministically with no provider calls", () => {
    const before = provider.calls;
    const first = golden.measureGoldenSet(golden.loadGoldenSet());
    const second = golden.measureGoldenSet(golden.loadGoldenSet());
    expect(provider.calls - before).toBe(0);
    expect(second).toEqual(first);
    expect(first.recall.expected).toBeGreaterThan(0);
    expect(first.recall.rate).not.toBeNull();
    expect(first.precision.rate).not.toBeNull();
    const same = golden.compareGoldenSet(first, second);
    expect(same).toMatchObject({ comparable: true, lost: [], gained: [], moreWrong: [], recall: { delta: 0 }, precision: { delta: 0 } });
    if (process.env.GOLDEN_SET_OUT) writeFileSync(process.env.GOLDEN_SET_OUT, JSON.stringify({ ...first, perMember: undefined }, null, 2));
  }, TIMEOUT_MS);

  it("scores a bank once its stored text is supplied, and a different loaded set is not comparable", () => {
    const bank = manifest.members.find((m) => m.kind === "answer_key_bank");
    expect(bank).toBeDefined();
    if (bank?.kind !== "answer_key_bank") return;
    const text = "Schedule of Fees\nOverdraft fee $30.00\nStop payment $30.00";
    const banksOnly = (set: import("./golden-set").GoldenSet) => ({ ...set, regression: [], cases: set.cases.filter((entry) => entry.member.kind === "answer_key_bank") });
    const offline = golden.measureGoldenSet(banksOnly(golden.loadGoldenSet()));
    const loaded = golden.measureGoldenSet(banksOnly(golden.loadGoldenSet({ bankTexts: new Map([[bank.id, text]]) })));
    expect(offline.recall.expected).toBe(0);
    expect(loaded.members.notLoaded).toBe(offline.members.notLoaded - 1);
    expect(loaded.byKind.answer_key_bank.expected).toBe(bank.expected.publish.length);
    expect(golden.compareGoldenSet(offline, loaded).comparable).toBe(false);
  }, TIMEOUT_MS);
});
