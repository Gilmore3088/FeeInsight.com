/**
 * The fee's own cells of a table line (#1394). Rosetta joins a two-column schedule into one line
 * per row ("Zipper Bags (Small)…… $4.00 | Outgoing International Wires…… $40.00/ea"), so the line
 * Knox read a fee from also carries the neighbouring column's fee. Stored as the fee's excerpt,
 * that neighbour reads as the fee's own text wherever the excerpt is quoted or re-read.
 *
 * The fee's cells are the cell that prints its price, plus the price-less cells just before it
 * that supply words of its name the price cell lacks ("Stop Payment | $25 per item"). A line
 * with no " | " cells, or no cell at the fee's price, is kept whole. Pure.
 */
const CELL_SPLIT = /\s*\|\s*/;
const PRICE = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)|(?<![\d.])\.(\d{2})\b|\b(free|no charge|none|n\/c|waived)\b/gi;
const NAME_WORD = /[a-z][a-z']{2,}/g;
const NOT_NAME_WORDS = new Set(["fee", "fees", "charge", "charges", "per", "the", "and", "for", "each", "item", "items", "with", "only"]);

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
  const atPrice = cells.findIndex(
    (cell) => prices(cell).some((value) => Math.abs(value - amount) < 0.005) && [...nameWords(cell)].some((word) => wanted.has(word)),
  );
  const priced = atPrice >= 0 ? atPrice : cells.findIndex((cell) => prices(cell).some((value) => Math.abs(value - amount) < 0.005));
  if (priced < 0) return line;
  let start = priced;
  const found = nameWords(cells[priced]);
  // Price-less cells just before the price that add a missing word of the name are its label.
  while (start > 0 && prices(cells[start - 1]).length === 0) {
    const adds = [...nameWords(cells[start - 1])].filter((word) => wanted.has(word) && !found.has(word));
    if (adds.length === 0) break;
    for (const word of adds) found.add(word);
    start -= 1;
  }
  // Nothing of the name anywhere in the run: the price is not the fee's own, keep the line.
  if (![...found].some((word) => wanted.has(word))) return line;
  return cells.slice(start, priced + 1).join(" | ");
}
