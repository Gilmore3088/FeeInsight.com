// @vitest-environment node
import { describe, expect, it } from "vitest";
import receipt from "./robot-human-agreement.json";
import { readLiveAudit } from "./shadow-lab/live-audit";
import { agreementReceiptFields, humanW43Accuracy, robotClass, w43Agreement } from "./w43-agreement";

const fixture = readLiveAudit();
const pct = (v: number | null) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);

describe("robot-human agreement on James's W43 live check (plan step 2)", () => {
  const report = w43Agreement(fixture);

  it("should_print_agreement_and_the_robot_accuracy_beside_james", () => {
    const human = humanW43Accuracy(fixture);
    console.log([
      `W43 robot-human agreement (audit v${receipt.audit_version}): ${report.agree}/${report.scored} = ${pct(report.agreement)} (target ${pct(receipt.target)}; v${receipt.before.audit_version} was ${receipt.before.agree}/${report.scored} = ${pct(receipt.before.agreement)})`,
      `right/wrong agreement: ${report.agreeRightWrong}/${report.scored} = ${pct(report.agreementRightWrong)}`,
      `robot accuracy on the replayed rows: ${report.robotRight}/${report.scored} = ${pct(report.robotRight / report.scored)}; James on the same rows ${report.humanRight}/${report.scored} = ${pct(report.humanRight / report.scored)}; James overall ${human.right}/${human.checked} = ${pct(human.right / human.checked)}`,
      `top disagreements (human→robot): ${report.disagreements.slice(0, 8).map((d) => `${d.key} ${d.count}`).join("; ")}`,
    ].join("\n"));
    expect(human).toEqual({ right: 604, checked: 882 });
  });

  it("should_keep_the_committed_receipt_equal_to_the_replay", () => {
    const measured = agreementReceiptFields(fixture);
    const committed = Object.fromEntries(Object.keys(measured).map((key) => [key, receipt[key as keyof typeof receipt]]));
    expect(measured).toEqual(committed);
    expect(receipt.fixture).toBe("src/lib/agents/deming/__fixtures__/live-audit-2026-w43.json");
  });

  it("should_record_the_excluded_rows_and_score_a_subset_of_james_checked_rows", () => {
    const excluded = Object.values(receipt.excluded).reduce((a, b) => a + b, 0);
    expect(receipt.scored + excluded).toBe(fixture.rows.length);
    expect(receipt.scored).toBeLessThan(receipt.human_w43.checked);
  });

  it("should_not_let_agreement_fall_below_the_measured_floor", () => {
    expect(report.agree).toBeGreaterThanOrEqual(receipt.floor_agree);
  });

  it("should_score_no_match_row_as_a_lost_term", () => {
    // The terms check is new: a MATCH James accepted must never become a terms miss on the replay.
    expect(report.rows.filter((r) => r.human === "right" && r.robotVerdict === "qualifier")).toEqual([]);
  });

  it("should_score_every_replayable_row_once_and_count_the_rest", () => {
    const excluded = Object.values(report.excluded).reduce((a, b) => a + b, 0);
    expect(report.scored + excluded).toBe(fixture.rows.length);
    expect(report.rows.some((r) => r.robot === "unknown")).toBe(false);
  });

  it("should_map_a_lost_term_to_james_wrong_amount", () => {
    expect(robotClass("qualifier")).toBe("amount");
    expect(robotClass("right")).toBe("right");
  });

  it("should_score_more_periods_lost_when_the_stored_frequency_is_read_as_not_shown", () => {
    const bound = w43Agreement(fixture, { frequency: "not_shown" });
    expect(bound.robotRight).toBeLessThanOrEqual(report.robotRight);
    expect(bound.agree).toBe(receipt.not_shown_bound.agree);
  });
});
