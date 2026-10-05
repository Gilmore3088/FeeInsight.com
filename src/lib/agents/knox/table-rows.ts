import { CELL_SEPARATOR } from "@/lib/agents/rosetta/html-dom";
import {
  amountsIn,
  classifyFeeText,
  confidenceFor,
  detectFrequency,
  isConditionAmount,
  notAZeroPrice,
  RANGE_JOINER,
  WAIVER_LANGUAGE,
  type ExtractionRulesResult,
} from "@/lib/agents/knox/rules";
import {
  cleanFeeName,
  composableTail,
  LEADING_VALUE,
  looksLikeHeading,
  passesDarwinChecks,
  QUALIFIER,
  ZERO_WORD,
} from "@/lib/agents/knox/layout";

/**
 * Knox pass 2a, `extract.table`: pair each table row's fee-name cell with its amount
 * cell. Pure.
 *
 * Rows come from `tableRowsFromText`, the adapter over Rosetta's current contract:
 * normalized text with one table row per line and cells joined by " | " (html-dom.ts,
 * pdf-layout.ts), plus the two layouts that lose the separator: a name line followed
 * by a line that starts with its price ("Stop Payment" / "$30.00 per item"), and
 * dot-leader rows split across lines. When Rosetta stores structured rows, re-point
 * the adapter; the extractor only sees `KnoxTableRow`.
 */

export const KNOX_TABLE_STRATEGY = { strategy: "extract.table", version: 2 } as const;

export interface KnoxTableRow {
  cells: string[];
  /** The section heading above the row ("Wire Transfers"), when there is one. */
  heading: string | null;
  layout: "cells" | "stacked";
}

const MAX_NAME_LINE_CHARS = 120;
const MAX_ROWS = 400;

function collapse(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function trailingLeader(value: string): boolean {
  return /(?:\.\s?){3,}\s*$|…\s*$/.test(value);
}

/** Adapter: Rosetta's normalized text to table rows. */
export function tableRowsFromText(text: string): KnoxTableRow[] {
  const lines = text.split(/\n+/).map(collapse).filter(Boolean);
  const rows: KnoxTableRow[] = [];
  let heading: string | null = null;
  // A fee name waiting for the price on the next line.
  let pendingName: string | null = null;
  let pendingHeading: string | null = null;

  for (let index = 0; index < lines.length && rows.length < MAX_ROWS; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] ?? "";
    const lead = line.match(LEADING_VALUE);

    if (lead && pendingName) {
      const rest = line.slice(lead[0].length);
      const qualifier = rest.match(QUALIFIER)?.[0] ?? "";
      const tail = rest.slice(qualifier.length).trim();
      // "$20.00 Wire Transfer Agreement ....." carries the next row's name.
      const tailIsNextName = /[a-z]/i.test(tail) && (trailingLeader(tail) || (LEADING_VALUE.test(next) && !/^[,(;]|^(for|if|when|after|plus|per|each|up to|max|min|or|and|with|waived)\b/i.test(tail)));
      const value = tailIsNextName ? `${lead[0]}${qualifier}` : line;
      rows.push({ cells: [pendingName, value.trim()], heading: pendingHeading, layout: "stacked" });
      pendingName = tailIsNextName && tail.length <= MAX_NAME_LINE_CHARS ? tail : null;
      pendingHeading = heading;
      continue;
    }
    pendingName = null;

    if (line.includes(CELL_SEPARATOR)) {
      const cells = line.split(CELL_SEPARATOR).map((cell) => cell.trim());
      const filled = cells.filter(Boolean);
      if (filled.length === 1 && amountsIn(line).length === 0 && looksLikeHeading(filled[0])) {
        heading = filled[0];
      } else {
        rows.push({ cells, heading, layout: "cells" });
      }
      continue;
    }

    if (amountsIn(line).length > 0) {
      // A dot-leader row whose price sits on the next line keeps its name pending.
      const lastAmount = amountsIn(line).pop();
      const tail = lastAmount ? line.slice(lastAmount.end) : "";
      if (lastAmount && trailingLeader(tail) && LEADING_VALUE.test(next)) {
        const qualifier = tail.match(QUALIFIER)?.[0] ?? "";
        const name = tail.slice(qualifier.length).trim();
        if (/[a-z]/i.test(name)) {
          pendingName = name;
          pendingHeading = heading;
        }
      }
      continue;
    }

    if (LEADING_VALUE.test(next) && line.length <= MAX_NAME_LINE_CHARS && /[a-z]/i.test(line)) {
      pendingName = line;
      pendingHeading = heading;
      continue;
    }
    if (looksLikeHeading(line)) heading = line;
  }
  return rows;
}

function valueCellIndex(cells: string[], from: number): number {
  for (let index = from; index < cells.length; index += 1) {
    const cell = cells[index];
    if (amountsIn(cell).length > 0 || ZERO_WORD.test(cell.replace(/[*.]+$/, "").trim())) return index;
  }
  return -1;
}

/** Name and price pairing for structured rows. */
export function extractFromTableRows(rows: KnoxTableRow[]): ExtractionRulesResult {
  const result: ExtractionRulesResult = { candidates: [], held: [] };
  for (const row of rows) {
    const firstName = row.cells.findIndex((cell) => /[a-z]/i.test(cell) && amountsIn(cell).length === 0);
    if (firstName < 0) continue;
    const valueIndex = valueCellIndex(row.cells, firstName + 1);
    if (valueIndex < 0) continue;
    // The name cell nearest the price names it ("STOP PAYMENT ORDER | NOTARY FEE | $6.00").
    let nameIndex = valueIndex - 1;
    while (nameIndex > firstName && !/[a-z]{3,}/i.test(row.cells[nameIndex])) nameIndex -= 1;
    // A value cell that opens with a fee name of its own ("NSF Fee $22.00") is a row of
    // its own; the line rules read it.
    const valueLead = row.cells[valueIndex].split("$")[0];
    if ((valueLead.match(/[a-z]{2,}/gi) ?? []).length >= 2 && !/^\W*(?:per|each|a|an|for|up to|plus)\b/i.test(valueLead)) continue;
    const nameCell = row.cells[nameIndex];
    const valueCell = row.cells[valueIndex];
    const name = cleanFeeName(nameCell);
    if (!name || /\b(no (?:[a-z]+ ){0,2}(?:fee|charge)s?|not charged|without charge)\b/i.test(name)) continue;
    // A cell that opens mid-sentence ("authorize and pay an overdraft ...") is prose from
    // an agreement laid out in columns, not a fee name.
    if (/^[a-z]/.test(nameCell.trim())) continue;

    let hint = classifyFeeText(name);
    let feeName = name;
    if (!hint && row.heading && composableTail(name)) {
      hint = classifyFeeText(`${row.heading} ${name}`);
      feeName = `${row.heading}: ${name}`;
    }
    if (!hint) continue;
    const excerpt = `${nameCell}${row.layout === "stacked" ? " / " : " | "}${valueCell}`.slice(0, 280);
    const frequency = detectFrequency(`${nameCell} ${valueCell}`);

    if (ZERO_WORD.test(valueCell.replace(/[*.]+$/, "").trim())) {
      if (passesDarwinChecks(hint, feeName, 0) && !notAZeroPrice(hint, feeName)) {
        result.held.push({ shape: "zero", feeName, amount: 0, amountMax: null, percent: null, frequency, canonicalHint: hint, excerpt });
      }
      continue;
    }
    if (/%/.test(valueCell.split("$")[0]) || /\b(no (fee|charge)|free)\b/i.test(valueCell.split("$")[0])) continue;

    const waiverAt = valueCell.match(WAIVER_LANGUAGE)?.index ?? Number.POSITIVE_INFINITY;
    const amounts = amountsIn(valueCell).filter((amount) => amount.start < waiverAt && !isConditionAmount(valueCell, amount));
    const first = amounts[0];
    if (!first) continue;
    const second = amounts[1];
    if (second && RANGE_JOINER.test(valueCell.slice(first.end, second.start))) {
      result.held.push({
        shape: "range",
        feeName,
        amount: Math.min(first.value, second.value),
        amountMax: Math.max(first.value, second.value),
        percent: null,
        frequency,
        canonicalHint: hint,
        excerpt,
      });
      continue;
    }
    if (first.value === 0) {
      if (passesDarwinChecks(hint, feeName, 0) && !notAZeroPrice(hint, feeName)) {
        result.held.push({ shape: "zero", feeName, amount: 0, amountMax: null, percent: null, frequency, canonicalHint: hint, excerpt });
      }
      continue;
    }
    if (valueCell.slice(first.end, first.end + 3).includes("%")) continue;
    if (!passesDarwinChecks(hint, feeName, first.value)) continue;
    result.candidates.push({
      feeName,
      amount: first.value,
      frequency,
      canonicalHint: hint,
      confidence: confidenceFor(excerpt),
      excerpt,
      waivable: WAIVER_LANGUAGE.test(`${nameCell} ${valueCell}`),
    });
  }
  return result;
}

export function extractTableCandidates(text: string): ExtractionRulesResult {
  return extractFromTableRows(tableRowsFromText(text));
}
