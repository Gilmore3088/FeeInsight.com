/** Literal inline wire direction prices. No rescaling, inferred price or provider evidence. */
export type WireClauseCategory = "wire_domestic_incoming" | "wire_domestic_outgoing" | "wire_intl_incoming" | "wire_intl_outgoing";

export interface WireClausePrice {
  feeName: string;
  amount: number;
  canonicalKey: WireClauseCategory;
  ownText: string;
  sourceLine: string;
  lineIndex: number;
  aliases: string[];
}

const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)(?![\d.])/g;
const CATEGORIES: ReadonlySet<string> = new Set([
  "wire_domestic_incoming", "wire_domestic_outgoing",
]);
const MAX_LINE = 700;
const MAX_ROWS = 60;
const SCHEDULE_HEADING = /^(?:fee schedule|fees(?: (?:and|&) charges)?|(?:standard|regular|general) (?:fees|services?))\s*:?$/i;
const ELIGIBILITY_HEADING = /\b(?:ages?|youth|senior|junior|student|minor|teen|checking|business|commercial|(?:savings|club|reward|premier) accounts?)\b|\b(?:under|over)\s+\d/i;

function nameKey(value: string): string {
  return value.replace(/[*_]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function label(value: string): string {
  return value.replace(/[*_]/g, "").replace(/^\s*\|\s*|\s*\|\s*$/g, "").trim();
}

function geography(words: string): "domestic" | "intl" | null | false {
  const domestic = /\bdomestic\b/i.test(words);
  const international = /\b(?:international|foreign|intl)\b/i.test(words);
  return domestic && international ? false : international ? "intl" : domestic ? "domestic" : null;
}

/** A suffix must consist entirely of the literal unit, direction and geography vocabulary. */
function directionClause(words: string) {
  const own = label(words).replace(/^on\s+/i, "").replace(/^per\s+(?:wire|transaction)s?\s+/i, "");
  if (!/^(?:(?:domestic|international|foreign|intl)\s+)?(?:incoming|outgoing)(?:\s+(?:incoming|outgoing))?(?:\s+(?:domestic|international|foreign|intl))?(?:\s+wires?(?:\s+transfers?)?(?:\s+fees?)?)?$/i.test(own)) return null;
  const directions = new Set((own.match(/\b(?:incoming|outgoing)\b/gi) ?? []).map(word => word.toLowerCase()));
  if (directions.size !== 1) return null;
  const geo = geography(own);
  if (geo === false) return null;
  return { own, direction: [...directions][0] as "incoming" | "outgoing", geography: geo };
}

function headerVariant(header: string, direction: "incoming" | "outgoing"): string | null {
  const choices = header.split(/\s*\/\s*/);
  if (choices.length !== 2) return null;
  const word = direction === "incoming" ? /\b(?:in|incoming)\b/i : /\b(?:out|outgoing)\b/i;
  const matching = choices.filter(choice => /\bwires?\b/i.test(choice) && word.test(choice));
  return matching.length === 1 ? matching[0] : null;
}

/** A complete physical wire-labelled row with two to four explicitly directed slash prices. */
export function wireClausePrices(text: string): WireClausePrice[] {
  const result: WireClausePrice[] = [];
  for (const [lineIndex, raw] of text.split(/\r?\n/).entries()) {
    const sourceLine = raw.trim();
    if (sourceLine.length > MAX_LINE || !sourceLine.includes("/") || !/\bwires?\b/i.test(sourceLine)) continue;
    const prices = [...sourceLine.matchAll(MONEY)];
    if (prices.length < 2 || prices.length > 4 || /%/.test(sourceLine)) continue;
    const header = label(sourceLine.slice(0, prices[0].index).replace(/\|\s*$/, ""));
    // A single literal service header, not prose, an account's eligibility clause or another cell.
    if (!/^(?:(?:domestic|international|foreign|intl)\s+)?wire(?:s|\s+(?:transfer|transfers|fee|fees|in|out))*\s*(?:\/\s*wire(?:s|\s+(?:transfer|transfers|in|out))*)?\s*(?:fee|fees)?\s*:?$/i.test(header)) continue;
    const headerGeo = geography(header);
    if (headerGeo === false) continue;
    const rows: WireClausePrice[] = [];
    for (const [index, price] of prices.entries()) {
      let suffix = sourceLine.slice((price.index ?? 0) + price[0].length, prices[index + 1]?.index ?? sourceLine.length).trim();
      if (index < prices.length - 1) {
        if (!/\/\s*$/.test(suffix)) break;
        suffix = suffix.replace(/\/\s*$/, "").trim();
      }
      const clause = directionClause(suffix);
      const amount = Number(price[1].replace(/,/g, ""));
      if (!clause || amount <= 0 || !Number.isFinite(amount) || (headerGeo && clause.geography && headerGeo !== clause.geography)) break;
      const geo = clause.geography ?? headerGeo ?? "domestic";
      const canonicalKey = `wire_${geo}_${clause.direction}` as WireClauseCategory;
      const directionLabel = clause.own.replace(/\b(incoming|outgoing)(?:\s+\1)+\b/ig, "$1");
      const variant = headerVariant(header, clause.direction);
      const feeName = variant ?? (/\bwires?\b/i.test(directionLabel) ? directionLabel : `${header}: ${directionLabel}`);
      rows.push({ feeName, amount, canonicalKey, ownText: `${header} | ${price[0]} ${suffix}`,
        sourceLine, lineIndex, aliases: [feeName, directionLabel, header] });
    }
    if (rows.length !== prices.length || new Set(rows.map(row => row.canonicalKey)).size !== rows.length) continue;
    result.push(...rows);
    if (result.length > MAX_ROWS) return [];
  }
  return result;
}

/**
 * New domestic authority is not a tier selector. Another explicit same-direction
 * domestic price anywhere in the document makes this physical pair ambiguous.
 * The legacy reader retains its prior behavior; no price or audience is chosen here.
 */
export function domesticWireClausePrices(text: string): WireClausePrice[] {
  const parsed = wireClausePrices(text);
  const rows = parsed.filter(row => CATEGORIES.has(row.canonicalKey));
  const handled = new Set(parsed.map(row => row.lineIndex));
  const lines = text.split(/\r?\n/);
  const ambiguous = new Set<number>();
  for (const row of rows) {
    let restrictedSection = false;
    for (const [index, line] of lines.slice(0, row.lineIndex).entries()) {
      const heading = line.trim();
      const following: string[] = [];
      for (let at = index + 1; at < lines.length && following.length < 2; at++) {
        if (lines[at].trim()) following.push(lines[at].trim());
      }
      const startsFeeBlock = following[0]?.includes("$") ||
        /^(?:service|fee type|description)\s*\|\s*(?:fee|amount)$/i.test(following[0] ?? "") ||
        (following[1]?.includes("$") && !/[$|%]/.test(following[0] ?? ""));
      if (SCHEDULE_HEADING.test(heading)) restrictedSection = false;
      else if (startsFeeBlock && heading.length <= 100 && !/[$|%]/.test(heading) && ELIGIBILITY_HEADING.test(heading)) restrictedSection = true;
    }
    // A literal price pair does not establish a standard price for a restricted
    // account section. Only an explicit general schedule heading resets that scope.
    if (restrictedSection) ambiguous.add(row.lineIndex);
    if (rows.some(other => other.canonicalKey === row.canonicalKey && other.amount !== row.amount)) {
      ambiguous.add(row.lineIndex);
    }
    const direction = row.canonicalKey.endsWith("_incoming")
      ? /\b(?:incoming|inbound)\b|\bwires?(?:\s+(?:transfers?|fees?))*\s+in\b|^\s*\|?\s*in\s*(?:\||:|\$)/i
      : /\b(?:outgoing|outbound)\b|\bwires?(?:\s+(?:transfers?|fees?))*\s+out\b|^\s*\|?\s*out\s*(?:\||:|\$)/i;
    for (const [index, line] of lines.entries()) {
      if (handled.has(index) || !direction.test(line) || !line.includes("$")) continue;
      // A literal wire label or its immediate unpriced wire heading supplies the service.
      const prior = lines.slice(0, index).filter(value => value.trim()).at(-1) ?? "";
      if (!/\bwires?\b/i.test(line) && (!/\bwires?\b/i.test(prior) || prior.includes("$"))) continue;
      const geo = geography(line);
      if (geo === "intl") continue;
      const amounts = [...line.matchAll(MONEY)].map(match => Number(match[1].replace(/,/g, "")));
      if (geo === false || amounts.some(amount => Number.isFinite(amount) && amount !== row.amount)) {
        ambiguous.add(row.lineIndex);
      }
    }
  }
  return rows.filter(row => !ambiguous.has(row.lineIndex));
}

export type WireClauseCheck = { ok: true; sourceLine: string } | { ok: false; reason: "amount_not_the_fee" | "category_not_in_text" };

/** Shared own-clause witness; incomplete/repeated ordinary rows make no exhaustive refusal. */
export function checkWireClausePrice(
  text: string, feeName: string, amount: number, category: string | null | undefined, categoryPattern: string,
): WireClauseCheck | null {
  if (category != null && !CATEGORIES.has(category)) return null;
  const key = nameKey(feeName);
  if (!key) return null;
  const allRows = wireClausePrices(text);
  // The international clauses stay evidence, without new admission or refusal authority.
  // A generic reader asking for that literal international price keeps its existing verdict.
  if (category == null && allRows.some(row => row.canonicalKey.startsWith("wire_intl_") && row.amount === amount &&
      row.aliases.some(alias => nameKey(alias) === key))) return null;
  const rows = domesticWireClausePrices(text);
  const named = rows.filter(row => row.aliases.some(alias => nameKey(alias) === key));
  if (named.length === 0) return null;
  const own = named.filter(row => category == null || category === row.canonicalKey);
  const matching = own.find(row => row.amount === amount && new RegExp(categoryPattern.replace(/\\m|\\M/g, "\\b"), "i").test(row.ownText));
  if (matching) return { ok: true, sourceLine: matching.ownText };
  const handled = new Set(named.map(row => row.lineIndex));
  const otherOwnOccurrence = text.split(/\r?\n/).some((line, index) => !handled.has(index) &&
    (` ${nameKey(line)} `).includes(` ${key} `));
  if (otherOwnOccurrence) return null;
  return { ok: false, reason: own.length === 0 ? "category_not_in_text" : "amount_not_the_fee" };
}
