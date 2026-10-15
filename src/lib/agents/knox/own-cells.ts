/**
 * The fee's own cells of a table line (#1394). Rosetta joins a two-column schedule into one line
 * per row ("Zipper Bags (Small)…… $4.00 | Outgoing International Wires…… $40.00/ea"), so the line
 * Knox read a fee from also carries the neighbouring column's fee. Stored as the fee's excerpt,
 * that neighbour reads as the fee's own text wherever the excerpt is quoted or re-read.
 *
 * The fee's cells are:
 * - the cell at its price that names it best (a tie keeps the whole line, so a neighbour at the
 *   same price is never taken for the fee: "Incoming Wire $15.00 | Outgoing Wire $15.00");
 * - every price-less cell just before it: the fee's label or its product ("Stop Payment | $25",
 *   "Business Checking | Paper Statement Fee $3.00"), which Darwin's duplicate key reads;
 * - the cells just after it that state its period or condition ("| Per Month", "| Waived with
 *   $1,500 minimum daily balance"), which the frequency and waiver readers read; never the next
 *   fee's label or price ("| Monthly Maintenance | $10.00", "| Daily Overdraft Fee $5").
 * A line with no " | " cells, or no cell at the fee's price, is kept whole. Pure.
 */
const CELL_SPLIT = /\s*\|\s*/;
const PRICE = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)|(?<![\d.])\.(\d{2})\b|\b(free|no charge|none|n\/c|waived)\b/gi;
const NAME_WORD = /[a-z][a-z']{2,}/g;
const NOT_NAME_WORDS = new Set(["fee", "fees", "charge", "charges", "per", "the", "and", "for", "each", "item", "items", "with", "only"]);
/** A cell that qualifies the price before it: its period, cap or waiver. */
const CONDITION_CELL = /^(?:per\b|each\b|every\b|a\s+(?:month|year|day|week)\b|monthly|annual|yearly|quarterly|daily|weekly|waived?\b|max|min|if\b|unless\b|plus\b|up\s+to\b|after\b|when\b|with\b|for\s+each\b|\/|\()/i;

/** A priced cell that is still a condition: a waiver or a balance, never another fee's price. */
const WAIVER_CELL = /^(?:waived?\b|with\s+(?:a\s+|an\s+)?(?:\$|minimum|balance|average|direct|combined)|if\b|unless\b|(?:max|min)(?:imum)?\s+(?:of\b|\$|\d|balance)|up\s+to\s+\$)/i;

function nameWords(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[‘’ʼ`]/g, "'").match(NAME_WORD) ?? [];
  return new Set(words.map((word) => word.replace(/'s?$/, "")).filter((word) => !NOT_NAME_WORDS.has(word)));
}

function prices(cell: string): number[] {
  return Array.from(cell.matchAll(PRICE), (match) => {
    if (match[3]) return 0;
    if (match[2]) return Number(match[2]) / 100;
    return Number(match[1].replace(/,/g, ""));
  });
}

export function ownCells(line: string, feeName: string, amount: number | null): string {
  if (amount == null || !line.includes("|")) return line;
  const cells = line.split(CELL_SPLIT).map((cell) => cell.trim()).filter((cell) => cell.length > 0);
  if (cells.length < 2) return line;
  const wanted = nameWords(feeName);
  const score = (from: number, to: number) => {
    const words = new Set<string>();
    for (let k = from; k <= to; k += 1) for (const word of nameWords(cells[k])) if (wanted.has(word)) words.add(word);
    return words.size;
  };
  // Each cell at the price, with the price-less cells before it as its label.
  const runs = cells.flatMap((cell, index) => {
    if (!prices(cell).some((value) => Math.abs(value - amount) < 0.005)) return [];
    let start = index;
    while (start > 0 && prices(cells[start - 1]).length === 0) start -= 1;
    return [{ start, priced: index, score: score(start, index) }];
  });
  const best = Math.max(0, ...runs.map((run) => run.score));
  const top = runs.filter((run) => run.score === best);
  // No run names the fee, or two name it equally well: keep the line.
  if (best === 0 || top.length !== 1) return line;
  const { start, priced } = top[0];
  let end = priced;
  // A condition cell after the price, never the next fee's label (a price-less cell followed by a
  // price: "| Monthly Maintenance | $10.00") or the next fee itself ("| Daily Overdraft Fee $5").
  while (end + 1 < cells.length) {
    const next = cells[end + 1];
    const priced = prices(next).length > 0;
    const condition = priced
      ? WAIVER_CELL.test(next)
      : CONDITION_CELL.test(next) && !(end + 2 < cells.length && prices(cells[end + 2]).length > 0);
    if (!condition) break;
    end += 1;
  }
  return cells.slice(start, end + 1).join(" | ");
}
