import { describe, expect, it, vi } from "vitest";

import { KEEP_REFUSED_ANSWER_STRATEGY, keepRefusedPaidAnswers } from "./refused-answers";

type DbMock = ReturnType<typeof vi.fn>;
const text = (strings: unknown) => (Array.isArray(strings) ? strings.join(" ") : String(strings));

// Shaped like the prod rows of 8 Oct 2026: answers dropped because the check got HTTP 403.
const rows = [
  {
    attempt_id: 901, institution_id: 351, strategy: "discover.paid_web_search", url: "https://www.1776bank.com/fee-schedule/",
    institution_name: "Independence Bank of Kentucky", state_code: "KY", website_url: "https://www.1776bank.com", fee_schedule_url: null, known_urls: [],
  },
  {
    attempt_id: 902, institution_id: 8638, strategy: "discover.paid_schedule_search", url: "https://www.desertfinancial.com/fees/consumer-fee-schedule.pdf",
    institution_name: "Desert Financial Federal Credit Union", state_code: "AZ", website_url: "https://www.desertfinancial.com",
    fee_schedule_url: "https://www.desertfinancial.com/globalassets/files/legal/fee-schedule.pdf", known_urls: [],
  },
  {
    attempt_id: 903, institution_id: 77, strategy: "discover.paid_web_search", url: "https://www.nerdwallet.com/bank-fees",
    institution_name: "Other Bank", state_code: "TX", website_url: "https://www.otherbank.com", fee_schedule_url: null, known_urls: [],
  },
  {
    attempt_id: 904, institution_id: 78, strategy: "discover.paid_web_search", url: "https://www.held.com/fees",
    institution_name: "Held Bank", state_code: "TX", website_url: "https://www.held.com", fee_schedule_url: null, known_urls: ["https://www.held.com/fees"],
  },
  {
    attempt_id: 905, institution_id: 1373, strategy: "discover.paid_web_search", url: "https://www.sagecapitalbank.com/wp-content/uploads/SCB-CRA-Public-File.pdf",
    institution_name: "Sage Capital Bank", state_code: "TX", website_url: "https://www.sagecapitalbank.com", fee_schedule_url: null, known_urls: [],
  },
];

function createDb(): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    if (text(strings).includes("paid answers refused by the bank's site")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
}
const asDb = (db: DbMock) => db as unknown as Parameters<typeof keepRefusedPaidAnswers>[0]["db"];
const calls = (db: DbMock, needle: string) => db.mock.calls.filter((call) => text(call[0]).includes(needle));

describe("keepRefusedPaidAnswers", () => {
  it("keeps a refused answer as the main link, or beside the bank's link as a companion", async () => {
    const db = createDb();
    const result = await keepRefusedPaidAnswers({ db: asDb(db), runId: 5 });
    expect(result).toMatchObject({ checked: 5, kept: 2, asMainLink: 1, asCompanion: 1 });
    const linked = calls(db, "UPDATE institution_sources");
    expect(linked).toHaveLength(1);
    expect(linked[0]).toContain("https://www.1776bank.com/fee-schedule/");
    const companions = calls(db, "INSERT INTO institution_additional_sources");
    expect(companions).toHaveLength(1);
    expect(companions[0]).toContain("https://www.desertfinancial.com/fees/consumer-fee-schedule.pdf");
    expect(text(companions[0][0])).toContain("'consumer_supplement'");
  });

  it("logs every answer once, kept or skipped, so none is picked again", async () => {
    const db = createDb();
    await keepRefusedPaidAnswers({ db: asDb(db), runId: 5 });
    const logged = calls(db, "INSERT INTO pipeline_attempts");
    expect(logged).toHaveLength(5);
    for (const call of logged) expect(call).toContain(KEEP_REFUSED_ANSWER_STRATEGY.strategy);
    const select = calls(db, "paid answers refused by the bank's site")[0];
    expect(text(select[0])).toContain("kept.input_fingerprint = pa.detail->>'proposed_url'");
  });

  it("skips an answer off the bank's site, one it already holds and a CRA public file", async () => {
    const db = createDb();
    const result = await keepRefusedPaidAnswers({ db: asDb(db), runId: 5 });
    expect(result.samples.map((sample) => sample.institutionId)).toEqual([351, 8638]);
  });

  it("dry runs write nothing", async () => {
    const db = createDb();
    const result = await keepRefusedPaidAnswers({ db: asDb(db), runId: 5, dryRun: true });
    expect(result.kept).toBe(2);
    expect(db.mock.calls).toHaveLength(1);
  });
});
