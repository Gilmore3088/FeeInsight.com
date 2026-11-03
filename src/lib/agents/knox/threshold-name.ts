/**
 * v170 (Knox re-read backlog dry run 3, Nov 2): a fee's name keeps the dollar threshold its own line ties
 * to it with a comparison word. Knox's name builders drop every figure outside a threshold parenthetical
 * as the price, so Morton Community Bank's (273, doc 40112) "Cashier's Check more than $1,000 (MCB
 * customers only)" / "$2.00" was named "Cashier's Check more than (MCB customers only)" and "Money Orders
 * $1,000 or less (MCB customers only)" / "$1.00" was named "Money Orders or less (MCB customers only)".
 * Those names are not the page's words, so the shared check could not find the row (`tiered_fee`).
 *
 * A rename only, after every reader: the figure goes back into the name where the read's own excerpt
 * prints it, right after the comparison words ("more than $1,000 (MCB", "below $500 | $5") or right before
 * them ("Orders $1,000 or less"), and only when the name holds that slot once and does not print the
 * figure already. The category was chosen on the name without the figure and stays; the figure is never
 * the read's own price. The caller keeps the new name only where Darwin's checks still pass it.
 */
const FIGURE = String.raw`\$\s?\d[\d,]*(?:\.\d{1,2})?`;
const BEFORE_WORDS = String.raw`(?:more|less|greater|fewer)\s+than|over|under|above|below|exceeding|exceeds|up\s+to`;
const AFTER_WORDS = String.raw`or\s+(?:less|more|greater|over|under|above|below)|and\s+(?:over|up|above|under|below)`;
/** "<words> $X <next>" and "<prev> $X <words>" in the excerpt. */
const FIGURE_AFTER_WORDS = new RegExp(String.raw`\b(${BEFORE_WORDS})\s+(${FIGURE})(?![\d.]*\d)(\s+\S+|\s*$)`, "gi");
const FIGURE_BEFORE_WORDS = new RegExp(String.raw`(\S+)\s+(${FIGURE})(?![\d.]*\d)\s+(${AFTER_WORDS})\b`, "gi");

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const words = (value: string) => value.trim().split(/\s+/).map(escape).join(String.raw`\s+`);

function replaceOnce(name: string, slot: RegExp, replacement: (match: RegExpExecArray) => string): string | null {
  const found = [...name.matchAll(new RegExp(slot.source, "gi"))];
  if (found.length !== 1) return null;
  const match = found[0] as RegExpExecArray;
  const at = match.index ?? 0;
  return `${name.slice(0, at)}${replacement(match)}${name.slice(at + match[0].length)}`;
}

/** The name with its line's threshold figures put back (see the module note), or the name unchanged. */
export function withThresholdFigures(name: string, excerpt: string | null | undefined, amount: number | null | undefined): string {
  if (!excerpt || !name || !/\$\s?\d/.test(excerpt)) return name;
  const line = excerpt.replace(/\s+/g, " ");
  const figureValue = (figure: string) => Number(figure.replace(/[$,\s]/g, ""));
  const ownPrice = (figure: string) => amount != null && Math.abs(figureValue(figure) - amount) < 0.005;
  let renamed = name;
  for (const match of line.matchAll(FIGURE_AFTER_WORDS)) {
    const [, comparison, figure, next] = match;
    if (ownPrice(figure) || renamed.includes(figure)) continue;
    const nextWord = next.trim();
    // The comparison words, then the excerpt's next word (or the name's end, or a cell break or the price after it).
    const slot = nextWord && !/^[|/$]/.test(nextWord)
      ? new RegExp(String.raw`\b${words(comparison)}(?=\s+${escape(nextWord)})`, "i")
      : new RegExp(String.raw`\b${words(comparison)}(?=\s*$)`, "i");
    renamed = replaceOnce(renamed, slot, (found) => `${found[0]} ${figure}`) ?? renamed;
  }
  for (const match of line.matchAll(FIGURE_BEFORE_WORDS)) {
    const [, previous, figure, comparison] = match;
    if (ownPrice(figure) || renamed.includes(figure) || /\$|\|/.test(previous)) continue;
    const slot = new RegExp(String.raw`(?<=(?:^|\s)${escape(previous)})\s+(?=${words(comparison)}\b)`, "i");
    renamed = replaceOnce(renamed, slot, () => ` ${figure} `) ?? renamed;
  }
  return renamed;
}
