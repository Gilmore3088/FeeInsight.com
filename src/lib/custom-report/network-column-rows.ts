/**
 * #1905: an ATM network table, one column per network, priced row by row. Pure, and shared: Knox
 * reads each row's non-network price with it (`runFreeSpecialists`) and the source check traces
 * those reads with it, so a read is stated by the same rule that made it.
 *
 *   Transaction Type | Navy Federal ATM | CO-OP ATM Network® | Non-Navy Federal/Non-CO-OP Network ATM | MAESTRO | ...
 *   Share withdrawal $1,000 maximum per 24 hours† | None | None | $1.00 | Not applicable | ...
 *   Transfer | None | None | $1.00 | Not applicable | ...
 *   Credit card cash advance§ | None | $0.50 | $1.00 plus ATM owner fees | Not applicable | ...
 *
 * (Navy Federal, doc 39026; R-G FCU's "Item/Service | Non-Owned ATM Fee | Owned ATM Fee", doc 35833.)
 * Read cell by cell, Knox's passes took a row's first price whatever its column: "Credit card cash
 * advance" at the CO-OP column's $0.50, and the share withdrawal row, the account's own non-network
 * fee, was never read at all because its name carries the $1,000 daily limit. The fee for using
 * another network's ATM is the non-network column's price, so each row is read there and named by
 * the row and that column ("Share withdrawal at Non-Navy Federal/Non-CO-OP Network ATM").
 *
 * Only a header that is a table header arms it: three to eight short cells, no figure, exactly one
 * cell naming an ATM the bank does not own or another network's ("Non-...", "Other", "Foreign",
 * "Out-of-Network") and another naming an ATM or network of its own. The table is the run of rows
 * under it with the same number of cells; any other line ends it. A row is read only when it prices
 * a use of the machine (a withdrawal, transfer, inquiry or balance) at a flat dollar figure that
 * opens its non-network cell; a credit card's cash advance (a card fee, not the account's), a
 * rejected or invalid attempt, a purchase, a free or unavailable cell and a conditional price
 * ("$3.00 per transfer after 4") give no read. Only the machine rows are hidden from the other
 * readers; a stop payment or monthly fee row under the same header stays theirs.
 */

const CELL = "|";
const MIN_CELLS = 3;
const MAX_CELLS = 8;
const MAX_HEADER_CELL_WORDS = 8;
/** A header over one row is a two-line note, not a table. */
const MIN_ROWS = 2;
const MONEY = /\$\s?\d|\d\.\d{2}\b/;
const ATM_WORDS = /\b(?:atms?|co-?op|allpoint|moneypass|cirrus|plus|star|pulse|nyce|network|machines?)\b/i;
/**
 * A column for an ATM the bank does not own, or another network's. A non-member's or non-customer's
 * column ("Non-Member ATM Fee") is what an outsider pays at the bank's own machines, never this.
 */
const NON_NETWORK_COLUMN =
  /^(?=.*\b(?:atms?|machines?)\b)(?!.*\bnon[- ]?(?:members?|customers?|clients?|account ?holders?|depositors?)\b)(?:.*\bnon[- ]?\w|.*\b(?:other|foreign|out[- ]of[- ]network|not\s+owned)\b)/i;
/**
 * The bank's own column names an ATM or a network by name ("Navy Federal ATM", "CO-OP ATM Network",
 * "Owned ATM Fee"). A bare "star", "plus" or "network" inside a product's name ("Star Checking") is
 * no ATM column (#1905 review).
 */
const OWN_COLUMN = /\b(?:atms?|machines?)\b|\b(?:co-?op|allpoint|moneypass|cirrus|nyce|pulse)\b|\b(?:star|plus)\s+(?:atms?|networks?)\b/i;
/**
 * A row about the machine or a card at it: the only rows the table's reader owns, so the only rows
 * blanked for the other readers. "Stop Payment | $30 | $30", a monthly fee or an overdraft row under
 * the same header stay theirs (#1905 review).
 */
const ATM_ROW =
  /\b(?:withdraw\w*|w\/d|transfers?|inquir\w*|balances?|deposits?|reject\w*|denied|declin\w*|invalid|insufficient|pin|cash\s+advances?|purchases?|atms?|pos|point[- ]of[- ]sale|surcharges?)\b/i;
/**
 * What may follow the price in the non-network cell for a flat read: nothing, or a plain unit. A
 * condition ("$3.00 per transfer after 4") makes the price conditional, so the row gives no read
 * (#1905 review).
 */
const FLAT_UNIT = /^(?:each|per\s+(?:transaction|item|withdrawal|transfer|inquiry|use|occurrence))?$/i;
/** A row that prices a use of the machine. */
const MACHINE_USE = /\b(?:withdraw\w*|w\/d|transfers?|inquir\w*|balances?)\b/i;
/** A row that is no fee of the account's at another network's ATM. */
const NOT_ACCOUNT_USE = /\bcredit\s+cards?\b|\b(?:reject\w*|denied|declin\w*|invalid|insufficient|purchases?|deposits?)\b/i;
const PRICE_OPENS_CELL = /^\$\s?(\d[\d,]*(?:\.\d{1,2})?)(?![\d,])/;
const FOOTNOTE_MARKS = /[†‡§¶*®™¹²³⁴⁵⁶⁷⁸⁹⁰]+/g;
/** A limit printed in the row's name ("$1,000 maximum per 24 hours"): the row's limit, never part of its name. */
const NAME_LIMIT = /\s*\$\s?\d[\d,]*(?:\.\d{1,2})?\s+(?:maximum|max\.?|limit)\b.*$/i;

export interface NetworkColumnRead {
  /** "<row> at <non-network column>". */
  feeName: string;
  amount: number;
  /** The stored row, as printed. */
  row: string;
  lineIndex: number;
}

function cellsOf(line: string): string[] {
  return line.split(CELL).map((cell) => cell.trim());
}

/** The non-network column's index when the line is a network table's header, or null. */
export function networkHeaderColumn(line: string): number | null {
  if (MONEY.test(line)) return null;
  const cells = cellsOf(line);
  if (cells.length < MIN_CELLS || cells.length > MAX_CELLS || cells.some((cell) => cell.length === 0)) return null;
  // A header cell is a label: short, no sentence, opening on a capital ("at international ATMs
  // (outside the U.S., ..." is a PDF line of prose, not a column).
  if (cells.some((cell) => cell.split(/\s+/).length > MAX_HEADER_CELL_WORDS || /[.;:!?]\s/.test(cell) || /^[a-z]/.test(cell))) return null;
  if (ATM_WORDS.test(cells[0]) && !/^(?:item|service|transaction|type|fee|description)/i.test(cells[0])) return null;
  const nonNetwork = cells.map((cell, index) => (index > 0 && NON_NETWORK_COLUMN.test(cell) ? index : -1)).filter((index) => index > 0);
  if (nonNetwork.length !== 1) return null;
  const column = nonNetwork[0];
  const own = cells.some((cell, index) => index > 0 && index !== column && OWN_COLUMN.test(cell));
  return own ? column : null;
}

function columnName(header: string): string {
  return header.replace(FOOTNOTE_MARKS, "").replace(/\s+(?:fees?|charges?)\s*$/i, "").replace(/\s+/g, " ").trim();
}

function rowName(cell: string): string {
  return cell.replace(FOOTNOTE_MARKS, "").replace(NAME_LIMIT, "").replace(/\s+/g, " ").trim();
}

/** Every network table row's non-network read in the text (see the module note). */
export function networkColumnReads(text: string): NetworkColumnRead[] {
  const lines = text.split("\n");
  const reads: NetworkColumnRead[] = [];
  for (const table of networkTables(lines)) {
    const header = columnName(cellsOf(lines[table.header])[table.column]);
    for (const index of table.rows) {
      const cells = cellsOf(lines[index]);
      const name = rowName(cells[0]);
      if (!/[a-z]{3,}/i.test(name) || !MACHINE_USE.test(name) || NOT_ACCOUNT_USE.test(name)) continue;
      const cell = cells[table.column];
      const price = PRICE_OPENS_CELL.exec(cell);
      if (!price) continue;
      const amount = Number(price[1].replace(/,/g, ""));
      if (!(amount > 0)) continue;
      const rest = cell.slice(price[0].length).replace(FOOTNOTE_MARKS, "").replace(/^[\s.,;:()-]+|[\s.,;:()-]+$/g, "");
      if (!FLAT_UNIT.test(rest)) continue;
      reads.push({ feeName: `${name} at ${header}`, amount, row: lines[index].trim(), lineIndex: index });
    }
  }
  return reads;
}

/** Each network table in the lines: its header line, non-network column and row lines. */
export function networkTables(lines: readonly string[]): Array<{ header: number; column: number; rows: number[] }> {
  const tables: Array<{ header: number; column: number; rows: number[] }> = [];
  for (let at = 0; at < lines.length; at += 1) {
    const column = networkHeaderColumn(lines[at]);
    if (column == null) continue;
    const width = cellsOf(lines[at]).length;
    const rows: number[] = [];
    let next = at + 1;
    for (; next < lines.length; next += 1) {
      const line = lines[next].trim();
      if (!line) continue;
      if (!line.includes(CELL) || cellsOf(line).length !== width) break;
      rows.push(next);
    }
    if (rows.length >= MIN_ROWS) tables.push({ header: at, column, rows });
    at = next - 1;
  }
  return tables;
}

/**
 * The text with each network table's machine rows (`ATM_ROW`) blank, so a reader that takes a row's
 * first price never reads another column's ("Credit card cash advance" at the CO-OP column's $0.50).
 * Any other row under the header ("Stop Payment | $30 | $30") stays for the other readers. Line
 * count kept.
 */
export function withoutNetworkTableRows(text: string): string {
  if (!/\b(?:atms?|machines?)\b/i.test(text)) return text;
  const lines = text.split("\n");
  const tables = networkTables(lines);
  if (tables.length === 0) return text;
  for (const table of tables) {
    for (const index of table.rows) if (ATM_ROW.test(rowName(cellsOf(lines[index])[0]))) lines[index] = "";
  }
  return lines.join("\n");
}

function key(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The last text read and its reads: the source check asks once per fee of the same document. */
let cached: { text: string; reads: NetworkColumnRead[] } | null = null;
function cachedReads(text: string): NetworkColumnRead[] {
  if (cached?.text !== text) cached = { text, reads: /\b(?:atms?|machines?)\b/i.test(text) ? networkColumnReads(text) : [] };
  return cached.reads;
}

/** The stored row a composed network read traces to, or null (the source check's path). */
export function networkColumnRow(text: string, feeName: string, amount: number): string | null {
  // Only a name the table composes ("<row> at <column>") can trace here.
  if (!/\sat\s/i.test(feeName)) return null;
  const wanted = key(feeName);
  const read = cachedReads(text).find((row) => key(row.feeName) === wanted && Math.abs(row.amount - amount) < 0.005);
  return read ? read.row : null;
}
