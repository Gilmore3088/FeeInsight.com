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
const INTERNATIONAL = /\b(?:international|foreign|intl|int['’]?l|internacional|extranjer[oa]s?)\b/i;
const DOMESTIC = /\b(?:domestic|dom[eé]stic[oa]?|nacional)\b/i;
const INCOMING = /\b(?:incoming|inbound|in\s+coming|receiv(?:ed|ing)|entrantes?)\b|\b(?:wire|wires|transfer|transfers)\s*[-:]?\s*in\b|^\s*in\s*$/i;
const OUTGOING = /\b(?:outgoing|outbound|out\s+going|send(?:ing)?|sent|salientes?)\b|\b(?:wire|wires|transfer|transfers)\s*[-:]?\s*out\b|^\s*out\s*$/i;
const MAX_ROW = 2_000;
const WIRE_WORDS = /^(?:(?:international|foreign|intl|int['’]?l|domestic|incoming|outgoing|inbound|outbound|in|out|wires?|transfers?|fees?|charges?|and|or|each|per|item|on)\s*)+$/i;
const clean = (text: string) => text.replace(/^[•●▪‣*-]\s*/, "").replace(/\s+/g, " ").trim();

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

function facts(own: string): { geography: WireGeography; directions: WireDirection[] } | null {
  const intl = INTERNATIONAL.test(own), domestic = DOMESTIC.test(own);
  const incoming = INCOMING.test(own), outgoing = OUTGOING.test(own);
  // Both means literal common scope, never a merger of unrelated direction cells.
  if (intl && domestic && !/(?:domestic\s*(?:and|or|&|\/)\s*(?:international|foreign|intl)|(?:international|foreign|intl)\s*(?:and|or|&|\/)\s*domestic)/i.test(own)) return null;
  if (incoming && outgoing && !/(?:in(?:coming|bound)?\s*(?:and|or|&|\/)\s*out(?:going|bound)?|out(?:going|bound)?\s*(?:and|or|&|\/)\s*in(?:coming|bound)?)/i.test(own)) return null;
  return { geography: intl && domestic ? "shared" : intl ? "international" : domestic ? "domestic" : "unspecified",
    directions: [...(incoming ? ["incoming" as const] : []), ...(outgoing ? ["outgoing" as const] : [])] };
}

function headingBefore(lines: string[], at: number): string | null {
  let visited = 0;
  for (let index = at - 1; index >= 0 && at - index <= 14 && visited < 8; index--) {
    const line = clean(lines[index]);
    if (!line) continue;
    visited++;
    const words = line.replace(/[():/&-]/g, " ").replace(/\s+/g, " ").trim();
    if (!line.includes("$") && !line.includes("|") && line.length <= 100 && /\bwires?\b/i.test(line) && WIRE_WORDS.test(words)) return line;
    // Only consecutive simple rows can remain under the nearest literal wire heading.
    const cells = line.split("|").map(clean);
    const price = cells.at(-1) ?? "";
    const label = cells.slice(0, -1).join(" ");
    if (!(cells.length === 2 && WIRE_WORDS.test(label) && /^\$\s*[\d,.]+\s*(?:per wire|each|per item)?\s*$/i.test(price))) break;
  }
  return null;
}

/**
 * Scope evidence after ordinary name/price admission; this never admits a price,
 * chooses a category or borrows a direction from a model key, URL or neighboring row.
 */
export function sourceOwnedWireScope(text: string, feeName: string, admittedAmount: number): OwnWireScope {
  if (!Number.isFinite(admittedAmount) || admittedAmount < 0) return { kind: "unresolved", reason: "missing_owner" };
  const key = labelKey(feeName), lines = text.split(/\r?\n/);
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
  for (const [lineIndex, raw] of lines.entries()) {
    if (literalClauses.some(row => row.lineIndex === lineIndex)) continue;
    const sourceLine = raw.trim();
    if (sourceLine.length > MAX_ROW) continue;
    const cells = sourceLine.split("|").map(clean);
    const heading = headingBefore(lines, lineIndex);
    for (const [cellIndex, cell] of cells.entries()) {
      const prices = [...cell.matchAll(MONEY)];
      const price = prices[0];
      if (!price || !prices.some(row => Number(row[1].replace(/,/g, "")) === admittedAmount)) continue;
      let label = clean(cell.slice(0, price.index));
      let ownText = cell;
      if (!label && cellIndex > 0 && !/[$%]/.test(cells[cellIndex - 1])) {
        label = cells[cellIndex - 1];
        ownText = `${label} | ${cell}`;
      }
      const combined = heading ? `${heading}: ${label}` : label;
      if (labelKey(label) !== key && labelKey(combined) !== key) continue;
      if (prices.length !== 1 || /%/.test(ownText)) { unsupported = true; continue; }
      const after = clean(cell.slice(price.index! + price[0].length));
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
