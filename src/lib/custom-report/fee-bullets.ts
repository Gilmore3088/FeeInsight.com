/** Physical single-column fee bullets, shared by Knox and its source witness. Pure. */
export interface FeeBullet {
  title: string;
  /** Complete owned text: conditions stay with the title and its price. */
  text: string;
  /** Only formatting leaders/whitespace are compacted, never words or conditions. */
  compactText: string;
  /** Explicit reference evidence, separate from the price's own charging-unit text. */
  linkedConditions: string | null;
  start: number;
  end: number;
  price: number | null;
  priceText: string | null;
  problem: "boundary" | "budget" | "ambiguous_price" | null;
}

export const FEE_BULLET_MAX_LINES = 6;
export const FEE_BULLET_MAX_CHARS = 2_000;
const BULLET = /^(?:[•●▪‣]\s*|[-*]\s+)/;
const LABEL = /^(?:[•●▪‣]\s*|[-*]\s+)([^|$%\n]{1,80}?)(?:\s+[—–]\s*|:\s+)(.+)$/;
const CONTINUATION = /^(?:[a-z]|\([A-Z][A-Z0-9]{0,9}\)\s+[a-z])/;
const MONEY = /\$\s*\d[\d,]*(?:\.\d{1,2})?(?!\d)/g;
// A terminal own price is printed against a leader, not inferred from a balance/cap nearby.
const TERMINAL_PRICE = /[.…]{3,}\s*(\$\s*\d[\d,]*(?:\.\d{1,2})?)(\s*(?:per\s+(?:item|occurrence|transaction)|each|\/item)?\s*\*?)\s*$/i;
const COUNT_CAP_NOTE = /^\*\s*No more than (?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b[^$%|\t]{0,240}\bfees?\b[^$%|\t]{0,100}\bper day\.?$/i;
const STAR_REFERENCE = /\*\s*[.…]{3,}\s*\$/;
const clean = (value: string) => value.replace(/\s+/g, " ").trim();

/** Inspect physical boundaries before callers collapse blank lines or split prose. */
export function feeBullets(text: string): FeeBullet[] {
  const lines = text.split(/\r?\n/);
  const result: FeeBullet[] = [];
  for (let start = 0; start < lines.length; start++) {
    const first = lines[start].trim();
    const label = LABEL.exec(first);
    if (!label || label[1].trim().split(/\s+/).length > 10) continue;
    // Already priced single physical rows stay with the existing readers. This
    // assembler owns wrapped descriptions and explicit leader-price units only.
    if (((first.match(MONEY)?.length ?? 0) > 0 && !TERMINAL_PRICE.test(first)) || /\b(?:free|none|no charge)\s*$/i.test(first)) continue;
    const parts = [first];
    let end = start;
    let problem: FeeBullet["problem"] = null;
    let price: number | null = null;
    let priceText: string | null = null;
    for (;;) {
      const full = parts.join(" ");
      const money = full.match(MONEY) ?? [];
      if (full.length > FEE_BULLET_MAX_CHARS) { problem = "budget"; break; }
      if (full.includes("|") || /\t/.test(lines[end])) { problem = "boundary"; break; }
      if (money.length > 0) {
        const terminal = TERMINAL_PRICE.exec(parts.at(-1)!);
        if (money.length !== 1 || !terminal || /\d\s*%/.test(full)) { problem = "ambiguous_price"; break; }
        priceText = terminal[1] + terminal[2];
        price = Number(terminal[1].replace(/[$,\s]/g, ""));
        break;
      }
      const next = lines[end + 1]?.trim();
      if (end - start + 1 >= FEE_BULLET_MAX_LINES) { problem = "budget"; break; }
      if (!next || BULLET.test(next) || next.includes("|") || !CONTINUATION.test(next)) { problem = "boundary"; break; }
      parts.push(next);
      end++;
    }
    const full = parts.join(" ");
    result.push({ title: clean(label[1]), text: full, compactText: clean(full.replace(/[.…]{3,}/g, " ... ")),
      start, end, price, priceText, problem, linkedConditions: null });
    start = end;
  }
  // A repeated asterisk can link adjacent fee units to one count-cap note. Cross
  // only complete units bearing that same reference, never a blank, table or
  // unrelated row. This note stays evidence; it supplies neither price nor unit.
  const byStart = new Map(result.map((row) => [row.start, row]));
  for (const row of result) {
    if (row.problem || !STAR_REFERENCE.test(row.text)) continue;
    for (let at = row.end + 1; at <= row.end + 12; ) {
      const line = lines[at]?.trim() ?? "";
      if (COUNT_CAP_NOTE.test(line) && row.compactText.length + line.length <= FEE_BULLET_MAX_CHARS) {
        row.linkedConditions = line;
        break;
      }
      const next = byStart.get(at);
      if (!next || next.problem || !STAR_REFERENCE.test(next.text)) break;
      at = next.end + 1;
    }
  }
  return result;
}

/** Keep a physical boundary where an owned unit left the legacy fragment reader. */
export function withoutFeeBullets(text: string, bullets: readonly FeeBullet[]): string {
  const lines = text.split(/\r?\n/);
  for (const row of bullets) {
    // An ambiguous physical table row can still contain a valid neighboring cell.
    if (/[|\t]/.test(row.text)) continue;
    lines[row.start] = "•";
    for (let i = row.start + 1; i <= row.end; i++) lines[i] = "";
  }
  return lines.join("\n");
}

/** A primary label or that label followed by its explicit description delimiter. */
export function ownsBulletName(row: FeeBullet, name: string): boolean {
  const primary = name.replace(BULLET, "").split(/\s+[—–]\s*|:\s+/)[0];
  return clean(primary).toLocaleLowerCase("en-US") === row.title.toLocaleLowerCase("en-US");
}
