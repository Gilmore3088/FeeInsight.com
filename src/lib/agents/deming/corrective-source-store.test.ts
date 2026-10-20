import { describe, expect, it } from "vitest";
import { CAPTURE_CHECK, captureCorrectiveSource, recordCorrectiveWarnings, warningOutcome } from "./corrective-source-store";

type Db = Parameters<typeof captureCorrectiveSource>[0];
interface Write { sql: string; values: unknown[] }

/** A transaction double: `savepoint` re-enters itself; `fail` names the statements that throw. */
function fakeTx(fail: { seal?: boolean; marker?: boolean }) {
  const writes: Write[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (fail.marker && sql.includes("UPDATE published_fee_corrections")) return Promise.reject(new Error("marker refused"));
    writes.push({ sql, values });
    if (sql.includes("current_setting")) return Promise.resolve([{ statement: "0", lock: "0" }]);
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    savepoint: (work: (scope: unknown) => Promise<unknown>) => work(tx),
    unsafe: () => (fail.seal ? Promise.reject(new Error("seal refused")) : Promise.resolve([])),
  });
  return { db: tx as unknown as Db, writes };
}

const INPUT = {
  correctionId: 41, runId: 7, stepId: 70,
  document: { id: 1, institutionId: 2, astId: 3, astInstitutionId: 2, status: "completed", documentUrl: "https://fixture.invalid",
    contentHash: "h", sourceHash: "h", textHash: "t", normalizedText: "Stop Payment Fee | $35.00" },
} as Parameters<typeof captureCorrectiveSource>[1];

const warnings = (writes: Write[]) => writes.filter((w) => w.sql.includes("agent_run_events"));

describe("captureCorrectiveSource", () => {
  it("should_record_a_step_warning_and_write_the_marker_when_the_seal_throws", async () => {
    const { db, writes } = fakeTx({ seal: true });
    await captureCorrectiveSource(db, INPUT);
    const [event] = warnings(writes);
    expect(event.values).toEqual(expect.arrayContaining([7, 70,
      "Corrective source snapshot for correction 41 failed, no snapshot sealed: seal refused"]));
    expect(String(event.values.at(-1))).toContain(CAPTURE_CHECK);
    expect(writes.some((w) => w.sql.includes("UPDATE published_fee_corrections"))).toBe(true);
  });

  it("should_record_a_step_warning_when_the_unavailable_marker_cannot_be_written", async () => {
    const { db, writes } = fakeTx({ marker: true });
    await captureCorrectiveSource(db, INPUT);
    expect(warnings(writes).map((w) => w.values[2])).toEqual([
      "Corrective source unavailable marker for correction 41 failed, nothing written: marker refused"]);
  });

  it("should_record_both_failures_when_seal_and_marker_fail", async () => {
    const { db, writes } = fakeTx({ seal: true, marker: true });
    await expect(captureCorrectiveSource(db, INPUT)).resolves.toBeUndefined();
    expect(warnings(writes)).toHaveLength(2);
  });

  it("should_write_no_warning_when_the_seal_is_refused_and_the_marker_is_written", async () => {
    const { db, writes } = fakeTx({});
    await captureCorrectiveSource(db, INPUT);
    expect(warnings(writes)).toEqual([]);
  });
});

describe("corrective warning wording", () => {
  it("should_say_read_failed_for_read_phases_and_nothing_written_for_write_phases", () => {
    expect(warningOutcome({ phase: "admission_read", timedOut: false })).toBe("read failed");
    expect(warningOutcome({ phase: "replay_read", timedOut: true })).toBe("timed out (statement timeout)");
    expect(warningOutcome({ phase: "unavailable_census", timedOut: false })).toBe("read failed");
    expect(warningOutcome({ phase: "enrollment", timedOut: false })).toBe("failed, nothing written");
    expect(warningOutcome({ phase: "replay_case", timedOut: true })).toBe("timed out (statement timeout), nothing written");
  });

  it("should_write_the_phase_outcome_into_the_step_warning_message", async () => {
    const { db, writes } = fakeTx({});
    await recordCorrectiveWarnings(db, 7, 70, [
      { phase: "replay_read", count: 1, timedOut: true, error: "canceling statement due to statement timeout" },
      { phase: "enrollment", count: 2, timedOut: false, error: "boom" },
    ]);
    expect(warnings(writes).map((w) => w.values[2])).toEqual([
      "Corrective source replay read, 1 time, timed out (statement timeout): canceling statement due to statement timeout",
      "Corrective source enrollment, 2 times, failed, nothing written: boom",
    ]);
  });
});
