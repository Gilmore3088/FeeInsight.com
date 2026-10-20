import { wireClausePrices } from "./wire-clause-prices";

export type WireDirection = "incoming" | "outgoing";
export type WireGeography = "international" | "domestic" | "shared" | "unspecified";
export type OwnWireScope = {
  kind: "owned";
  geography: WireGeography;
  directions: WireDirection[];
  ownText: string;
  sourceLine: string;
  lineIndex: number;
} | { kind: "unresolved"; reason: "missing_owner" | "ambiguous_owner" | "unsupported_shape" };
export type InternationalDirectionReview =
  | { kind: "not_applicable" }
  | { kind: "admit"; scope: Extract<OwnWireScope, { kind: "owned" }> }
  | { kind: "hold"; reason: "geography_missing" | "geography_mismatch" | "direction_missing" | "direction_mismatch" | "category_mismatch"; scope: Extract<OwnWireScope, { kind: "owned" }> }
  | { kind: "decline"; reason: "missing_owner" | "ambiguous_owner" | "unsupported_shape" };

const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})(?![\d.])/g;
const ZERO_MARKER = /\b(?:no\s+charge|no\s+fee|free)\b/gi;
const INTERNATIONAL = /\b(?:international|foreign|intl|int['’]?l|internacional|extranjer[oa]s?)\b/i;
const DOMESTIC = /\b(?:domestic|dom[eé]stic[oa]?|nacional)\b/i;
const INCOMING = /\b(?:incoming|inbound|in\s+coming|receiv(?:ed|ing)|entrantes?)\b|\b(?:wire|wires|transfer|transfers)\s*[-:]?\s*in\b|^\s*in\s*$/i;
const OUTGOING = /\b(?:outgoing|outbound|out\s+going|send(?:ing)?|sent|salientes?)\b|\b(?:wire|wires|transfer|transfers)\s*[-:]?\s*out\b|^\s*out\s*$/i;
const OUTSIDE_USA_WIRE = /(?:^|[:|\n])\s*outgoing\s+wire\s+transfers?\s+outside\s+(?:the\s+)?USA\b/i;
const MAX_ROW = 2_000;
const WIRE_WORDS = /^(?:(?:international|foreign|intl|int['’]?l|domestic|incoming|outgoing|inbound|outbound|in|out|wires?|transfers?|fees?|charges?|and|or|each|per|item|on)\s*)+$/i;
const clean = (text: string) => text.replace(/\*\*|__/g, "").replace(/^[•●▪‣*-]\s*/, "").replace(/\s+/g, " ").trim();
const LEADING_PRICE = /^\$\s*(?:\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})(?![\d.])/;
const SIMPLE_PRICE = /^\$\s*[\d,.]+\s*(?:(?:per\s+|\/)wire|each|per item)?\s*$/i;
const TRAILING_LEADER = /(?:(?:\.\s*){3,}|…)\s*$/;

type PhysicalRow = { cells: string[]; sourceLine: string; lineIndex: number; priceLineIndex?: number };

function physicalCells(line: string): string[] {
  const cells = line.split("|").map(clean);
  // A complete Markdown outer delimiter is syntax, not a blank first/last column.
  // Interior empty cells remain physical columns and are never collapsed.
  return line.trim().startsWith("|") && line.trim().endsWith("|") ? cells.slice(1, -1) : cells;
}

/** Only literal label/price geometry, after price admission; no inferred fee or scope. */
function physicalRows(lines: string[]): PhysicalRow[] {
  const result: PhysicalRow[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const sourceLine = lines[lineIndex].trim();
    if (!sourceLine || sourceLine.length > MAX_ROW) continue;
    // Keep empty cells: collapsing one would move a right-column label under a left header.
    const cells = physicalCells(sourceLine);
    result.push({ cells, sourceLine, lineIndex });
    if (cells.length !== 1) continue;
    const cell = cells[0];
    const dollars = [...cell.matchAll(MONEY)];
    // A trailing dot-leader name owns the next leading price. A preceding price belongs
    // to the previous row, never to that trailing name.
    const lastPrice = dollars.at(-1);
    const name = lastPrice ? clean(cell.slice(lastPrice.index! + lastPrice[0].length)) : cell;
    const leaderName = TRAILING_LEADER.test(name);
    if (dollars.length && !leaderName) continue;
    let nextIndex = lineIndex + 1;
    while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex++;
    // One explicit display-label note can separate its own name and price (not prose).
    if (!dollars.length && /^\(Fee shown (?:when charged )?as [^$|]+\)$/i.test(clean(lines[nextIndex] ?? ""))) {
      nextIndex++;
      while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex++;
    }
    if (nextIndex - lineIndex > 6) continue;
    const next = clean(lines[nextIndex] ?? "");
    const price = next.match(LEADING_PRICE)?.[0];
    if (!price || (!leaderName && !SIMPLE_PRICE.test(next))) continue;
    const label = name.replace(/(?:\.\s*){3,}|…/g, " ").trim();
    if (!label || /[$|]/.test(label)) continue;
    result.push({ cells: [label, leaderName ? price : next], sourceLine: lines.slice(lineIndex, nextIndex + 1).join("\n").trim(), lineIndex, priceLineIndex: nextIndex });
  }
  return result;
}

/** Equivalent literal wire vocabulary, without erasing account/service qualifiers. */
function labelKey(value: string): string {
  const words = clean(value).replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}' ]/gu, " ")
    .replace(/\bint['’]?l\b/gi, "international").replace(/\bin\s+coming\b/gi, "incoming")
    .replace(/\bout\s+going\b/gi, "outgoing").replace(/\s+/g, " ").trim().toLowerCase();
  if (!WIRE_WORDS.test(words)) return words;
  return [...new Set(words.split(" ").map(word => /^(?:wires?|transfers?)$/.test(word) ? "wire"
    : /^(?:in|inbound)$/.test(word) ? "incoming" : /^(?:out|outbound)$/.test(word) ? "outgoing"
      : /^(?:foreign|intl)$/.test(word) ? "international" : word)
    .filter(word => !/^(?:fees?|charges?|and|or|each|per|item|on)$/.test(word)))].sort().join(" ");
}

/** A finite current-name uncertainty cue; it never chooses a category or admits a price. */
export function hasLiteralOutsideUsaWireCue(value: string): boolean {
  return OUTSIDE_USA_WIRE.test(value) && !/\b(?:not|no|unavailable|except|excluding)\b/i.test(value);
}

function facts(own: string): { geography: WireGeography; directions: WireDirection[] } | null {
  const outsideUSA = hasLiteralOutsideUsaWireCue(own);
  const intl = INTERNATIONAL.test(own) || outsideUSA, domestic = DOMESTIC.test(own);
  const incoming = INCOMING.test(own), outgoing = OUTGOING.test(own);
  // Both means literal common scope, never a merger of unrelated direction cells.
  if (intl && domestic && !/(?:domestic\s*(?:and|or|&|\/)\s*(?:international|foreign|intl)|(?:international|foreign|intl)\s*(?:and|or|&|\/)\s*domestic)/i.test(own)) return null;
  if (incoming && outgoing && !/(?:in(?:coming|bound)?\s*(?:and|or|&|\/)\s*out(?:going|bound)?|out(?:going|bound)?\s*(?:and|or|&|\/)\s*in(?:coming|bound)?)/i.test(own)) return null;
  return { geography: intl && domestic ? "shared" : intl ? "international" : domestic ? "domestic" : "unspecified",
    directions: [...(incoming ? ["incoming" as const] : []), ...(outgoing ? ["outgoing" as const] : [])] };
}

function headingBefore(lines: string[], rows: ReadonlyMap<number, PhysicalRow[]>, at: number, admittedZero: boolean, ownerColumn: number): string | null {
  let visited = 0;
  let geographyChild: string | null = null;
  for (let index = at - 1; index >= 0 && at - index <= 14 && visited < 8; index--) {
    const line = clean(lines[index]);
    if (!line) continue;
    visited++;
    const cells = physicalCells(line);
    const column = cells[ownerColumn] ?? "";
    const nextCell = cells[ownerColumn + 1] ?? "";
    const pairedPrice = rows.get(index)?.some(row => row.priceLineIndex != null && row.cells[ownerColumn] && row.cells[ownerColumn + 1]);
    const ownPrice = pairedPrice || /\$|\b(?:free|no charge|no fee)\b/i.test(column) || /^\$|^(?:free|no charge|no fee)\b/i.test(nextCell);
    const words = column.replace(/[():/&-]/g, " ").replace(/\s+/g, " ").trim();
    if (!ownPrice && column.length <= 100 && /\bwires?\b/i.test(column) && WIRE_WORDS.test(words)) return geographyChild ? `${column}\n${geographyChild}` : column;
    if (!ownPrice && /^(?:international|domestic)$/i.test(column)) { geographyChild ??= column; continue; }
    // Only consecutive simple rows can remain under the nearest literal wire heading.
    const prior = rows.get(index)?.find(row => row.cells[ownerColumn] && row.cells[ownerColumn + 1]);
    const inlinePrice = [...column.matchAll(MONEY)][0];
    const price = inlinePrice ? column.slice(inlinePrice.index) : prior?.cells[ownerColumn + 1] ?? "";
    const label = (inlinePrice ? column.slice(0, inlinePrice.index) : prior?.cells[ownerColumn] ?? "").replace(/(?:\.\s*){3,}|…/g, " ").replace(/\b(incoming|outgoing)[1-3](?:,[1-3])?(?=\s|$)/gi, "$1").replace(/[():/&-]/g, " ").replace(/\s+/g, " ").trim();
    const simplePrice = SIMPLE_PRICE.test(price) || (admittedZero && /^(?:free|no charge|no fee)\s*(?:per wire|each|per item)?\s*$/i.test(price));
    const directedLabel = WIRE_WORDS.test(label) || /^(?:(?:USD|US Dollars?|Foreign Currency)\s+)?(?:Incoming|Outgoing)$/i.test(label);
    if (directedLabel && simplePrice) continue;
    // In a stacked table the prior price line is followed backwards by its explicit label.
    if (SIMPLE_PRICE.test(column) && index > 0 && [rows.get(index - 1), rows.get(index - 2)].flat().some(row => row
      && WIRE_WORDS.test(row.cells[ownerColumn] ?? "") && row.sourceLine.endsWith(lines[index].trim()))) continue;
    break;
  }
  return null;
}

/**
 * Scope evidence after ordinary name/price admission; this never admits a price,
 * chooses a category or borrows a direction from a model key, URL or neighboring row.
 */
export function sourceOwnedWireScope(text: string, feeName: string, admittedAmount: number): OwnWireScope {
  if (!Number.isFinite(admittedAmount) || admittedAmount < 0) return { kind: "unresolved", reason: "missing_owner" };
  const key = labelKey(feeName), lines = text.split(/\r?\n/), rows = physicalRows(lines);
  const rowsByLine = new Map<number, PhysicalRow[]>();
  for (const row of rows) rowsByLine.set(row.lineIndex, [...(rowsByLine.get(row.lineIndex) ?? []), row]);
  const pairedPriceLines = new Set(rows.flatMap(row => row.priceLineIndex == null ? [] : [row.priceLineIndex]));
  if (!key) return { kind: "unresolved", reason: "missing_owner" };
  const found: Extract<OwnWireScope, { kind: "owned" }>[] = [];
  let unsupported = false;
  const literalClauses = wireClausePrices(text).filter(row => row.amount === admittedAmount
    && row.aliases.some(alias => labelKey(alias) === key));
  for (const clause of literalClauses) {
    const scope = facts(clause.ownText);
    if (!scope) { unsupported = true; continue; }
    found.push({ kind: "owned", ...scope, ownText: clause.ownText, sourceLine: clause.sourceLine, lineIndex: clause.lineIndex });
  }
  // An exact two-direction/two-price physical cell owns its prices in printed order.
  // This supplies scope only for the already admitted exact name and amount, never a read.
  for (const { cells, sourceLine, lineIndex } of rows) {
    if (cells.length !== 2 || /\n/.test(sourceLine)) continue;
    const pair = cells[0].match(/^(.*?\b)(incoming|outgoing)\s*\/\s*(incoming|outgoing)\s*$/i);
    const prices = cells[1].match(/^\$\s*(\d[\d,]*(?:\.\d{1,2})?)\s*\/\s*\$\s*(\d[\d,]*(?:\.\d{1,2})?)\s*$/);
    if (!pair || !prices || pair[2].toLowerCase() === pair[3].toLowerCase()) continue;
    const prefix = pair[1].trim();
    if (!/\bwires?\b/i.test(prefix) || !INTERNATIONAL.test(prefix)
      || DOMESTIC.test(prefix) || INCOMING.test(prefix) || OUTGOING.test(prefix)
      || !WIRE_WORDS.test(prefix.replace(/[():/&–—-]/g, " ").replace(/\s+/g, " ").trim())) continue;
    const amounts = prices.slice(1).map(value => Number(value.replace(/,/g, "")));
    if (amounts.some(value => !Number.isFinite(value) || value <= 0) || amounts[0] === amounts[1]) continue;
    for (let index = 0; index < 2; index++) {
      const direction = pair[index + 2].toLowerCase() as WireDirection;
      if (amounts[index] !== admittedAmount || labelKey(`${prefix} ${direction}`) !== key) continue;
      found.push({ kind: "owned", geography: "international", directions: [direction], ownText: sourceLine, sourceLine, lineIndex });
    }
  }
  for (const { lineIndex, cells, sourceLine } of rows) {
    if (literalClauses.some(row => row.lineIndex === lineIndex)) continue;
    // A bare price that already belongs to one physical continuation is not a second owner.
    if (cells.length === 1 && SIMPLE_PRICE.test(cells[0]) && pairedPriceLines.has(lineIndex)) continue;
    for (const [cellIndex, cell] of cells.entries()) {
      const dollars = [...cell.matchAll(MONEY)];
      // Factual ownership for an ALREADY admitted zero; no numeric admission is added.
      const zeroMarker = admittedAmount === 0 && dollars.length === 0;
      const prices = zeroMarker ? [...cell.matchAll(ZERO_MARKER)] : dollars;
      const price = prices[0];
      if (!price || (!zeroMarker && !prices.some(row => Number(row[1].replace(/,/g, "")) === admittedAmount))) continue;
      let label = clean(cell.slice(0, price.index));
      let ownText = cell;
      let ownerColumn = cellIndex;
      if (!label && cellIndex > 0 && !/[$%]/.test(cells[cellIndex - 1])) {
        label = cells[cellIndex - 1];
        ownText = `${label} | ${cell}`;
        ownerColumn = cellIndex - 1;
      }
      const heading = headingBefore(lines, rowsByLine, lineIndex, admittedAmount === 0, ownerColumn);
      const combined = heading ? `${heading}: ${label}` : label;
      const after = clean(cell.slice(price.index! + price[0].length));
      const prefixes = heading ? [heading, heading.split("\n").reverse().join(" ")] : [];
      const aliases = [label, ...prefixes.map(prefix => `${prefix}: ${label}`)];
      const preceding = cells[cellIndex - 1];
      const ownFacts = facts(label);
      if (label && preceding && preceding.length <= 80 && !/[$%]/.test(preceding)
        && /^[\p{L}\p{N} &/'’():–—-]+$/u.test(preceding) && /\bwires?\b/i.test(label)
        && ownFacts?.geography === "international" && ownFacts.directions.length === 1) {
        aliases.push(`${preceding}: ${label}`);
      }
      // Some existing readers name the noun printed immediately after this own price.
      if (/^per\s+wire\b/i.test(after)) aliases.push(...aliases.map(alias => `${alias} wire`));
      if (!aliases.some(alias => labelKey(alias) === key)) continue;
      if (prices.length !== 1 || /%/.test(ownText)) { unsupported = true; continue; }
      if (zeroMarker && (!/^(?:(?:per wire|each|per item)[.!]?)?\s*$/i.test(after)
        || cells.slice(cellIndex + 1).some(next => next.length > 0))) { unsupported = true; continue; }
      const tailScope = INTERNATIONAL.test(after) || DOMESTIC.test(after) || INCOMING.test(after) || OUTGOING.test(after);
      if (tailScope && !WIRE_WORDS.test(after.replace(/[():/&-]/g, " ").replace(/\s+/g, " ").trim())) { unsupported = true; continue; }
      const labelFacts = facts(label), headingFacts = heading ? facts(heading) : null;
      if (!labelFacts || (heading && !headingFacts)) { unsupported = true; continue; }
      // An own explicit direction/geography cannot be contradicted by an inherited header.
      if (headingFacts && ((labelFacts.geography !== "unspecified" && headingFacts.geography !== "unspecified" && labelFacts.geography !== headingFacts.geography)
        || (labelFacts.directions.length && headingFacts.directions.length && JSON.stringify(labelFacts.directions) !== JSON.stringify(headingFacts.directions)))) { unsupported = true; continue; }
      const scope = facts(`${combined}${tailScope ? ` ${after}` : ""}`);
      if (!scope) { unsupported = true; continue; }
      found.push({ kind: "owned", ...scope, ownText: heading ? `${heading}\n${ownText}` : ownText, sourceLine, lineIndex });
    }
  }
  if (unsupported) return { kind: "unresolved", reason: "unsupported_shape" };
  if (found.length !== 1) return { kind: "unresolved", reason: found.length ? "ambiguous_owner" : "missing_owner" };
  return found[0];
}

/** Caller supplies Darwin's existing resolved category; raw hints are not final decisions. */
export function reviewInternationalDirection(scope: OwnWireScope, resolvedCategory: string | null): InternationalDirectionReview {
  if (!resolvedCategory?.startsWith("wire_")) return { kind: "not_applicable" };
  if (scope.kind === "unresolved") return resolvedCategory.startsWith("wire_intl_")
    ? { kind: "decline", reason: scope.reason } : { kind: "not_applicable" };
  if (!resolvedCategory.startsWith("wire_intl_")) return scope.geography === "international"
    ? { kind: "hold", reason: "category_mismatch", scope } : { kind: "not_applicable" };
  if (scope.geography === "unspecified") return { kind: "hold", reason: "geography_missing", scope };
  if (scope.geography === "domestic") return { kind: "hold", reason: "geography_mismatch", scope };
  if (!scope.directions.length) return { kind: "hold", reason: "direction_missing", scope };
  const direction = resolvedCategory.endsWith("_incoming") ? "incoming" : "outgoing";
  return scope.directions.includes(direction) ? { kind: "admit", scope } : { kind: "hold", reason: "direction_mismatch", scope };
}
