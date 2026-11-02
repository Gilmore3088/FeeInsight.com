// @vitest-environment node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { PipelineVariant, PublishedFee, StageFee } from "./shadow-lab/types";

/**
 * Plan step 4 (#2535): every `*_LIVE` switch passes the golden set before it turns on.
 *
 * The PR gate runs in CI (`.github/workflows/test.yml`, unit shard 1) with `SWITCH_GATE_DIFF`
 * naming the PR's diff against its base. Each switch named on an added or removed line of non-test
 * source replays the golden set with the switch off and on, in its own test, and writes a receipt
 * (Markdown and JSON under `SWITCH_GATE_OUT`, default `test-results/switch-gate`, and the job
 * summary). A test fails when any number gets worse, listing the fees that did. A switch the golden
 * set cannot replay gets a "not replayable" receipt carrying its reason from `NOT_REPLAYABLE_REASONS`.
 * It fails when no reason is stated, and when the PR turns the switch on (`switchesTurnedOnInDiff`)
 * without adding or rewording that reason line in the same diff (`reasonsStatedInDiff`).
 * Database sweeps replay through `sweep-replay.ts`: the sweep's decision function over the golden
 * set's publications, switch off then on.
 * More than `MAX_SWITCHES_PER_DIFF` named switches fail with one "too many" receipt that names the
 * local command to run instead. A `*_LIVE` name a PR deletes from every file in `src/` (a removed or
 * renamed switch) fails unless `RETIRED_SWITCHES` lists it.
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
const { sweepPublished, sweepSwitches } = await import("./sweep-replay");
const { GREATER_VALLEY_VISA_TEXT } = await import("@/lib/non-deposit-document.fixtures");

const TIMEOUT_MS = 300_000;
const entries = inventory.scanSwitches(process.cwd());
const switches = new Map(entries.filter(inventory.isSwitch).map((entry) => [entry.name, entry]));
const whyNot = (name: string): string | null => (switches.has(name) ? replay.NOT_REPLAYABLE_REASONS[name] ?? null : "not a `*_LIVE` switch in src/");

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

/**
 * One input per sweep switch on which the sweep's actions differ between switch off and on: the
 * published fees of one document, with its text and address. Most are rows from the sweep's own
 * tests and committed live fixtures; two are golden members the sweep moves.
 */
interface SweepProbe { fees: PublishedFee[]; text: string; url: string | null }
const pub = (canonicalFeeKey: string, feeName: string, amountCents: number, excerpt: string, frequency: string | null = null): PublishedFee =>
  ({ canonicalFeeKey, feeName, amountCents, frequency, excerpt, reason: null, sourceLine: excerpt, attributed: true });
const one = (fees: PublishedFee[], text?: string, url: string | null = "https://bank.example/fees"): SweepProbe =>
  ({ fees, text: text ?? fees.map((f) => f.excerpt).join("\n"), url });
const darwinFixture = <T>(name: string) => JSON.parse(readFileSync(join(process.cwd(), "src/lib/agents/darwin/__fixtures__", name), "utf8")) as T[];
const goldenSweep = (id: string): SweepProbe => {
  const entry = loadGoldenSet().cases.find((candidate) => candidate.member.id === id);
  if (!entry?.case.document.text) throw new Error(`golden member ${id} is missing`);
  const head = experimentalVariant({ id: "head", description: "", excerptAtPublish: false });
  return { fees: runCase(head, entry.case).published, text: entry.case.document.text, url: entry.case.document.url };
};
const SAFETY_NET = "Safety Net Overdraft | $0 if the negative balance is $5 or less. $10 if the negative balance is $5.01 to $20. $35 per item** if negative balance is $20.01 or greater.";
const NO_FEES = "It’s easy to open. It makes banking more convenient. There are no minimum balance requirements or monthly service fees. And you can get started with only a $1 deposit.";
const protection = darwinFixture<[number, number, number, string, number, number, string]>("protection-item-live-2026-11-01.json")[0];
const safeBox = 'Safe deposit box 5x5 | $ 15.00 Charged once each year for renting a safe deposit box of this size.';

const SWEEP_PROBES: Record<string, () => SweepProbe> = {
  BANDED_ZERO_TAKEDOWN_LIVE: () => one([pub("overdraft", "Safety Net Overdraft", 0, SAFETY_NET)], `${SAFETY_NET}\n\nSafety Net Overdraft | $5.01-$20.00 is $10.00 per transaction. $20.01 and over is $35.00 per transaction`),
  RATE_FLOOR_TAKEDOWN_LIVE: () => one([pub("check_cashing", "Merchant Check Cashing", 1000, "Merchant Check Cashing (Greater of 10% of Item or $10)")]),
  LATE_CHARGE_BOUND_TAKEDOWN_LIVE: () => one([pub("late_payment", "Maximum late charge", 3000, "Maximum late charge $30.00")]),
  NO_FEE_SENTENCE_TAKEDOWN_LIVE: () => one([pub("monthly_maintenance", "It’s easy to open. It makes banking more convenient. There are no minimum balance requirements or monthly service fees.", 100, NO_FEES)]),
  DARWIN_LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE: () => one([pub("other_lending_fee", "Loan Documentation Fee, estimated payment", 147389, "Loan Documentation Fee, estimated payment of $1,473.89")]),
  CANADIAN_DOCUMENT_TAKEDOWN_LIVE: () => one([pub("monthly_maintenance", "Monthly Fee", 400, "Monthly Fee $4.00")], "Chequing account Monthly Fee $4.00 ... Unlimited Interac e‑Transfers with no fees"),
  NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE: () => one([pub("appraisal_fee", "Appraisal", 40000, "Appraisal $400")], "Current Rates\nAppraisal $400", "https://www.bankofgreene.com/current-rates/"),
  BROKERAGE_DOCUMENT_TAKEDOWN_LIVE: () => one([pub("account_research", "Research", 2000, "Research $20")], "Pricing\nResearch $20", "https://www.usbank.com/investing/self-directed-investing/pricing.html"),
  CARD_PROGRAM_TAKEDOWN_LIVE: () => one([pub("monthly_maintenance", "Monthly Fee", 300, "Monthly Fee $3.00")], "Monthly Fee $3.00", "https://www.schoolsfirstfcu.org/disclosures/payroll-card-statement-of-fees-disclosure/"),
  OPENING_DOCUMENT_TAKEDOWN_LIVE: () => one([pub("nsf", "Non-sufficient funds (NSF) payment fee", 1500, "Non-sufficient funds (NSF) payment fee $15")],
    "TD Fit Personal Unsecured Consumer Loan Disclosure\nThis disclosure describes your TD Fit loan.", "https://www.td.com/content/dam/tdb/document/pdf/personal-banking/td-fit-account-guide-acc-en.pdf"),
  CREDIT_TERMS_TAKEDOWN_LIVE: () => one([pub("nsf", "Returned Check Fee", 1800, "Returned Check Fee $18")], GREATER_VALLEY_VISA_TEXT,
    "https://static1.squarespace.com/static/5c6c3188b7c92c1f58671825/t/5cb89dc60d929793056a1f0f/1555602886476/Disclosure-Visa_Disclosure.pdf"),
  LOAN_SECTION_TAKEDOWN_LIVE: () => one([pub("nsf", "Returned Item", 3000, "Returned Item | $30.00")], ["Business Checking# | $24.95 per month", "Loans", "SERVICE | AMOUNT", "Returned Item | $30.00"].join("\n")),
  CARD_PROGRAM_SECTION_TAKEDOWN_LIVE: () => one([pub("card_replacement", "Card Replacement", 500, "Card Replacement | $5.00")],
    ["Gift Card", "Card Inactivity Fee (No activity within 12 months) | $2.50", "Card Replacement | $5.00", "Plastic Card Replacement (Debit) | $20.00 / card"].join("\n")),
  FRAGMENT_NAME_TAKEDOWN_LIVE: () => one([pub("late_payment", "Late Fee up to (see schedule)", 0, "Late Fee up to (see schedule)")]),
  QUALIFIED_FRAGMENT_TAKEDOWN_LIVE: () => one([pub("late_payment", "Late Fee up to (see schedule)", 0, "Late Fee up to (see schedule)")]),
  SAME_LINE_READ_TAKEDOWN_LIVE: () => one([pub("stop_payment", "Stop Payment", 3000, "Stop Payment Fee | $30.00"), pub("stop_payment", "Stop Payment Fee", 3000, "Stop Payment Fee | $30.00")], "Schedule of Fees\nStop Payment Fee | $30.00"),
  LINE_CONFLICT_TAKEDOWN_LIVE: () => one([pub("safe_deposit_box", "Safe deposit box 5x5", 1500, safeBox, "per_item"), pub("safe_deposit_box", "Safe deposit box 5x5", 1500, safeBox, "annual")]),
  LINE_CONFLICT_OWN_UNIT_LIVE: () => one([pub("document_reproduction", "Photocopies", 25, "Photocopies | $.25 per page", "per_item"), pub("document_reproduction", "Photocopies", 25, "Photocopies | $.25 per page", "per_page")]),
  OD_TRANSFER_REFILE_LIVE: () => one([pub("overdraft", "Overdraft (O/D) Protection", 1200, "Overdraft (O/D) Protection | $12.00 per automatic transfer to a")]),
  PROTECTION_ITEM_REFILE_LIVE: () => one([pub("od_protection_transfer", protection[3], Math.round(protection[4] * 100), "")], protection[6]),
  OWN_UNIT_REFILE_LIVE: () => one([pub("document_reproduction", "Photocopies", 25, "Photocopies | $.25 per page", "per_item")], "Schedule of Fees\nPhotocopies | $.25 per page"),
  OWN_UNIT_BLANK_PART_HOUR_LIVE: () => one([pub("account_research", "Account Research", 1000, "Account Research | $10.00 per half hour")], "Schedule of Fees\nAccount Research | $10.00 per half hour"),
  HOURLY_FREQUENCY_LIVE: () => goldenSweep("shadow:missed_fees:state:1338"),
  HOURLY_LINE_LIVE: () => one([pub("account_research", "Account Research", 3000, "Account Research | $30.00 per hour", "per_item")], "Schedule of Fees\nAccount Research | $30.00 per hour"),
};

describe("switch golden-set replay", () => {
  it("maps only real switches, and each mapped switch's inventory row says it replays", () => {
    for (const name of Object.keys(replay.SWITCH_REPLAYS)) {
      expect(switches.has(name), `${name} is mapped in SWITCH_REPLAYS but is not a switch in src/`).toBe(true);
      expect(switches.get(name)?.replay).toBe(replay.SWITCH_REPLAYS[name].scope);
    }
    for (const spec of Object.values(replay.SWITCH_REPLAYS)) {
      if (spec.scope === "partial" || spec.scope === "sweep, partial") expect(spec.keepsCodeValue, "a partial replay names the reads it leaves at the PR head's code value").toBeTruthy();
    }
    const sweeps = Object.keys(replay.SWITCH_REPLAYS).filter((name) => replay.SWITCH_REPLAYS[name].sweep);
    expect(Object.keys(SWEEP_PROBES).sort()).toEqual(sweeps.sort());
    expect(Object.keys(PROBES).sort()).toEqual(Object.keys(replay.SWITCH_REPLAYS).filter((name) => !replay.SWITCH_REPLAYS[name].sweep).sort());
  });

  for (const [name, spec] of Object.entries(replay.SWITCH_REPLAYS)) {
    if (spec.sweep) {
      it(`${name}: the sweep acts differently on at least one input with the switch on`, () => {
        const probe = SWEEP_PROBES[name]?.();
        expect(probe, `${name} needs an input in SWEEP_PROBES whose sweep differs with the switch on`).toBeDefined();
        const run = (on: boolean) => sweepPublished(probe!.fees, { ...probe!, caseKey: "probe" }, sweepSwitches({ [name]: on }));
        const [off, on] = [run(false), run(true)];
        expect(JSON.stringify(on.published), `${name} on and off left the same fees live: the override does not reach the sweep (swept on: ${JSON.stringify(on.swept.map((s) => s.reason))})`)
          .not.toBe(JSON.stringify(off.published));
      }, TIMEOUT_MS);
      continue;
    }
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
    const unset = measureGoldenSet(set, experimentalVariant({ id: "current", description: "", excerptAtPublish: false, switches: {} }));
    expect(unset).toEqual(current);
    expect(current.recall.expected).toBeGreaterThan(0);
    expect(provider.calls - before).toBe(0);
  }, TIMEOUT_MS);

  it("a switch with no replay gets a not-replayable receipt with its reason, and one with no reason fails", () => {
    const set = loadGoldenSet();
    const name = [...switches.keys()].find((candidate) => !replay.SWITCH_REPLAYS[candidate])!;
    const receipt = replay.replaySwitch(set, name, whyNot(name));
    expect(receipt.status).toBe("not_replayable");
    expect(receipt.reason).toBe(replay.NOT_REPLAYABLE_REASONS[name]);
    expect(replay.renderReceipt(receipt)).toMatch(/NOT REPLAYABLE/);
    expect(replay.unreplayableVerdict(receipt, new Set(), new Set())).toBeNull();
    const unstated = replay.replaySwitch(set, name, null);
    expect(unstated.status).toBe("no_reason");
    expect(replay.renderReceipt(unstated)).toMatch(/NO REASON STATED/);
    expect(replay.unreplayableVerdict(unstated, new Set(), new Set())).toMatch(/no stated reason/);
    // Turned on in the PR: passes only when the same diff adds its reason line.
    expect(replay.unreplayableVerdict(receipt, new Set([name]), new Set())).toMatch(/turned on in this PR/);
    expect(replay.unreplayableVerdict(receipt, new Set([name]), new Set([name]))).toBeNull();
  }, TIMEOUT_MS);

  it("reads the switches a diff turns on and the reasons it states", () => {
    const flip = ["diff --git a/src/lib/x.ts b/src/lib/x.ts", "-export const SAMPLE_REPORT_LIVE = false;", "+export const SAMPLE_REPORT_LIVE = true;",
      "+export const NEW_THING_LIVE: boolean = true;", "-export const STAYS_ON_LIVE = true;", "+export const STAYS_ON_LIVE = true; // reworded",
      "+export const ADDED_OFF_LIVE = false;",
      "diff --git a/src/lib/x.test.ts b/src/lib/x.test.ts", "+const TEST_ONLY_LIVE = true;"].join("\n");
    expect(replay.switchesTurnedOnInDiff(flip)).toEqual(["NEW_THING_LIVE", "SAMPLE_REPORT_LIVE"]);
    const reasons = ["diff --git a/src/lib/agents/deming/switch-replay.ts b/src/lib/agents/deming/switch-replay.ts",
      "+  SAMPLE_REPORT_LIVE: `shows the sample report page; ${SYSTEM}`,", "   CITY_REPAIR_LIVE: \"context\",", "-  OLD_LIVE: \"gone\",",
      "diff --git a/src/lib/other.ts b/src/lib/other.ts", "+  FOO_LIVE: \"not the map\","].join("\n");
    expect(replay.reasonsStatedInDiff(reasons)).toEqual(["SAMPLE_REPORT_LIVE"]);
  });

  it("a sweep replay runs the pipeline once and judges only the sweep, with no provider call", () => {
    const full = loadGoldenSet();
    const set = { ...full, cases: full.cases.slice(0, 40), regression: [] };
    const before = provider.calls;
    const receipt = replay.replaySwitch(set, "HOURLY_LINE_LIVE");
    expect(provider.calls - before).toBe(0);
    expect(receipt.scope).toBe("sweep");
    expect(["pass", "fail"]).toContain(receipt.status);
    expect(receipt.goldenSet?.members.measured).toBe(40);
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

  it("fails a switch the PR deletes from src/, unless it is listed as retired", () => {
    // Built, so this file does not add the name to the inventory's scan of src/.
    const gone = ["GONE", "SWITCH", "LIVE"].join("_");
    const diff = [
      "diff --git a/src/lib/foo.ts b/src/lib/foo.ts", "--- a/src/lib/foo.ts", "+++ b/src/lib/foo.ts", "@@ -1,3 +0,0 @@",
      `-export const ${gone} = false;`, `-  if (!${gone}) return base;`, "-// DAILY_CAP_LINES_LIVE still lives elsewhere",
      "diff --git a/src/lib/bar.test.ts b/src/lib/bar.test.ts", `-expect(${["BAR", "LIVE"].join("_")}).toBe(false);`,
    ].join("\n");
    const head = new Set(entries.map((entry) => entry.name));
    expect(head.has(gone)).toBe(false);
    expect(replay.switchesNamedInDiff(diff, new Set(switches.keys()))).toEqual(["DAILY_CAP_LINES_LIVE"]);
    expect(replay.switchesRemovedInDiff(diff, head)).toEqual([gone]);
    const receipt = replay.removedSwitchReceipt(gone, {});
    expect(receipt.status).toBe("removed");
    expect(replay.renderReceipt(receipt)).toContain("REMOVED");
    expect(replay.removedSwitchReceipt(gone, { [gone]: "on since 2026-10-01; receipts #1" }).status).toBe("retired");
    // A rename removes the old name (which fails) and adds the new one, which replays or says not replayable.
    const rename = `${diff}\ndiff --git a/src/lib/foo.ts b/src/lib/foo.ts\n+export const DAILY_CAP_LINES_LIVE = true;`;
    expect(replay.switchesRemovedInDiff(rename, head)).toEqual([gone]);
  });

  it("over the cap, the gate fails with the local command that replays the switches", () => {
    const many = [...switches.keys()].slice(0, replay.MAX_SWITCHES_PER_DIFF + 1);
    const diff = ["diff --git a/src/x.ts b/src/x.ts", ...many.map((name) => `+use(${name});`)].join("\n");
    const names = replay.switchesNamedInDiff(diff, new Set(switches.keys()));
    expect(names.length).toBeGreaterThan(replay.MAX_SWITCHES_PER_DIFF);
    const message = replay.tooManyMessage(names);
    expect(message).toContain(`SWITCH_GATE_SWITCHES=${names.join(",")} npx vitest run src/lib/agents/deming/switch-gate.test.ts`);
    expect(() => expect.fail(message)).toThrow(/TOO MANY/);
  });

  it("holds every other switch at the PR head's code value", async () => {
    const { DAILY_CAP_LINES_LIVE } = await import("@/lib/daily-cap-wording");
    const { DASH_LIST_ROWS_LIVE } = await import("@/lib/agents/knox/dash-list-rows");
    const other = replay.switchExperiment("NO_CHARGE_SENTENCE_READ_LIVE", replay.SWITCH_REPLAYS.NO_CHARGE_SENTENCE_READ_LIVE, true);
    expect(other.dailyCapLines).toBe(DAILY_CAP_LINES_LIVE);
    expect(other.dashListRows).toBe(DASH_LIST_ROWS_LIVE);
    expect(replay.switchExperiment("DASH_LIST_ROWS_LIVE", replay.SWITCH_REPLAYS.DASH_LIST_ROWS_LIVE, !DASH_LIST_ROWS_LIVE).dashListRows).toBe(!DASH_LIST_ROWS_LIVE);
  });
});

const diffPath = process.env.SWITCH_GATE_DIFF;
const named = process.env.SWITCH_GATE_SWITCHES;

describe.runIf(Boolean(diffPath || named))("switch golden-set gate (PR receipts)", () => {
  const diff = !named && diffPath ? readFileSync(diffPath, "utf8") : "";
  const names = named
    ? named === "all" ? [...switches.keys()] : named.split(",").map((name) => name.trim()).filter(Boolean)
    : replay.switchesNamedInDiff(diff, new Set(switches.keys()));
  // A name deleted from every file in `src/` is gone from the head scan, so the diff finds it.
  const removed = replay.switchesRemovedInDiff(diff, new Set(entries.map((entry) => entry.name)));
  const turnedOn = new Set(replay.switchesTurnedOnInDiff(diff));
  const stated = new Set(replay.reasonsStatedInDiff(diff));
  // Sweep replays share one pipeline run, so only read switches count toward the cap.
  const tooMany = !named && names.filter((name) => !replay.SWITCH_REPLAYS[name]?.sweep).length > replay.MAX_SWITCHES_PER_DIFF;
  const receipts: import("./switch-replay").SwitchReceipt[] = [];
  const set = names.length > 0 && !tooMany ? loadGoldenSet() : null;

  afterAll(() => {
    const out = process.env.SWITCH_GATE_OUT ?? join(process.cwd(), "test-results/switch-gate");
    mkdirSync(out, { recursive: true });
    const counts = receipts.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    const markdown = [
      "## Switch golden-set receipts (plan step 4)",
      "",
      names.length === 0 && removed.length === 0
        ? "This PR names no `*_LIVE` switch in an added or removed line of non-test source."
        : tooMany
          ? replay.tooManyMessage(names)
          : `Switches named: ${names.length + removed.length}. ${Object.entries(counts).map(([status, n]) => `${status.replace(/_/g, " ")}: ${n}`).join(", ")}.`,
      "",
      ...receipts.map(replay.renderReceipt),
    ].join("\n");
    writeFileSync(join(out, "receipts.md"), markdown);
    writeFileSync(join(out, "receipts.json"), `${JSON.stringify({ names, removed, tooMany, receipts }, null, 1)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    console.log(markdown);
  });

  for (const name of removed) {
    it(`${name}: a switch removed from src/ is either listed as retired or fails`, () => {
      const receipt = replay.removedSwitchReceipt(name);
      receipts.push(receipt);
      expect(receipt.status, `${name}: ${receipt.reason}`).toBe("retired");
    });
  }

  if (tooMany) {
    it(`names ${names.length} switches, over the cap of ${replay.MAX_SWITCHES_PER_DIFF}: replay them by name locally`, () => {
      expect.fail(replay.tooManyMessage(names));
    });
    return;
  }

  if (names.length === 0) {
    if (removed.length === 0) it("names no switch", () => expect(receipts).toEqual([]));
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
      // "Not replayable" never passes silently: a stated reason is required, and a switch this PR turns on needs it stated in this PR.
      expect(replay.unreplayableVerdict(receipt, turnedOn, stated)).toBeNull();
    }, TIMEOUT_MS);
  }
});
