import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { FEEDBACK_KINDS, feedbackRowReaders } from "@/lib/agents/learning/feedback-kinds";
import { MISSED_SCHEDULE_CHECK, MISSED_SECOND_SCHEDULE_KIND, missedScheduleFeedback, scheduleMissed } from "./missed-schedules";
import { SECOND_DOCUMENT_FINDER } from "./second-document";
import { readFileSync } from "node:fs";

describe("missed second schedules (#2070)", () => {
  it("is missed only while no stored copy or companion has the same address", () => {
    const url = "https://www.bank.example/disclosures/overdraft.pdf";
    expect(scheduleMissed(url, [])).toBe(true);
    expect(scheduleMissed(url, ["https://bank.example/fees.pdf", null])).toBe(true);
    expect(scheduleMissed(url, ["http://bank.example/disclosures/overdraft.pdf/"])).toBe(false);
    expect(scheduleMissed("  ", [])).toBe(false);
  });

  it("files one row per bank and address against discovery, read by the companion finder's reader", () => {
    const row = missedScheduleFeedback({ institutionId: 7, documentUrl: "https://www.bank.example/od.pdf", categories: ["overdraft", "nsf", "overdraft"], evidenceFeeIds: [11] });
    expect(row).toMatchObject({
      aboutStage: "discover", signal: "missed", kind: MISSED_SECOND_SCHEDULE_KIND, reportedBy: "deming", checkName: MISSED_SCHEDULE_CHECK,
      institutionId: 7, sourceUrl: "https://www.bank.example/od.pdf", dedupeKey: "missed_second_schedule:7:bank.example/od.pdf",
    });
    expect(row.evidence).toMatchObject({ categories: ["nsf", "overdraft"], answer_key_fee_ids: [11] });
    expect(FEEDBACK_KINDS[MISSED_SECOND_SCHEDULE_KIND]).toBeDefined();
    expect(feedbackRowReaders({ kind: row.kind, about_stage: row.aboutStage, check_name: row.checkName ?? null })).toEqual(["src/lib/agents/magellan/missed-schedules.ts"]);
  });

  it("closes a row on the companion finder's own attempt", () => {
    // The loader names the finder's strategy as a literal (no import cycle with second-document.ts).
    const loader = readFileSync("src/lib/agents/magellan/missed-schedules.ts", "utf8");
    expect(loader).toContain(`pa.strategy = '${SECOND_DOCUMENT_FINDER.strategy}'`);
  });
});
