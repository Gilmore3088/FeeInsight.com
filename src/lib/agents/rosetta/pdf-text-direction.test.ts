/**
 * Sideways PDF pages (#1092, pdf-text-direction.ts). Georgia United FCU's truth-in-savings
 * disclosure (answer key state:60; the Internet Archive capture of 2026-03-17 has the seed's own
 * sha256) stores every page as a portrait page turned a quarter, with every text item drawn at
 * [0, s, -s, 0, x, y]. Read by y and x as an upright page, its stacked cell lines joined with no
 * space ("AverageBalance") and the fee table read across its lines, so the re-read published none
 * of the 36 key fees. The pages below are synthetic, built upright and then turned the way that
 * file turns them, so the upright reading is the expected one.
 */
import { describe, expect, it } from "vitest";

import { runFreeSpecialists } from "../knox/specialists";
import { layoutPageResult, layoutPageText, type PdfTextItem } from "./pdf-layout";
import {
  PDF_TEXT_DIRECTION_LIVE,
  itemQuarterTurn,
  pageQuarterTurn,
  pageTextDirection,
  turnItemsUpright,
  type QuarterTurn,
} from "./pdf-text-direction";

const SIZE = 8;
const CHAR = 3.6;
function item(str: string, x: number, y: number, size = SIZE): PdfTextItem {
  return { str, transform: [size, 0, 0, size, x, y], width: str.length * CHAR, height: size };
}

/** An upright fee table: a label column, an amount column, and a cell whose words wrap onto three lines. */
function uprightPage(): PdfTextItem[] {
  const rows: Array<[string, string]> = [
    ["Stop Payment", "$32.00/Request"],
    ["Expedited Card Delivery", "$30.00/Card"],
    ["Items Sent for Collection", "$25.00/Item"],
    ["Wire Transfer (Outgoing)", "$20.00/Transfer"],
    ["Counter Checks (temporary checks)", "$1.00/Check"],
  ];
  const items = [item("EFT FEES", 40, 700)];
  rows.forEach(([label, amount], index) => items.push(item(label, 40, 680 - index * 12), item(amount, 260, 680 - index * 12)));
  // A cell of three stacked words beside a second cell of two lines, as in the rate schedule.
  items.push(item("Average", 40, 600), item("Daily", 46, 590), item("Balance", 40, 580));
  items.push(item("Account withdrawal", 120, 600), item("limitations apply.", 120, 590));
  return items;
}

/** The items as a page turned by `turn` stores them: the inverse of turning them upright. */
function drawnAt(items: PdfTextItem[], turn: QuarterTurn): PdfTextItem[] {
  return turnItemsUpright(items, ((4 - turn) % 4) as QuarterTurn);
}

describe("PDF_TEXT_DIRECTION_LIVE switch", () => {
  it("ships off, and leaves every page as drawn while off", () => {
    expect(PDF_TEXT_DIRECTION_LIVE).toBe(false);
    const sideways = drawnAt(uprightPage(), 1);
    expect(layoutPageText(sideways)).toBe(layoutPageText(sideways, { textDirection: false }));
    expect(pageTextDirection(sideways).items).toBe(sideways);
  });
});

describe("text direction from the PDF's own text matrix", () => {
  it("reads a quarter turn from each item's matrix, and no turn from slanted text", () => {
    expect(itemQuarterTurn([8, 0, 0, 8, 1, 2])).toBe(0);
    expect(itemQuarterTurn([0, 7.98, -7.98, 0, 227.82, 612.36])).toBe(1);
    expect(itemQuarterTurn([-8, 0, 0, -8, 1, 2])).toBe(2);
    expect(itemQuarterTurn([0, -8, 8, 0, 1, 2])).toBe(3);
    expect(itemQuarterTurn([6, 6, -6, 6, 1, 2])).toBeNull();
    expect(itemQuarterTurn([0, 0, 0, 0, 1, 2])).toBeNull();
  });

  it("calls a page turned only when most of its characters are drawn at that turn", () => {
    const page = uprightPage();
    expect(pageQuarterTurn(page)).toBe(0);
    expect(pageQuarterTurn(drawnAt(page, 1))).toBe(1);
    expect(pageQuarterTurn(drawnAt(page, 3))).toBe(3);
    // A sideways note in the margin of an upright page is a minority: the page stays upright.
    const note = drawnAt([item("01003035-D3700-P-1-012426 (TISDM2 D37006)-e", 10, 300)], 1);
    expect(pageQuarterTurn([...page, ...note])).toBe(0);
  });
});

describe("a sideways page read turned upright", () => {
  it("joins stacked words with no space and reads the table across its lines when not turned (the defect)", () => {
    const text = layoutPageText(drawnAt(uprightPage(), 1), { textDirection: false });
    expect(text).toContain("AverageBalance");
    expect(text).not.toContain("Stop Payment | $32.00/Request");
  });

  it.each([1, 2, 3] as const)("reads a page drawn at quarter turn %i exactly as the upright page", (turn) => {
    const upright = layoutPageResult(uprightPage());
    const turned = layoutPageResult(drawnAt(uprightPage(), turn), { textDirection: true });
    expect(turned.text).toBe(upright.text);
    expect(turned.textTurn).toBe(turn);
    expect(upright.textTurn).toBe(0);
  });

  it("leaves an upright page byte for byte as it was, a sideways margin note included", () => {
    const page = [...uprightPage(), ...drawnAt([item("Rev. 01/2026 form 37006", 10, 300)], 1)];
    expect(layoutPageText(page, { textDirection: true })).toBe(layoutPageText(page, { textDirection: false }));
  });

  it("gives Knox's free reader the sideways page's fees with their own amounts", () => {
    const fees = (textDirection: boolean) =>
      runFreeSpecialists(layoutPageText(drawnAt(uprightPage(), 1), { textDirection }), { institutionName: "Georgia United FCU" })
        .candidates.map((fee) => `${fee.feeName} ${fee.amount}`);
    const upright = fees(true);
    expect(upright.some((fee) => /stop payment/i.test(fee) && fee.endsWith(" 32"))).toBe(true);
    expect(upright.some((fee) => /collection/i.test(fee) && fee.endsWith(" 25"))).toBe(true);
    expect(fees(false).some((fee) => /stop payment/i.test(fee) && fee.endsWith(" 32"))).toBe(false);
  });
});
