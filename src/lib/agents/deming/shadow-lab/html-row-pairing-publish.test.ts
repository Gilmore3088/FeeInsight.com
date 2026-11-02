// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractHtmlDomText } from "@/lib/agents/rosetta/html-dom";
import { normalizeWhitespace } from "@/lib/agents/rosetta/read";
import { currentVariant } from "./variants";
import type { StageFee } from "./types";

/**
 * Rows `HTML_ROW_PAIRING_LIVE` joins whose price is no fee (#1092 review of #2951). Each joined
 * line is pinned, and today's free pipeline (Knox's read, Darwin's verify, Hamilton's publish gate)
 * must publish nothing from it, so a later Knox change that starts reading one fails here first.
 */

function readWithPairing(label: string, price: string): string {
  const html = `<div class="row"><div class="col-6">${label}</div><div class="col-6">${price}</div></div>`;
  return normalizeWhitespace(extractHtmlDomText(html, { rowPairing: true }).text);
}

function published(text: string): StageFee[] {
  const live: StageFee[] = [];
  for (const fee of currentVariant.extract(text).passed) {
    const verified = currentVariant.verify(fee, text);
    if (!verified.ok) continue;
    if (currentVariant.publishGate(verified.fee, text, live).publish) live.push(verified.fee);
  }
  return live;
}

const NOT_A_FEE: Array<[string, string]> = [
  ["Business Checking", "$0 Basic Checking"],
  ["Open an account", "$300 bonus"],
  ["Overdraft Privilege", "$500 limit for qualifying members"],
  ["Mobile Deposit", "$25 minimum to open a savings account"],
  ["Interest rate", "$10,000 and above earns 2.50% APY"],
  ["Free Checking", "Free"],
  ["Minimum balance to avoid fee", "$1,500"],
];

describe("HTML row pairing: joined rows that state no fee", () => {
  it("should_publish_a_real_fee_row_so_the_checks_below_are_not_vacuous", () => {
    const fees = published(readWithPairing("Stop payment", "$30.00 per request"));
    expect(fees.map((fee) => [fee.canonicalFeeKey, fee.amountCents])).toEqual([["stop_payment", 3000]]);
  });

  it.each(NOT_A_FEE)("should_join_%s_and_publish_nothing", (label, price) => {
    const text = readWithPairing(label, price);
    expect(text).toBe(`${label} | ${price}`);
    expect(published(text)).toEqual([]);
  });
});
