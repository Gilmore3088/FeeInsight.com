import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLAIM_GOLDEN_PROMPT_FILES, normalizeHeldOutText } from "./claim-golden-set";
import { gateAnswer } from "./output-gate";
import { PIPELINE_TERMS } from "./workspace/four-roles";
import {
  PERSONAS,
  PERSONA_GOLDEN_CASES,
  personaAgreementTable,
  personaGateInput,
  personaHeldOutTexts,
  replayPersonaGoldenSet,
  type AccountKind,
  type AdversarialKind,
} from "./persona-golden-set";

const replay = replayPersonaGoldenSet();

describe("persona golden set (T5, #982, #1726)", () => {
  it("covers the five personas with several questions each, every adversarial kind and both account kinds", () => {
    for (const persona of PERSONAS) expect(replay.byPersona[persona], persona).toBeGreaterThanOrEqual(3);
    const adversarial: AdversarialKind[] = ["untraced_figure", "wrong_institution", "causal_unsupported", "percent_pooled_with_dollars",
      "thin_peer_median", "thin_local_median", "stale_period", "correction_as_price_change", "pipeline_agent_name"];
    const account: AccountKind[] = ["other_tenant_institution", "reader_without_pro"];
    const kinds = new Set(PERSONA_GOLDEN_CASES.map((c) => c.adversarial ?? c.account));
    for (const kind of [...adversarial, ...account]) expect(kinds.has(kind), kind).toBe(true);
    expect(new Set(PERSONA_GOLDEN_CASES.map((c) => c.id)).size).toBe(PERSONA_GOLDEN_CASES.length);
  });

  it.each(replay.results.map((r) => [r.id, r] as const))("%s gets its expected verdict", (_id, result) => {
    expect({ unified: result.unified, meets: result.meetsExpect }).toEqual({ unified: result.expect, meets: true });
  });

  it("holds every adversarial and account case: the gate passes nothing it should hold", () => {
    expect(replay.gateBugs).toEqual([]);
    for (const r of replay.results.filter((x) => x.group !== "persona" && x.expect === "held")) expect(r.unified, r.id).toBe("held");
  });

  it("passes every correct persona answer except the over-holds it names", () => {
    expect(replay.overHolds).toEqual(["cfo-no-cause"]);
    for (const r of replay.results.filter((x) => x.group === "persona" && !x.overHold)) expect(r.unified, r.id).toBe("validated");
  });

  it("records each case exactly as shadowGate does: the golden origin, no gate error, the gate's own status", () => {
    for (const c of PERSONA_GOLDEN_CASES) {
      if (c.surface === "access") continue;
      const r = replay.results.find((x) => x.id === c.id)!;
      expect(r.record?.origin, c.id).toBe("golden");
      expect(r.record?.error, c.id).toBeUndefined();
      expect(r.unified, c.id).toBe(gateAnswer(personaGateInput(c)).status);
    }
  });

  it("names every internal agent in customer text as an internal name", () => {
    for (const name of ["Knox", "Darwin", "Rosetta", "Magellan", "Atlas", "Gutenberg", "Hoovie"]) {
      expect(`${name} checked the fee.`, name).toMatch(PIPELINE_TERMS);
    }
    // Deming and Bayes only as a system: a town, an institution and a rule of probability pass.
    for (const text of ["Deming reconciled the filings.", "The Deming audit flagged it.", "Bayes replay counted it.", "The Bayes ledger shows it."]) {
      expect(text, text).toMatch(PIPELINE_TERMS);
    }
    for (const text of ["Deming Schools Employees Federal Credit Union charges $25.", "Its branch in Deming, NM charges $30.",
      "By Bayes' rule the estimate holds.", "A Bayesian reading of the fee."]) {
      expect(text, text).not.toMatch(PIPELINE_TERMS);
    }
  });

  it("keeps its texts out of every prompt, knowledge and repair file (held out)", () => {
    const leaks: string[] = [];
    for (const file of CLAIM_GOLDEN_PROMPT_FILES) {
      const source = normalizeHeldOutText(readFileSync(path.join(process.cwd(), file), "utf8"));
      for (const { id, text } of personaHeldOutTexts()) if (source.includes(normalizeHeldOutText(text))) leaks.push(`${id} in ${file}`);
    }
    expect(leaks).toEqual([]);
  });

  it("prints the agreement table for a reviewer (agree, unified stricter, legacy stricter, per surface)", () => {
    const table = personaAgreementTable(replay);
    const disagreements = replay.results.filter((r) => r.agreement !== "agree")
      .map((r) => `- ${r.id} (${r.surface}): legacy ${r.legacy}, unified ${r.unified} [${r.codes.join(", ")}]`);
    process.stdout.write(`\nPersona golden set ${replay.version}: ${replay.total} cases `
      + `(${replay.byGroup.persona} persona, ${replay.byGroup.adversarial} adversarial, ${replay.byGroup.account} account); `
      + `unified validated ${replay.byStatus.validated}, partial ${replay.byStatus.ready_partial}, held ${replay.byStatus.held}\n${table}\n`
      + `Disagreements:\n${disagreements.join("\n")}\n`);
    const all = replay.agreement.reduce((sum, row) => sum + row.total, 0);
    expect(all).toBe(replay.total);
    for (const row of replay.agreement) expect(row.agree + row.unifiedStricter + row.legacyStricter).toBe(row.total);
    // Recorded on 2026-10-25: the written-answer path is the only one that disagrees.
    expect(replay.agreement.find((row) => row.surface === "written_answer")).toMatchObject({ unifiedStricter: 3, legacyStricter: 1 });
    expect(replay.agreement.filter((row) => row.surface !== "written_answer").every((row) => row.agree === row.total)).toBe(true);
  });
});
