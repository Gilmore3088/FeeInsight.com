// @vitest-environment node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { PipelineVariant, StageFee } from "./shadow-lab/types";

/**
 * Plan step 4 (#2535): every `*_LIVE` switch passes the golden set before it turns on.
 *
 * The PR gate runs in CI (`.github/workflows/test.yml`, unit shard 1) with `SWITCH_GATE_DIFF`
 * naming the PR's diff against its base. Each switch named on an added or removed line of non-test
 * source replays the golden set with the switch off and on, in its own test, and writes a receipt
 * (Markdown and JSON under `SWITCH_GATE_OUT`, default `test-results/switch-gate`, and the job
 * summary). A test fails when any number gets worse, listing the fees that did. A switch the golden
 * set cannot replay gets a "not replayable" receipt, which does not pass it and does not fail the PR.
 * More than `MAX_SWITCHES_PER_DIFF` named switches get one "too many" receipt instead: run them by
 * name locally.
 *
 * Locally: `SWITCH_GATE_SWITCHES=all` (or a comma list) replays switches by name instead of a diff,
 * with no cap. An environment switch has no diff when it flips, so run it this way before flipping.
 */

const provider = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/ai-provider", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(real).map(([name, value]) => [name, typeof value === "function"
    ? () => { provider.calls += 1; throw new Error(`switch gate: paid provider call refused (${name})`); }
    : value]));
});

const { loadGoldenSet, measureGoldenSet } = await import("./golden-set");
const { currentVariant, experimentalVariant } = await import("./shadow-lab/variants");
const { runCase } = await import("./shadow-lab/run-case");
const replay = await import("./switch-replay");
const inventory = await import("./switch-inventory");
const { CHANGED_FROM_MAIN } = await import("@/lib/agents/knox/dash-list-rows.fixtures");

const TIMEOUT_MS = 300_000;
const entries = inventory.scanSwitches(process.cwd());
const switches = new Map(entries.filter(inventory.isSwitch).map((entry) => [entry.name, entry]));
const whyNot = (name: string) => (switches.get(name)?.replay ?? "not a `*_LIVE` switch in src/").replace(/^no: /, "");

/**
 * One input per mapped switch on which the variant's output differs between switch off and on.
 * Without it a misspelled or ignored override would measure the same pipeline twice and pass.
 */
const WELLS_FARGO = readFileSync(join(process.cwd(), "src/lib/__fixtures__/no-charge-nsf/wells-fargo-overdraft-faq-33356.txt"), "utf8");
const DISCONTINUED = ["Personal Checking", "Essential Checking | Monthly Fee | $6.00", "", "Legacy Accounts", "Gold Checking",
  "Monthly Fee | $15.00", "Paper Statement | $3.00", "", "Basic Savings Monthly Service Charge (80 Suffix) | $5.00 (this account no longer offered)"].join("\n");
const fee = (canonicalFeeKey: string, feeName: string, amountCents: number, excerpt: string): StageFee =>
  ({ canonicalFeeKey, feeName, amountCents, frequency: null, excerpt, reason: null });
const publishOf = (f: StageFee) => (v: PipelineVariant) => v.publishGate(f, `Schedule of Fees\n${f.excerpt}`, []);
const goldenCase = (id: string) => (v: PipelineVariant) => {
  const entry = loadGoldenSet().cases.find((candidate) => candidate.member.id === id);
  if (!entry) throw new Error(`golden member ${id} is missing`);
  return runCase(v, entry.case).published.map((p) => [p.canonicalFeeKey, p.amountCents, p.feeName]);
};
const sideBySide = (line: string) => ["Card Replacement $ 100.00 | Copies per item $ 1.00", "Rush Order $ 125.00 | Mail Deposit Processing, per item $ 15.00",
  line, "ATM Withdrawals2 | Non-Sufficient Funds (NSF) / Uncollected (UNC)"].join("\n");
const TERRA = "Foreign Transaction Fees No Charge | Night Depository Bags & Key $ 30.00";

const PROBES: Record<string, (v: PipelineVariant) => unknown> = {
  KNOX_HELD_NAME_RULES_LIVE: goldenCase("shadow:missed_fees:state:7623"),
  DASH_LIST_ROWS_LIVE: (v) => v.extract(CHANGED_FROM_MAIN[1].lines.join("\n")).passed,
  KNOX_DISCONTINUED_TABLES_LIVE: (v) => v.extract(DISCONTINUED),
  DAILY_CAP_LINES_LIVE: goldenCase("shadow:missed_fees:state:8741"),
  NO_CHARGE_SENTENCE_READ_LIVE: (v) => v.extract(WELLS_FARGO),
  DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE: (v) => v.verify(fee("foreign_transaction", "Foreign Transaction Fees", 0, TERRA), sideBySide(TERRA)),
  BORROWED_DIRECTION_LIVE: publishOf(fee("stop_payment", "Stop Payment: Incoming", 3000, "Stop Payment: Incoming | $30.00")),
  NON_CUSTOMER_CASHIERS_CHECK_LIVE: publishOf(fee("cashiers_check", "Official Cashier Check-Non-Customer", 1000, "Official Cashier Check-Non-Customer | $10.00")),
  INTL_ABBREVIATION_REFILE_LIVE: publishOf(fee("wire_domestic_outgoing", "Int. Wire Transfer – Outgoing", 4500, "Int. Wire Transfer – Outgoing | $45.00")),
  LOAN_PAYMENT_NSF_REFILE_LIVE: publishOf(fee("nsf", "» NSF mortgage payment: Additional Cenlar charge", 2500, "» NSF mortgage payment: Additional Cenlar charge | $25.00")),
};

describe("switch golden-set replay", () => {
  it("maps only real switches, and each mapped switch's inventory row says it replays", () => {
    for (const name of Object.keys(replay.SWITCH_REPLAYS)) {
      expect(switches.has(name), `${name} is mapped in SWITCH_REPLAYS but is not a switch in src/`).toBe(true);
      expect(switches.get(name)?.replay).toBe(replay.SWITCH_REPLAYS[name].scope);
    }
    for (const spec of Object.values(replay.SWITCH_REPLAYS)) {
      if (spec.scope === "partial") expect(spec.keepsCodeValue, "a partial replay names the reads it leaves at the PR head's code value").toBeTruthy();
    }
    expect(Object.keys(PROBES).sort()).toEqual(Object.keys(replay.SWITCH_REPLAYS).sort());
  });

  for (const [name, spec] of Object.entries(replay.SWITCH_REPLAYS)) {
    it(`${name}: the override changes the pipeline on at least one input`, () => {
      const probe = PROBES[name];
      expect(probe, `${name} needs an input in PROBES whose output differs with the switch on`).toBeDefined();
      const off = JSON.stringify(probe(experimentalVariant(replay.switchExperiment(name, spec, false))));
      const on = JSON.stringify(probe(experimentalVariant(replay.switchExperiment(name, spec, true))));
      expect(on, `${name} on and off gave the same output: the override does not reach the code`).not.toBe(off);
    }, TIMEOUT_MS);
  }

  it("an experiment with no switch fields is today's pipeline", () => {
    // A slice keeps the unit shard fast; the full set runs in the PR gate and golden-set.test.ts.
    const full = loadGoldenSet();
    const set = { ...full, cases: full.cases.slice(0, 80), regression: full.regression.slice(0, 20) };
    const before = provider.calls;
    const current = measureGoldenSet(set, currentVariant);
    const unset = measureGoldenSet(set, experimentalVariant({ id: "current", description: "", excerptAtPublish: false, dailyCapLines: false, switches: {} }));
    expect(unset).toEqual(current);
    expect(current.recall.expected).toBeGreaterThan(0);
    expect(provider.calls - before).toBe(0);
  }, TIMEOUT_MS);

  it("a switch with no replay gets a not-replayable receipt that does not pass", () => {
    const set = loadGoldenSet();
    const name = [...switches.keys()].find((candidate) => !replay.SWITCH_REPLAYS[candidate])!;
    const receipt = replay.replaySwitch(set, name, whyNot(name));
    expect(receipt.status).toBe("not_replayable");
    expect(replay.renderReceipt(receipt)).toMatch(/NOT REPLAYABLE/);
  }, TIMEOUT_MS);

  it("the gate fails on any number that falls and passes when none does", () => {
    const flat = { before: 0.5, after: 0.5, delta: 0 };
    const none = { lost: [], moreWrong: [], moreLetThrough: [] };
    expect(replay.worseNumbers({ recall: flat, precision: flat, knownWrongRefused: flat, ...none })).toEqual([]);
    expect(replay.worseNumbers({ recall: { before: 0.5, after: 0.49, delta: -0.01 }, precision: flat, knownWrongRefused: flat, ...none,
      lost: [{ id: "m", fee: { canonicalFeeKey: "nsf", feeName: null, amountCents: 3000 } }], moreWrong: [{ id: "m", before: 0, after: 1 }] }))
      .toEqual(["recall", "expected fees lost", "members publishing more known-wrong fees"]);
    expect(replay.worseNumbers({ recall: { before: null, after: null, delta: null }, precision: flat, knownWrongRefused: { before: 1, after: 0.9, delta: -0.1 },
      ...none, moreLetThrough: [{ id: "regression:x", before: 0, after: 1 }] }))
      .toEqual(["known-wrong refused", "members letting more known-wrong fees or takedowns through"]);
  });

  it("reads the switches that added and removed lines of non-test source name", () => {
    const diff = [
      "diff --git a/src/x.ts b/src/x.ts", "--- a/src/x.ts", "+++ b/src/x.ts", "@@ -1 +1 @@",
      "-export const DAILY_CAP_LINES_LIVE = false;", "+export const DAILY_CAP_LINES_LIVE = true;",
      " // KNOX_HELD_NAME_RULES_LIVE is context, not a change", "+const ALREADY_LIVE = /x/;",
      "diff --git a/src/lib/agents/deming/switch-replay.ts b/src/lib/agents/deming/switch-replay.ts", "+  NO_CHARGE_SENTENCE_READ_LIVE: {",
      "diff --git a/src/lib/x.test.ts b/src/lib/x.test.ts", "+expect(BORROWED_DIRECTION_LIVE).toBe(true);",
      "diff --git a/src/lib/agents/knox/dash-list-rows.fixtures.ts b/src/lib/agents/knox/dash-list-rows.fixtures.ts", "+// DASH_LIST_ROWS_LIVE",
    ].join("\n");
    expect(replay.switchesNamedInDiff(diff, new Set(switches.keys()))).toEqual(["DAILY_CAP_LINES_LIVE"]);
  });
});

const diffPath = process.env.SWITCH_GATE_DIFF;
const named = process.env.SWITCH_GATE_SWITCHES;

describe.runIf(Boolean(diffPath || named))("switch golden-set gate (PR receipts)", () => {
  const names = named
    ? named === "all" ? [...switches.keys()] : named.split(",").map((name) => name.trim()).filter(Boolean)
    : diffPath ? replay.switchesNamedInDiff(readFileSync(diffPath, "utf8"), new Set(switches.keys())) : [];
  const tooMany = !named && names.length > replay.MAX_SWITCHES_PER_DIFF;
  const receipts: import("./switch-replay").SwitchReceipt[] = [];
  const set = names.length > 0 && !tooMany ? loadGoldenSet() : null;

  afterAll(() => {
    const out = process.env.SWITCH_GATE_OUT ?? join(process.cwd(), "test-results/switch-gate");
    mkdirSync(out, { recursive: true });
    const counts = receipts.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    const markdown = [
      "## Switch golden-set receipts (plan step 4)",
      "",
      names.length === 0
        ? "This PR names no `*_LIVE` switch in an added or removed line of non-test source."
        : tooMany
          ? `TOO MANY: this PR names ${names.length} switches (cap ${replay.MAX_SWITCHES_PER_DIFF}), so none was replayed in CI. ` +
            `Run them locally and paste the receipts into the PR: \`SWITCH_GATE_SWITCHES=${names.join(",")} npx vitest run src/lib/agents/deming/switch-gate.test.ts\`.`
          : `Switches named: ${names.length}. ${Object.entries(counts).map(([status, n]) => `${status.replace(/_/g, " ")}: ${n}`).join(", ")}.`,
      "",
      ...receipts.map(replay.renderReceipt),
    ].join("\n");
    writeFileSync(join(out, "receipts.md"), markdown);
    writeFileSync(join(out, "receipts.json"), `${JSON.stringify({ names, tooMany, receipts }, null, 1)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    console.log(markdown);
  });

  if (names.length === 0 || tooMany) {
    it(tooMany ? `names ${names.length} switches, over the cap: replay them by name locally` : "names no switch", () => {
      expect(receipts).toEqual([]);
    });
    return;
  }

  for (const name of names) {
    it(`${name}: no golden-set number gets worse with the switch on`, () => {
      const before = provider.calls;
      const receipt = replay.replaySwitch(set!, name, whyNot(name));
      receipts.push(receipt);
      expect(provider.calls - before).toBe(0);
      const worse = receipt.worseFees.slice(0, 20).map((f) => `${f.change}: ${f.fee ? `${f.fee.canonicalFeeKey} ${f.fee.amountCents ?? "varies"}c ${f.fee.feeName ?? ""}` : "takedown"} (${f.member})`);
      expect(receipt.status === "fail" || receipt.status === "not_comparable" ? { worse: receipt.worse, reason: receipt.reason, fees: worse } : null,
        `${name} made a golden-set number worse; the receipt lists the fees`).toBeNull();
    }, TIMEOUT_MS);
  }
});
