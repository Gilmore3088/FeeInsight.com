import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLAIM_GOLDEN_CASES,
  CLAIM_GOLDEN_HELD_OUT,
  CLAIM_GOLDEN_PROMPT_FILES,
  CLAIM_GOLDEN_REVIEW,
  CLAIM_GOLDEN_SET_VERSION,
  heldOutLeaks,
  runClaimGoldenCase,
  runClaimGoldenSet,
  type ClaimGoldenCase,
} from "./claim-golden-set";
import { EVIDENCE_REGRESSION_CASES, EVIDENCE_REGRESSION_SET_VERSION, HUMAN_REVIEW } from "./evidence-regression-set";

const root = path.resolve(__dirname, "../../..");
const byId = (id: string) => CLAIM_GOLDEN_CASES.find((c) => c.id === id)!;

describe("Hamilton claim golden set: today's behaviour, recorded (#1077, step 0)", () => {
  const run = runClaimGoldenSet();

  for (const result of run.results) {
    it(`${result.group}: ${result.id}${result.todayWrong ? " (wrong today)" : ""}`, () => {
      expect(result, result.summary).toMatchObject({ pass: true });
    });
  }

  it("covers the four groups the design names, each with a control, under distinct ids", () => {
    const groups = new Set(CLAIM_GOLDEN_CASES.map((c) => c.group));
    expect([...groups].sort()).toEqual(["causation", "swapped_bank", "wrong_period_claim", "wrong_premise"]);
    for (const group of groups) expect(CLAIM_GOLDEN_CASES.some((c) => c.group === group && c.control), group).toBe(true);
    expect(new Set(CLAIM_GOLDEN_CASES.map((c) => c.id)).size).toBe(CLAIM_GOLDEN_CASES.length);
  });

  it("marks a case wrong today exactly when today's status disagrees with the target, with a reason and a hole", () => {
    for (const c of CLAIM_GOLDEN_CASES) {
      const disagrees = (c.target.status === "held") !== (c.expect.status === "held");
      expect(c.todayWrong, c.id).toBe(disagrees);
      expect(Boolean(c.todayWrongReason?.trim()), c.id).toBe(c.todayWrong);
      expect((c.holes?.length ?? 0) > 0, c.id).toBe(c.todayWrong);
      if (c.control) expect(c.target, c.id).toEqual({ status: "validated", reasons: [] });
      else expect(c.target.reasons.length, c.id).toBeGreaterThan(0);
    }
    expect(run.todayWrong).toBe(0);
    expect(run.total).toBe(28);
  });

  it("closes the two holes the design names (step 3)", () => {
    // A figure the question states is no longer supported unchecked: a contradicting record omits it.
    expect(runClaimGoldenCase(byId("wp-fee-restated")).actual.binding?.omitted).toEqual(["premise_contradicted"]);
    expect(runClaimGoldenCase(byId("wp-nonexistent-fee")).actual.binding?.omitted).toEqual(["premise_unsupported"]);
    // The same pricing-cause words are held with NCUA data and without it (answer-interpretations.ts).
    expect(runClaimGoldenCase(byId("ca-financial-pricing")).actual.status).toBe("held");
    expect(runClaimGoldenCase(byId("ca-fee-only-pricing")).actual.status).toBe("held");
    expect(CLAIM_GOLDEN_CASES.filter((c) => c.holes?.length)).toEqual([]);
  });

  it("says plainly that no person has reviewed it, and is held out", () => {
    expect(run.version).toBe(CLAIM_GOLDEN_SET_VERSION);
    expect(CLAIM_GOLDEN_SET_VERSION).toBe("2026-10-25.4");
    expect(CLAIM_GOLDEN_REVIEW.status).toBe("unreviewed");
    expect(CLAIM_GOLDEN_REVIEW.record).toBeNull();
    expect(CLAIM_GOLDEN_REVIEW.note).toMatch(/No person has reviewed these cases/);
    expect(CLAIM_GOLDEN_HELD_OUT).toBe(true);
  });

  it("leaves the reviewed regression set as James approved it", () => {
    expect(EVIDENCE_REGRESSION_SET_VERSION).toBe("2026-10-18.1");
    expect(HUMAN_REVIEW.status).toBe("reviewed");
    const reviewed = new Set(EVIDENCE_REGRESSION_CASES.map((c) => c.id));
    expect(CLAIM_GOLDEN_CASES.filter((c) => reviewed.has(c.id)).map((c) => c.id)).toEqual([]);
  });

  it("uses synthetic institutions and fixture URLs only", () => {
    const allowed = new Set([9001, 9002, 9011, 9012, 9013, 9014, 9015]);
    for (const c of CLAIM_GOLDEN_CASES) {
      const json = JSON.stringify(c.surface === "written_answer" ? c.reads : c.bundle);
      for (const match of json.matchAll(/"(?:id|institution_id|institutionId)":(\d+)/g)) expect(allowed.has(Number(match[1])), `${c.id}: ${match[0]}`).toBe(true);
      for (const url of json.match(/https?:\/\/[^"]+/g) ?? []) expect(url, c.id).toMatch(/^https:\/\/fixture\.invalid\//);
      expect(`${c.question ?? ""} ${c.text}`, c.id).not.toMatch(/—|Atlas|Magellan|Rosetta|Knox|Darwin|Hamilton Pro/);
    }
  });

  it("fails a case whose recorded outcome is wrong, so the runner can't pass everything", () => {
    const shown = byId("wp-fee-corrected");
    expect(runClaimGoldenCase({ ...shown, expect: { ...shown.expect, status: "held" } } as ClaimGoldenCase).pass).toBe(false);
    const held = byId("sb-fee");
    expect(runClaimGoldenCase({ ...held, expect: { ...held.expect, binding: { supported: 0, interpretation: 0, omitted: ["wrong_period"], factIds: [] } } } as ClaimGoldenCase).pass).toBe(false);
    const quarter = byId("pd-quarter");
    expect(runClaimGoldenCase({ ...quarter, expect: { ...quarter.expect, problems: [] } } as ClaimGoldenCase).pass).toBe(false);
    expect(runClaimGoldenCase({ ...quarter, expect: { ...quarter.expect, problems: ["A different problem."] } } as ClaimGoldenCase).pass).toBe(false);
  });
});

describe("Hamilton claim golden set: held out of prompts (#1077)", () => {
  it("names prompt files that exist", () => {
    expect(CLAIM_GOLDEN_PROMPT_FILES.filter((file) => !existsSync(path.join(root, file)))).toEqual([]);
  });

  it.each(CLAIM_GOLDEN_PROMPT_FILES)("no golden case's question or answer appears in %s", (file) => {
    expect(heldOutLeaks(readFileSync(path.join(root, file), "utf8"))).toEqual([]);
  });

  it("no golden case's text appears in any other Hamilton or research source file", () => {
    const sources = ["src/lib/hamilton", "src/lib/research"].flatMap((dir) =>
      readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
        .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
        .map((file) => path.join(dir, file)))
      .filter((file) => !file.endsWith("claim-golden-set.ts"));
    expect(sources.length).toBeGreaterThan(50);
    const leaks = sources.flatMap((file) => heldOutLeaks(readFileSync(path.join(root, file), "utf8")).map((id) => `${file}: ${id}`));
    expect(leaks).toEqual([]);
  });

  it("catches a case's text pasted into a prompt, however it is wrapped or quoted", () => {
    const prompt = `const SYSTEM = \`Example:\n  "Bank A's   overdraft fee is $25 lower\n  because it competes with Bank B."\`;`;
    expect(heldOutLeaks(prompt)).toEqual(["ca-fee-only"]);
    expect(heldOutLeaks("Example question: why did Bank A’s overdraft revenue fall?")).toEqual(["wp-metric-absent", "wp-metric-absent-traced", "wp-metric-absent-control"]);
    expect(heldOutLeaks("A prompt with no case text in it.")).toEqual([]);
  });
});
