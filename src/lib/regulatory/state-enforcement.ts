/**
 * State banking departments' public enforcement orders against banks.
 *
 * States publish no common format, so each source is read with one of two generic
 * readers: `table` reads every HTML table that has a party column (name, institution,
 * bank, respondent), mapping columns by their header text; `links` reads a page of
 * links, one order per link, taking the date from the link text or URL. Only rows that
 * name a bank (bank, trust, savings, bancorp) are kept: the same pages list orders
 * against mortgage lenders, money transmitters and individuals.
 *
 * States with no list of bank orders (Kansas, Oklahoma, Nebraska, Iowa, Wisconsin,
 * Indiana among them) are not here: their joint orders appear only in federal releases.
 */
import { parseDocument } from "htmlparser2";
import { parseActionDate } from "./enforcement";
import { STATE_REGULATORS } from "./state-regulators";

export type StateOrderReader = "table" | "links";

export interface StateOrderSource {
  state: string;
  reader: StateOrderReader;
  /** Links on the listing page to read as well (a page that only points to the list). */
  follow?: RegExp;
  /** The listing pages; a source with one page per year lists each year. */
  urls: (today: Date) => string[];
}

const yearsBack = (today: Date, from: number) => {
  const out: number[] = [];
  for (let y = today.getUTCFullYear(); y >= from; y -= 1) out.push(y);
  return out;
};

export const STATE_ORDER_SOURCES: readonly StateOrderSource[] = [
  { state: "NJ", reader: "table", urls: () => ["https://www.nj.gov/dobi/division_banking/bankdivenforce.html"] },
  { state: "NY", reader: "links", urls: () => ["https://www.dfs.ny.gov/industry_guidance/enforcement_actions"] },
  {
    state: "IL",
    reader: "table",
    urls: (today) => yearsBack(today, 2015).map((y) => `https://idfpr.illinois.gov/banks/cbt/enforcement/enforcement${y}.html`),
  },
  {
    state: "MD",
    reader: "table",
    urls: (today) => yearsBack(today, 2015).map((y) => `https://www.labor.maryland.gov/FINANCE/consumers/enforcement${y}.shtml`),
  },
  { state: "WA", reader: "table", urls: () => ["https://dfi.wa.gov/banks/administrative-actions"] },
  { state: "TX", reader: "links", urls: () => ["https://www.dob.texas.gov/laws-regulations/enforcement-orders-bank"] },
  {
    state: "NC",
    reader: "links",
    follow: /state[- ]chartered bank enforcement/i,
    urls: () => ["https://nccob.nc.gov/consumer-information/enforcement-actions"],
  },
];

/** "STATE_NJ": the agency code stored on institution_enforcement_actions. */
export const stateAgencyCode = (state: string) => `STATE_${state}`;

export function isStateAgency(code: string): boolean {
  return /^STATE_[A-Z]{2}$/.test(code);
}

/** "OCC", "Federal Reserve", or the state department's name ("New Jersey Department of Banking and Insurance"). */
export function enforcementAgencyLabel(code: string): string {
  if (code === "OCC") return "OCC";
  if (code === "FRB") return "Federal Reserve";
  if (isStateAgency(code)) {
    const regulator = STATE_REGULATORS.find((r) => r.stateCode === code.slice(6));
    return regulator?.agency ?? `${code.slice(6)} banking department`;
  }
  return code;
}

/** "OCC and Federal Reserve", or "OCC, Federal Reserve and 3 state banking departments". */
export function enforcementAgencyList(codes: readonly string[]): string {
  const states = codes.filter(isStateAgency);
  const names = codes.filter((c) => !isStateAgency(c)).map(enforcementAgencyLabel);
  if (states.length === 1) names.push(enforcementAgencyLabel(states[0]));
  else if (states.length > 1) names.push(`${states.length} state banking departments`);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export interface StateOrder {
  party_name: string;
  party_city: string | null;
  action_type: string | null;
  start_date: string | null;
  termination_date: string | null;
  document_url: string | null;
}

const BANK_PARTY = /\b(bank|banc|bancorp|bancshares|banking|trust|savings|national association|n\.\s?a\.)\b/i;
const NOT_A_BANK = /\b(mortgage|money transmitter|check cash|payday|consumer lender|pawn|debt|insurance)\b/i;

export function isBankParty(name: string): boolean {
  return BANK_PARTY.test(name) && !NOT_A_BANK.test(name);
}

const ACTION_TYPE = /(consent order|cease[- ]and[- ]desist|order to cease|written agreement|memorandum of understanding|civil money penalty|supervisory agreement|prompt corrective action|order terminating[^,;]*|termination order|removal order|prohibition order|order)/i;

export function actionTypeOf(text: string): string | null {
  const m = text.match(ACTION_TYPE);
  if (!m) return null;
  const t = m[1].toLowerCase().replace(/\s+/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A yyyymmdd or yyyy-mm-dd date inside a URL or text, when it is a plausible order date. */
export function dateIn(text: string): string | null {
  const m = text.match(/(?:^|[^0-9])((?:19|20)\d{2})[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])(?![0-9])/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const words = text.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{4})\b/i);
  if (words) return parseActionDate(words[1].replace(/^Sept\.?\s/i, "Sep ").replace(/^([A-Za-z]+)\./, "$1"));
  const slashed = text.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
  return slashed ? parseActionDate(slashed[1]) : null;
}

type Node = ReturnType<typeof parseDocument>["children"][number];
interface El {
  type: string;
  name: string;
  attribs: Record<string, string>;
  children: Node[];
}
const isEl = (n: Node): n is Node & El => "name" in n && "children" in n && n.type === "tag";

function textOf(node: Node): string {
  if (node.type === "text") return (node as unknown as { data: string }).data;
  if (isEl(node)) {
    if (node.name === "script" || node.name === "style") return "";
    const inner = node.children.map(textOf).join(node.name === "br" ? "\n" : "");
    return node.name === "br" ? " " : inner;
  }
  return "";
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function all(node: Node, name: string, out: El[] = []): El[] {
  if (isEl(node)) {
    if (node.name === name) out.push(node);
    for (const c of node.children) all(c, name, out);
  } else if ("children" in node) {
    for (const c of (node as unknown as { children: Node[] }).children) all(c, name, out);
  }
  return out;
}

function resolve(href: string | undefined, baseUrl: string): string | null {
  if (!href || href.startsWith("#") || /^(mailto|javascript):/i.test(href)) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Rows of this table, not of tables nested inside it. */
function rowsOf(table: El): El[] {
  const rows: El[] = [];
  const walk = (el: El) => {
    for (const c of el.children) {
      if (!isEl(c)) continue;
      if (c.name === "tr") rows.push(c);
      else if (c.name !== "table") walk(c);
    }
  };
  walk(table);
  return rows;
}

const cellsOf = (row: El) => row.children.filter(isEl).filter((c) => c.name === "td" || c.name === "th");

type Column = "party" | "city" | "type" | "date" | "end";

/** Which column each header names; the first match wins, and the start date never takes a termination column. */
export function mapColumns(headers: readonly string[]): Partial<Record<Column, number>> {
  const map: Partial<Record<Column, number>> = {};
  headers.forEach((raw, i) => {
    const h = raw.toLowerCase();
    if (map.end === undefined && /terminat|rescind|lifted|vacat/.test(h)) map.end = i;
    else if (map.date === undefined && /date|effective|issued|signed/.test(h)) map.date = i;
    else if (map.party === undefined && /institution|bank|name|respondent|party|entity|company|licensee/.test(h)) map.party = i;
    else if (map.type === undefined && /action|type|order|document|description/.test(h)) map.type = i;
    else if (map.city === undefined && /city|location|town/.test(h)) map.city = i;
  });
  return map;
}

export function parseOrderTables(html: string, baseUrl: string): StateOrder[] {
  const doc = parseDocument(html, { decodeEntities: true });
  const orders: StateOrder[] = [];
  for (const table of all(doc as unknown as Node, "table")) {
    const rows = rowsOf(table);
    if (rows.length < 2) continue;
    const headerAt = rows.findIndex((r) => cellsOf(r).some((c) => c.name === "th"));
    const header = headerAt >= 0 ? rows[headerAt] : rows[0];
    const cols = mapColumns(cellsOf(header).map((c) => clean(textOf(c as unknown as Node))));
    if (cols.party === undefined) continue;
    for (const row of rows.slice(rows.indexOf(header) + 1)) {
      const cells = cellsOf(row);
      const cell = (k: Column) => (cols[k] !== undefined && cells[cols[k] as number] ? clean(textOf(cells[cols[k] as number] as unknown as Node)) : "");
      const party = cleanParty(cell("party"));
      if (!party || !isBankParty(party)) continue;
      const labelled = /Institution:|Type of Action:/i.test(cell("party")) ? parseLabelled(cell("party")) : null;
      if (labelled) {
        labelled.document_url = all(row as unknown as Node, "a").map((a) => resolve(a.attribs.href, baseUrl)).find(Boolean) ?? null;
        orders.push(labelled);
        continue;
      }
      const link = all(row as unknown as Node, "a").map((a) => resolve(a.attribs.href, baseUrl)).find(Boolean) ?? null;
      const typeText = cell("type");
      orders.push({
        party_name: party,
        party_city: cell("city") || null,
        action_type: actionTypeOf(typeText) ?? (typeText || null),
        start_date: parseActionDate(cell("date")) ?? dateIn(cell("date")),
        termination_date: parseActionDate(cell("end")) ?? dateIn(cell("end")),
        document_url: link,
      });
    }
  }
  return orders;
}

/**
 * A party name as the bank calls itself: no "In the matter of", "to", "(PDF)", or the
 * merger and co-respondent tail ("THE BANK OF MISSOURI, successor by merger to ...").
 */
export function cleanParty(name: string): string {
  return clean(
    name
      .replace(/\(pdf\)|\[pdf\]/gi, " ")
      .replace(/^\s*(in the matter of|in re:?|re:|to|against)\s+/i, "")
      .replace(/,?\s+(successor by merger|successor to|formerly|f\/k\/a|and its|et al)\b.*$/i, ""),
  ).replace(/^[\s,;:.-]+|[\s,;:-]+$/g, "");
}

const LABELS = /(Institution|Bank|Name of (?:Institution|Bank)|Type of Action|Action|Effective Date|Date of (?:Action|Order)|Date|Termination Date|Terminated|Reason|City|Location):/gi;

/** "Institution: X Type of Action: Y Effective Date: Z Reason: ..." as fields, or null. */
export function parseLabelled(text: string): StateOrder | null {
  const marks = [...text.matchAll(LABELS)];
  if (marks.length < 2) return null;
  const fields: Record<string, string> = {};
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? (marks[i + 1].index as number) : text.length;
    const key = m[1].toLowerCase();
    if (!(key in fields)) fields[key] = clean(text.slice((m.index as number) + m[0].length, end));
  });
  const party = fields.institution ?? fields.bank ?? fields["name of institution"] ?? fields["name of bank"];
  if (!party || !isBankParty(party)) return null;
  const date = fields["effective date"] ?? fields["date of action"] ?? fields["date of order"] ?? fields.date ?? "";
  const end = fields["termination date"] ?? fields.terminated ?? "";
  const type = fields["type of action"] ?? fields.action ?? "";
  return {
    party_name: cleanParty(party),
    party_city: fields.city ?? fields.location ?? null,
    action_type: actionTypeOf(type) ?? (type || null),
    start_date: parseActionDate(date) ?? dateIn(date),
    termination_date: parseActionDate(end) ?? dateIn(end),
    document_url: null,
  };
}

/** Every labelled order block on a page ("Institution: ..."), each with its first link. */
export function parseLabelledBlocks(html: string, baseUrl: string): StateOrder[] {
  const doc = parseDocument(html, { decodeEntities: true });
  const orders: StateOrder[] = [];
  const seen = new Set<string>();
  for (const tag of ["tr", "li", "p", "div"]) {
    for (const el of all(doc as unknown as Node, tag)) {
      const text = clean(textOf(el as unknown as Node));
      if (!/Institution:|Bank:/i.test(text) || text.length > 2_000) continue;
      // Only the innermost block that holds one order: skip a wrapper holding several.
      if ((text.match(/Institution:|Bank:/gi) ?? []).length > 1) continue;
      const order = parseLabelled(text);
      if (!order) continue;
      const key = `${order.party_name}|${order.start_date}|${order.action_type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      order.document_url = all(el as unknown as Node, "a").map((a) => resolve(a.attribs.href, baseUrl)).find(Boolean) ?? null;
      orders.push(order);
    }
  }
  return orders;
}

/** "Piermont Bank - Consent Order" -> "Piermont Bank": the bank-named piece of a link's text. */
function partyFromLinkText(text: string): string | null {
  const pieces = text.split(/\s+[-–—:|]\s+|\s*\(\s*|\s*\)\s*|,\s+(?=(?:consent|order|cease|written|civil)\b)/i).map(clean).filter(Boolean);
  const bankish = pieces.find((p) => isBankParty(p));
  if (!bankish) return null;
  return cleanParty(bankish.replace(ACTION_TYPE, ""));
}

export function parseOrderLinks(html: string, baseUrl: string): StateOrder[] {
  const doc = parseDocument(html, { decodeEntities: true });
  const seen = new Set<string>();
  const orders: StateOrder[] = [];
  for (const a of all(doc as unknown as Node, "a")) {
    const text = clean(textOf(a as unknown as Node));
    const url = resolve(a.attribs.href, baseUrl);
    if (!text || !url || seen.has(url)) continue;
    const party = partyFromLinkText(text);
    if (!party) continue;
    const actionType = actionTypeOf(text) ?? actionTypeOf(decodeURIComponent(url).replace(/[-_]/g, " "));
    const date = dateIn(text) ?? dateIn(url);
    // A menu link ("Banking and Sending Money") names no order and no date.
    if (!actionType && !date) continue;
    seen.add(url);
    orders.push({ party_name: party, party_city: null, action_type: actionType, start_date: date, termination_date: null, document_url: url });
  }
  return orders;
}

/**
 * The source's own reader first; a page it finds nothing on is read for labelled blocks,
 * then (for table sources) as a list of order links, since several states moved from
 * tables to per-order links.
 */
export function parseStateOrders(reader: StateOrderReader, html: string, baseUrl: string): StateOrder[] {
  const first = reader === "table" ? parseOrderTables(html, baseUrl) : parseOrderLinks(html, baseUrl);
  if (first.length > 0) return first;
  const labelled = parseLabelledBlocks(html, baseUrl);
  if (labelled.length > 0) return labelled;
  return reader === "table" ? parseOrderLinks(html, baseUrl) : [];
}

/** Links on a page whose text matches, resolved (for a source's `follow`). */
export function linksMatching(html: string, baseUrl: string, pattern: RegExp, limit = 3): string[] {
  const doc = parseDocument(html, { decodeEntities: true });
  const urls: string[] = [];
  for (const a of all(doc as unknown as Node, "a")) {
    const url = resolve(a.attribs.href, baseUrl);
    if (url && pattern.test(clean(textOf(a as unknown as Node))) && !urls.includes(url)) urls.push(url);
    if (urls.length >= limit) break;
  }
  return urls;
}

/** What a page looks like when a reader finds nothing there, for the run detail. */
export function describePage(html: string): { tables: number; links: number; headers: string[][]; text: string } {
  const doc = parseDocument(html, { decodeEntities: true });
  const tables = all(doc as unknown as Node, "table");
  const main = all(doc as unknown as Node, "main")[0] ?? all(doc as unknown as Node, "body")[0];
  return {
    tables: tables.length,
    links: all(doc as unknown as Node, "a").length,
    headers: tables.slice(0, 3).map((t) => rowsOf(t).slice(0, 2).flatMap((r) => cellsOf(r).map((c) => clean(textOf(c as unknown as Node)).slice(0, 60)))),
    text: clean(main ? textOf(main as unknown as Node) : "").slice(0, 600),
  };
}

/** One order's stable key: agency, party, date and type (the same order on two year pages is one row). */
export function stateOrderKey(state: string, order: StateOrder): string {
  const party = order.party_name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Without a date, the order's own link tells two orders apart.
  return [stateAgencyCode(state), party, order.start_date ?? order.document_url ?? "", (order.action_type ?? "").toLowerCase()].join("|");
}
