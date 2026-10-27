import { describe, expect, it } from "vitest";

import { checkFeeAgainstSource } from "./source-check";
import { DAILY_CAP_LINES_LIVE } from "@/lib/daily-cap-wording";

/**
 * v136 (#2064): the wider daily cap trace (`statesDailyCap` wide, `capLineUnder`) is behind
 * `DAILY_CAP_LINES_LIVE`, off, so every live path that calls the shared check without options
 * (Darwin's verify and live re-check, release-held, lost-recheck restore, the rules re-check, Knox's
 * self-check) reads a cap row exactly as main did. Each row: text, fee name, amount, and main's result
 * (c992a93d7) as `ok:<source line>` or `no:<reason>`, for od_daily_cap, nsf_daily_cap and no category.
 * The rows are the cap shapes in the tests already, the shadow lab's cap lines, and the shapes the
 * review of #2768 found (limits, caps on other fees, per-item prices, sustained charges, small caps).
 */
const CAP_ROWS: Array<[string, string, number, string[]]> = [
  ["Overdraft/Non-Sufficient Funds ** | $20.00 | Per Item | Maximum of $120.00 per day", "Overdraft/Non-Sufficient Funds daily maximum", 120, ["ok:Overdraft/Non-Sufficient Funds ** | $20.00 | Per Item | Maximum of $120.00 per day", "ok:Overdraft/Non-Sufficient Funds ** | $20.00 | Per Item | Maximum of $120.00 per day", "ok:Overdraft/Non-Sufficient Funds ** | $20.00 | Per Item | Maximum of $120.00 per day"]],
  ["NSF/Overdraft Fees**\n1st Overdraft Privilege Paid Fee $30.00 (max $180.00 daily)", "1st Overdraft Privilege Paid Fee daily maximum", 180, ["ok:1st Overdraft Privilege Paid Fee $30.00 (max $180.00 daily)", "ok:1st Overdraft Privilege Paid Fee $30.00 (max $180.00 daily)", "no:amount_is_a_threshold"]],
  ["Overdraft fee $35 per item, up to $105 per day", "Overdraft Daily Cap", 105, ["ok:Overdraft fee $35 per item, up to $105 per day", "ok:Overdraft fee $35 per item, up to $105 per day", "no:name_not_in_text"]],
  ["Overdraft Daily Cap | $175", "Overdraft Daily Cap", 175, ["ok:Overdraft Daily Cap | $175", "ok:Overdraft Daily Cap | $175", "ok:Overdraft Daily Cap | $175"]],
  ["Overdraft Fee | $36.00 per item", "Overdraft Daily Cap", 36, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Wire Transfer | $25.00 | Maximum of $120.00 per day", "Overdraft Daily Cap", 120, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Paid Overdraft Charge: $30.00/item ($150.00 max daily)", "Paid Overdraft Charge daily maximum", 150, ["no:amount_is_a_threshold", "no:amount_is_a_threshold", "no:amount_is_a_threshold"]],
  ["Total overdraft charges/fees will not exceed $100.00 per day", "Overdraft fees daily maximum", 100, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Courtesy Pay | $30/item | Wire Transfer (incoming) | $5/item\n4 item cap per day (max fee of $120/day)", "Courtesy Pay daily maximum", 120, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Return Item Fee: $30 (unpaid due to insufficient funds)\n\nLimit of $120 per day", "Return Item Fee daily maximum", 120, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft (OD) Fee $32.50\n(Daily limit of $97.50 per\naccount)", "Overdraft (OD) Fee daily maximum", 97.5, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Charge each item paid\n\n$32.00 per item/Daily maximum $96.00. Overdraft charges will not be assessed on weekends.", "Overdraft Charge each item paid daily maximum", 96, ["ok:$32.00 per item/Daily maximum $96.00. Overdraft charges will not be assessed on weekends.", "ok:$32.00 per item/Daily maximum $96.00. Overdraft charges will not be assessed on weekends.", "ok:$32.00 per item/Daily maximum $96.00. Overdraft charges will not be assessed on weekends."]],
  ["You are required to pay a $36 overdraft fee for each overdraft transaction that is paid by the bank. There is a limit of $108 each day in total fees that you can be charged for overdrawing your account.", "Overdraft fees daily maximum", 108, ["ok:You are required to pay a $36 overdraft fee for each overdraft transaction that is paid by the bank. There is a limit of $108 each day in total fees that you can be charged for overdrawing your account.", "ok:You are required to pay a $36 overdraft fee for each overdraft transaction that is paid by the bank. There is a limit of $108 each day in total fees that you can be charged for overdrawing your account.", "no:name_not_in_text"]],
  ["Overdraft Fee $35.00\nOverdraft limit $500 per day", "Overdraft Fee daily maximum", 500, ["ok:Overdraft limit $500 per day", "ok:Overdraft limit $500 per day", "no:name_not_in_text"]],
  ["Courtesy Pay $30\nLimit of $500 per day", "Courtesy Pay daily maximum", 500, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee $35\nmaximum $120 per day for returned deposited items", "Overdraft Fee daily maximum", 120, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee $35 Stop Payment Fee $30\nLimit of $120 per day", "Overdraft Fee daily maximum", 120, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["NSF Fee $30\nDaily maximum $35 per item", "NSF Fee daily maximum", 35, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee $35\nMaximum of $25 per day", "Overdraft Fee daily maximum", 25, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee $35\nOverdraft Fee $35\nMax $5 per day sustained", "Overdraft Fee daily maximum", 5, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee $35\nLimit of $120 per day; Limit of $90 per day for NSF", "Overdraft Fee daily maximum", 90, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee $35\nDaily maximum $105. NSF daily maximum $90.", "Overdraft Fee daily maximum", 90, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Sustained overdraft charge up to $5/day", "Sustained overdraft daily maximum", 5, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee $35 (maximum $5 per day)", "Overdraft Fee daily maximum", 5, ["ok:Overdraft Fee $35 (maximum $5 per day)", "ok:Overdraft Fee $35 (maximum $5 per day)", "no:name_not_in_text"]],
  ["Overdraft Fee $35\nDaily maximum $105 Overdraft Fee", "Overdraft Fee daily maximum", 105, ["ok:Daily maximum $105 Overdraft Fee", "ok:Daily maximum $105 Overdraft Fee", "ok:Daily maximum $105 Overdraft Fee"]],
  ["Overdraft Fee $35\n$5 max daily for extended overdraft", "Overdraft Fee daily maximum", 5, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee $35 / $5 max per day after day 7", "Overdraft Fee daily maximum", 5, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee | $30.00 per item\nCourtesy Pay limit of $500 per day", "Overdraft Fee daily maximum", 500, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee | $30.00\nTotal ATM withdrawals will not exceed $500.00 per day", "Overdraft Fee daily maximum", 500, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee | $30.00\nDaily ATM cash limit: $500", "Overdraft Fee daily maximum", 500, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee | $30.00\nStop Payment | $25.00\nMoney Order | $5.00\nLimit of $120 per day", "Overdraft Fee daily maximum", 120, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee | $35.00 per item\nMaximum of $25.00 per day", "Overdraft Fee daily maximum", 25, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Bounce Protection | $30.00 per item\nTotal limit of $750 per day", "Bounce Protection daily maximum", 750, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee | $35.00 per item\nPaid items limit $500 per day", "Overdraft Fee daily maximum", 500, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee $35\nMaximum daily overdraft limit of $500", "Overdraft Fee daily maximum", 500, ["ok:Maximum daily overdraft limit of $500", "ok:Maximum daily overdraft limit of $500", "ok:Maximum daily overdraft limit of $500"]],
  ["Overdraft Fee | $35.00 per item\nDaily maximum fee of $5.00 for sustained overdrafts", "Overdraft Fee daily maximum", 5, ["ok:Daily maximum fee of $5.00 for sustained overdrafts", "ok:Daily maximum fee of $5.00 for sustained overdrafts", "ok:Daily maximum fee of $5.00 for sustained overdrafts"]],
  ["Overdraft Fee | $35.00 per item\nMaximum $10 per day after 5 days", "Overdraft Fee daily maximum", 10, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee $35 Account Research $25 per hour\nMaximum of $100 per day", "Overdraft Fee daily maximum", 100, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
  ["Overdraft Fee $35 Coin counting $5\nMaximum of $100 per day", "Overdraft Fee daily maximum", 100, ["no:name_not_in_text", "no:name_not_in_text", "no:name_not_in_text"]],
];

const KEYS = ["od_daily_cap", "nsf_daily_cap", null] as const;

function results(text: string, name: string, amount: number, dailyCapLines?: boolean): string[] {
  return KEYS.map((key) => {
    const result = checkFeeAgainstSource(text, name, amount, ".", key, dailyCapLines == null ? {} : { dailyCapLines });
    return result.ok ? `ok:${result.sourceLine}` : `no:${result.reason}`;
  });
}

/** The only rows the switch, once on, moves from not-ok to ok: real caps the wider wording traces. */
const GAINED_WITH_THE_SWITCH = new Set([
  "Paid Overdraft Charge: $30.00/item ($150.00 max daily)",
  "Total overdraft charges/fees will not exceed $100.00 per day",
  "Courtesy Pay | $30/item | Wire Transfer (incoming) | $5/item\n4 item cap per day (max fee of $120/day)",
]);

describe("v136 daily cap trace is off on every live path", () => {
  it("should_keep_the_switch_off", () => {
    expect(DAILY_CAP_LINES_LIVE).toBe(false);
  });

  it("should_trace_every_cap_row_shape_as_main_did_by_default", () => {
    for (const [text, name, amount, main] of CAP_ROWS) expect(results(text, name, amount), text).toEqual(main);
  });

  it("should_trace_every_cap_row_shape_as_main_did_with_the_switch_passed_off", () => {
    for (const [text, name, amount, main] of CAP_ROWS) expect(results(text, name, amount, false), text).toEqual(main);
  });

  it("should_only_add_the_real_caps_when_switched_on", () => {
    for (const [text, name, amount, main] of CAP_ROWS) {
      const on = results(text, name, amount, true);
      if (!GAINED_WITH_THE_SWITCH.has(text)) {
        expect(on, text).toEqual(main);
        continue;
      }
      // A cap category gains the trace; with no category the row reads as main did.
      expect(on.slice(0, 2).every((result) => result.startsWith("ok:")), text).toBe(true);
      expect(main.slice(0, 2).every((result) => result.startsWith("no:")), text).toBe(true);
      expect(on[2], text).toEqual(main[2]);
    }
  });
});
