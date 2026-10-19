import { explicitAccountHeading } from "./lineup";
import { amountsIn, isConditionAmount, type ExtractedFeeCandidate } from "./rules";

const MAX_OWNER_LINES = 12;
const MAX_PRICE_LINES = 3;
const MAX_BLOCK_CHARS = 2_000;
const MONTHLY_FEE = /\bmonthly\b[^$]{0,48}\b(?:fee|charge)s?\b|\b(?:fee|charge)s?\b[^$]{0,48}\bper\s+month\b/i;
const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g;
const squash = (value: string) => value.replace(/\s+/g, " ").trim();
const phrase = (value: string) => squash(value.replace(/^\s*[•*\-]\s*/, "")).toLowerCase();
const ownerKey = (value: string) => {
  const key = phrase(value);
  return /\b(?:checking|savings|money market)\b/.test(key) ? key.replace(/\s+accounts?$/, "") : key;
};
const prices = (value: string) => [...value.matchAll(MONEY)].map(match => Math.round(Number(match[1].replace(/,/g, "")) * 100));
function containsLiteral(whole: string, part: string): boolean {
  const literal = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${literal}(?=$|[^\\p{L}\\p{N}])`, "u").test(whole);
}

interface OwnedRow {
  start: number;
  owner: string;
  row: string;
  block: string;
  price: number;
  end: number;
}

/**
 * A repeated generic monthly price is not one identifiable account's fee. Preserve two
 * complete, bounded literal owner/price blocks for eligibility review instead of choosing
 * whichever occurrence survives the line and specialist dedupe. This is not a product reader:
 * unique, explicitly assigned and unsupported layouts retain their existing behavior.
 */
export function monthlyAccountOwnerReview(text: string, institutionName?: string | null) {
  const lines = text.split("\n");
  const rows: OwnedRow[] = [];
  let owner: string | null = null;
  let headingAt = -1;
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    const heading = explicitAccountHeading(line, institutionName);
    if (heading) { owner = heading; headingAt = at; continue; }
    // An unsupported account title still ends the prior account. A retired product's
    // parenthetical or an unfamiliar uppercase heading cannot inherit its predecessor.
    const possibleTitle = line.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (!line.includes("$") && /\b(?:accounts?|checking|savings|money market)\b/i.test(possibleTitle) &&
      /[A-Z]/.test(possibleTitle) && possibleTitle === possibleTitle.toUpperCase()) { owner = null; continue; }
    if (!line.trim() || line.includes("|")) { owner = null; continue; }
    if (!owner || at - headingAt > MAX_OWNER_LINES || !line.includes("$")) continue;
    for (let count = 1; count <= MAX_PRICE_LINES && at + count <= lines.length; count++) {
      const ownLines = lines.slice(at, at + count);
      if (ownLines.some((part, index) => !part.trim() || part.includes("|") ||
        (index > 0 && (part.includes("$") || explicitAccountHeading(part, institutionName) ||
          !/^\s*(?:[a-z(]|If\b|Unless\b|When\b|Minimum\b|Average\b|Monthly balance\b)/.test(part))))) break;
      const row = squash(ownLines.join(" "));
      const feePrices = amountsIn(row).filter(amount => !isConditionAmount(row, amount));
      if (!MONTHLY_FEE.test(row) || feePrices.length !== 1) continue;
      const block = lines.slice(headingAt, at + count).join("\n").trim();
      // Never truncate an owner or its price/condition witness to make a review unit fit.
      if (block.length <= MAX_BLOCK_CHARS) rows.push({ start: at, end: at + count, owner, row, block, price: Math.round(feePrices[0].value * 100) });
    }
  }
  const complete = [...new Map(rows.map(row => [row.start, row])).values()].filter(row => {
    // A price plus an unfinished waiver/condition is not a complete bounded witness.
    // Unsupported or over-budget prose remains unknown instead of retaining a prefix.
    if (/(?:\b(?:and|or|if|unless|when|following|with|the|minimum|average)|(?:may|can) be waived|:)\s*$/i.test(row.row)) return false;
    const next = lines[row.end];
    return row.end - row.start < MAX_PRICE_LINES || next == null || !next.trim() || next.includes("$") ||
      next.includes("|") || Boolean(explicitAccountHeading(next, institutionName)) ||
      !/^\s*(?:[a-z(]|If\b|Unless\b|When\b|Minimum\b|Average\b|Monthly balance\b)/.test(next);
  });
  return (candidate: ExtractedFeeCandidate): string | null => {
    if (candidate.canonicalHint !== "monthly_maintenance") return null;
    const needle = phrase(candidate.excerpt);
    const ownPrices = prices(candidate.excerpt);
    const cents = Math.round(candidate.amount * 100);
    if (needle.length < 12 || !MONTHLY_FEE.test(needle) || !ownPrices.includes(cents) || candidate.excerpt.includes("|")) return null;
    // A model can honestly quote the account heading and its balance before the fee.
    // Those extra figures are context; the indexed physical price row still owns one price.
    const matches = complete.filter(row => row.price === cents &&
      (containsLiteral(phrase(row.row), needle) ||
        (needle.endsWith(phrase(row.row)) && containsLiteral(needle, phrase(row.row)))));
    const byOwner = new Map<string, OwnedRow>();
    for (const row of matches) {
      const key = ownerKey(row.owner);
      if (!byOwner.has(key)) byOwner.set(key, row);
    }
    if (byOwner.size < 2) return null;
    const assigned = ownerKey(candidate.lineup?.productName ?? "");
    if (assigned && byOwner.has(assigned)) return null;
    const named = phrase(candidate.feeName);
    const namedOwners = [...byOwner.keys()].filter(key => containsLiteral(named, key));
    // "Rewards Checking Plus" explicitly names the longer account, rather than two
    // owners merely because another heading is "Rewards Checking".
    const specific = namedOwners.filter(key => !namedOwners.some(other => other !== key && containsLiteral(other, key)));
    if (specific.length === 1) return null;
    return [...byOwner.values()].slice(0, 2).map(row => row.block).join("\n\n");
  };
}
